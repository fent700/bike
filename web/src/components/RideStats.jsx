import { Stat } from './ui'
import { distanceParts, formatDuration, formatElevation, formatRideDate, isImperial, speedValue } from '../lib/units'

export function RideHero({ summary, units }) {
  const { value, unit } = distanceParts(summary.distance, units)
  return (
    <div className="pt-1 pb-4">
      <div className="text-[14px] text-white/50">{formatRideDate(summary.startedAt)}</div>
      <div className="metric mt-1 flex items-baseline gap-2">
        <span className="text-[64px] leading-none font-bold tracking-[-0.04em]">{value}</span>
        <span className="text-[20px] font-semibold text-white/50">{unit}</span>
      </div>
    </div>
  )
}

export function RideStatGrid({ summary, units }) {
  const imperial = isImperial(units)
  const speedUnit = imperial ? 'mph' : 'km/h'
  const [elev, elevUnit] = formatElevation(summary.elevGain, units).split(' ')
  return (
    <div className="grid grid-cols-2 gap-2">
      <Stat label="Moving Time" value={formatDuration(summary.movingTime)} />
      <Stat label="Elapsed" value={formatDuration(summary.elapsedTime)} />
      <Stat label="Avg Speed" value={speedValue(summary.avgSpeed, units).toFixed(1)} unit={speedUnit} />
      <Stat label="Max Speed" value={speedValue(summary.maxSpeed, units).toFixed(1)} unit={speedUnit} />
      <Stat label="Climb" value={elev} unit={elevUnit} />
      <Stat
        label="Avg Pace"
        value={summary.distance > 50 ? formatDuration(summary.movingTime / (summary.distance / (imperial ? 1609.344 : 1000))) : '–'}
        unit={imperial ? '/mi' : '/km'}
      />
    </div>
  )
}
