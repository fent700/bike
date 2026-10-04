import { Check, Share, Trash } from 'lucide-react'
import { HoldButton, Sheet } from './ui'
import { RideHero, RideStatGrid } from './RideStats'

/** Shown the moment a ride is finished; the ride is already saved by then. */
export default function RideSummary({ summary, units, onDone, onShare, onDelete }) {
  return (
    <Sheet
      open={Boolean(summary)}
      onClose={onDone}
      title={summary?.name ?? ''}
      footer={
        summary && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onShare}
              className="glass-well press flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold"
            >
              <Share className="h-5 w-5" /> Export GPX
            </button>
            <button
              type="button"
              onClick={onDone}
              className="glass-green press flex h-14 items-center justify-center gap-2 rounded-2xl text-[17px] font-bold"
            >
              <Check className="h-5 w-5" strokeWidth={3} /> Done
            </button>
          </div>
        )
      }
    >
      {summary && (
        <div className="pb-2">
          <RideHero summary={summary} units={units} />
          <RideStatGrid summary={summary} units={units} />
          <HoldButton onConfirm={onDelete} className="mt-2 w-full">
            <Trash className="h-4 w-4" /> Hold to Discard Ride
          </HoldButton>
        </div>
      )}
    </Sheet>
  )
}
