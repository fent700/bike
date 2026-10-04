import { useEffect, useRef } from 'react'
import { Compass, LocateFixed, Navigation2, Pause, Play, Route, Square, Timer } from 'lucide-react'
import { HoldButton, Presence, Stat, cx } from './ui'
import { haptic } from '../lib/native'
import { liveMovingTime } from '../lib/ride'
import {
  distanceParts,
  formatClockShort,
  formatDuration,
  formatElevation,
  isImperial,
  speedParts,
  speedUnit,
  speedValue,
} from '../lib/units'

/**
 * Bottom HUD: one glass pill, readable at a glance at 20 mph.
 *
 *   [ SPEED ] | [ time / distance ]  or  [ ETA / remaining ]  or  [ Start ] | (recenter)
 *
 * Tapping the middle opens the ride panel above it (secondary stats plus
 * pause / finish), and it folds itself away again after a few seconds.
 */
export default function GlassHUD({
  units,
  speed,
  speedLive,
  ride,
  now,
  nav,
  followMode,
  expanded,
  onToggleExpanded,
  onRecenter,
  onStart,
  onPause,
  onResume,
  onFinish,
  barRef,
  stackRef,
  aboveBar,
}) {
  const collapseTimer = useRef(null)
  useEffect(() => {
    clearTimeout(collapseTimer.current)
    if (expanded) collapseTimer.current = setTimeout(() => onToggleExpanded(false), 9000)
    return () => clearTimeout(collapseTimer.current)
  }, [expanded, onToggleExpanded, ride?.status])

  const { whole, tenth } = speedParts(speedLive ? speed : 0, units)
  const paused = ride?.status === 'paused'
  const autoPaused = ride?.autoPaused && !paused

  return (
    <div
      ref={stackRef}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2.5 px-3 pb-[calc(var(--sab)+10px)] pl-[calc(var(--sal)+12px)] pr-[calc(var(--sar)+12px)]"
    >
      <Presence show={Boolean(expanded && ride)}>
        {(leaving) => (
          <RidePanel
            leaving={leaving}
            ride={ride}
            now={now}
            units={units}
            nav={nav}
            paused={paused}
            onPause={onPause}
            onResume={onResume}
            onFinish={onFinish}
          />
        )}
      </Presence>

      <Presence show={Boolean(aboveBar)}>
        {(leaving) => (
          <div
            className={cx(
              'flex w-full justify-center',
              leaving ? 'animate-rise-out pointer-events-none' : 'animate-rise-in',
            )}
          >
            {aboveBar}
          </div>
        )}
      </Presence>

      <div
        ref={barRef}
        className="glass pointer-events-auto flex w-full max-w-[560px] items-center gap-2 rounded-[32px] py-2.5 pr-2.5 pl-5 [@media(max-height:520px)]:max-w-[780px]"
      >
        <div className="flex min-w-[104px] flex-col items-start" aria-label="Speed">
          <div className={cx('metric flex items-baseline leading-none', !speedLive && 'text-white/35')}>
            <span className="text-[62px] font-bold tracking-[-0.045em]">{speedLive ? whole : '–'}</span>
            {speedLive && <span className="text-[26px] font-semibold text-white/55">.{tenth}</span>}
          </div>
          <div className="mt-0.5 text-[11px] font-semibold tracking-[0.18em] text-white/45">{speedUnit(units)}</div>
        </div>

        <div className="mx-1 h-14 w-px self-center bg-white/10" />

        <div className="min-w-0 flex-1">
          {nav ? (
            <NavMetrics nav={nav} units={units} now={now} onClick={() => ride && onToggleExpanded(!expanded)} />
          ) : ride ? (
            <button
              type="button"
              onClick={() => {
                haptic('light')
                onToggleExpanded(!expanded)
              }}
              className="press flex w-full flex-col items-start gap-1 rounded-2xl py-1 pl-1 text-left"
            >
              <MetricRow
                icon={Timer}
                value={formatDuration(liveMovingTime(ride, now))}
                dim={paused || autoPaused}
                badge={paused ? 'PAUSED' : autoPaused ? 'AUTO' : null}
              />
              <MetricRow icon={Route} {...distanceRow(ride.distance, units)} dim={paused} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                haptic('medium')
                onStart()
              }}
              className="glass-green press flex h-14 w-full items-center justify-center gap-2 rounded-[22px] text-[18px] font-bold text-white"
            >
              <Play className="h-5 w-5 fill-white" strokeWidth={2.4} />
              Start Ride
            </button>
          )}
        </div>

        <RecenterButton mode={followMode} onClick={onRecenter} />
      </div>
    </div>
  )
}

function distanceRow(meters, units) {
  const { value, unit } = distanceParts(meters, units)
  return { value, unit }
}

function MetricRow({ icon: Icon, value, unit, dim, badge }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-white/40" strokeWidth={2.4} />
      <span className={cx('metric text-[27px] leading-none font-semibold', dim && 'text-white/45')}>{value}</span>
      {unit && <span className="text-[13px] font-semibold text-white/45">{unit}</span>}
      {badge && (
        <span
          className={cx(
            'rounded-md px-1.5 py-0.5 text-[10px] font-bold tracking-wider',
            badge === 'PAUSED' ? 'bg-caution/20 text-caution' : 'bg-white/10 text-white/60',
          )}
        >
          {badge}
        </span>
      )}
    </div>
  )
}

function NavMetrics({ nav, units, now, onClick }) {
  const arrival = new Date(now + nav.etaSeconds * 1000)
  const { value, unit } = distanceParts(nav.remaining, units)
  return (
    <button type="button" onClick={onClick} className="press flex w-full flex-col items-start gap-1 py-1 pl-1 text-left">
      <div className="flex items-baseline gap-2">
        <span className="metric text-[27px] leading-none font-semibold">{formatClockShort(arrival)}</span>
        <span className="text-[12px] font-semibold tracking-[0.12em] text-white/45">ARRIVE</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="metric text-[27px] leading-none font-semibold">{value}</span>
        <span className="text-[13px] font-semibold text-white/45">{unit} left</span>
      </div>
    </button>
  )
}

function RecenterButton({ mode, onClick }) {
  const Icon = mode === 'follow' ? Navigation2 : mode === 'north' ? Compass : LocateFixed
  const label = mode === 'follow' ? 'Switch to north up' : mode === 'north' ? 'Switch to heading up' : 'Recenter map'
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        haptic('medium')
        onClick()
      }}
      className={cx(
        'press flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full border',
        mode === 'free'
          ? 'animate-ring-pulse border-lane-hi/50 bg-lane/20 text-lane-hi'
          : 'border-white/10 bg-white/8 text-lane-hi',
      )}
    >
      <Icon className={cx('h-7 w-7', mode === 'follow' && 'fill-lane-hi/25')} strokeWidth={2.3} />
    </button>
  )
}

function RidePanel({ leaving, ride, now, units, nav, paused, onPause, onResume, onFinish }) {
  const moving = liveMovingTime(ride, now)
  const avg = moving > 5 ? ride.distance / moving : 0
  const imperial = isImperial(units)
  const speedFmt = (mps) => speedValue(mps, units).toFixed(1)
  const dist = distanceParts(ride.distance, units)
  const [elevValue, elevUnit] = formatElevation(ride.elevGain, units).split(' ')

  const stats = nav
    ? [
        { label: 'Time', value: formatDuration(moving) },
        { label: 'Distance', value: dist.value, unit: dist.unit },
        { label: 'Avg', value: speedFmt(avg), unit: imperial ? 'mph' : 'km/h' },
        { label: 'Max', value: speedFmt(ride.maxSpeed), unit: imperial ? 'mph' : 'km/h' },
        { label: 'Climb', value: elevValue, unit: elevUnit },
        { label: 'Clock', value: formatClockShort(new Date(now)) },
      ]
    : [
        { label: 'Avg', value: speedFmt(avg), unit: imperial ? 'mph' : 'km/h' },
        { label: 'Max', value: speedFmt(ride.maxSpeed), unit: imperial ? 'mph' : 'km/h' },
        { label: 'Climb', value: elevValue, unit: elevUnit },
        { label: 'Elapsed', value: formatDuration((now - ride.startedAt) / 1000) },
        { label: 'Moving', value: formatDuration(moving) },
        { label: 'Clock', value: formatClockShort(new Date(now)) },
      ]

  return (
    <div
      className={cx(
        'glass w-full max-w-[560px] rounded-[30px] p-3 [@media(max-height:520px)]:max-w-[780px]',
        leaving ? 'animate-rise-out pointer-events-none' : 'animate-rise-in pointer-events-auto',
      )}
    >
      <div className="grid grid-cols-3 gap-2 [@media(max-height:520px)]:grid-cols-6">
        {stats.map((s) => (
          <Stat key={s.label} {...s} compact />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {paused ? (
          <button
            type="button"
            onClick={() => {
              haptic('medium')
              onResume()
            }}
            className="glass-green press flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-bold"
          >
            <Play className="h-5 w-5 fill-white" /> Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic('medium')
              onPause()
            }}
            className="glass-well press flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold"
          >
            <Pause className="h-5 w-5 fill-white" /> Pause
          </button>
        )}
        <HoldButton onConfirm={onFinish}>
          <Square className="h-4 w-4 fill-current" /> Hold to Finish
        </HoldButton>
      </div>
    </div>
  )
}
