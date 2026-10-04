import { STORES, dbClear, dbGet, dbPut } from './storage'
import { angleDiff, bearing, lonLatToTile, segmentProjection, tileBounds } from './geo'
import { isNative, nativeFetch } from './native'

// Bike infrastructure from OpenStreetMap via Overpass.
//
// Mapbox Streets carries dedicated cycleways (class=path, type=cycleway), but
// not painted lanes on ordinary roads, and nothing about which way a lane
// flows. OSM has both. Data is fetched per z13 tile (~3 km square), cached in
// IndexedDB for two weeks, and kept in memory around wherever the rider is.

const TILE_Z = 13
const TTL = 14 * 24 * 3600 * 1000
const RETRY_AFTER = 60_000
const MAX_TILES_IN_MEMORY = 64
// Tried in order; whichever answers becomes the first choice for the next tile.
// Hosts must stay in sync with NativeBridge.fetchHosts on the iOS side.
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export const KIND_LABEL = {
  path: 'Bike Path',
  track: 'Protected Lane',
  lane: 'Bike Lane',
  shared: 'Shared Lane',
}
const KIND_RANK = { path: 4, track: 3, lane: 2, shared: 1 }

const LANE_VALUES = 'lane|track|shared_lane|share_busway|opposite_lane|opposite_track|opposite_share_busway'

function buildQuery([w, s, e, n]) {
  const bb = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`
  return `[out:json][timeout:25];
(
  way["highway"="cycleway"]${bb};
  way["highway"~"^(path|footway|bridleway|pedestrian|track)$"]["bicycle"="designated"]${bb};
  way["highway"]["cycleway"~"^(${LANE_VALUES})$"]${bb};
  way["highway"]["cycleway:both"~"^(${LANE_VALUES})$"]${bb};
  way["highway"]["cycleway:left"~"^(${LANE_VALUES})$"]${bb};
  way["highway"]["cycleway:right"~"^(${LANE_VALUES})$"]${bb};
  way["highway"]["bicycle_road"="yes"]${bb};
  way["highway"]["cyclestreet"="yes"]${bb};
);
out tags geom;`
}

function laneKind(value) {
  switch (value) {
    case 'track':
    case 'opposite_track':
      return 'track'
    case 'lane':
    case 'opposite_lane':
      return 'lane'
    case 'shared_lane':
    case 'share_busway':
    case 'opposite_share_busway':
      return 'shared'
    default:
      return null
  }
}

function onewayOf(tags, key = 'oneway') {
  const v = tags[key]
  if (v === 'yes' || v === '1' || v === 'true') return 1
  if (v === '-1' || v === 'reverse') return -1
  if (v === 'no') return 0
  return key === 'oneway' && tags.junction === 'roundabout' ? 1 : null
}

/**
 * Turns one OSM way into 0–2 rendered features. Painted lanes become one
 * feature per side, offset off the road centreline, each carrying the
 * direction bikes travel in it — that is what the white arrows draw from.
 * Directions assume right-hand traffic.
 */
function waysToFeatures(way) {
  const tags = way.tags || {}
  const coords = (way.geometry || []).map((g) => [g.lon, g.lat])
  if (coords.length < 2) return []
  const name = tags.name || ''
  const make = (kind, side, dir) => ({
    key: `${way.id}:${side}`,
    feature: {
      type: 'Feature',
      properties: { kind, dir, off: side === 'right' ? 1 : side === 'left' ? -1 : 0, name },
      geometry: { type: 'LineString', coordinates: coords },
    },
  })

  if (
    tags.highway === 'cycleway' ||
    (tags.bicycle === 'designated' && /^(path|footway|bridleway|pedestrian|track)$/.test(tags.highway))
  ) {
    const dir = onewayOf(tags, 'oneway:bicycle') ?? onewayOf(tags) ?? 0
    return [make('path', 'center', dir)]
  }

  const roadOneway = onewayOf(tags) ?? 0
  const bikeTwoWay = tags['oneway:bicycle'] === 'no'
  const both = tags['cycleway:both']
  const right = laneKind(tags['cycleway:right'] ?? both)
  const left = laneKind(tags['cycleway:left'] ?? both)
  const out = []

  const sideDir = (side, value) => {
    const explicit = onewayOf(tags, `cycleway:${side}:oneway`)
    if (explicit != null) return explicit
    if (roadOneway !== 0) {
      if (String(value).startsWith('opposite') || (bikeTwoWay && side === 'left')) return -roadOneway
      return roadOneway
    }
    return side === 'right' ? 1 : -1
  }

  if (right || left) {
    if (right) out.push(make(right, 'right', sideDir('right', tags['cycleway:right'] ?? both)))
    if (left) out.push(make(left, 'left', sideDir('left', tags['cycleway:left'] ?? both)))
    return out
  }

  const generic = laneKind(tags.cycleway)
  if (generic) {
    if (roadOneway !== 0) {
      if (tags.cycleway.startsWith('opposite')) out.push(make(generic, 'left', -roadOneway))
      else out.push(make(generic, 'right', roadOneway))
    } else {
      out.push(make(generic, 'right', 1), make(generic, 'left', -1))
    }
    return out
  }

  if (tags.bicycle_road === 'yes' || tags.cyclestreet === 'yes') return [make('shared', 'center', roadOneway)]
  return []
}

function indexEntry({ key, feature }) {
  const coords = feature.geometry.coordinates
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of coords) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return { key, feature, bbox: [w, s, e, n] }
}

export class BikeInfra {
  constructor({ onChange } = {}) {
    this.onChange = onChange
    this.tiles = new Map() // key → { entries, used }
    this.pending = new Map() // key → priority
    this.inflight = 0
    this.failedUntil = new Map()
    this.endpoint = 0
    this.focus = null
    this.enabled = true
    this.changeTimer = null
  }

  setEnabled(on) {
    this.enabled = on
    if (!on) this.pending.clear()
    this.notify()
  }

  notify() {
    clearTimeout(this.changeTimer)
    this.changeTimer = setTimeout(() => this.onChange?.(), 250)
  }

  tileKeyAt(lon, lat) {
    const [x, y] = lonLatToTile(lon, lat, TILE_Z)
    return `${x}/${y}`
  }

  hasDataAt(lon, lat) {
    return this.tiles.has(this.tileKeyAt(lon, lat))
  }

  /** Rider position: the 3×3 block around them, nearest first. */
  ensureAround(lon, lat) {
    if (!this.enabled) return
    const [cx, cy] = lonLatToTile(lon, lat, TILE_Z)
    this.focus = [cx, cy]
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) this.request(`${cx + dx}/${cy + dy}`, Math.abs(dx) + Math.abs(dy))
    }
  }

  /** Map viewport while browsing; capped so a zoomed-out pan can't queue a city. */
  ensureBounds([w, s, e, n]) {
    if (!this.enabled) return
    const [x0, y0] = lonLatToTile(w, n, TILE_Z)
    const [x1, y1] = lonLatToTile(e, s, TILE_Z)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 16) return
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    if (!this.focus) this.focus = [Math.round(cx), Math.round(cy)]
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) this.request(`${x}/${y}`, 3 + Math.hypot(x - cx, y - cy))
    }
  }

  request(key, priority) {
    if (this.tiles.has(key)) {
      this.tiles.get(key).used = Date.now()
      return
    }
    if ((this.failedUntil.get(key) || 0) > Date.now()) return
    const current = this.pending.get(key)
    if (current == null || priority < current) this.pending.set(key, priority)
    this.pump()
  }

  pump() {
    // One request at a time. Overpass is a shared volunteer service and its
    // fair-use policy asks for no more than two concurrent queries per client.
    if (this.inflight > 0 || !this.pending.size || !this.enabled) return
    let bestKey = null, bestPriority = Infinity
    for (const [key, priority] of this.pending) {
      if (priority < bestPriority) {
        bestKey = key
        bestPriority = priority
      }
    }
    this.pending.delete(bestKey)
    this.inflight++
    this.loadTile(bestKey)
      .catch((err) => {
        console.warn('bike lanes: tile failed', bestKey, err?.message || err)
        this.failedUntil.set(bestKey, Date.now() + RETRY_AFTER)
      })
      .finally(() => {
        this.inflight--
        this.pump()
      })
  }

  async loadTile(key) {
    const cached = await dbGet(STORES.tiles, key)
    if (cached && Date.now() - cached.t < TTL) {
      this.install(key, cached.ways)
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (cached) this.install(key, cached.ways)
      throw new Error('offline')
    }
    const [x, y] = key.split('/').map(Number)
    let json
    try {
      json = await this.fetchOverpass(buildQuery(tileBounds(x, y, TILE_Z)))
    } catch (err) {
      // Stale beats nothing when the network is down.
      if (cached) this.install(key, cached.ways)
      throw err
    }
    const ways = (json.elements || [])
      .filter((el) => el.type === 'way')
      .map((el) => ({ id: el.id, tags: el.tags, geometry: el.geometry }))
    dbPut(STORES.tiles, key, { t: Date.now(), ways })
    this.install(key, ways)
  }

  async fetchOverpass(query) {
    const body = `data=${encodeURIComponent(query)}`
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
    let lastError = null
    for (let attempt = 0; attempt < ENDPOINTS.length; attempt++) {
      const index = (this.endpoint + attempt) % ENDPOINTS.length
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 35_000)
      try {
        const res = isNative
          ? await nativeFetch(ENDPOINTS[index], { method: 'POST', headers, body, timeout: 40_000 })
          : await fetch(ENDPOINTS[index], { method: 'POST', body, headers, signal: controller.signal })
        if (!res.ok) {
          lastError = new Error(`Overpass HTTP ${res.status}`)
          continue
        }
        const json = await res.json()
        this.endpoint = index
        return json
      } catch (err) {
        lastError = err
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError || new Error('Overpass unavailable')
  }

  install(key, ways) {
    const entries = []
    for (const way of ways) for (const item of waysToFeatures(way)) entries.push(indexEntry(item))
    this.tiles.set(key, { entries, used: Date.now() })
    this.evict()
    this.notify()
  }

  evict() {
    if (this.tiles.size <= MAX_TILES_IN_MEMORY) return
    const byAge = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used)
    for (const [key] of byAge.slice(0, this.tiles.size - MAX_TILES_IN_MEMORY)) this.tiles.delete(key)
  }

  /** Every loaded feature, deduplicated across tile borders. */
  geojson() {
    const seen = new Set()
    const features = []
    if (this.enabled) {
      for (const { entries } of this.tiles.values()) {
        for (const { key, feature } of entries) {
          if (seen.has(key)) continue
          seen.add(key)
          features.push(feature)
        }
      }
    }
    return { type: 'FeatureCollection', features }
  }

  /**
   * Closest bike facility to a fix, or null. Where both sides of a road have
   * lanes the GPS cannot tell which one the rider is in, so the side whose
   * flow matches the rider's course wins.
   */
  nearest(lon, lat, course, maxDist) {
    if (!this.enabled) return null
    const [cx, cy] = lonLatToTile(lon, lat, TILE_Z)
    const padLat = maxDist / 110574
    const padLon = maxDist / (111320 * Math.cos((lat * Math.PI) / 180))
    const p = [lon, lat]
    const seen = new Set()
    let best = null
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const tile = this.tiles.get(`${cx + dx}/${cy + dy}`)
        if (!tile) continue
        tile.used = Date.now()
        for (const { key, feature, bbox } of tile.entries) {
          if (seen.has(key)) continue
          seen.add(key)
          if (lon < bbox[0] - padLon || lon > bbox[2] + padLon || lat < bbox[1] - padLat || lat > bbox[3] + padLat) continue
          const coords = feature.geometry.coordinates
          let minDist = Infinity, segIndex = 0
          for (let i = 0; i < coords.length - 1; i++) {
            const { dist } = segmentProjection(p, coords[i], coords[i + 1])
            if (dist < minDist) {
              minDist = dist
              segIndex = i
            }
          }
          if (minDist > maxDist) continue
          const { kind, dir, name } = feature.properties
          let score = minDist - KIND_RANK[kind] * 1.5
          if (dir !== 0 && course != null) {
            const flow = (bearing(coords[segIndex], coords[segIndex + 1]) + (dir < 0 ? 180 : 0)) % 360
            if (Math.abs(angleDiff(course, flow)) > 100) score += maxDist
          }
          if (!best || score < best.score) best = { kind, name, dist: minDist, score }
        }
      }
    }
    return best
  }

  async clearCache() {
    this.tiles.clear()
    this.pending.clear()
    this.failedUntil.clear()
    await dbClear(STORES.tiles)
    this.notify()
  }
}
