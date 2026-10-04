# Bike

A handlebar HUD for road riding on iPhone. A dark map that shows bike lanes in green and roads in quiet gray, a live puck, big glanceable numbers, ride recording, and cycling turn-by-turn directions.

The UI is a React + Mapbox GL JS web app (`web/`). It ships inside a thin native Swift shell (`ios/`) that handles what a web page can't: background GPS while a ride is recording, a true compass, barometric climb, keeping the screen awake, voice cues that duck your music, and the share sheet.

---

## Install on the phone (CI)

Every push to `main` runs `.github/workflows/build-ipa.yml` on a macOS runner. The repo is public, so those minutes are free. The workflow:

1. installs the web dependencies and runs `npm test` (ride maths, routing progress, lane matching)
2. builds the web bundle into `ios/Web/`
3. generates the Xcode project with XcodeGen and builds Release for `iphoneos` with signing off
4. packages `Bike.ipa` with `ios/Scripts/package.sh` and uploads it as an artifact

Download **Bike-N.ipa** from the run page (it comes down as the bare `.ipa`, not a zip) and open it in ESign. The archive is deliberately unsigned; ESign signs it on the way onto the device. The run number becomes the build number, so you can tell installs apart.

### Mapbox token (one time)

The map needs a public Mapbox token (`pk.…`). You can get one from [account.mapbox.com → Tokens](https://account.mapbox.com/access-tokens/). There are two ways to give it to the app:

- **Bake it in (recommended):** in the repo, go to Settings → Secrets and variables → Actions → New repository secret, name it `MAPBOX_TOKEN`, paste the token, and re-run the workflow. A public token ends up inside the IPA either way; the secret just keeps it out of git history.
- **Paste it on the phone:** without the secret, the app opens on a "Connect Mapbox" screen. Paste the token once and it's stored on the device. You can change it later under Menu → Settings → Mapbox token.

The free tier covers one rider's daily use with lots of room to spare: 50k map loads, 100k Directions requests, and Search Box sessions per month.

---

## Using it

| | |
|---|---|
| **Bottom HUD** | Speed (large), ride time and distance, and the camera button. When you're navigating, the middle switches to arrival time and distance left. |
| **Start Ride** | Starts recording. Tap the time/distance area to open the ride panel: average, max, climb, elapsed, moving, the clock, **Pause**, and **Hold to Finish**. The panel folds away on its own. |
| **Camera button** | Heading-up 3D follow → north-up follow → back again. If you pan the map, it pulses green, and one tap recenters. Pinching while following changes the zoom without breaking follow. |
| **Top pill** | GPS problems first, then **Bike Path / Protected Lane / Bike Lane / Shared Lane** when you're on one, then compass heading. |
| **Search** | Search places and addresses, or use Home/Work, favorites, and recents. **Long-press the map** to route to any point. |
| **Navigation** | Mapbox's cycling profile, which prefers bike infrastructure. You get a turn banner, voice cues, automatic rerouting after three off-route fixes, and arrival detection. Pressing Go also starts recording. |
| **Menu → Rides** | Weekly totals and ride history with route thumbnails. Each ride has stats, **Show on Map**, **Export GPX** (Strava, Komoot, …), and Hold to Delete. |
| **Menu → Settings** | Units, 3D tilt, speed-based zoom, bike lanes on/off, auto-pause, voice, keep screen on, map legend, refreshing lane data, and the token. |

Details that matter on a bike:

- **Auto-pause:** the clock stops below ~2 mph after 5 s and resumes above ~3.4 mph.
- **Background:** a recording ride keeps logging with the screen locked or another app open, and the blue location pill shows while it does. When you're not recording, GPS stops as soon as the app leaves the screen.
- **Crash-proof rides:** the ride in progress is saved every 10 s and whenever the app leaves the foreground. If iOS kills the app, the ride resumes on relaunch. A ride abandoned for more than 6 h is filed into history instead.
- **Accidental-tap safety:** finishing and deleting a ride are press-and-hold actions, so a pothole can't end your ride. All buttons are ≥ 56 pt for gloves.
- **Speed-adaptive zoom:** the map shows more road ahead the faster you go.
- **Lane colours:** bright green = off-street path or protected track, emerald = painted lane, dashed = sharrows. Painted lanes sit on their own side of the road. White chevrons show flow direction on one-way facilities, and a white bike badge marks dedicated paths.

---

## Develop in a browser

```sh
cd web
cp .env.example .env        # put the pk.* token in it, or paste it in the app
npm install
npm run dev                 # http://localhost:5173 (also on your LAN via --host)
```

| URL flag | Effect |
|---|---|
| `?sim` | Simulated ride from downtown Portland: varying pace, a stop every 100 s for auto-pause |
| `?sim=45.52,-122.68` | Same, starting at that lat,lon |
| `?nomap` | Dev builds only: the HUD over a blank background, with no token needed |

`npm test` runs `web/scripts/selftest.mjs` against the recorder, navigation and lane libraries. `npm run build:ios` writes the production bundle to `ios/Web/`.

When the app runs on the phone, Safari's Web Inspector attaches to it: **Develop → *iPhone* → Bike**.

## Build on a Mac (instead of CI)

Requirements: Xcode 16+, Node 22, `brew install xcodegen`.

```sh
cd web && npm ci && npm run build:ios && cd ..
cd ios && xcodegen generate && open Bike.xcodeproj
```

Set a signing team on the `Bike` target and run on a device. For a sideloadable IPA, use the same `xcodebuild` flags as the workflow, then run `./Scripts/package.sh`. The web build has to come first, because XcodeGen rejects the missing `Web/` folder.

---

## How it fits together

```
web/                        React 19 · Vite · Tailwind 4 · Mapbox GL JS 3
├── src/App.jsx             GPS stream → recorder → lane match → nav engine → UI
├── src/components/
│   ├── Map.jsx             map lifecycle, camera follow loop, overlay data
│   ├── GlassHUD.jsx        bottom pill + ride panel
│   ├── StatusPill.jsx      top pill and the turn banner
│   └── …Sheet.jsx          search, menu (rides/settings), ride summary
├── src/lib/
│   ├── location.js         one fix stream: native, browser or simulated
│   ├── ride.js             recorder state machine, GPX export
│   ├── bikeInfra.js        OSM bike lanes via Overpass, tile cache, nearest-lane
│   ├── navigation.js       Search Box, Directions (cycling), route progress
│   ├── mapStyle.js         dark-v11 restyle + lane/route/trail layers
│   └── native.js           bridge to the iOS shell
└── scripts/selftest.mjs

ios/                        Swift 6, strict concurrency, iOS 17+
├── project.yml             XcodeGen source of truth
├── Sources/App/            SwiftUI entry
├── Sources/Web/            WKWebView host + bike:// scheme handler
├── Sources/Native/         bridge, CoreLocation/CoreMotion, speech
└── Scripts/package.sh      .app → unsigned .ipa, with stale-build checks
```

**Why a web app in a native shell.** The map and HUD are Mapbox GL JS, the stack this was specified in, and you can iterate on it in a browser with live reload. The shell is under 800 lines of Swift, covering only the parts that need native code. A bare web page on iOS loses GPS the moment the screen locks, has no true heading without a permission dance, and can't keep the screen on reliably.

**Why `bike://app/` and not `file://`.** WebKit refuses module scripts from `file://`, and file pages get an opaque origin, so IndexedDB (your ride history) wouldn't persist. A custom scheme handler gives the page a stable origin.

**Bike lane data.** Mapbox Streets has dedicated cycleways but not painted lanes or lane direction. OpenStreetMap has both, so lanes come from Overpass in ~3 km tiles. They're cached in IndexedDB for two weeks, so a familiar commute doesn't hit the network. Overpass rejects browser requests whose origin isn't `http(s)`, so on the phone those requests go through native `URLSession` with a `User-Agent` that names the app, as Overpass's usage policy asks. Lane directions assume right-hand traffic.

**Camera.** Position arrives at ~1 Hz, and a frame loop interpolates between fixes at ~30 fps. Follow-mode padding keeps the puck in the lower third so most of the screen shows the road ahead. Heading comes from GPS course once you're rolling and from the compass when you're stopped.

**Lane detection.** Each fix is matched against nearby OSM segments within a radius that scales with GPS accuracy. Two agreeing fixes are needed to enter a lane and three to leave, so the pill doesn't flicker as GPS wanders. Where both sides of a road have lanes, the side whose flow matches your direction wins.

Map data © Mapbox © OpenStreetMap contributors.
