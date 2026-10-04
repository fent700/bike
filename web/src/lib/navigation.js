import { cumulativeDistances, distance, nearestOnLine } from './geo'

const API = 'https://api.mapbox.com'

export const newSessionToken = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

/**
 * Search Box API suggest. A session (suggest… + one retrieve) is the billing
 * unit, so the caller keeps one token for the whole time the sheet is open.
 */
export async function searchSuggest(query, { token, session, proximity, signal }) {
  const params = new URLSearchParams({
    q: query,
    access_token: token,
    session_token: session,
    language: 'en',
    limit: '7',
    types: 'poi,address,street,place,neighborhood,locality,postcode',
  })
  if (proximity) params.set('proximity', `${proximity[0].toFixed(5)},${proximity[1].toFixed(5)}`)
  if (proximity) params.set('origin', `${proximity[0].toFixed(5)},${proximity[1].toFixed(5)}`)
  const res = await fetch(`${API}/search/searchbox/v1/suggest?${params}`, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const json = await res.json()
  return (json.suggestions || []).map((s) => ({
    id: s.mapbox_id,
    name: s.name,
    address: s.full_address || s.place_formatted || s.address || '',
    distance: s.distance ?? null,
    category: s.poi_category?.[0] || s.feature_type || '',
  }))
}

export async function searchRetrieve(id, { token, session }) {
  const params = new URLSearchParams({ access_token: token, session_token: session })
  const res = await fetch(`${API}/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${params}`)
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
  const json = await res.json()
  const f = json.features?.[0]
  if (!f) throw new Error('Place not found')
  const props = f.properties || {}
  const nav = props.coordinates?.routable_points?.[0]
  return {
    id,
    name: props.name || 'Destination',
    address: props.full_address || props.place_formatted || '',
    coord: nav ? [nav.longitude, nav.latitude] : f.geometry.coordinates,
  }
}

/** Reverse lookup for a long-pressed map point. Geocoding v6 is free-tier generous. */
export async function reverseGeocode([lon, lat], { token }) {
  const params = new URLSearchParams({ longitude: lon, latitude: lat, access_token: token, limit: '1' })
  try {
    const res = await fetch(`${API}/search/geocode/v6/reverse?${params}`)
    if (!res.ok) throw new Error()
    const f = (await res.json()).features?.[0]
    return { name: f?.properties?.name || 'Dropped Pin', address: f?.properties?.place_formatted || '' }
  } catch {
    return { name: 'Dropped Pin', address: `${lat.toFixed(5)}, ${lon.toFixed(5)}` }
  }
}

/**
 * Mapbox cycling profile: prefers bike lanes and quiet streets, avoids roads
 * where bikes are banned. `bearings` on the origin makes the first leg leave in
 * the direction the rider is already rolling instead of opening with a U-turn.
 */
export async function fetchRoute({ token, from, to, heading, units }) {
  const coords = `${from[0].toFixed(6)},${from[1].toFixed(6)};${to[0].toFixed(6)},${to[1].toFixed(6)}`
  const params = new URLSearchParams({
    access_token: token,
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    banner_instructions: 'true',
    voice_instructions: 'true',
    voice_units: units === 'metric' ? 'metric' : 'imperial',
    alternatives: 'false',
    language: 'en',
  })
  if (heading != null) params.set('bearings', `${Math.round(heading)},60;`)
  const res = await fetch(`${API}/directions/v5/mapbox/cycling/${coords}?${params}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.code !== 'Ok' || !json.routes?.length) {
    throw new Error(json.message || (json.code === 'NoRoute' ? 'No bike route found' : `Routing failed (${res.status})`))
  }
  return normalizeRoute(json.routes[0])
}

export function normalizeRoute(route) {
  const coords = route.geometry.coordinates
  const cum = cumulativeDistances(coords)
  const steps = []
  let searchFrom = 0
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      // Locate each maneuver on the overview polyline rather than summing step
      // distances — the API's per-step metres drift from the geometry's own
      // length by a few percent over a long route, which is a turn called
      // 40 m late at the end of a 5 km ride.
      const hit = nearestOnLine(step.maneuver.location, coords, cum, searchFrom, Math.min(coords.length - 1, searchFrom + 400))
      searchFrom = hit.index
      steps.push({
        startAlong: hit.along,
        distance: step.distance,
        name: step.name || '',
        type: step.maneuver.type,
        modifier: step.maneuver.modifier || '',
        instruction: step.maneuver.instruction || '',
        exit: step.maneuver.exit ?? null,
        banner: step.bannerInstructions?.[0]?.primary?.text || '',
        voice: (step.voiceInstructions || []).map((v) => ({ at: v.distanceAlongGeometry, text: v.announcement })),
      })
    }
  }
  return {
    coords,
    cum,
    length: cum[cum.length - 1],
    distance: route.distance,
    duration: route.duration,
    steps,
    geojson: { type: 'Feature', properties: {}, geometry: route.geometry },
  }
}

const OFF_ROUTE_FIXES = 3
const ARRIVE_RADIUS = 25

/**
 * Tracks a rider along a route. Fed one fix at a time; returns everything the
 * banner, HUD and voice need. Projection searches a window just behind and
 * ahead of the last match so a route that doubles back on itself can't snap
 * the rider to the wrong pass.
 */
export class NavSession {
  constructor(route, destination) {
    this.route = route
    this.destination = destination
    this.index = 0
    this.along = 0
    this.offCount = 0
    this.spoken = new Set()
    this.arrived = false
  }

  update(fix) {
    const { coords, cum, steps, length } = this.route
    const p = [fix.lon, fix.lat]
    let hit = nearestOnLine(p, coords, cum, Math.max(0, this.index - 8), this.index + 120)
    if (hit.dist > 60) hit = nearestOnLine(p, coords, cum)

    const tolerance = Math.max(30, Math.min(fix.acc ?? 10, 50) * 1.5)
    this.offCount = hit.dist > tolerance ? this.offCount + 1 : 0
    const offRoute = this.offCount >= OFF_ROUTE_FIXES

    if (!offRoute) {
      this.index = hit.index
      this.along = Math.max(this.along - 30, hit.along)
    }

    const toDestination = distance(p, this.destination.coord)
    if (!this.arrived && (toDestination < ARRIVE_RADIUS || (this.along > length - 15 && hit.dist < tolerance))) {
      this.arrived = true
    }

    let current = 0
    for (let i = 0; i < steps.length; i++) if (steps[i].startAlong <= this.along + 3) current = i
    const upcoming = steps[Math.min(current + 1, steps.length - 1)]
    const toManeuver = current + 1 < steps.length ? Math.max(0, upcoming.startAlong - this.along) : toDestination

    let announcement = null
    if (!offRoute && !this.arrived) {
      // Voice cues hang off the step being ridden and fire once the remaining
      // distance to its end drops under each cue's trigger. Only the most
      // imminent unspoken cue plays; any it overtook are marked spent.
      const cues = steps[current].voice
      let pick = -1
      for (let i = 0; i < cues.length; i++) {
        const key = `${current}:${i}`
        if (!this.spoken.has(key) && toManeuver <= cues[i].at + 5) {
          this.spoken.add(key)
          pick = i
        }
      }
      if (pick >= 0) announcement = cues[pick].text
    }

    return {
      current,
      upcoming,
      toManeuver,
      remaining: Math.max(0, length - this.along),
      offRoute,
      arrived: this.arrived,
      announcement,
      along: this.along,
    }
  }
}

export function routeLabel(step, destinationName) {
  if (!step) return ''
  if (step.type === 'arrive') return destinationName || 'Arrive'
  return step.banner || step.name || step.instruction
}
