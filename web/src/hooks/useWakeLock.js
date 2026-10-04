import { useEffect } from 'react'
import { isNative, postNative } from '../lib/native'

/**
 * Screen stays on. The iOS shell does this natively with
 * isIdleTimerDisabled; in a browser it's the Screen Wake Lock API, which only
 * grants from a visible page and drops on every visibility change, so it is
 * re-requested on each return and on the first touch.
 */
export function useWakeLock(enabled) {
  useEffect(() => {
    if (isNative) {
      postNative('setKeepAwake', { on: enabled })
      return
    }
    if (!enabled || !('wakeLock' in navigator)) return
    let lock = null
    let cancelled = false
    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible' || (lock && !lock.released)) return
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // Denied without a user gesture; the pointerdown listener retries.
      }
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    window.addEventListener('pointerdown', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      window.removeEventListener('pointerdown', acquire)
      lock?.release?.().catch(() => {})
    }
  }, [enabled])
}
