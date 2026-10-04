import { isNative, onNative, postNative } from './native'
import { destination } from './geo'

/**
 * One location stream, three backends:
 *   native    — CoreLocation through the iOS shell. Background-capable, true
 *               heading, barometric altitude, one permission prompt.
 *   browser   — navigator.geolocation, for `npm run dev` and Safari.
 *   simulate  — synthetic ride (`?sim` in the URL) for working on the HUD
 *               without leaving the desk.
 *
 * Every backend emits the same fix shape:
 *   { lat, lon, acc, alt, vacc, speed, speedAcc, course, t, rel }
 * speed/course are null when the receiver has none; rel is barometric
 * relative altitude in metres (native only).
 *
 * Status: 'pending' | 'granted' | 'denied' | 'unavailable'
 */
export function startLocation({ onFixes, onHeading, onStatus, simulate }) {
  if (simulate) return startSimulation({ onFixes, onHeading, onStatus, origin: simulate })
  if (isNative) return startNativeLocation({ onFixes, onHeading, onStatus })
  return startBrowserLocation({ onFixes, onHeading, onStatus })
}

function startNativeLocation({ onFixes, onHeading, onStatus }) {
  const offs = [
    onNative('location', (m) => onFixes(m.fixes || [])),
    onNative('heading', (m) => onHeading(m.heading, m.accuracy ?? null)),
    onNative('authorization', (m) => onStatus(m.status)),
  ]
  postNative('ready')
  return () => offs.forEach((off) => off())
}

function startBrowserLocation({ onFixes, onHeading, onStatus }) {
  if (!('geolocation' in navigator)) {
    onStatus('unavailable')
    return () => {}
  }
  onStatus('pending')
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onStatus('granted')
      const c = pos.coords
      onFixes([
        {
          lat: c.latitude,
          lon: c.longitude,
          acc: c.accuracy,
          alt: c.altitude,
          vacc: c.altitudeAccuracy,
          speed: c.speed != null && c.speed >= 0 && !Number.isNaN(c.speed) ? c.speed : null,
          speedAcc: null,
          course: c.heading != null && c.heading >= 0 && !Number.isNaN(c.heading) ? c.heading : null,
          t: pos.timestamp || Date.now(),
          rel: null,
        },
      ])
    },
    (err) => onStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'pending'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
  )

  const onOrientation = (e) => {
    let heading = null
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading
    else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha
    if (heading == null) return
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0
    onHeading((heading + screenAngle + 360) % 360, e.webkitCompassAccuracy ?? null)
  }
  window.addEventListener('deviceorientationabsolute', onOrientation)
  window.addEventListener('deviceorientation', onOrientation)

  return () => {
    navigator.geolocation.clearWatch(watchId)
    window.removeEventListener('deviceorientationabsolute', onOrientation)
    window.removeEventListener('deviceorientation', onOrientation)
  }
}

/** iOS Safari only hands out compass data after a user gesture asks for it. */
export function requestCompassPermission() {
  if (isNative) return
  try {
    const req = window.DeviceOrientationEvent?.requestPermission
    if (typeof req === 'function') req.call(window.DeviceOrientationEvent).catch(() => {})
  } catch {
    // Permission API missing or already decided.
  }
}

/**
 * A loop with drifting heading, varying pace and a 12-second stop every
 * 100 seconds, so auto-pause, the speed readout and camera follow all get
 * exercised. Origin defaults to downtown Portland, which has dense OSM
 * cycleway tagging to test the lane layers against.
 */
function startSimulation({ onFixes, onHeading, onStatus, origin }) {
  onStatus('granted')
  let pos = Array.isArray(origin) ? origin : [-122.6765, 45.5231]
  let course = 90
  let tick = 0
  const emit = () => {
    tick++
    const stopped = tick % 100 > 88
    const speed = stopped ? 0 : 5.6 + 2.2 * Math.sin(tick / 9)
    course = (course + Math.sin(tick / 14) * 7 + 360) % 360
    pos = destination(pos, course, speed)
    const jitter = () => (Math.random() - 0.5) * 0.00002
    onFixes([
      {
        lat: pos[1] + jitter(),
        lon: pos[0] + jitter(),
        acc: 4 + Math.random() * 3,
        alt: 40 + 14 * Math.sin(tick / 45),
        vacc: 4,
        speed,
        speedAcc: 0.4,
        course: stopped ? null : course,
        t: Date.now(),
        rel: null,
      },
    ])
    onHeading(course, 8)
  }
  emit()
  const id = setInterval(emit, 1000)
  return () => clearInterval(id)
}

/** `?sim` → default origin, `?sim=45.52,-122.68` → that lat,lon. */
export function simulationFromUrl() {
  const params = new URLSearchParams(window.location.search)
  if (!params.has('sim')) return null
  const [lat, lon] = (params.get('sim') || '').split(',').map(Number)
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lon, lat] : true
}
