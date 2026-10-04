import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { haptic } from '../lib/native'

const cx = (...parts) => parts.filter(Boolean).join(' ')

/** 56 pt circular glass control — the minimum for gloves on a bumpy road. */
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

export function Sheet({ open, onClose, title, children, footer, tall }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        className="animate-fade-in absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <section
        className={cx(
          'glass-strong animate-sheet-in relative mx-auto flex w-full max-w-[620px] flex-col rounded-t-[32px] pb-[calc(var(--sab)+12px)]',
          tall ? 'h-[86dvh]' : 'max-h-[86dvh]',
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-white/20" />
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
        <div className="scroll-y min-h-0 flex-1 px-5">{children}</div>
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
