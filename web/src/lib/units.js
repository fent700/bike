const MPS_TO_MPH = 2.2369363
const MPS_TO_KPH = 3.6
const M_PER_MI = 1609.344
const FT_PER_M = 3.2808399

export const isImperial = (units) => units !== 'metric'

export function speedValue(mps, units) {
  return Math.max(0, mps || 0) * (isImperial(units) ? MPS_TO_MPH : MPS_TO_KPH)
}

export const speedUnit = (units) => (isImperial(units) ? 'MPH' : 'KM/H')

/** Whole and tenths split so the HUD can set them at two sizes. */
export function speedParts(mps, units) {
  const v = Math.round(speedValue(mps, units) * 10) / 10
  const whole = Math.floor(v)
  return { whole: String(whole), tenth: String(Math.round((v - whole) * 10) % 10) }
}

export function formatSpeed(mps, units, digits = 1) {
  return `${speedValue(mps, units).toFixed(digits)} ${isImperial(units) ? 'mph' : 'km/h'}`
}

export function distanceParts(meters, units) {
  const v = (meters || 0) / (isImperial(units) ? M_PER_MI : 1000)
  const digits = v < 10 ? 2 : v < 100 ? 1 : 0
  return { value: v.toFixed(digits), unit: isImperial(units) ? 'mi' : 'km' }
}

export function formatDistance(meters, units) {
  const { value, unit } = distanceParts(meters, units)
  return `${value} ${unit}`
}

/** Turn-by-turn style: feet/metres up close, tenths further out. */
export function formatNavDistance(meters, units) {
  const m = Math.max(0, meters || 0)
  if (isImperial(units)) {
    const ft = m * FT_PER_M
    if (ft < 528) return `${ft < 100 ? Math.max(10, Math.round(ft / 10) * 10) : Math.round(ft / 50) * 50} ft`
    const mi = m / M_PER_MI
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
  }
  if (m < 1000) return `${m < 100 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10} m`
  const km = m / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

export function formatElevation(meters, units) {
  const v = Math.round((meters || 0) * (isImperial(units) ? FT_PER_M : 1))
  return `${v.toLocaleString()} ${isImperial(units) ? 'ft' : 'm'}`
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/** "1 h 12 min" / "18 min" — for route estimates, never seconds. */
export function formatEta(seconds) {
  const min = Math.max(1, Math.round((seconds || 0) / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

export function formatClock(date) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatRideDate(ts) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  const time = formatClock(d)
  if (sameDay(d, today)) return `Today, ${time}`
  if (sameDay(d, yesterday)) return `Yesterday, ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
}

export function rideName(ts) {
  const h = new Date(ts).getHours()
  if (h < 5) return 'Night Ride'
  if (h < 11) return 'Morning Ride'
  if (h < 14) return 'Lunch Ride'
  if (h < 17) return 'Afternoon Ride'
  if (h < 21) return 'Evening Ride'
  return 'Night Ride'
}

/** "5:42" — the HUD has no room for AM/PM and at a glance doesn't need it. */
export function formatClockShort(date) {
  return formatClock(date).replace(/\s?[AaPp]\.?[Mm]\.?$/, '')
}
