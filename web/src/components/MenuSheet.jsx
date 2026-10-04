import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, KeyRound, Map as MapIcon, Share, Trash } from 'lucide-react'
import { HoldButton, RouteThumb, Segmented, Sheet, Toggle } from './ui'
import { RideHero, RideStatGrid } from './RideStats'
import { STORES, dbAll } from '../lib/storage'
import { distanceParts, formatDuration, formatRideDate, speedValue } from '../lib/units'
import { haptic, isNative } from '../lib/native'

export default function MenuSheet({
  open,
  onClose,
  tab,
  setTab,
  settings,
  updateSettings,
  ridesVersion,
  onShowRide,
  onShareRide,
  onDeleteRide,
  tokenInfo,
  onChangeToken,
  onClearLaneCache,
}) {
  const [selected, setSelected] = useState(null)
  useEffect(() => {
    if (!open) setSelected(null)
  }, [open])

  const title = selected ? selected.name : 'Bike'
  return (
    <Sheet open={open} onClose={onClose} title={title} tall>
      {selected ? (
        <RideDetail
          summary={selected}
          units={settings.units}
          onBack={() => setSelected(null)}
          onShow={() => onShowRide(selected)}
          onShare={() => onShareRide(selected)}
          onDelete={async () => {
            await onDeleteRide(selected.id)
            setSelected(null)
          }}
        />
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'rides', label: 'Rides' },
              { value: 'settings', label: 'Settings' },
            ]}
          />
          {tab === 'rides' ? (
            <RidesList units={settings.units} version={ridesVersion} onSelect={setSelected} />
          ) : (
            <SettingsPanel
              settings={settings}
              update={updateSettings}
              tokenInfo={tokenInfo}
              onChangeToken={onChangeToken}
              onClearLaneCache={onClearLaneCache}
            />
          )}
        </>
      )}
    </Sheet>
  )
}

function startOfWeek(now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

function RidesList({ units, version, onSelect }) {
  const [rides, setRides] = useState(null)
  useEffect(() => {
    let alive = true
    dbAll(STORES.rides).then((all) => alive && setRides(all.sort((a, b) => b.startedAt - a.startedAt)))
    return () => {
      alive = false
    }
  }, [version])

  const totals = useMemo(() => {
    if (!rides) return null
    const weekStart = startOfWeek()
    const week = rides.filter((r) => r.startedAt >= weekStart)
    const sum = (list, key) => list.reduce((acc, r) => acc + (r[key] || 0), 0)
    return {
      weekDistance: sum(week, 'distance'),
      weekTime: sum(week, 'movingTime'),
      weekCount: week.length,
      allDistance: sum(rides, 'distance'),
      allCount: rides.length,
    }
  }, [rides])

  if (!rides) return <div className="h-40" />

  const week = distanceParts(totals.weekDistance, units)
  const all = distanceParts(totals.allDistance, units)

  return (
    <div className="pb-6">
      <div className="glass-well mt-4 rounded-3xl p-4">
        <div className="text-[13px] font-semibold tracking-[0.12em] text-white/45 uppercase">This Week</div>
        <div className="metric mt-1 flex items-baseline gap-2">
          <span className="text-[44px] leading-none font-bold tracking-tight">{week.value}</span>
          <span className="text-[17px] font-semibold text-white/50">{week.unit}</span>
        </div>
        <div className="mt-2 flex gap-4 text-[14px] text-white/55">
          <span>
            {totals.weekCount} ride{totals.weekCount === 1 ? '' : 's'}
          </span>
          <span>{formatDuration(totals.weekTime)} moving</span>
          <span className="ml-auto">
            {all.value} {all.unit} all time
          </span>
        </div>
      </div>

      {rides.length === 0 ? (
        <p className="mt-10 text-center text-[15px] text-white/45">No rides yet. Tap Start Ride on the HUD.</p>
      ) : (
        <ul className="mt-3">
          {rides.map((r) => {
            const d = distanceParts(r.distance, units)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    haptic('light')
                    onSelect(r)
                  }}
                  className="press flex min-h-[72px] w-full items-center gap-3 rounded-2xl px-1 text-left"
                >
                  <RouteThumb coords={r.preview} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{r.name}</span>
                    <span className="block truncate text-[13px] text-white/45">{formatRideDate(r.startedAt)}</span>
                  </span>
                  <span className="metric shrink-0 text-right">
                    <span className="block text-[17px] font-semibold">
                      {d.value} <span className="text-[13px] text-white/45">{d.unit}</span>
                    </span>
                    <span className="block text-[13px] text-white/45">
                      {formatDuration(r.movingTime)} · {speedValue(r.avgSpeed, units).toFixed(1)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/25" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function RideDetail({ summary, units, onBack, onShow, onShare, onDelete }) {
  return (
    <div className="pb-6">
      <button type="button" onClick={onBack} className="-ml-1 flex h-11 items-center gap-1 text-[16px] font-medium text-route">
        <ChevronLeft className="h-5 w-5" /> Rides
      </button>
      <RideHero summary={summary} units={units} />
      <RideStatGrid summary={summary} units={units} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onShow}
          className="glass-well press flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold"
        >
          <MapIcon className="h-5 w-5" /> Show on Map
        </button>
        <button
          type="button"
          onClick={onShare}
          className="glass-well press flex h-14 items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold"
        >
          <Share className="h-5 w-5" /> Export GPX
        </button>
      </div>
      <HoldButton onConfirm={onDelete} className="mt-2 w-full">
        <Trash className="h-4 w-4" /> Hold to Delete
      </HoldButton>
    </div>
  )
}

function SettingsPanel({ settings, update, tokenInfo, onChangeToken, onClearLaneCache }) {
  const [cleared, setCleared] = useState(false)
  return (
    <div className="pb-8">
      <Group title="Units">
        <Segmented
          value={settings.units}
          onChange={(units) => update({ units })}
          options={[
            { value: 'imperial', label: 'mph · mi' },
            { value: 'metric', label: 'km/h · km' },
          ]}
        />
      </Group>

      <Group title="Map">
        <Row label="3D tilt when following" hint="Heading-up view pitched toward the road ahead">
          <Toggle checked={settings.tilt} onChange={(tilt) => update({ tilt })} label="3D tilt" />
        </Row>
        <Row label="Zoom out with speed" hint="See further ahead when you're moving fast">
          <Toggle checked={settings.autoZoom} onChange={(autoZoom) => update({ autoZoom })} label="Auto zoom" />
        </Row>
        <Row label="Bike lanes" hint="Paths, protected and painted lanes from OpenStreetMap">
          <Toggle checked={settings.showInfra} onChange={(showInfra) => update({ showInfra })} label="Bike lanes" />
        </Row>
      </Group>

      <Group title="Ride">
        <Row label="Auto-pause" hint="Clock stops when you do">
          <Toggle checked={settings.autoPause} onChange={(autoPause) => update({ autoPause })} label="Auto-pause" />
        </Row>
        <Row label="Voice directions" hint="Turn cues duck your music while speaking">
          <Toggle checked={settings.voice} onChange={(voice) => update({ voice })} label="Voice" />
        </Row>
        <Row label="Keep screen on" hint="Display never sleeps while the app is open">
          <Toggle checked={settings.keepAwake} onChange={(keepAwake) => update({ keepAwake })} label="Keep screen on" />
        </Row>
      </Group>

      <Group title="Legend">
        <Legend />
      </Group>

      <Group title="Data">
        <button
          type="button"
          onClick={async () => {
            await onClearLaneCache()
            setCleared(true)
          }}
          className="glass-well press flex h-14 w-full items-center justify-center rounded-2xl text-[16px] font-semibold"
        >
          {cleared ? 'Lane cache cleared' : 'Refresh bike lane data'}
        </button>
        <button
          type="button"
          onClick={onChangeToken}
          className="glass-well press mt-2 flex h-14 w-full items-center gap-3 rounded-2xl px-4 text-left"
        >
          <KeyRound className="h-5 w-5 shrink-0 text-white/60" />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Mapbox token</span>
            <span className="block truncate font-mono text-[12px] text-white/40">
              {tokenInfo.masked} {tokenInfo.fromEnv ? '· built in' : '· on this device'}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-white/30" />
        </button>
      </Group>

      <p className="mt-8 text-center text-[12px] text-white/30">
        Bike {__APP_VERSION__} · {isNative ? 'iOS' : 'Web'} · Map © Mapbox © OpenStreetMap
      </p>
    </div>
  )
}

function Group({ title, children }) {
  return (
    <div className="mt-6">
      <h3 className="mb-2 px-1 text-[13px] font-semibold tracking-[0.12em] text-white/40 uppercase">{title}</h3>
      {children}
    </div>
  )
}

function Row({ label, hint, children }) {
  return (
    <div className="flex min-h-[64px] items-center gap-3 border-b border-white/6 px-1 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-[16px] font-semibold">{label}</div>
        {hint && <div className="text-[13px] text-white/45">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Legend() {
  const items = [
    { label: 'Bike path / protected', swatch: <Line color="#00F076" /> },
    { label: 'Painted bike lane', swatch: <Line color="#10B981" /> },
    { label: 'Shared lane (sharrows)', swatch: <Line color="#10B981" dashed /> },
    { label: 'Your route', swatch: <Line color="#0A84FF" /> },
    { label: 'This ride', swatch: <Line color="#CBD5E1" faint /> },
    { label: 'Roads', swatch: <Line color="#4B5563" thin /> },
  ]
  return (
    <div className="glass-well grid grid-cols-1 gap-2.5 rounded-2xl p-4">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-[15px] text-white/75">
          {i.swatch}
          {i.label}
        </div>
      ))}
      <div className="flex items-center gap-3 text-[15px] text-white/75">
        <span className="flex w-10 justify-center text-[18px] leading-none font-bold">›</span>
        One-way lane direction
      </div>
    </div>
  )
}

function Line({ color, dashed, faint, thin }) {
  return (
    <svg width="40" height="10" aria-hidden="true">
      <line
        x1="3"
        y1="5"
        x2="37"
        y2="5"
        stroke={color}
        strokeWidth={thin ? 2 : 5}
        strokeLinecap={dashed ? 'butt' : 'round'}
        strokeDasharray={dashed ? '6 5' : undefined}
        opacity={faint ? 0.5 : 1}
      />
    </svg>
  )
}
