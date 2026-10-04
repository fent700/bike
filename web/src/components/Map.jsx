import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { addOverlayLayers, lineFeature, restyleBaseMap, setBikeLayersVisible } from '../lib/mapStyle'
import { angleDiff, clamp, lerpAngle } from '../lib/geo'
import { readLocal } from '../lib/storage'

const STYLE = 'mapbox://styles/mapbox/dark-v11'
const FOLLOW_PITCH = 50
const FRAME_INTERVAL = 30 // ms — ~30 fps is smooth at riding speed and halves GPU time vs 60
const EMPTY = { type: 'FeatureCollection', features: [] }

/** Look further ahead the faster you go: z17.1 standing, z15.5 at ~33 mph. */
const speedZoom = (speed) => clamp(17.1 - (speed || 0) * 0.11, 15.5, 17.1)

function createPuckElement() {
  const el = document.createElement('div')
  el.className = 'puck no-heading'
  el.innerHTML = `
    <div class="puck-pulse"></div>
    <svg class="puck-cone" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="puck-cone-fill" cx="60" cy="60" r="56" gradientUnits="userSpaceOnUse">
          <stop offset="0.12" stop-color="#00F076" stop-opacity="0.62"/>
          <stop offset="1" stop-color="#00F076" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path d="M60 60 L34.6 10.1 A56 56 0 0 1 85.4 10.1 Z" fill="url(#puck-cone-fill)"/>
    </svg>
    <div class="puck-dot"></div>`
  return el
}

function createDestinationElement() {
  const el = document.createElement('div')
  el.className = 'dest-pin'
  return el
}

/**
 * Mapbox lifecycle, HUD camera and overlay data.
 *
 * Position and heading arrive through `liveRef` (mutated by App on every fix)
 * rather than props, so a 1 Hz GPS stream never re-renders React. A rAF loop
 * interpolates between fixes and drives both the puck and — in follow modes —
 * the camera, which keeps the puck pinned while the road slides underneath.
 *
 * followMode: 'follow' (heading-up, pitched, puck low) | 'north' | 'free'
 */
export default function Map({
  ref,
  token,
  liveRef,
  followMode,
  settings,
  infra,
  infraVersion,
  trail,
  route,
  history,
  destination,
  bottomInset,
  onFollowBreak,
  onLongPress,
  onAuthError,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const motionRef = useRef(null)
  const propsRef = useRef({})
  const [ready, setReady] = useState(false)

  useEffect(() => {
    propsRef.current = { followMode, settings, onFollowBreak, onLongPress, onAuthError, infra }
  })

  useEffect(() => {
    mapboxgl.accessToken = token
    const last = readLocal('lastPos', null)
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLE,
      center: last || [-98.58, 39.83],
      zoom: last ? 15.8 : 3.2,
      projection: 'mercator',
      attributionControl: false,
      logoPosition: 'bottom-left',
      // Retina is plenty on a handlebar; 3× would be ~2.25× the fragment work
      // for detail nobody can see at 20 mph.
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      antialias: false,
      fadeDuration: 120,
      maxPitch: 65,
      doubleClickZoom: false,
      pitchWithRotate: false,
      performanceMetricsCollection: false,
    })
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    const puckEl = createPuckElement()
    const puck = new mapboxgl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' })
    let puckShown = false

    const motion = {
      seq: -1,
      from: null,
      to: null,
      start: 0,
      dur: 1000,
      pos: null,
      bearing: null,
      zoom: null,
      zoomOffset: 0,
      autoZoom: 16.6,
      userZooming: false,
      transitionUntil: 0,
      lastDraw: 0,
      firstFix: true,
    }
    motionRef.current = motion

    map.on('load', () => {
      restyleBaseMap(map)
      addOverlayLayers(map)
      setReady(true)
    })

    map.on('error', (e) => {
      const status = e?.error?.status
      if (status === 401 || status === 403) propsRef.current.onAuthError?.(status)
      else console.warn('map:', e?.error?.message || e)
    })

    map.on('dragstart', (e) => {
      if (e.originalEvent) propsRef.current.onFollowBreak?.()
    })
    map.on('zoomstart', (e) => {
      if (e.originalEvent) motion.userZooming = true
    })
    map.on('zoomend', () => {
      if (!motion.userZooming) return
      motion.userZooming = false
      // A pinch while following doesn't break follow; it trims the auto zoom.
      motion.zoomOffset = clamp(map.getZoom() - motion.autoZoom, -4, 2.5)
      motion.zoom = map.getZoom()
    })

    let browseTimer = null
    map.on('moveend', () => {
      if (propsRef.current.followMode !== 'free') return
      clearTimeout(browseTimer)
      browseTimer = setTimeout(() => {
        if (map.getZoom() < 12.5) return
        const b = map.getBounds()
        propsRef.current.infra?.ensureBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      }, 500)
    })

    // Long-press drops a destination. iOS WebKit never fires `contextmenu`
    // for touch, so it's timed by hand; the mouse path covers desktop dev.
    let pressTimer = null
    let pressPoint = null
    let lastPressAt = 0
    const cancelPress = () => {
      clearTimeout(pressTimer)
      pressTimer = null
    }
    map.on('touchstart', (e) => {
      cancelPress()
      if (e.originalEvent.touches.length !== 1) return
      pressPoint = e.point
      const { lng, lat } = e.lngLat
      pressTimer = setTimeout(() => {
        pressTimer = null
        lastPressAt = Date.now()
        propsRef.current.onLongPress?.([lng, lat])
      }, 550)
    })
    map.on('touchmove', (e) => {
      if (pressTimer && (Math.abs(e.point.x - pressPoint.x) > 10 || Math.abs(e.point.y - pressPoint.y) > 10)) cancelPress()
    })
    map.on('touchend', cancelPress)
    map.on('touchcancel', cancelPress)
    map.on('contextmenu', (e) => {
      if (Date.now() - lastPressAt < 1000) return
      propsRef.current.onLongPress?.([e.lngLat.lng, e.lngLat.lat])
    })

    let raf = 0
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      if (now - motion.lastDraw < FRAME_INTERVAL) return
      const dt = motion.lastDraw ? Math.min(now - motion.lastDraw, 250) : 16
      motion.lastDraw = now

      const live = liveRef.current
      if (!live?.pos) return

      if (live.seq !== motion.seq) {
        motion.from = motion.pos ?? live.pos
        motion.to = live.pos
        motion.start = now
        motion.dur = clamp(live.interval ?? 1000, 250, 1500)
        motion.seq = live.seq
      }
      const k = clamp((now - motion.start) / motion.dur, 0, 1)
      const pos = [
        motion.from[0] + (motion.to[0] - motion.from[0]) * k,
        motion.from[1] + (motion.to[1] - motion.from[1]) * k,
      ]
      const moved = !motion.pos || pos[0] !== motion.pos[0] || pos[1] !== motion.pos[1]
      motion.pos = pos

      // GPS course once rolling (true direction of travel), compass when
      // stopped or crawling, where course is noise.
      const headingTarget = live.course != null && live.speed > 2 ? live.course : live.heading
      let turning = false
      if (headingTarget != null) {
        motion.bearing =
          motion.bearing == null ? headingTarget : lerpAngle(motion.bearing, headingTarget, 1 - Math.exp(-dt / 320))
        turning = Math.abs(angleDiff(motion.bearing, headingTarget)) > 0.15
      }

      puck.setLngLat(pos)
      if (motion.bearing != null) puck.setRotation(motion.bearing)
      puckEl.classList.toggle('no-heading', headingTarget == null)
      puckEl.classList.toggle('stale', Boolean(live.stale))
      if (!puckShown) {
        puck.addTo(map)
        puckShown = true
      }

      const { followMode: mode, settings: s } = propsRef.current
      if (mode === 'free') return

      motion.autoZoom = s.autoZoom ? speedZoom(live.speed) : 16.6
      const targetZoom = clamp(motion.autoZoom + motion.zoomOffset, 11, 19.5)
      motion.zoom = motion.zoom == null ? targetZoom : motion.zoom + (targetZoom - motion.zoom) * (1 - Math.exp(-dt / 1400))
      const camBearing = mode === 'follow' ? (motion.bearing ?? map.getBearing()) : 0

      if (motion.firstFix) {
        motion.firstFix = false
        motion.zoom = targetZoom
        motion.transitionUntil = now + 1100
        map.easeTo({ center: pos, zoom: targetZoom, bearing: camBearing, duration: 1000, essential: true })
        return
      }
      if (now < motion.transitionUntil) return

      const camera = {}
      if (moved) camera.center = pos
      if (turning || Math.abs(angleDiff(map.getBearing(), camBearing)) > 0.05) camera.bearing = camBearing
      // Never pass zoom: undefined — jumpTo treats the key's presence as an
      // instruction and the map goes to NaN.
      if (!motion.userZooming && Math.abs(map.getZoom() - motion.zoom) > 0.002) camera.zoom = motion.zoom
      if (camera.center || camera.bearing != null || camera.zoom != null) map.jumpTo(camera)
    }
    raf = requestAnimationFrame(frame)

    mapRef.current = map
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(browseTimer)
      cancelPress()
      puck.remove()
      map.remove()
      mapRef.current = null
      setReady(false)
    }
  }, [token, liveRef])

  // Camera mode, gestures and padding. Padding is what puts the puck in the
  // lower third in heading-up mode so most of the screen shows road ahead.
  useEffect(() => {
    const map = mapRef.current
    const motion = motionRef.current
    if (!map || !ready) return
    if (followMode === 'free') {
      map.dragRotate.enable()
      map.touchZoomRotate.enable()
      map.touchZoomRotate.enableRotation()
      map.touchPitch.enable()
      map.scrollZoom.enable()
      return
    }
    map.dragRotate.disable()
    map.touchPitch.disable()
    map.touchZoomRotate.enable({ around: 'center' })
    map.touchZoomRotate.disableRotation()
    map.scrollZoom.enable({ around: 'center' })

    const height = map.getContainer().clientHeight
    const padding = {
      top: followMode === 'follow' ? Math.round(height * 0.42) : 0,
      bottom: bottomInset,
      left: 0,
      right: 0,
    }
    const options = {
      padding,
      pitch: followMode === 'follow' && settings.tilt ? FOLLOW_PITCH : 0,
      bearing: followMode === 'follow' ? (motion.bearing ?? map.getBearing()) : 0,
      duration: 900,
      essential: true,
    }
    if (motion.pos) {
      options.center = motion.pos
      options.zoom = motion.zoom ?? 16.6
    }
    motion.transitionUntil = performance.now() + 950
    map.easeTo(options)
  }, [followMode, ready, settings.tilt, bottomInset])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    setBikeLayersVisible(map, settings.showInfra)
    map.getSource('bike-osm')?.setData(settings.showInfra ? infra.geojson() : EMPTY)
  }, [ready, infra, infraVersion, settings.showInfra])

  useEffect(() => {
    if (ready) mapRef.current?.getSource('trail')?.setData(lineFeature(trail))
  }, [ready, trail])

  useEffect(() => {
    if (ready) mapRef.current?.getSource('route')?.setData(route?.geojson ?? EMPTY)
  }, [ready, route])

  useEffect(() => {
    if (ready) mapRef.current?.getSource('history')?.setData(lineFeature(history))
  }, [ready, history])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !destination) return
    const marker = new mapboxgl.Marker({ element: createDestinationElement(), anchor: 'bottom', offset: [0, -6] })
      .setLngLat(destination)
      .addTo(map)
    return () => marker.remove()
  }, [ready, destination])

  useImperativeHandle(
    ref,
    () => ({
      fitBounds(bounds, { top = 0, bottom = 0 } = {}) {
        const map = mapRef.current
        if (!map || !bounds) return
        // Follow-mode padding is persistent camera state and fitBounds adds
        // to it — clear it first or the route squeezes into the bottom third.
        map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 })
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            padding: { top: top + 48, bottom: bottom + 48, left: 48, right: 48 },
            pitch: 0,
            bearing: 0,
            maxZoom: 16.5,
            duration: 900,
            essential: true,
          },
        )
      },
      /** Fallback lane probe against Mapbox's own cycleway data. */
      probeBikeAt(lon, lat) {
        const map = mapRef.current
        if (!map || !map.isStyleLoaded() || !map.getLayer('bike-mbx-path')) return null
        const p = map.project([lon, lat])
        const r = 10
        const hits = map.queryRenderedFeatures(
          [
            [p.x - r, p.y - r],
            [p.x + r, p.y + r],
          ],
          { layers: ['bike-mbx-path', 'bike-mbx-lane'] },
        )
        if (!hits.length) return null
        return hits.some((f) => f.layer.id === 'bike-mbx-path') ? 'path' : 'lane'
      },
    }),
    [],
  )

  return <div ref={containerRef} className="absolute inset-0" />
}
