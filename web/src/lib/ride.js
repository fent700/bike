import { distance, lineBounds, simplify } from './geo'
import { rideName } from './units'

// Thresholds, all from riding rather than from a spec sheet:
const MAX_FIX_ACCURACY = 35 // m; worse than this is urban-canyon garbage
const MAX_COUNTED_GAP = 15_000 // ms; a longer hole means the app was dead, not riding
const AUTO_PAUSE_BELOW = 0.9 // m/s ≈ 2 mph
const AUTO_PAUSE_AFTER = 5_000 // ms below the threshold before the clock stops
const AUTO_RESUME_ABOVE = 1.5 // m/s ≈ 3.4 mph
const MAX_PLAUSIBLE_SPEED = 30 // m/s ≈ 67 mph; anything above is a GPS jump
const BARO_STEP = 1.5 // m of climb before it counts, barometer
const GPS_STEP = 4 // m of climb before it counts, GPS altitude

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/**
 * Ride state machine: idle → recording ⇄ paused → finished.
 *
 * Everything is derived from fix timestamps, never the wall clock, so a ride
 * restored after the webview was killed does not count the dead time as
 * riding, and a batch of fixes the iOS shell buffered while the screen was
 * locked replays into exactly the same totals as if it had arrived live.
 */
export class RideRecorder {
  constructor() {
    this.ride = null
    this.listeners = new Set()
    this.snapshot = null
  }

  subscribe(fn) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  emit() {
    const r = this.ride
    this.snapshot = r
      ? {
          id: r.id,
          startedAt: r.startedAt,
          status: r.status,
          autoPaused: r.autoPaused,
          distance: r.distance,
          movingTime: r.movingTime,
          lastT: r.lastT,
          maxSpeed: r.maxSpeed,
          elevGain: r.elevGain,
          pointCount: r.points.length,
        }
      : null
    for (const fn of this.listeners) fn(this.snapshot)
  }

  get active() {
    return Boolean(this.ride)
  }

  start(now = Date.now()) {
    this.ride = {
      id: newId(),
      startedAt: now,
      status: 'recording',
      autoPaused: false,
      seg: 0,
      points: [],
      distance: 0,
      movingTime: 0,
      maxSpeed: 0,
      elevGain: 0,
      lastT: null,
      anchor: null,
      slowSince: null,
      eleRef: null,
      eleSource: null,
      eleSmooth: null,
      prevPos: null,
      prevPosT: null,
    }
    this.emit()
  }

  pause() {
    const r = this.ride
    if (!r || r.status === 'paused') return
    r.status = 'paused'
    r.autoPaused = false
    r.slowSince = null
    this.emit()
  }

  resume() {
    const r = this.ride
    if (!r || r.status === 'recording') return
    r.status = 'recording'
    // New track segment so GPX shows the gap instead of a straight line across
    // wherever the bike went while paused. The anchor resets for the same
    // reason: distance ridden while paused is not this ride's distance.
    r.seg++
    r.anchor = null
    r.lastT = null
    this.emit()
  }

  ingest(fixes, { autoPause = true } = {}) {
    const r = this.ride
    if (!r || !fixes.length) return
    for (const fix of fixes) this.ingestOne(r, fix, autoPause)
    this.emit()
  }

  ingestOne(r, fix, autoPause) {
    const t = fix.t
    if (r.lastT != null && t <= r.lastT) return
    const wasActive = r.status === 'recording' && !r.autoPaused
    if (wasActive && r.lastT != null) {
      const dt = t - r.lastT
      if (dt > 0 && dt < MAX_COUNTED_GAP) r.movingTime += dt / 1000
    }
    r.lastT = t

    const pos = [fix.lon, fix.lat]
    let speed = fix.speed
    if (speed == null && r.prevPos && t > r.prevPosT) {
      speed = distance(r.prevPos, pos) / ((t - r.prevPosT) / 1000)
    }
    r.prevPos = pos
    r.prevPosT = t

    if (r.status === 'recording' && autoPause && speed != null) {
      if (!r.autoPaused) {
        if (speed < AUTO_PAUSE_BELOW) {
          r.slowSince ??= t
          if (t - r.slowSince >= AUTO_PAUSE_AFTER) r.autoPaused = true
        } else {
          r.slowSince = null
        }
      } else if (speed > AUTO_RESUME_ABOVE) {
        r.autoPaused = false
        r.slowSince = null
      }
    } else if (!autoPause && r.autoPaused) {
      r.autoPaused = false
    }

    const active = r.status === 'recording' && !r.autoPaused
    if (fix.acc != null && fix.acc > MAX_FIX_ACCURACY) return

    if (!r.anchor) {
      r.anchor = pos
      if (r.status === 'recording') r.points.push([fix.lon, fix.lat, fix.alt ?? null, t, r.seg])
    } else {
      const d = distance(r.anchor, pos)
      // Step has to clear the fix's own error radius, or a phone sitting at a
      // red light walks itself a few hundred metres over a long stop.
      const minStep = Math.max(3, Math.min(fix.acc ?? 10, 20) * 0.6)
      const stationary = speed != null && speed < 0.5 && d < 10
      if (d >= minStep && !stationary) {
        if (r.status === 'recording') {
          // Auto-paused movement still extends the track (the stop was real),
          // but only active movement adds distance.
          if (active) r.distance += d
          r.points.push([fix.lon, fix.lat, fix.alt ?? null, t, r.seg])
        }
        r.anchor = pos
      }
    }

    if (
      active &&
      fix.speed != null &&
      fix.speed < MAX_PLAUSIBLE_SPEED &&
      (fix.acc ?? 99) <= 20 &&
      (fix.speedAcc == null || fix.speedAcc < 2.5)
    ) {
      r.maxSpeed = Math.max(r.maxSpeed, fix.speed)
    }

    this.trackElevation(r, fix, active)
  }

  /**
   * Climb counted from local minima with a dead band, so sensor noise that
   * oscillates inside the band never accumulates. Barometer wins when the
   * shell provides it; GPS altitude is the fallback and gets a wider band.
   */
  trackElevation(r, fix, active) {
    let alt, step, source
    if (fix.rel != null) {
      alt = fix.rel
      step = BARO_STEP
      source = 'baro'
    } else if (fix.alt != null && (fix.vacc == null || fix.vacc <= 15)) {
      r.eleSmooth = r.eleSmooth == null || r.eleSource !== 'gps' ? fix.alt : r.eleSmooth * 0.75 + fix.alt * 0.25
      alt = r.eleSmooth
      step = GPS_STEP
      source = 'gps'
    } else {
      return
    }
    if (r.eleSource !== source || r.eleRef == null) {
      r.eleSource = source
      r.eleRef = alt
      return
    }
    if (!active || alt < r.eleRef) {
      r.eleRef = alt
    } else if (alt - r.eleRef >= step) {
      r.elevGain += alt - r.eleRef
      r.eleRef = alt
    }
  }

  trail() {
    return this.ride ? this.ride.points.map((p) => [p[0], p[1]]) : []
  }

  serialize() {
    return this.ride ? { ...this.ride } : null
  }

  restore(saved) {
    if (!saved?.id) return false
    this.ride = { ...saved, slowSince: null }
    this.emit()
    return true
  }

  /** Ends the ride and returns { summary, track }; recorder goes idle. */
  finish(now = Date.now()) {
    const r = this.ride
    if (!r) return null
    this.ride = null
    this.emit()
    const coords = r.points.map((p) => [p[0], p[1]])
    const endedAt = Math.max(r.lastT ?? now, r.startedAt)
    const summary = {
      id: r.id,
      name: rideName(r.startedAt),
      startedAt: r.startedAt,
      endedAt,
      distance: r.distance,
      movingTime: r.movingTime,
      elapsedTime: (endedAt - r.startedAt) / 1000,
      maxSpeed: r.maxSpeed,
      avgSpeed: r.movingTime > 0 ? r.distance / r.movingTime : 0,
      elevGain: r.elevGain,
      bounds: coords.length ? lineBounds(coords) : null,
      preview: simplify(coords, 12).slice(0, 400),
    }
    return { summary, track: r.points }
  }
}

/** Moving time including the live sliver since the last fix, for a ticking clock. */
export function liveMovingTime(snapshot, now = Date.now()) {
  if (!snapshot) return 0
  const live =
    snapshot.status === 'recording' && !snapshot.autoPaused && snapshot.lastT && now - snapshot.lastT < 3000
      ? (now - snapshot.lastT) / 1000
      : 0
  return snapshot.movingTime + live
}

export function toGpx(summary, track) {
  const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)
  const iso = (t) => new Date(t).toISOString()
  const segments = []
  for (const p of track) {
    const seg = p[4] ?? 0
    if (!segments.length || segments[segments.length - 1].seg !== seg) segments.push({ seg, pts: [] })
    segments[segments.length - 1].pts.push(p)
  }
  const body = segments
    .map(
      ({ pts }) =>
        `    <trkseg>\n${pts
          .map(
            ([lon, lat, ele, t]) =>
              `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${
                ele != null ? `<ele>${ele.toFixed(1)}</ele>` : ''
              }<time>${iso(t)}</time></trkpt>`,
          )
          .join('\n')}\n    </trkseg>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bike" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(summary.name)}</name>
    <time>${iso(summary.startedAt)}</time>
  </metadata>
  <trk>
    <name>${esc(summary.name)}</name>
    <type>cycling</type>
${body}
  </trk>
</gpx>
`
}

export function gpxFilename(summary) {
  const d = new Date(summary.startedAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `${summary.name.replace(/\s+/g, '-')}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours(),
  )}${pad(d.getMinutes())}.gpx`
}
