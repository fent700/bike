// Restyles mapbox/dark-v11 into the HUD look and adds the bike, route and
// trail layers. Every base-layer edit is matched by id pattern and wrapped,
// so a Mapbox style revision that renames a layer degrades to "left at the
// stock colour" rather than throwing during load.

export const COLORS = {
  background: '#0A0A0C',
  water: '#0B1016',
  land: '#0E0F12',
  park: '#0E1311',
  building: '#141519',
  roadMajor: '#64748B',
  roadMid: '#56606F',
  roadMinor: '#4B5563',
  footway: '#272B33',
  rail: '#1E2127',
  label: '#8B93A1',
  laneHi: '#00F076',
  lane: '#10B981',
  route: '#0A84FF',
  trail: '#CBD5E1',
  history: '#F8FAFC',
}

const BIKE_LAYERS = [
  'bike-mbx-path',
  'bike-mbx-lane',
  'bike-osm-glow',
  'bike-osm-line',
  'bike-osm-shared',
  'bike-osm-arrows',
  'bike-osm-arrows-side',
  'bike-osm-icons',
]

const HIDDEN_SYMBOLS = /^(poi-label|transit-label|natural-point-label|natural-line-label|waterway-label|road-exit-shield)$/

const zoomWidth = (stops, scale = 1) => [
  'interpolate',
  ['exponential', 1.5],
  ['zoom'],
  ...stops.flatMap(([z, w]) => [z, typeof scale === 'number' ? w * scale : ['*', w, scale]]),
]

function safely(fn) {
  try {
    fn()
  } catch {
    // Layer or property absent in this style revision.
  }
}

export function restyleBaseMap(map) {
  for (const layer of map.getStyle().layers) {
    const { id, type } = layer
    const sourceLayer = layer['source-layer']
    safely(() => {
      if (type === 'background') {
        map.setPaintProperty(id, 'background-color', COLORS.background)
      } else if (id === 'hillshade' || type === 'hillshade') {
        map.setLayoutProperty(id, 'visibility', 'none')
      } else if (type === 'fill' && /water/.test(id)) {
        map.setPaintProperty(id, 'fill-color', COLORS.water)
      } else if (type === 'line' && /waterway/.test(id)) {
        map.setPaintProperty(id, 'line-color', COLORS.water)
      } else if (type === 'fill' && /building/.test(id)) {
        map.setPaintProperty(id, 'fill-color', COLORS.building)
        map.setPaintProperty(id, 'fill-opacity', 0.9)
      } else if (type === 'fill' && /park|national/.test(id)) {
        map.setPaintProperty(id, 'fill-color', COLORS.park)
      } else if (type === 'fill' && /^(land|landcover|landuse)/.test(id)) {
        map.setPaintProperty(id, 'fill-color', COLORS.land)
      } else if (type === 'line' && sourceLayer === 'road') {
        styleRoad(map, id)
      } else if (type === 'symbol' && HIDDEN_SYMBOLS.test(id)) {
        map.setLayoutProperty(id, 'visibility', 'none')
      } else if (type === 'symbol' && /road-label|road-number/.test(id)) {
        map.setPaintProperty(id, 'text-color', COLORS.label)
        map.setPaintProperty(id, 'text-halo-color', COLORS.background)
      } else if (type === 'line' && /admin/.test(id)) {
        map.setPaintProperty(id, 'line-opacity', 0.35)
      }
    })
  }
}

function styleRoad(map, id) {
  if (/case|shadow/.test(id)) {
    map.setLayoutProperty(id, 'visibility', 'none')
    return
  }
  if (/path|steps|pedestrian|sidewalk/.test(id)) {
    map.setPaintProperty(id, 'line-color', COLORS.footway)
    map.setPaintProperty(id, 'line-width', zoomWidth([[13, 0.4], [16, 1], [19, 2]]))
    return
  }
  if (/rail/.test(id)) {
    map.setPaintProperty(id, 'line-color', COLORS.rail)
    return
  }
  const major = /motorway|trunk|primary/.test(id)
  const mid = /secondary|tertiary/.test(id)
  map.setPaintProperty(id, 'line-color', major ? COLORS.roadMajor : mid ? COLORS.roadMid : COLORS.roadMinor)
  map.setPaintProperty(
    id,
    'line-width',
    major || mid
      ? zoomWidth([[8, 0.5], [12, 1.1], [15, 2], [17, 2.6], [20, 7]])
      : zoomWidth([[11, 0.3], [13, 0.8], [15, 1.5], [17, 2.2], [20, 6]]),
  )
  if (!/tunnel/.test(id)) map.setPaintProperty(id, 'line-opacity', 1)
}

// Arrow and bike glyphs are drawn on a canvas rather than loaded as images,
// so they exist synchronously before the symbol layers that reference them.
function glyph(size, draw) {
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size * ratio
  const ctx = canvas.getContext('2d')
  ctx.scale(ratio, ratio)
  draw(ctx, size)
  return { image: ctx.getImageData(0, 0, size * ratio, size * ratio), ratio }
}

function addGlyphs(map) {
  // Chevron pointing along +x: line-placed symbols align their x axis with
  // the line's direction of digitisation.
  const arrow = glyph(28, (ctx, s) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 6.5
    const path = () => {
      ctx.beginPath()
      ctx.moveTo(s * 0.32, s * 0.24)
      ctx.lineTo(s * 0.66, s * 0.5)
      ctx.lineTo(s * 0.32, s * 0.76)
    }
    path()
    ctx.stroke()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 3.4
    path()
    ctx.stroke()
  })

  const bike = glyph(34, (ctx, s) => {
    const c = s / 2
    ctx.fillStyle = 'rgba(10,10,12,0.92)'
    ctx.beginPath()
    ctx.arc(c, c, c - 1.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLORS.laneHi
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.strokeStyle = '#FFFFFF'
    ctx.lineWidth = 1.7
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const r = s * 0.15
    const back = [s * 0.31, s * 0.6]
    const front = [s * 0.69, s * 0.6]
    for (const [x, y] of [back, front]) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    const crank = [s * 0.48, s * 0.6]
    const seat = [s * 0.42, s * 0.38]
    const head = [s * 0.62, s * 0.38]
    ctx.beginPath()
    ctx.moveTo(...back)
    ctx.lineTo(...crank)
    ctx.lineTo(...head)
    ctx.lineTo(...front)
    ctx.moveTo(...back)
    ctx.lineTo(...seat)
    ctx.lineTo(...crank)
    ctx.moveTo(seat[0] - s * 0.05, seat[1])
    ctx.lineTo(seat[0] + s * 0.05, seat[1])
    ctx.moveTo(...head)
    ctx.lineTo(head[0] - s * 0.03, head[1] - s * 0.07)
    ctx.lineTo(head[0] + s * 0.04, head[1] - s * 0.07)
    ctx.stroke()
  })

  if (!map.hasImage('bike-arrow')) map.addImage('bike-arrow', arrow.image, { pixelRatio: arrow.ratio })
  if (!map.hasImage('bike-glyph')) map.addImage('bike-glyph', bike.image, { pixelRatio: bike.ratio })
}

const EMPTY = { type: 'FeatureCollection', features: [] }

export function addOverlayLayers(map) {
  addGlyphs(map)
  const beforeId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id

  map.addSource('bike-osm', { type: 'geojson', data: EMPTY, tolerance: 0.45, buffer: 64 })
  map.addSource('route', { type: 'geojson', data: EMPTY, lineMetrics: false })
  map.addSource('trail', { type: 'geojson', data: EMPTY, tolerance: 0.6 })
  map.addSource('history', { type: 'geojson', data: EMPTY, tolerance: 0.6 })

  const round = { 'line-cap': 'round', 'line-join': 'round' }
  const kindScale = ['match', ['get', 'kind'], 'path', 1, 'track', 0.92, 'lane', 0.78, 0.62]
  const laneOffset = [
    'interpolate',
    ['linear'],
    ['zoom'],
    13,
    ['*', ['get', 'off'], 1],
    16,
    ['*', ['get', 'off'], 3.5],
    19,
    ['*', ['get', 'off'], 9],
  ]
  const bikeWidth = zoomWidth(
    [
      [11, 1.2],
      [14, 3],
      [16, 4.5],
      [18, 6],
      [20, 10],
    ],
    kindScale,
  )
  const bikeColor = ['match', ['get', 'kind'], ['path', 'track'], COLORS.laneHi, COLORS.lane]

  const layers = [
    {
      id: 'trail-line',
      type: 'line',
      source: 'trail',
      layout: round,
      paint: { 'line-color': COLORS.trail, 'line-opacity': 0.38, 'line-width': zoomWidth([[12, 1.5], [16, 3.2], [19, 6]]) },
    },
    {
      id: 'route-glow',
      type: 'line',
      source: 'route',
      layout: round,
      paint: {
        'line-color': COLORS.route,
        'line-opacity': 0.38,
        'line-blur': 6,
        'line-width': zoomWidth([[10, 6], [14, 11], [17, 16], [20, 30]]),
      },
    },
    {
      id: 'bike-mbx-path',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['all', ['==', ['get', 'class'], 'path'], ['==', ['get', 'type'], 'cycleway']],
      layout: round,
      paint: { 'line-color': COLORS.laneHi, 'line-opacity': 0.9, 'line-width': zoomWidth([[11, 1.2], [14, 3], [16, 4.5], [18, 6], [20, 10]]) },
    },
    {
      id: 'bike-mbx-lane',
      type: 'line',
      source: 'composite',
      'source-layer': 'road',
      filter: ['match', ['get', 'bike_lane'], ['left', 'right', 'both', 'yes'], true, false],
      layout: round,
      // Centreline only — Mapbox doesn't say which side. Kept thin and dim so
      // the per-side OSM lanes read as the real thing once their tile lands.
      paint: { 'line-color': COLORS.lane, 'line-opacity': 0.5, 'line-width': zoomWidth([[11, 0.8], [14, 1.6], [16, 2.2], [18, 3], [20, 5]]) },
    },
    {
      id: 'bike-osm-glow',
      type: 'line',
      source: 'bike-osm',
      filter: ['!=', ['get', 'kind'], 'shared'],
      layout: round,
      paint: {
        'line-color': bikeColor,
        'line-opacity': 0.26,
        'line-blur': 5,
        'line-offset': laneOffset,
        'line-width': zoomWidth([[11, 3], [14, 7], [16, 11], [18, 15], [20, 24]], kindScale),
      },
    },
    {
      id: 'bike-osm-line',
      type: 'line',
      source: 'bike-osm',
      filter: ['!=', ['get', 'kind'], 'shared'],
      layout: round,
      paint: { 'line-color': bikeColor, 'line-offset': laneOffset, 'line-width': bikeWidth },
    },
    {
      id: 'bike-osm-shared',
      type: 'line',
      source: 'bike-osm',
      filter: ['==', ['get', 'kind'], 'shared'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': COLORS.lane,
        'line-opacity': 0.8,
        'line-offset': laneOffset,
        'line-width': bikeWidth,
        'line-dasharray': [1.4, 1.2],
      },
    },
    {
      id: 'route-core',
      type: 'line',
      source: 'route',
      layout: round,
      paint: { 'line-color': '#3D9BFF', 'line-width': zoomWidth([[10, 2], [14, 2.6], [17, 3.4], [20, 7]]) },
    },
    {
      id: 'history-line',
      type: 'line',
      source: 'history',
      layout: round,
      paint: { 'line-color': COLORS.history, 'line-opacity': 0.88, 'line-width': zoomWidth([[10, 2], [14, 3], [17, 4.5], [20, 8]]) },
    },
    {
      id: 'bike-osm-arrows',
      type: 'symbol',
      source: 'bike-osm',
      minzoom: 14,
      filter: ['all', ['!=', ['get', 'dir'], 0], ['==', ['get', 'off'], 0]],
      layout: arrowLayout(),
    },
    {
      id: 'bike-osm-arrows-side',
      type: 'symbol',
      source: 'bike-osm',
      minzoom: 14,
      filter: ['all', ['!=', ['get', 'dir'], 0], ['!=', ['get', 'off'], 0]],
      layout: {
        ...arrowLayout(),
        // icon-offset rotates with icon-rotate, so a reversed arrow needs the
        // opposite perpendicular sign to stay over its own side of the road.
        'icon-offset': ['case', ['>', ['*', ['get', 'off'], ['get', 'dir']], 0], ['literal', [0, 6]], ['literal', [0, -6]]],
      },
    },
    {
      id: 'bike-osm-icons',
      type: 'symbol',
      source: 'bike-osm',
      minzoom: 14.5,
      filter: ['==', ['get', 'kind'], 'path'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 280,
        'icon-image': 'bike-glyph',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14.5, 0.55, 17, 0.8, 20, 1],
        'icon-rotation-alignment': 'viewport',
        'icon-pitch-alignment': 'viewport',
        'icon-padding': 24,
      },
    },
  ]

  for (const layer of layers) map.addLayer(layer, beforeId)
}

function arrowLayout() {
  return {
    'symbol-placement': 'line',
    'symbol-spacing': 90,
    'icon-image': 'bike-arrow',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 17, 0.72, 20, 1],
    'icon-rotate': ['case', ['<', ['get', 'dir'], 0], 180, 0],
    'icon-rotation-alignment': 'map',
    'icon-pitch-alignment': 'map',
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  }
}

export function setBikeLayersVisible(map, visible) {
  for (const id of BIKE_LAYERS) {
    safely(() => map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'))
  }
}

export const lineFeature = (coords) =>
  coords && coords.length > 1
    ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
    : EMPTY
