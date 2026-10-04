// Coordinates are [lon, lat] throughout, matching GeoJSON and Mapbox.

const EARTH_RADIUS = 6371008.8
const RAD = Math.PI / 180

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export function distance(a, b) {
  const dLat = (b[1] - a[1]) * RAD
  const dLon = (b[0] - a[0]) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function bearing(a, b) {
  const φ1 = a[1] * RAD
  const φ2 = b[1] * RAD
  const Δλ = (b[0] - a[0]) * RAD
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) / RAD + 360) % 360
}

export function destination(p, bearingDeg, meters) {
  const δ = meters / EARTH_RADIUS
  const θ = bearingDeg * RAD
  const φ1 = p[1] * RAD
  const λ1 = p[0] * RAD
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return [((λ2 / RAD + 540) % 360) - 180, φ2 / RAD]
}

/** Signed shortest turn from a to b, in (-180, 180]. */
export function angleDiff(a, b) {
  return ((((b - a) % 360) + 540) % 360) - 180
}

export function lerpAngle(a, b, t) {
  return (a + angleDiff(a, b) * t + 360) % 360
}

/**
 * Point-to-segment distance in meters on a local flat projection centred on
 * the point. Exact enough below a few kilometres, which is all a GPS fix
 * against a road segment ever needs, and an order of magnitude cheaper than
 * cross-track haversine when it runs against thousands of segments per fix.
 */
export function segmentProjection(p, a, b) {
  const kx = Math.cos(p[1] * RAD) * 111320
  const ky = 110574
  const ax = (a[0] - p[0]) * kx
  const ay = (a[1] - p[1]) * ky
  const dx = (b[0] - p[0]) * kx - ax
  const dy = (b[1] - p[1]) * ky - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? clamp(-(ax * dx + ay * dy) / len2, 0, 1) : 0
  return { dist: Math.hypot(ax + t * dx, ay + t * dy), t }
}

export function cumulativeDistances(coords) {
  const cum = new Float64Array(coords.length)
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + distance(coords[i - 1], coords[i])
  return cum
}

/** Nearest point on a polyline within [from, to) segment range. */
export function nearestOnLine(p, coords, cum, from = 0, to = coords.length - 1) {
  let best = { dist: Infinity, index: 0, t: 0, along: 0 }
  const lo = clamp(from, 0, coords.length - 2)
  const hi = clamp(to, lo + 1, coords.length - 1)
  for (let i = lo; i < hi; i++) {
    const { dist, t } = segmentProjection(p, coords[i], coords[i + 1])
    if (dist < best.dist) best = { dist, index: i, t, along: cum[i] + t * (cum[i + 1] - cum[i]) }
  }
  return best
}

export function lineBounds(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of coords) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return [w, s, e, n]
}

/** Ramer–Douglas–Peucker on a flat local projection, tolerance in meters. */
export function simplify(coords, tolerance = 4) {
  if (coords.length < 3) return coords
  const keep = new Uint8Array(coords.length)
  keep[0] = keep[coords.length - 1] = 1
  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let maxDist = 0, index = -1
    for (let i = first + 1; i < last; i++) {
      const { dist } = segmentProjection(coords[i], coords[first], coords[last])
      if (dist > maxDist) { maxDist = dist; index = i }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return coords.filter((_, i) => keep[i])
}

// Slippy-map tile math, used to key the bike-infrastructure cache.
export function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = Math.floor(((lon + 180) / 360) * n)
  const latRad = clamp(lat, -85.0511, 85.0511) * RAD
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  return [clamp(x, 0, n - 1), clamp(y, 0, n - 1)]
}

export function tileBounds(x, y, z) {
  const n = 2 ** z
  const lon = (i) => (i / n) * 360 - 180
  const lat = (j) => Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) / RAD
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)] // w, s, e, n
}

export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const compassPoint = (deg) => COMPASS_POINTS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
