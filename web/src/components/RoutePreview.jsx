import { Navigation, RotateCcw, Star, X } from 'lucide-react'
import { Spinner, cx } from './ui'
import { formatDistance, formatEta } from '../lib/units'
import { haptic } from '../lib/native'

/** Destination card that sits above the HUD before a route starts. */
export default function RoutePreview({ preview, units, isFavorite, onToggleFavorite, onGo, onRetry, onCancel, cardRef }) {
  const { destination, route, loading, error } = preview
  return (
    <div
      ref={cardRef}
      className="glass pointer-events-auto w-full max-w-[560px] rounded-[30px] p-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 pt-0.5 pl-1">
          <div className="truncate text-[20px] leading-tight font-bold">{destination.name}</div>
          {destination.address && <div className="mt-0.5 truncate text-[14px] text-white/50">{destination.address}</div>}
          <div className="mt-2 h-7">
            {loading ? (
              <span className="flex items-center gap-2 text-[15px] text-white/60">
                <Spinner className="h-4 w-4" /> Finding a bike route
              </span>
            ) : error ? (
              <span className="text-[15px] text-[#ff6961]">{error}</span>
            ) : route ? (
              <span className="metric text-[20px] font-semibold">
                {formatEta(route.duration)}
                <span className="mx-2 text-white/30">·</span>
                <span className="text-white/70">{formatDistance(route.distance, units)}</span>
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={() => {
            haptic('selection')
            onToggleFavorite()
          }}
          className="press glass-well flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
        >
          <Star className={cx('h-6 w-6', isFavorite ? 'fill-caution text-caution' : 'text-white/70')} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="press glass-well flex h-14 w-14 shrink-0 items-center justify-center rounded-full"
        >
          <X className="h-6 w-6 text-white/80" strokeWidth={2.4} />
        </button>
      </div>
      {error ? (
        <button
          type="button"
          onClick={onRetry}
          className="glass-well press mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[17px] font-semibold"
        >
          <RotateCcw className="h-5 w-5" /> Try Again
        </button>
      ) : (
        <button
          type="button"
          disabled={!route}
          onClick={() => {
            haptic('medium')
            onGo()
          }}
          className="glass-green press mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-[18px] font-bold disabled:opacity-40"
        >
          <Navigation className="h-5 w-5 fill-white" /> Go
        </button>
      )}
    </div>
  )
}
