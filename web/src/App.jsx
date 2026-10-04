import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Menu, Search, X } from 'lucide-react'
import MapView from './components/Map'
import GlassHUD from './components/GlassHUD'
import { ManeuverBanner, StatusPill } from './components/StatusPill'
import SearchSheet from './components/SearchSheet'
import RoutePreview from './components/RoutePreview'
import MenuSheet from './components/MenuSheet'
import RideSummary from './components/RideSummary'
import TokenGate from './components/TokenGate'
import { Presence, RoundButton, cx } from './components/ui'
import { useMapboxToken, usePlaces, useSettings } from './hooks/useSettings'
import { useNow } from './hooks/useNow'
import { useWakeLock } from './hooks/useWakeLock'
import { requestCompassPermission, simulationFromUrl, startLocation } from './lib/location'
import { RideRecorder, gpxFilename, toGpx } from './lib/ride'
import { BikeInfra } from './lib/bikeInfra'
import { NavSession, fetchRoute, reverseGeocode } from './lib/navigation'
import { STORES, dbDelete, dbGet, dbPut, requestPersistence, writeLocal } from './lib/storage'
import { haptic, onNative, postNative } from './lib/native'
import { shareFile, speak } from './lib/speech'
import { angleDiff, clamp, distance, lineBounds } from './lib/geo'

const SIM = simulationFromUrl()
// Dev only: HUD over a blank canvas, for layout work without a Mapbox token.
const NO_MAP = import.meta.env.DEV && new URLSearchParams(window.location.search).has('nomap')
const STALE_AFTER = 8000
const RESTORE_WINDOW = 6 * 3600 * 1000
const REROUTE_COOLDOWN = 12_000

export default function App() {
  const [settings, updateSettings] = useSettings()
  const { token, fromEnv, setToken } = useMapboxToken()
  const [places, setPlaces] = usePlaces()
  const [authError, setAuthError] = useState(null)
  const [editingToken, setEditingToken] = useState(false)

  // Location
  const [locStatus, setLocStatus] = useState(SIM ? 'granted' : 'pending')
  const [fix, setFix] = useState(null)
  const [speed, setSpeed] = useState(0)
  const [stale, setStale] = useState(true)
  const [compass, setCompass] = useState(null)
  const [lane, setLane] = useState(null)
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const liveRef = useRef({ pos: null, seq: 0, interval: 1000, speed: 0, course: null, heading: null, stale: true })
  const lastFixRef = useRef(null)
  const laneRef = useRef({ current: null, candidate: null, count: 0 })

  // Camera
  const [followMode, setFollowMode] = useState('follow')
  const lastFollowRef = useRef('follow')

  // Ride
  const [recorder] = useState(() => new RideRecorder())
  const [ride, setRide] = useState(null)
  const [trail, setTrail] = useState([])
  const trailStampRef = useRef(0)
  const [hudExpanded, setHudExpanded] = useState(false)
  const [finished, setFinished] = useState(null)
  const [ridesVersion, setRidesVersion] = useState(0)
  const [viewedRide, setViewedRide] = useState(null)

  // Bike infrastructure
  const [infraVersion, setInfraVersion] = useState(0)
  const [infra] = useState(() => new BikeInfra({ onChange: () => setInfraVersion((v) => v + 1) }))

  // Navigation
  const [sheet, setSheet] = useState(null)
  const [menuTab, setMenuTab] = useState('rides')
  const [preview, setPreview] = useState(null)
  const [nav, setNav] = useState(null)
  const navRef = useRef(null)

  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const showToast = useCallback((message) => {
    clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = setTimeout(() => setToast(null), 3500)
  }, [])

  const mapRef = useRef(null)
  const barRef = useRef(null)
  const stackRef = useRef(null)
  const topRef = useRef(null)
  const [barInset, setBarInset] = useState(120)

  const now = useNow(1000)
  useWakeLock(settings.keepAwake)

  // ── HUD geometry → map padding and Mapbox chrome offset ────────────────
  useLayoutEffect(() => {
    const measure = () => {
      const h = window.innerHeight
      if (stackRef.current) {
        const stackTop = stackRef.current.getBoundingClientRect().top
        document.documentElement.style.setProperty('--hud-inset', `${Math.max(0, h - stackTop + 6)}px`)
      }
      if (barRef.current) {
        // Bucketed so a one-pixel wobble doesn't re-ease the follow camera.
        const inset = Math.round((h - barRef.current.getBoundingClientRect().top) / 8) * 8
        setBarInset((prev) => (prev === inset ? prev : inset))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (stackRef.current) ro.observe(stackRef.current)
    if (barRef.current) ro.observe(barRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // ── Location stream ─────────────────────────────────────────────────────
  const handlersRef = useRef({})
  useEffect(() => {
    handlersRef.current = { onFixes: handleFixes, onHeading: handleHeading }
  })

  function handleHeading(h) {
    liveRef.current.heading = h
    setCompass((prev) => (prev == null || Math.abs(angleDiff(prev, h)) >= 3 ? h : prev))
  }

  function handleFixes(fixes) {
    if (!fixes.length) return
    const latest = fixes[fixes.length - 1]
    const previous = lastFixRef.current
    lastFixRef.current = latest

    recorder.ingest(fixes, { autoPause: settings.autoPause })

    let rawSpeed = latest.speed
    if (rawSpeed == null && previous && latest.t > previous.t) {
      rawSpeed = distance([previous.lon, previous.lat], [latest.lon, latest.lat]) / ((latest.t - previous.t) / 1000)
    }
    const fresh = Date.now() - latest.t < 5000
    const live = liveRef.current
    const nowPerf = performance.now()
    live.interval = live.arrivedAt ? clamp(nowPerf - live.arrivedAt, 250, 1500) : 1000
    live.arrivedAt = nowPerf
    live.pos = [latest.lon, latest.lat]
    live.seq++
    live.speed = fresh ? rawSpeed ?? 0 : 0
    live.course = latest.course
    live.lastWall = Date.now()
    live.stale = false

    setSpeed((prev) => {
      if (!fresh || rawSpeed == null || rawSpeed < 0.35) return 0
      return prev * 0.35 + rawSpeed * 0.65
    })
    setFix(latest)
    setStale(false)

    if (settings.showInfra) {
      infra.ensureAround(latest.lon, latest.lat)
      const course = latest.course != null && (latest.speed ?? 0) > 2 ? latest.course : live.heading
      let kind = null
      if ((latest.acc ?? 10) <= 30) {
        const hit = infra.nearest(latest.lon, latest.lat, course, clamp(5 + (latest.acc ?? 10) * 0.6, 8, 20))
        kind = hit?.kind ?? null
        if (!hit && !infra.hasDataAt(latest.lon, latest.lat)) kind = mapRef.current?.probeBikeAt(latest.lon, latest.lat) ?? null
      }
      // Two agreeing fixes to enter, three to leave. GPS wanders a few
      // metres either side of a lane and the pill shouldn't flicker with it.
      const h = laneRef.current
      if (kind === h.candidate) h.count++
      else {
        h.candidate = kind
        h.count = 1
      }
      if (kind !== h.current && h.count >= (kind ? 2 : 3)) {
        h.current = kind
        setLane(kind)
      }
    }

    const n = navRef.current
    if (n?.session) {
      const state = n.session.update(latest)
      if (state.announcement && settings.voice) speak(state.announcement)
      if (state.offRoute && !n.rerouting && Date.now() - n.lastReroute > REROUTE_COOLDOWN) reroute(n)
      if (state.arrived && !n.arrivedAt) {
        n.arrivedAt = Date.now()
        haptic('success')
        setTimeout(() => {
          if (navRef.current === n) endNav()
        }, 8000)
      }
      setNav((prev) => (prev ? { ...prev, state } : prev))
    }
  }

  useEffect(() => {
    const stop = startLocation({
      simulate: SIM,
      onStatus: setLocStatus,
      onHeading: (h) => handlersRef.current.onHeading?.(h),
      onFixes: (fixes) => handlersRef.current.onFixes?.(fixes),
    })
    const staleTimer = setInterval(() => {
      const live = liveRef.current
      if (live.lastWall && Date.now() - live.lastWall > STALE_AFTER && !live.stale) {
        live.stale = true
        live.speed = 0
        setStale(true)
        setSpeed(0)
      }
    }, 2000)
    const savePos = setInterval(() => {
      if (liveRef.current.pos) writeLocal('lastPos', liveRef.current.pos)
    }, 30_000)
    return () => {
      stop()
      clearInterval(staleTimer)
      clearInterval(savePos)
    }
  }, [])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  useEffect(() => {
    infra.setEnabled(settings.showInfra)
    if (!settings.showInfra) {
      laneRef.current = { current: null, candidate: null, count: 0 }
      setLane(null)
    } else if (liveRef.current.pos) {
      infra.ensureAround(...liveRef.current.pos)
    }
  }, [infra, settings.showInfra])

  // ── Ride lifecycle and persistence ──────────────────────────────────────
  useEffect(() => recorder.subscribe(setRide), [recorder])

  const persistFinished = useCallback(async ({ summary, track }) => {
    await Promise.all([dbPut(STORES.rides, summary.id, summary), dbPut(STORES.tracks, summary.id, track)])
    setRidesVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    requestPersistence()
    let cancelled = false
    dbGet(STORES.kv, 'activeRide').then((saved) => {
      if (cancelled || !saved || recorder.active) return
      recorder.restore(saved)
      if (Date.now() - (saved.lastT ?? saved.startedAt) < RESTORE_WINDOW) {
        setTrail(recorder.trail())
        return
      }
      // Abandoned overnight: file it rather than resume it.
      const result = recorder.finish()
      dbDelete(STORES.kv, 'activeRide')
      if (result && result.summary.distance >= 30) persistFinished(result)
    })
    return () => {
      cancelled = true
    }
  }, [recorder, persistFinished])

  const rideActive = Boolean(ride)
  useEffect(() => {
    if (!rideActive) return
    const save = () => {
      const snapshot = recorder.serialize()
      if (snapshot) dbPut(STORES.kv, 'activeRide', snapshot)
    }
    const onVisibility = () => document.visibilityState === 'hidden' && save()
    const interval = setInterval(save, 10_000)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', save)
    const offNative = onNative('appState', (m) => !m.active && save())
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', save)
      offNative()
    }
  }, [rideActive, recorder])

  const pointCount = ride?.pointCount ?? 0
  useEffect(() => {
    if (!rideActive) return
    const t = Date.now()
    if (t - trailStampRef.current < 3000 && pointCount > 2) return
    trailStampRef.current = t
    setTrail(recorder.trail())
  }, [pointCount, rideActive, recorder])

  // Background GPS only while a ride is actually recording.
  useEffect(() => {
    postNative('setRecording', { on: ride?.status === 'recording' })
  }, [ride?.status])

  const startRide = useCallback(() => {
    requestCompassPermission()
    recorder.start()
    setViewedRide(null)
    setTrail([])
    haptic('success')
  }, [recorder])

  const finishRide = useCallback(() => {
    const result = recorder.finish()
    dbDelete(STORES.kv, 'activeRide')
    setHudExpanded(false)
    setTrail([])
    if (!result) return
    const { summary, track } = result
    if (summary.distance < 30 && summary.movingTime < 30) {
      showToast('Ride too short, not saved')
      return
    }
    persistFinished(result)
    setFinished(result)
    setViewedRide({ id: summary.id, name: summary.name, coords: track.map((p) => [p[0], p[1]]) })
    if (summary.bounds) {
      setFollowMode('free')
      requestAnimationFrame(() => mapRef.current?.fitBounds(summary.bounds, { top: 80, bottom: window.innerHeight * 0.55 }))
    }
  }, [recorder, persistFinished, showToast])

  const shareRide = useCallback(
    async (summary) => {
      const track = await dbGet(STORES.tracks, summary.id)
      if (!track?.length) {
        showToast('No GPS track saved for this ride')
        return
      }
      shareFile({ filename: gpxFilename(summary), mime: 'application/gpx+xml', content: toGpx(summary, track) })
    },
    [showToast],
  )

  const deleteRide = useCallback(async (id) => {
    await Promise.all([dbDelete(STORES.rides, id), dbDelete(STORES.tracks, id)])
    setRidesVersion((v) => v + 1)
    setViewedRide((v) => (v?.id === id ? null : v))
  }, [])

  const showRide = useCallback(
    async (summary) => {
      const track = await dbGet(STORES.tracks, summary.id)
      setSheet(null)
      if (!track?.length) {
        showToast('No GPS track saved for this ride')
        return
      }
      setViewedRide({ id: summary.id, name: summary.name, coords: track.map((p) => [p[0], p[1]]) })
      setFollowMode('free')
      requestAnimationFrame(() => mapRef.current?.fitBounds(summary.bounds, { top: 90, bottom: barInset }))
    },
    [barInset, showToast],
  )

  // ── Navigation ──────────────────────────────────────────────────────────
  const currentCourse = () => {
    const f = lastFixRef.current
    if (f?.course != null && (f.speed ?? 0) > 1.5) return f.course
    return liveRef.current.heading
  }

  const openPreview = useCallback(
    async (destination) => {
      setSheet(null)
      const from = liveRef.current.pos
      if (!from) {
        showToast('Waiting for GPS')
        return
      }
      haptic('light')
      setViewedRide(null)
      setPreview({ destination, loading: true })
      setFollowMode('free')
      try {
        const route = await fetchRoute({ token, from, to: destination.coord, heading: currentCourse(), units: settings.units })
        setPreview((prev) => (prev?.destination.id === destination.id ? { ...prev, route, loading: false } : prev))
      } catch (err) {
        setPreview((prev) =>
          prev?.destination.id === destination.id ? { ...prev, loading: false, error: err.message } : prev,
        )
      }
    },
    [token, settings.units, showToast],
  )

  const previewRoute = preview?.route
  useEffect(() => {
    if (!previewRoute) return
    const id = requestAnimationFrame(() => {
      const stackTop = stackRef.current?.getBoundingClientRect().top ?? window.innerHeight * 0.6
      const topBottom = topRef.current?.getBoundingClientRect().bottom ?? 80
      mapRef.current?.fitBounds(lineBounds(previewRoute.coords), {
        top: topBottom,
        bottom: window.innerHeight - stackTop,
      })
    })
    return () => cancelAnimationFrame(id)
  }, [previewRoute])

  const onLongPress = useCallback(
    (coord) => {
      if (navRef.current) return
      haptic('medium')
      const destination = { id: `pin:${coord[0].toFixed(5)},${coord[1].toFixed(5)}`, name: 'Dropped Pin', address: '', coord }
      openPreview(destination)
      reverseGeocode(coord, { token }).then((info) =>
        setPreview((prev) =>
          prev?.destination.id === destination.id ? { ...prev, destination: { ...prev.destination, ...info } } : prev,
        ),
      )
    },
    [openPreview, token],
  )

  const endNav = useCallback(() => {
    navRef.current = null
    setNav(null)
  }, [])

  async function reroute(n) {
    n.rerouting = true
    n.lastReroute = Date.now()
    setNav((prev) => (prev ? { ...prev, rerouting: true } : prev))
    haptic('warning')
    try {
      const route = await fetchRoute({
        token,
        from: liveRef.current.pos,
        to: n.destination.coord,
        heading: currentCourse(),
        units: settings.units,
      })
      if (navRef.current !== n) return
      n.session = new NavSession(route, n.destination)
      const state = lastFixRef.current ? n.session.update(lastFixRef.current) : null
      if (state?.announcement && settings.voice) speak(state.announcement)
      setNav((prev) => (prev ? { ...prev, route, state, rerouting: false } : prev))
    } catch {
      setNav((prev) => (prev ? { ...prev, rerouting: false } : prev))
    } finally {
      n.rerouting = false
    }
  }

  const startNav = useCallback(() => {
    if (!preview?.route) return
    const { destination, route } = preview
    const session = new NavSession(route, destination)
    const n = { session, destination, lastReroute: 0, rerouting: false, arrivedAt: null }
    navRef.current = n
    const state = lastFixRef.current ? session.update(lastFixRef.current) : null
    setNav({ destination, route, state, rerouting: false })
    setPreview(null)
    lastFollowRef.current = 'follow'
    setFollowMode('follow')
    setPlaces((p) => ({
      ...p,
      recents: [destination, ...p.recents.filter((r) => r.id !== destination.id)].slice(0, 12),
    }))
    if (!recorder.active) recorder.start()
    if (state?.announcement && settings.voice) speak(state.announcement)
  }, [preview, recorder, setPlaces, settings.voice])

  const toggleFavorite = useCallback(() => {
    const destination = preview?.destination
    if (!destination) return
    setPlaces((p) => {
      const exists = p.favorites.some((f) => f.id === destination.id)
      return {
        ...p,
        favorites: exists ? p.favorites.filter((f) => f.id !== destination.id) : [destination, ...p.favorites].slice(0, 30),
      }
    })
  }, [preview, setPlaces])

  // ── Camera ──────────────────────────────────────────────────────────────
  const recenter = useCallback(() => {
    setFollowMode((mode) => {
      if (mode === 'free') return lastFollowRef.current
      const next = mode === 'follow' ? 'north' : 'follow'
      lastFollowRef.current = next
      return next
    })
    if (!finished) setViewedRide(null)
  }, [finished])

  const onFollowBreak = useCallback(() => setFollowMode('free'), [])
  const onAuthError = useCallback((status) => setAuthError(`Mapbox rejected the token (HTTP ${status}). Paste a valid one.`), [])

  // ── Derived view state ──────────────────────────────────────────────────
  const hasFix = Boolean(fix) && !stale
  const displayHeading = fix?.course != null && speed > 2 ? fix.course : compass
  const navHud =
    nav?.state && !nav.state.arrived
      ? (() => {
          const routeSpeed = nav.route.distance / Math.max(1, nav.route.duration)
          const rideAvg = ride && ride.movingTime > 120 ? ride.distance / ride.movingTime : 0
          const pace = rideAvg > 2 ? rideAvg * 0.6 + routeSpeed * 0.4 : routeSpeed
          return { remaining: nav.state.remaining, etaSeconds: nav.state.remaining / Math.max(pace, 1) }
        })()
      : null
  const riding = speed > 2.5 && !sheet
  const isFavorite = Boolean(preview && places.favorites.some((f) => f.id === preview.destination.id))
  const destinationCoord = nav?.destination.coord ?? preview?.destination.coord ?? null
  const showGate = !NO_MAP && (!token || Boolean(authError) || editingToken)
  const maskedToken = token ? `${token.slice(0, 8)}…${token.slice(-4)}` : 'none'

  return (
    <div className="fixed inset-0 overflow-hidden bg-oled">
      {token && !authError && !NO_MAP && (
        <MapView
          ref={mapRef}
          token={token}
          liveRef={liveRef}
          followMode={followMode}
          settings={settings}
          infra={infra}
          infraVersion={infraVersion}
          trail={trail}
          route={nav?.route ?? preview?.route ?? null}
          history={viewedRide?.coords ?? null}
          destination={destinationCoord}
          bottomInset={barInset}
          onFollowBreak={onFollowBreak}
          onLongPress={onLongPress}
          onAuthError={onAuthError}
        />
      )}

      <div
        ref={topRef}
        className="safe-top pointer-events-none fixed inset-x-0 z-20 flex flex-col items-center gap-2 pr-[calc(var(--sar)+12px)] pl-[calc(var(--sal)+12px)]"
      >
        <Presence show={Boolean(nav)}>
          {(leaving) => (
            <ManeuverBanner
              leaving={leaving}
              state={nav?.state}
              destination={nav?.destination}
              units={settings.units}
              rerouting={nav?.rerouting}
              onEnd={() => {
                haptic('medium')
                endNav()
              }}
            />
          )}
        </Presence>
        <StatusPill
          locStatus={locStatus}
          hasFix={hasFix}
          accuracy={fix?.acc ?? 0}
          lane={settings.showInfra ? lane : null}
          heading={displayHeading}
          online={online}
          paused={ride?.status === 'paused'}
          compact={Boolean(nav)}
        />
        <Presence show={Boolean(viewedRide && !finished)}>
          {(leaving) => (
            <button
              type="button"
              onClick={() => setViewedRide(null)}
              className={cx(
                'glass flex h-11 items-center gap-2 rounded-full pr-2 pl-4 text-[15px] font-semibold',
                leaving ? 'animate-drop-out' : 'animate-drop-in pointer-events-auto',
              )}
            >
              {viewedRide?.name}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
                <X className="h-4 w-4" />
              </span>
            </button>
          )}
        </Presence>
        <Presence show={Boolean(toast)}>
          {(leaving) => (
            <div
              className={cx(
                'glass rounded-2xl px-4 py-2.5 text-[15px] font-medium',
                leaving ? 'animate-drop-out' : 'animate-drop-in',
              )}
            >
              {toast}
            </div>
          )}
        </Presence>
      </div>

      {/* Out of the way while the ride panel is open. In landscape the panel
          spans the width the buttons sit in. */}
      <Presence show={!preview && !hudExpanded}>
        {(leaving) => (
          <div
            className={cx(
              'pointer-events-none fixed right-[calc(var(--sar)+12px)] z-20 flex origin-top-right flex-col gap-3 transition-opacity duration-500',
              riding && 'opacity-45',
              leaving ? 'animate-pop-out [&_button]:pointer-events-none' : 'animate-pop-in',
            )}
            style={{ top: nav ? 'calc(var(--sat) + 150px)' : 'calc(var(--sat) + 66px)' }}
          >
            {!nav && <RoundButton icon={Search} label="Search" onClick={() => setSheet('search')} />}
            <RoundButton icon={Menu} label="Menu" onClick={() => setSheet('menu')} />
          </div>
        )}
      </Presence>

      <GlassHUD
        units={settings.units}
        speed={speed}
        speedLive={hasFix}
        ride={ride}
        now={now}
        nav={navHud}
        followMode={followMode}
        expanded={hudExpanded && !preview}
        onToggleExpanded={setHudExpanded}
        onRecenter={recenter}
        onStart={startRide}
        onPause={() => recorder.pause()}
        onResume={() => recorder.resume()}
        onFinish={finishRide}
        barRef={barRef}
        stackRef={stackRef}
        aboveBar={
          preview && (
            <RoutePreview
              preview={preview}
              units={settings.units}
              isFavorite={isFavorite}
              onToggleFavorite={toggleFavorite}
              onGo={startNav}
              onRetry={() => openPreview(preview.destination)}
              onCancel={() => {
                setPreview(null)
                setFollowMode(lastFollowRef.current)
              }}
            />
          )
        }
      />

      <SearchSheet
        open={sheet === 'search'}
        onClose={() => setSheet(null)}
        token={token}
        proximity={fix ? [fix.lon, fix.lat] : null}
        places={places}
        setPlaces={setPlaces}
        units={settings.units}
        onPick={openPreview}
      />

      <MenuSheet
        open={sheet === 'menu'}
        onClose={() => setSheet(null)}
        tab={menuTab}
        setTab={setMenuTab}
        settings={settings}
        updateSettings={updateSettings}
        ridesVersion={ridesVersion}
        onShowRide={showRide}
        onShareRide={shareRide}
        onDeleteRide={deleteRide}
        tokenInfo={{ masked: maskedToken, fromEnv }}
        onChangeToken={() => {
          setSheet(null)
          setEditingToken(true)
        }}
        onClearLaneCache={() => infra.clearCache()}
      />

      <RideSummary
        summary={finished?.summary ?? null}
        units={settings.units}
        onDone={() => {
          setFinished(null)
          setViewedRide(null)
          setFollowMode(lastFollowRef.current)
        }}
        onShare={() => finished && shareRide(finished.summary)}
        onDelete={async () => {
          if (finished) await deleteRide(finished.summary.id)
          setFinished(null)
          setViewedRide(null)
          setFollowMode(lastFollowRef.current)
          showToast('Ride discarded')
        }}
      />

      <Presence show={showGate} exit={320}>
        {(leaving) => (
          <TokenGate
            leaving={leaving}
            initialError={authError}
            currentToken={editingToken && !authError ? token : null}
            onCancel={() => setEditingToken(false)}
            onSave={(t) => {
              setToken(t)
              setAuthError(null)
              setEditingToken(false)
            }}
          />
        )}
      </Presence>
    </div>
  )
}
