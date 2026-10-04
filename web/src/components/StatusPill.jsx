import { Navigation2, WifiOff, X } from 'lucide-react'
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowUpRight,
  CornerUpLeft,
  CornerUpRight,
  Flag,
  Merge,
  RotateCcw,
  Undo2,
} from 'lucide-react'
import { KIND_LABEL } from '../lib/bikeInfra'
import { compassPoint } from '../lib/geo'
import { isNative, postNative } from '../lib/native'
import { formatNavDistance } from '../lib/units'
import { routeLabel } from '../lib/navigation'
import { Presence, cx } from './ui'

const DOT = {
  green: 'bg-lane-hi shadow-[0_0_10px_2px_rgba(0,240,118,0.6)]',
  amber: 'bg-caution shadow-[0_0_8px_1px_rgba(255,176,32,0.5)]',
  red: 'bg-stop shadow-[0_0_8px_1px_rgba(255,69,58,0.5)]',
  gray: 'bg-white/35',
}

/**
 * Top pill. One line, highest-priority fact first: permission problems, then
 * GPS quality, then whether you're on bike infrastructure, then heading.
 */
export function StatusPill({ locStatus, hasFix, accuracy, lane, heading, online, paused, compact }) {
  let tone = 'gray'
  let text = null
  let onClick = null

  if (locStatus === 'denied') {
    tone = 'red'
    if (isNative) {
      text = 'Location Off · Tap to Fix'
      onClick = () => postNative('openSettings')
    } else {
      text = 'Location Blocked'
    }
  } else if (locStatus === 'unavailable') {
    tone = 'red'
    text = 'No Location Hardware'
  } else if (!hasFix) {
    tone = 'amber'
    text = 'Finding GPS'
  } else if (accuracy > 30) {
    tone = 'amber'
    text = 'Weak GPS'
  } else if (lane) {
    tone = 'green'
    text = KIND_LABEL[lane]
  } else if (paused) {
    tone = 'amber'
    text = 'Paused'
  }

  const showHeading = heading != null && hasFix
  const visible = Boolean(text || showHeading || !online)

  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Presence show={visible}>
      {(leaving) => (
        <Wrapper
          type={onClick ? 'button' : undefined}
          onClick={onClick}
          className={cx(
            'glass flex items-center gap-2.5 rounded-full px-4',
            compact ? 'h-10' : 'h-11',
            leaving ? 'animate-drop-out' : 'animate-drop-in pointer-events-auto',
          )}
        >
          {!online && <WifiOff className="h-4 w-4 text-caution" strokeWidth={2.4} />}
          {text && (
            // Keyed on the text so a change (Bike Lane → Protected Lane)
            // fades in rather than snapping.
            <span key={text} className="animate-fade-in flex items-center gap-2.5">
              <span
                className={cx('h-2.5 w-2.5 rounded-full', DOT[tone], tone === 'amber' && !hasFix && 'animate-soft-pulse')}
              />
              <span className={cx('text-[15px] font-semibold tracking-tight', tone === 'green' && 'text-lane-hi')}>
                {text}
              </span>
            </span>
          )}
          {text && showHeading && <span className="h-4 w-px bg-white/15" />}
          {showHeading && (
            <span className="flex items-center gap-1.5">
              <Navigation2
                className="h-3.5 w-3.5 fill-white/80 text-white/80"
                style={{ transform: `rotate(${Math.round(heading)}deg)` }}
                strokeWidth={2}
              />
              <span className="metric text-[15px] font-semibold">
                {compassPoint(heading)}
                <span className="ml-1 text-white/45">{Math.round(heading) % 360}°</span>
              </span>
            </span>
          )}
        </Wrapper>
      )}
    </Presence>
  )
}

function maneuverIcon(step) {
  if (!step) return ArrowUp
  const { type, modifier } = step
  if (type === 'arrive') return Flag
  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn' || type === 'exit roundabout') return RotateCcw
  if (type === 'merge') return Merge
  switch (modifier) {
    case 'uturn':
      return Undo2
    case 'sharp right':
    case 'right':
      return CornerUpRight
    case 'slight right':
      return ArrowUpRight
    case 'sharp left':
    case 'left':
      return CornerUpLeft
    case 'slight left':
      return ArrowUpLeft
    default:
      return ArrowUp
  }
}

/** Next maneuver, sized to read without leaning in. */
export function ManeuverBanner({ state, destination, units, rerouting, onEnd, leaving }) {
  const step = state?.upcoming
  const Icon = rerouting ? RotateCcw : maneuverIcon(step)
  const arriving = state?.arrived
  return (
    <div
      className={cx(
        'glass flex w-full max-w-[560px] items-center gap-3 rounded-[30px] p-2.5',
        leaving ? 'animate-drop-out' : 'animate-drop-in pointer-events-auto',
      )}
    >
      <div
        className={cx(
          'flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-[22px]',
          arriving ? 'bg-lane' : 'bg-route',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_24px_-6px_rgba(10,132,255,0.6)]',
        )}
      >
        <Icon className={cx('h-9 w-9 text-white', rerouting && 'animate-spin')} strokeWidth={2.6} />
      </div>
      <div className="min-w-0 flex-1">
        {rerouting ? (
          <div className="text-[24px] leading-tight font-bold">Rerouting</div>
        ) : arriving ? (
          <>
            <div className="text-[24px] leading-tight font-bold">Arrived</div>
            <div className="truncate text-[16px] text-white/65">{destination?.name}</div>
          </>
        ) : (
          <>
            <div className="metric text-[34px] leading-none font-bold">{formatNavDistance(state?.toManeuver, units)}</div>
            <div className="mt-1 truncate text-[17px] font-medium text-white/75">{routeLabel(step, destination?.name)}</div>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="End navigation"
        onClick={onEnd}
        className="press glass-well flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
      >
        <X className="h-6 w-6 text-white/80" strokeWidth={2.4} />
      </button>
    </div>
  )
}
