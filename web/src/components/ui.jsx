import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { haptic } from '../lib/native'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/** 56 pt circular glass control: the minimum for gloves on a bumpy road. */
export function RoundButton({ icon: Icon, label, onClick, active, className, iconClass, size = 56, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        haptic('light')
        onClick?.(e)
      }}
      style={{ width: size, height: size }}
      className={cx(
        'glass press pointer-events-auto flex shrink-0 items-center justify-center rounded-full',
        active && 'ring-2 ring-lane-hi/70',
        className,
      )}
    >
      {Icon ? <Icon className={cx('h-6 w-6', iconClass)} strokeWidth={2.2} /> : children}
    </button>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        haptic('selection')
        onChange(!checked)
      }}
      className={cx(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-lane' : 'bg-white/15',
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.35)] transition-transform duration-300 ease-spring',
          checked && 'translate-x-[20px]',
        )}
      />
    </button>
  )
}

export function Segmented({ value, options, onChange }) {
  return (
    <div className="glass-well flex rounded-2xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => {
            haptic('selection')
            onChange(o.value)
          }}
          className={cx(
            'h-11 flex-1 rounded-xl text-[15px] font-semibold transition-colors',
            value === o.value ? 'bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]' : 'text-white/55',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Press-and-hold to confirm. Ending a ride or deleting one is irreversible,
 * and a single tap is exactly what a pothole delivers to a mounted phone.
 */
export function HoldButton({ onConfirm, children, duration = 800, tone = 'danger', className }) {
  const [holding, setHolding] = useState(false)
  const timer = useRef(null)
  const start = () => {
    setHolding(true)
    haptic('light')
    timer.current = setTimeout(() => {
      setHolding(false)
      haptic('success')
      onConfirm()
    }, duration)
  }
  const cancel = () => {
    clearTimeout(timer.current)
    setHolding(false)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  const fill = tone === 'danger' ? 'bg-stop/45' : 'bg-white/20'
  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={cx(
        'glass-well press relative h-14 overflow-hidden rounded-2xl text-[16px] font-semibold',
        tone === 'danger' ? 'text-[#ff6961]' : 'text-white',
        className,
      )}
    >
      <span
        className={cx('absolute inset-y-0 left-0', fill)}
        style={{
          width: holding ? '100%' : '0%',
          transition: holding ? `width ${duration}ms linear` : 'width 200ms ease-out',
        }}
      />
      <span className="relative flex items-center justify-center gap-2">{children}</span>
    </button>
  )
}

/**
 * Keeps an element mounted after `show` goes false, long enough to play its
 * way out. Children is a render function taking `leaving`; while leaving it
 * re-runs the last function rendered while shown, so a closing toast or sheet
 * keeps its last content instead of going blank mid-animation.
 */
export function Presence({ show, exit = 220, children }) {
  const [mounted, setMounted] = useState(show)
  const lastRender = useRef(children)
  if (show) lastRender.current = children

  useEffect(() => {
    if (show) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), exit)
    return () => clearTimeout(timer)
  }, [show, exit])

  if (!show && !mounted) return null
  return lastRender.current(!show)
}

const SHEET_EXIT = 300

export function Sheet({ open, onClose, ...props }) {
  return (
    <Presence show={open} exit={SHEET_EXIT}>
      {(leaving) => <SheetFrame leaving={leaving} onClose={onClose} {...props} />}
    </Presence>
  )
}

/**
 * Bottom sheet that follows the finger. Pull down on the grabber or header,
 * or on the content once it's scrolled to the top, and it tracks the touch;
 * let go past a quarter of its height (or flick) and it carries on down and
 * closes, otherwise it springs back.
 */
function SheetFrame({ leaving, onClose, title, children, footer, tall }) {
  const sheetRef = useRef(null)
  const headerRef = useRef(null)
  const scrollRef = useRef(null)
  const closeRef = useRef(onClose)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [flung, setFlung] = useState(false)

  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const sheet = sheetRef.current
    const scroller = scrollRef.current
    let drag = null

    const begin = (y, t, fromHeader) => {
      drag = { startY: y, lastY: y, lastT: t, velocity: 0, active: fromHeader }
      if (fromHeader) setDragging(true)
    }
    const move = (y, t) => {
      const dy = y - drag.startY
      if (!drag.active) {
        // Content area: a downward pull at the top of the scroll takes over;
        // anything else is ordinary scrolling and is left alone.
        if (dy > 6 && scroller.scrollTop <= 0) {
          drag.active = true
          drag.startY = y
          setDragging(true)
        } else {
          if (dy < -6) drag = null
          return false
        }
      }
      const dt = Math.max(1, t - drag.lastT)
      drag.velocity = (y - drag.lastY) / dt
      drag.lastY = y
      drag.lastT = t
      const pull = y - drag.startY
      // Rubber-band upward: the sheet can't go higher than it sits.
      setOffset(pull > 0 ? pull : -Math.sqrt(-pull) * 2)
      return true
    }
    const end = () => {
      if (!drag?.active) {
        drag = null
        return
      }
      const pull = drag.lastY - drag.startY
      const height = sheet.offsetHeight
      const dismiss = pull > Math.min(160, height * 0.25) || (drag.velocity > 0.55 && pull > 24)
      drag = null
      setDragging(false)
      if (dismiss) {
        haptic('light')
        setFlung(true)
        setOffset(height + 40)
        closeRef.current()
      } else {
        setOffset(0)
      }
    }

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return
      const fromHeader = headerRef.current.contains(e.target)
      if (!fromHeader && scroller.scrollTop > 0) return
      begin(e.touches[0].clientY, e.timeStamp, fromHeader)
    }
    const onTouchMove = (e) => {
      if (!drag) return
      if (move(e.touches[0].clientY, e.timeStamp) && e.cancelable) e.preventDefault()
    }
    // Mouse path for desktop dev: header only.
    const onPointerDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button')) return
      begin(e.clientY, e.timeStamp, true)
      const onMove = (ev) => drag && move(ev.clientY, ev.timeStamp)
      const onUp = () => {
        end()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    }

    sheet.addEventListener('touchstart', onTouchStart, { passive: true })
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('touchend', end)
    sheet.addEventListener('touchcancel', end)
    headerRef.current.addEventListener('pointerdown', onPointerDown)
    const header = headerRef.current
    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('touchend', end)
      sheet.removeEventListener('touchcancel', end)
      header.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  const height = sheetRef.current?.offsetHeight || 600
  const backdropOpacity = Math.max(0, 1 - Math.max(0, offset) / height)

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        className={cx('absolute inset-0 bg-black/35', leaving ? 'animate-fade-out' : 'animate-fade-in')}
        style={{ opacity: backdropOpacity, transition: dragging ? 'none' : 'opacity 300ms ease' }}
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className={cx(
          'glass-strong relative mx-auto flex w-full max-w-[620px] flex-col rounded-t-[32px] pb-[calc(var(--sab)+12px)]',
          tall ? 'h-[86dvh]' : 'max-h-[86dvh]',
          // A sheet flung away by hand finishes on its transition; the
          // keyframe exit would snap it back to the top first.
          leaving ? !flung && 'animate-sheet-out' : 'animate-sheet-in',
        )}
        style={{
          transform: `translateY(${offset}px)`,
          transition: dragging ? 'none' : `transform ${flung ? 260 : 420}ms var(--ease-spring)`,
        }}
      >
        <div ref={headerRef} className="cursor-grab touch-none pt-2 active:cursor-grabbing">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-white/25" />
          <header className="flex items-center gap-2 px-5 pt-2 pb-3">
            <h2 className="flex-1 truncate text-[22px] font-bold tracking-tight">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="press glass-well -mr-1 flex h-12 w-12 items-center justify-center rounded-full"
            >
              <X className="h-5 w-5 text-white/80" strokeWidth={2.4} />
            </button>
          </header>
        </div>
        <div ref={scrollRef} className="scroll-y min-h-0 flex-1 px-5">
          {children}
        </div>
        {footer && <div className="px-5 pt-3">{footer}</div>}
      </section>
    </div>
  )
}

export function Stat({ label, value, unit, className, compact }) {
  return (
    <div className={cx('glass-well rounded-2xl px-3.5', compact ? 'py-2.5' : 'py-3', className)}>
      <div className="text-[11px] font-semibold tracking-[0.12em] text-white/45 uppercase">{label}</div>
      <div className="metric mt-0.5 truncate text-[24px] leading-tight font-semibold">
        {value}
        {unit && <span className="ml-1 text-[14px] font-medium text-white/50">{unit}</span>}
      </div>
    </div>
  )
}

export function Spinner({ className }) {
  return (
    <span
      className={cx('inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white', className)}
    />
  )
}

/** Tiny route silhouette for ride lists. */
export function RouteThumb({ coords, size = 52 }) {
  if (!coords || coords.length < 2) {
    return <div className="glass-well shrink-0 rounded-xl" style={{ width: size, height: size }} />
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of coords) {
    w = Math.min(w, x)
    e = Math.max(e, x)
    s = Math.min(s, y)
    n = Math.max(n, y)
  }
  const kx = Math.cos(((s + n) / 2) * (Math.PI / 180))
  const span = Math.max((e - w) * kx, n - s) || 1e-6
  const pad = 7
  const scale = (size - pad * 2) / span
  const ox = (size - (e - w) * kx * scale) / 2
  const oy = (size - (n - s) * scale) / 2
  const d = coords
    .map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - w) * kx * scale).toFixed(1)} ${(oy + (n - y) * scale).toFixed(1)}`)
    .join('')
  return (
    <svg width={size} height={size} className="glass-well shrink-0 rounded-xl" aria-hidden="true">
      <path d={d} fill="none" stroke="#10B981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export { cx }
