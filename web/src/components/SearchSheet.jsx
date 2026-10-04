import { useEffect, useMemo, useRef, useState } from 'react'
import { Briefcase, Clock, House, MapPin, Navigation, Search, Star, X } from 'lucide-react'
import { Sheet, Spinner, cx } from './ui'
import { newSessionToken, searchRetrieve, searchSuggest } from '../lib/navigation'
import { formatDistance } from '../lib/units'
import { haptic } from '../lib/native'

export default function SearchSheet({ open, onClose, token, proximity, places, setPlaces, units, onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [assigning, setAssigning] = useState(null) // 'home' | 'work' | null
  const [session, setSession] = useState(newSessionToken)
  const inputRef = useRef(null)
  const proximityRef = useRef(proximity)
  proximityRef.current = proximity

  useEffect(() => {
    if (!open) return
    setQuery('')
    setResults([])
    setError(null)
    setAssigning(null)
    setSession(newSessionToken())
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        setResults(await searchSuggest(q, { token, session, proximity: proximityRef.current, signal: controller.signal }))
      } catch (err) {
        if (err.name !== 'AbortError') setError(err.message)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 260)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open, token, session])

  const choose = async (suggestion) => {
    haptic('light')
    setLoading(true)
    setError(null)
    try {
      const place = await searchRetrieve(suggestion.id, { token, session })
      setSession(newSessionToken())
      if (assigning) {
        setPlaces((p) => ({ ...p, [assigning]: place }))
        setAssigning(null)
        setQuery('')
        setResults([])
      } else {
        onPick(place)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const removeFavorite = (id) => setPlaces((p) => ({ ...p, favorites: p.favorites.filter((f) => f.id !== id) }))
  const clearRecents = () => setPlaces((p) => ({ ...p, recents: [] }))

  const showLibrary = query.trim().length < 2
  const title = assigning ? `Set ${assigning === 'home' ? 'Home' : 'Work'}` : 'Where to?'

  return (
    <Sheet open={open} onClose={onClose} title={title} tall>
      <div className="glass-well flex h-14 items-center gap-3 rounded-2xl px-4">
        <Search className="h-5 w-5 shrink-0 text-white/45" strokeWidth={2.4} />
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={assigning ? 'Search an address' : 'Search places or addresses'}
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[17px] text-white placeholder:text-white/35 focus:outline-none"
        />
        {loading && <Spinner className="h-4 w-4" />}
        {query && !loading && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            className="-mr-2 flex h-11 w-11 items-center justify-center"
          >
            <X className="h-5 w-5 text-white/50" />
          </button>
        )}
      </div>

      {error && <p className="mt-3 text-[15px] text-[#ff6961]">{error}</p>}

      {showLibrary ? (
        <Library
          places={places}
          assigning={assigning}
          onPick={onPick}
          onAssign={setAssigning}
          onClear={(key) => setPlaces((p) => ({ ...p, [key]: null }))}
          onRemoveFavorite={removeFavorite}
          onClearRecents={clearRecents}
        />
      ) : (
        <ul className="mt-3 pb-4">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                className="press flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-1 text-left active:bg-white/5"
              >
                <span className="glass-well flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
                  <MapPin className="h-5 w-5 text-route" strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] font-semibold">{r.name}</span>
                  <span className="block truncate text-[14px] text-white/50">{r.address || r.category}</span>
                </span>
                {r.distance != null && (
                  <span className="metric shrink-0 text-[14px] text-white/50">{formatDistance(r.distance, units)}</span>
                )}
              </button>
            </li>
          ))}
          {!loading && !results.length && !error && <p className="mt-6 text-center text-white/45">No matches nearby</p>}
        </ul>
      )}
    </Sheet>
  )
}

function Library({ places, assigning, onPick, onAssign, onClear, onRemoveFavorite, onClearRecents }) {
  const recents = useMemo(
    () => places.recents.filter((r) => !places.favorites.some((f) => f.id === r.id)).slice(0, 8),
    [places],
  )
  if (assigning) return <p className="mt-6 text-center text-[15px] text-white/50">Search for the address to save.</p>
  return (
    <div className="pb-6">
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <PlaceTile icon={House} label="Home" place={places.home} onGo={onPick} onSet={() => onAssign('home')} onClear={() => onClear('home')} />
        <PlaceTile icon={Briefcase} label="Work" place={places.work} onGo={onPick} onSet={() => onAssign('work')} onClear={() => onClear('work')} />
      </div>

      {places.favorites.length > 0 && (
        <Section title="Favorites">
          {places.favorites.map((p) => (
            <PlaceRow key={p.id} icon={Star} iconClass="fill-caution text-caution" place={p} onGo={onPick} onRemove={() => onRemoveFavorite(p.id)} />
          ))}
        </Section>
      )}

      {recents.length > 0 && (
        <Section title="Recent" action={{ label: 'Clear', onClick: onClearRecents }}>
          {recents.map((p) => (
            <PlaceRow key={p.id} icon={Clock} place={p} onGo={onPick} />
          ))}
        </Section>
      )}

      <p className="mt-6 text-center text-[13px] text-white/35">Tip: long-press anywhere on the map to route there.</p>
    </div>
  )
}

function PlaceTile({ icon: Icon, label, place, onGo, onSet, onClear }) {
  return (
    <div className="glass-well relative flex h-[76px] items-center rounded-2xl">
      <button
        type="button"
        onClick={() => {
          haptic('light')
          place ? onGo(place) : onSet()
        }}
        className="press flex h-full min-w-0 flex-1 items-center gap-3 rounded-2xl pr-2 pl-3.5 text-left"
      >
        <span className={cx('flex h-11 w-11 shrink-0 items-center justify-center rounded-full', place ? 'bg-route' : 'bg-white/10')}>
          <Icon className="h-5 w-5 text-white" strokeWidth={2.3} />
        </span>
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold">{label}</span>
          <span className="block truncate text-[13px] text-white/45">{place ? place.name : 'Tap to set'}</span>
        </span>
      </button>
      {place && (
        <button type="button" aria-label={`Clear ${label}`} onClick={onClear} className="flex h-full w-11 items-center justify-center">
          <X className="h-4 w-4 text-white/35" />
        </button>
      )}
    </div>
  )
}

function Section({ title, action, children }) {
  return (
    <div className="mt-6">
      <div className="mb-1 flex items-center justify-between px-1">
        <h3 className="text-[13px] font-semibold tracking-[0.12em] text-white/40 uppercase">{title}</h3>
        {action && (
          <button type="button" onClick={action.onClick} className="h-9 px-1 text-[14px] font-medium text-route">
            {action.label}
          </button>
        )}
      </div>
      <ul>{children}</ul>
    </div>
  )
}

function PlaceRow({ icon: Icon, iconClass, place, onGo, onRemove }) {
  return (
    <li className="flex items-center">
      <button
        type="button"
        onClick={() => {
          haptic('light')
          onGo(place)
        }}
        className="press flex min-h-[60px] min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 text-left"
      >
        <span className="glass-well flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
          <Icon className={cx('h-[18px] w-[18px] text-white/60', iconClass)} strokeWidth={2.2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{place.name}</span>
          <span className="block truncate text-[13px] text-white/45">{place.address}</span>
        </span>
        {!onRemove && <Navigation className="h-4 w-4 shrink-0 text-white/25" />}
      </button>
      {onRemove && (
        <button type="button" aria-label="Remove favorite" onClick={onRemove} className="flex h-14 w-11 items-center justify-center">
          <X className="h-4 w-4 text-white/35" />
        </button>
      )}
    </li>
  )
}
