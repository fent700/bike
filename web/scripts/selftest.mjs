import { createServer } from 'vite'
const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
const geo = await server.ssrLoadModule('/src/lib/geo.js')
const { RideRecorder, toGpx } = await server.ssrLoadModule('/src/lib/ride.js')
const { NavSession, normalizeRoute } = await server.ssrLoadModule('/src/lib/navigation.js')
const { BikeInfra } = await server.ssrLoadModule('/src/lib/bikeInfra.js')
const units = await server.ssrLoadModule('/src/lib/units.js')
let failures = 0
const ok = (cond, msg) => {
  if (!cond) failures++
  console.log(cond ? '  ok  ' : '  FAIL', msg)
}

console.log('RideRecorder')
const rec = new RideRecorder()
rec.start(0)
let pos = [-122.68, 45.52]
let t = 1_000_000
const fixes = []
for (let i = 0; i < 120; i++) {
  pos = geo.destination(pos, 90, 5)
  t += 1000
  fixes.push({ lat: pos[1], lon: pos[0], acc: 5, alt: 40 + i * 0.1, vacc: 4, speed: 5, speedAcc: 0.3, course: 90, t, rel: null })
}
for (let i = 0; i < 20; i++) {
  t += 1000
  fixes.push({ lat: pos[1] + (Math.random() - 0.5) * 2e-5, lon: pos[0], acc: 6, alt: 52, vacc: 4, speed: 0.1, speedAcc: 0.3, course: null, t, rel: null })
}
rec.ingest(fixes)
const snap = rec.snapshot
ok(Math.abs(snap.distance - 600) < 15, `distance ${snap.distance.toFixed(1)} ≈ 600 m`)
ok(snap.autoPaused, `auto-paused after stop (${snap.autoPaused})`)
ok(snap.movingTime > 118 && snap.movingTime < 128, `moving time ${snap.movingTime.toFixed(1)} s`)
ok(Math.abs(snap.maxSpeed - 5) < 0.01, `max speed ${snap.maxSpeed}`)
ok(snap.elevGain >= 6 && snap.elevGain <= 12, `elev gain ${snap.elevGain.toFixed(1)} m for a 12 m ramp`)
rec.ingest(fixes)
ok(Math.abs(rec.snapshot.distance - snap.distance) < 1e-9, 'replayed batch ignored')
const { summary, track } = rec.finish()
ok(summary.avgSpeed > 4.6 && summary.avgSpeed < 5.1, `avg ${summary.avgSpeed.toFixed(2)} m/s`)
const gpx = toGpx(summary, track)
ok(gpx.split('<trkpt').length - 1 === track.length, `gpx has ${track.length} points`)

console.log('NavSession')
const a = [-122.68, 45.52]
const b = geo.destination(a, 90, 500)
const c = geo.destination(b, 0, 500)
const line = []
for (let i = 0; i <= 50; i++) line.push(geo.destination(a, 90, i * 10))
for (let i = 1; i <= 50; i++) line.push(geo.destination(b, 0, i * 10))
const route = normalizeRoute({
  distance: 1000,
  duration: 240,
  geometry: { type: 'LineString', coordinates: line },
  legs: [
    {
      steps: [
        {
          distance: 500,
          name: 'East St',
          maneuver: { type: 'depart', location: a, instruction: 'Head east' },
          voiceInstructions: [
            { distanceAlongGeometry: 500, announcement: 'Head east, then turn left' },
            { distanceAlongGeometry: 100, announcement: 'In 300 feet, turn left' },
          ],
        },
        {
          distance: 500,
          name: 'North Ave',
          maneuver: { type: 'turn', modifier: 'left', location: b, instruction: 'Turn left' },
          voiceInstructions: [{ distanceAlongGeometry: 80, announcement: 'You have arrived' }],
        },
        { distance: 0, name: 'North Ave', maneuver: { type: 'arrive', location: c, instruction: 'Arrive' }, voiceInstructions: [] },
      ],
    },
  ],
})
ok(Math.abs(route.steps[1].startAlong - 500) < 2, `turn located at ${route.steps[1].startAlong.toFixed(1)} m`)
const nav = new NavSession(route, { name: 'Dest', coord: c })
const said = []
let last
const step = (p) => {
  last = nav.update({ lon: p[0], lat: p[1], acc: 5 })
  if (last.announcement) said.push(last.announcement)
  return last
}
for (let d = 0; d <= 480; d += 10) step(geo.destination(a, 90, d))
ok(said.length === 2, `cues before turn: ${JSON.stringify(said)}`)
ok(last.upcoming.modifier === 'left' && last.toManeuver < 30, `upcoming left in ${last.toManeuver.toFixed(0)} m`)
for (let d = 10; d <= 300; d += 10) step(geo.destination(b, 0, d))
ok(last.current === 1 && !last.offRoute, `on step 1, remaining ${last.remaining.toFixed(0)} m`)
const offPoint = geo.destination(geo.destination(b, 0, 300), 90, 80)
step(offPoint)
step(offPoint)
ok(step(offPoint).offRoute, 'off route after 3 fixes 80 m off')
const n2 = new NavSession(route, { name: 'Dest', coord: c })
let arrived = false
for (let d = 0; d <= 1000; d += 20) {
  const p = d <= 500 ? geo.destination(a, 90, d) : geo.destination(b, 0, d - 500)
  arrived = n2.update({ lon: p[0], lat: p[1], acc: 5 }).arrived || arrived
}
ok(arrived, 'arrival detected')

console.log('BikeInfra')
const infra = new BikeInfra()
const roadStart = [-122.68, 45.52]
const toLL = ([lon, lat]) => ({ lon, lat })
const roadGeom = [0, 1, 2, 3].map((i) => toLL(geo.destination(roadStart, 90, i * 100)))
const pathGeom = [0, 1, 2].map((i) => toLL(geo.destination(geo.destination(roadStart, 0, 300), 90, i * 100)))
infra.install(infra.tileKeyAt(...roadStart), [
  { id: 1, tags: { highway: 'secondary', 'cycleway:both': 'lane', name: 'Lane St' }, geometry: roadGeom },
  { id: 2, tags: { highway: 'cycleway', oneway: 'yes' }, geometry: pathGeom },
  { id: 3, tags: { highway: 'residential', oneway: 'yes', cycleway: 'opposite_lane' }, geometry: roadGeom.map((g) => ({ lon: g.lon, lat: g.lat + 0.01 })) },
])
const fc = infra.geojson()
const lanes = fc.features.filter((f) => f.properties.name === 'Lane St')
ok(fc.features.length === 4, `features: ${fc.features.length}`)
ok(
  lanes.some((f) => f.properties.off === 1 && f.properties.dir === 1) && lanes.some((f) => f.properties.off === -1 && f.properties.dir === -1),
  'both-side lanes: right flows forward, left flows back',
)
const contra = fc.features.find((f) => f.properties.name === '' && f.properties.kind === 'lane')
ok(contra?.properties.dir === -1, `opposite_lane runs against the oneway (dir ${contra?.properties.dir})`)
const onRoad = geo.destination(geo.destination(roadStart, 90, 150), 180, 3)
ok(infra.nearest(onRoad[0], onRoad[1], 90, 12)?.kind === 'lane', 'rider 3 m off lane road → lane')
const onPath = geo.destination(geo.destination(roadStart, 0, 300), 90, 60)
ok(infra.nearest(onPath[0], onPath[1], 90, 12)?.kind === 'path', 'rider on cycleway → path')
const away = geo.destination(roadStart, 0, 150)
ok(infra.nearest(away[0], away[1], 90, 12) === null, '150 m away → none')

console.log('Units')
ok(units.formatNavDistance(91.44, 'imperial') === '300 ft', `300 ft → ${units.formatNavDistance(91.44, 'imperial')}`)
ok(units.formatNavDistance(1609.344 * 0.34, 'imperial') === '0.3 mi', `0.34 mi → ${units.formatNavDistance(1609.344 * 0.34, 'imperial')}`)
ok(units.formatDuration(3725) === '1:02:05', `3725 s → ${units.formatDuration(3725)}`)
ok(JSON.stringify(units.speedParts(8.94, 'imperial')) === '{"whole":"20","tenth":"0"}', `8.94 m/s → ${JSON.stringify(units.speedParts(8.94, 'imperial'))}`)
ok(!/[AP]M/i.test(units.formatClockShort(new Date(2026, 0, 1, 17, 42))), `clock → ${units.formatClockShort(new Date(2026, 0, 1, 17, 42))}`)

await server.close()
console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
