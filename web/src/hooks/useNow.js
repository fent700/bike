import { useEffect, useState } from 'react'

/** Re-renders on a fixed beat; drives the ride clock and ETA. */
export function useNow(interval = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), interval)
    return () => clearInterval(id)
  }, [interval, enabled])
  return now
}
