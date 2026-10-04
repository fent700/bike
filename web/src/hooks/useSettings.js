import { useCallback, useState } from 'react'
import { readLocal, writeLocal } from '../lib/storage'

export const DEFAULT_SETTINGS = {
  units: 'imperial',
  tilt: true,
  autoZoom: true,
  autoPause: true,
  voice: true,
  keepAwake: true,
  showInfra: true,
}

function usePersisted(key, initial) {
  const [value, setValue] = useState(() => readLocal(key, initial))
  const update = useCallback(
    (next) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next
        writeLocal(key, resolved)
        return resolved
      }),
    [key],
  )
  return [value, update]
}

export function useSettings() {
  const [stored, setStored] = usePersisted('settings', DEFAULT_SETTINGS)
  const settings = { ...DEFAULT_SETTINGS, ...stored }
  const update = useCallback((patch) => setStored((prev) => ({ ...DEFAULT_SETTINGS, ...prev, ...patch })), [setStored])
  return [settings, update]
}

const ENV_TOKEN = (import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '').trim()

/** A token pasted on the device wins over the one baked in at build time. */
export function useMapboxToken() {
  const [stored, setStored] = usePersisted('mapboxToken', '')
  const token = stored || ENV_TOKEN
  return { token, fromEnv: !stored && Boolean(ENV_TOKEN), setToken: setStored }
}

export const EMPTY_PLACES = { home: null, work: null, favorites: [], recents: [] }

export function usePlaces() {
  const [stored, setStored] = usePersisted('places', EMPTY_PLACES)
  return [{ ...EMPTY_PLACES, ...stored }, setStored]
}
