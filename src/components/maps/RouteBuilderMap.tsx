import { useEffect, useMemo, useRef, useState } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary, MapControl, ControlPosition } from '@vis.gl/react-google-maps'
import type { RouteStop, RouteGeometry } from '@/api/transport'
import { Checkbox } from '@/components/ui'
import { decodePolyline } from '@/lib/decodePolyline'
import { useInterpolatedPosition } from '@/lib/useInterpolatedPosition'
import { tripIsLive } from '@/lib/busTrip'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }
const DEFAULT_ZOOM = 12

type LatLng = { lat: number; lng: number }

function placedStops(stops: RouteStop[]): RouteStop[] {
  return stops.filter((s) => s.lat != null && s.lng != null && (s.lat !== 0 || s.lng !== 0))
}

function FitStops({ stops }: { stops: LatLng[] }) {
  const map = useMap()
  const key = stops.map((s) => `${s.lat},${s.lng}`).join('|')
  useEffect(() => {
    if (!map || stops.length === 0) return
    if (stops.length === 1) {
      map.setCenter(stops[0])
      map.setZoom(15)
      return
    }
    const lats = stops.map((s) => s.lat)
    const lngs = stops.map((s) => s.lng)
    map.fitBounds({
      north: Math.max(...lats),
      south: Math.min(...lats),
      east: Math.max(...lngs),
      west: Math.min(...lngs),
    }, 48)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

function StopSearchBox({ onPlace }: { onPlace: (lat: number, lng: number) => void }) {
  const map = useMap()
  const placesLib = useMapsLibrary('places')
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!placesLib || !map || !inputRef.current) return
    const autocomplete = new placesLib.Autocomplete(inputRef.current, { fields: ['geometry', 'name'] })
    autocomplete.bindTo('bounds', map)
    const listener = autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      const loc = place.geometry?.location
      if (!loc) return
      map.panTo({ lat: loc.lat(), lng: loc.lng() })
      map.setZoom(16)
      onPlace(loc.lat(), loc.lng())
      setValue(place.name ?? '')
    })
    return () => listener.remove()
  }, [placesLib, map, onPlace])

  if (!placesLib) return null

  return (
    <MapControl position={ControlPosition.TOP_LEFT}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search for a place to place the stop…"
        style={{
          margin: 10, width: 280, padding: '8px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--surface, #fff)',
          fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      />
    </MapControl>
  )
}

function RoutePolyline({ path, strokeColor = '#2563eb' }: { path: LatLng[]; strokeColor?: string }) {
  const map = useMap()
  const pathKey = path.map((p) => `${p.lat},${p.lng}`).join('|')
  useEffect(() => {
    if (!map || path.length < 2 || typeof google === 'undefined') return
    const line = new google.maps.Polyline({
      path,
      strokeColor,
      strokeOpacity: 0.85,
      strokeWeight: 4,
      geodesic: true,
      map,
    })
    return () => line.setMap(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pathKey, strokeColor])
  return null
}

/** Renders the decoded road-following route geometry (from the Routes API) as a polyline.
 *  Draws nothing when geometry is undefined or its status is 'unavailable' — no silent
 *  fallback to the straight-line RoutePolyline above. */
function RoadRoutePolyline({ geometry, strokeColor = '#2563eb' }: { geometry: RouteGeometry | undefined; strokeColor?: string }) {
  const map = useMap()
  const encoded = geometry?.status === 'available' ? geometry.geometry : null
  useEffect(() => {
    if (!map || !encoded || typeof google === 'undefined') return
    const path = decodePolyline(encoded)
    if (path.length < 2) return
    const line = new google.maps.Polyline({ path, strokeColor, strokeOpacity: 0.85, strokeWeight: 4, geodesic: false, map })
    return () => line.setMap(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, encoded, strokeColor])
  return null
}

function RouteUnavailableBadge() {
  return (
    <div
      className="t-xs muted3"
      style={{ position: 'absolute', top: 10, right: 12, background: 'var(--surface)', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)' }}
    >
      Route unavailable
    </div>
  )
}

function StopPin({
  sequence, name, selected, onClick,
}: {
  sequence: number
  name: string
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <div
      style={{ transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 6, position: 'relative', cursor: onClick ? 'pointer' : undefined }}
      onClick={onClick}
    >
      <span
        style={{
          width: 28, height: 28, borderRadius: 999, flex: '0 0 auto',
          background: selected ? 'var(--brand-600, #2563eb)' : '#0f766e',
          color: '#fff', fontSize: 12, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #fff', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}
      >
        {sequence}
      </span>
      <span
        style={{
          background: 'var(--surface, #fff)', padding: '2px 8px', borderRadius: 6,
          border: '1px solid var(--border)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}
      >
        {name}
      </span>
    </div>
  )
}

/** Bus icon + label, rotated to the vehicle's GPS heading when available (points up/0deg otherwise). */
function BusMarker({
  busId, label, heading, color, onClick,
}: {
  busId: string
  label: string
  heading?: number | null
  color: string
  onClick?: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: onClick ? 'pointer' : undefined }} onClick={onClick}>
      <div style={{ position: 'relative', width: 26, height: 26 }}>
        <svg
          data-testid={`bus-icon-${busId}`}
          width={26} height={26} viewBox="0 0 24 24" fill="#FFC107"
          style={{ transform: `rotate(${heading ?? 0}deg)`, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))' }}
        >
          {/* School-bus body, viewed from above — front (windshield stripe) points toward heading 0deg (up). */}
          <rect x={5} y={2} width={14} height={20} rx={4} stroke="#1f2937" strokeWidth={1} />
          <rect x={7} y={4.5} width={10} height={2.5} rx={0.5} fill="#1f2937" />
          <rect x={7} y={8.5} width={10} height={9} rx={1} fill="#fff9db" stroke="#1f2937" strokeWidth={0.6} />
          <line x1={12} y1={8.5} x2={12} y2={17.5} stroke="#1f2937" strokeWidth={0.6} />
          <rect x={3.5} y={6} width={1.6} height={3} rx={0.6} fill="#1f2937" />
          <rect x={18.9} y={6} width={1.6} height={3} rx={0.6} fill="#1f2937" />
          <rect x={3.5} y={15} width={1.6} height={3} rx={0.6} fill="#1f2937" />
          <rect x={18.9} y={15} width={1.6} height={3} rx={0.6} fill="#1f2937" />
        </svg>
        <span
          data-testid={`bus-status-dot-${busId}`}
          style={{
            position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 999,
            background: color, border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        />
      </div>
      <span style={{
        background: color, color: '#fff', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
      }}>
        {label}
      </span>
    </div>
  )
}

/** Wraps a fleet bus marker with position interpolation — smooths movement between GPS pings
 *  instead of the marker jump-cutting to each new ping. */
function LiveBusMarker({
  busId, lat, lng, heading, color, label, onClick,
}: {
  busId: string
  lat: number
  lng: number
  heading?: number | null
  color: string
  label: string
  onClick?: () => void
}) {
  const position = useInterpolatedPosition(lat, lng)
  if (!position) return null
  return (
    <AdvancedMarker position={position}>
      <BusMarker busId={busId} label={label} heading={heading} color={color} onClick={onClick} />
    </AdvancedMarker>
  )
}

export type RouteBuilderMapProps = {
  stops: RouteStop[]
  height?: number
  selectedStopId?: string | null
  onMapClick?: (lat: number, lng: number) => void
  onStopClick?: (stopId: string) => void
  geometry?: RouteGeometry
}

/**
 * Interactive route editor map: click to add stops (via parent), polyline through placed stops,
 * numbered markers. Parent handles persistence.
 */
export function RouteBuilderMap({
  stops, height = 420, selectedStopId, onMapClick, onStopClick, geometry,
}: RouteBuilderMapProps) {
  const placed = useMemo(() => placedStops(stops), [stops])
  const path = useMemo(
    () => placed.sort((a, b) => a.sequence - b.sequence).map((s) => ({ lat: s.lat as number, lng: s.lng as number })),
    [placed],
  )
  const initialCenter = path[0] ?? DEFAULT_CENTER
  const initialZoom = path.length > 0 ? 14 : DEFAULT_ZOOM

  if (!API_KEY) {
    return (
      <div
        className="col ai-center jc-center"
        style={{ height, borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--surface-2)', padding: 24, textAlign: 'center' }}
      >
        <div className="fw6">Map not configured</div>
        <div className="t-sm muted">Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to enable the route builder.</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          defaultCenter={initialCenter}
          defaultZoom={initialZoom}
          gestureHandling="greedy"
          disableDefaultUI={false}
          clickableIcons={false}
          style={{ width: '100%', height: '100%' }}
          onClick={(e) => {
            if (!onMapClick || !e.detail.latLng) return
            onMapClick(e.detail.latLng.lat, e.detail.latLng.lng)
          }}
        >
          {geometry?.status === 'available' && <RoadRoutePolyline geometry={geometry} />}
          {placed.map((s) => (
            <AdvancedMarker
              key={s.id}
              position={{ lat: s.lat as number, lng: s.lng as number }}
              onClick={() => onStopClick?.(s.id)}
            >
              <StopPin sequence={s.sequence} name={s.name} selected={s.id === selectedStopId} />
            </AdvancedMarker>
          ))}
          <FitStops stops={path} />
          {onMapClick && <StopSearchBox onPlace={onMapClick} />}
        </Map>
      </APIProvider>
      {onMapClick && (
        <div className="t-xs muted3" style={{ position: 'absolute', bottom: 10, left: 12, background: 'var(--surface)', padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)' }}>
          Click map to add a stop
        </div>
      )}
      {geometry?.status === 'unavailable' && <RouteUnavailableBadge />}
    </div>
  )
}

export type MapStop = { id: string; name: string; sequence: number; lat: number; lng: number }

/** Fleet map with optional route polyline + stop markers. */
export function TransportRouteMap({
  stops, buses, height = 360,
}: {
  stops?: MapStop[]
  buses?: { id: string; busNo: string; lat: number; lng: number; speedKmh?: number | null; moving?: boolean }[]
  height?: number
}) {
  const path = useMemo(
    () => (stops ?? []).sort((a, b) => a.sequence - b.sequence).map((s) => ({ lat: s.lat, lng: s.lng })),
    [stops],
  )

  if (!API_KEY) {
    return (
      <div className="col ai-center jc-center" style={{ height, borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--surface-2)' }}>
        <div className="t-sm muted">Map not configured</div>
      </div>
    )
  }

  const busPoints = buses ?? []
  const initialCenter = busPoints[0] ? { lat: busPoints[0].lat, lng: busPoints[0].lng } : path[0] ?? DEFAULT_CENTER

  return (
    <div style={{ position: 'relative', height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          defaultCenter={initialCenter}
          defaultZoom={13}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          {path.length >= 2 && <RoutePolyline path={path} />}
          {(stops ?? []).map((s) => (
            <AdvancedMarker key={s.id} position={{ lat: s.lat, lng: s.lng }}>
              <StopPin sequence={s.sequence} name={s.name} />
            </AdvancedMarker>
          ))}
          {busPoints.map((b) => (
            <AdvancedMarker key={b.id} position={{ lat: b.lat, lng: b.lng }}>
              <span style={{ background: '#16a34a', color: '#fff', padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
                {b.busNo}{b.moving && b.speedKmh != null ? ` · ${Math.round(b.speedKmh)}` : ''}
              </span>
            </AdvancedMarker>
          ))}
          <FitStops stops={path.length > 0 ? path : busPoints.map((b) => ({ lat: b.lat, lng: b.lng }))} />
        </Map>
      </APIProvider>
    </div>
  )
}

// 12 visually distinct colors. Assigned by each route's position among the currently *visible*
// routes (not a hash of its id) — guarantees no two simultaneously-shown routes share a color,
// as long as 12 or fewer are visible at once (comfortably more than any real fleet selection).
const ROUTE_COLORS = [
  '#2563eb', '#0d9488', '#c026d3', '#ea580c', '#65a30d', '#db2777',
  '#0891b2', '#7c3aed', '#ca8a04', '#dc2626', '#059669', '#4338ca',
]

/** Live fleet map with route polylines per assigned route and bus markers.
 *  With no bus selected, shows every bus's current location only (no routes) —
 *  select one or more buses to also draw their route line(s). */
export function FleetLiveMap({
  fleet,
  routeStopsByRouteId,
  height = 360,
  highlightStop,
  routeGeometryByRouteId = {},
  onStopClick,
  onBusClick,
  selectedBusIds: selectedBusIdsProp,
  onSelectedBusIdsChange,
}: {
  fleet: { busId: string; busNo: string; routeId?: string | null; routeName?: string | null; driver?: string | null; lat?: number | null; lng?: number | null; speedKmh?: number | null; heading?: number | null; status?: string }[]
  routeStopsByRouteId: Record<string, RouteStop[]>
  height?: number
  /** Optional ★ child/student stop overlay (from API assignment — not local SoT). */
  highlightStop?: { name: string; lat: number; lng: number } | null
  /** Road-following geometry per route, keyed by routeId. Additive — falls back to no line
   *  (not a straight-line placeholder) when a selected route's geometry isn't available yet. */
  routeGeometryByRouteId?: Record<string, RouteGeometry>
  /** Called with a stop's id when its marker is clicked — parent decides what to reveal (e.g. a student list modal). */
  onStopClick?: (stopId: string) => void
  /** Called with a bus's id when its marker is clicked — parent decides what to reveal (e.g. a bus info panel). */
  onBusClick?: (busId: string) => void
  selectedBusIds?: string[]
  onSelectedBusIdsChange?: (ids: string[]) => void
}) {
  const [uncontrolledIds, setUncontrolledIds] = useState<string[]>([])
  const selectedBusIds = selectedBusIdsProp ?? uncontrolledIds
  const setSelectedBusIds = onSelectedBusIdsChange ?? setUncontrolledIds
  const toggleBus = (id: string) => setSelectedBusIds(
    selectedBusIds.includes(id) ? selectedBusIds.filter((x) => x !== id) : [...selectedBusIds, id],
  )

  const [routeFilter, setRouteFilter] = useState('')
  // Distinguishes "the filter is untouched" (still hide routes by default, to avoid
  // clutter on a large fleet) from "the user explicitly picked All routes" (show them).
  const [routeFilterTouched, setRouteFilterTouched] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const routeOptions: [string, string][] = []
  const seenRouteIds = new Set<string>()
  for (const b of fleet) {
    if (!b.routeId || seenRouteIds.has(b.routeId)) continue
    seenRouteIds.add(b.routeId)
    routeOptions.push([b.routeId, b.routeName ?? b.routeId])
  }
  const statusOptions = Array.from(new Set(fleet.map((b) => b.status).filter((s): s is string => !!s)))

  const filteredFleet = fleet.filter((b) => {
    if (routeFilter && b.routeId !== routeFilter) return false
    if (statusFilter && b.status !== statusFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const haystack = `${b.busNo} ${b.routeName ?? ''} ${b.driver ?? ''}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!pickerOpen) return
    const onDoc = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [pickerOpen])

  const pickerLabel = selectedBusIds.length === 0
    ? 'All buses'
    : selectedBusIds.length === 1
      ? (fleet.find((b) => b.busId === selectedBusIds[0])?.busNo ?? '1 bus selected')
      : `${selectedBusIds.length} buses selected`

  const visibleFleet = selectedBusIds.length
    ? filteredFleet.filter((b) => selectedBusIds.includes(b.busId))
    : filteredFleet

  const busPoints = visibleFleet
    .filter((b) => b.lat != null && b.lng != null)
    .map((b) => {
      const live = b.status ? tripIsLive(b.status) : true
      return {
        id: b.busId,
        busNo: b.busNo,
        lat: b.lat as number,
        lng: b.lng as number,
        speedKmh: b.speedKmh ?? null,
        heading: b.heading ?? null,
        live,
        // Always surface speed when GPS reports it — not only when legacy status is "moving".
        moving: live && b.speedKmh != null && b.speedKmh > 3,
        showSpeed: live && b.speedKmh != null,
      }
    })

  // No selection and no route filter -> no routes at all (just live locations). Selecting
  // buses, or picking a route in the filter, draws only the route(s) currently in view.
  const visibleRouteIds = new Set(visibleFleet.map((b) => b.routeId).filter((id): id is string => !!id))
  // Routes stay hidden only in the fully untouched default (no selection, no filter of any
  // kind) — any deliberate narrowing (a bus pick, a route/status pick, or a search term)
  // means the user wants to see what's in view, lines included.
  const anyFilterActive = selectedBusIds.length > 0 || !!routeFilter || routeFilterTouched || !!statusFilter || !!search
  const routePaths = !anyFilterActive ? [] : Object.entries(routeStopsByRouteId)
    .filter(([routeId]) => visibleRouteIds.has(routeId))
    .map(([routeId, stops]) => {
      const placed = placedStops(stops)
      const path = placed.sort((a, b) => a.sequence - b.sequence).map((s) => ({ lat: s.lat as number, lng: s.lng as number }))
      return { routeId, path, stops: placed }
    }).filter((r) => r.path.length >= 2)

  const busSelector = fleet.length > 0 && (
    <div ref={pickerRef} style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
      <button
        type="button"
        onClick={() => setPickerOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
          padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--surface)', cursor: 'pointer',
        }}
      >
        {pickerLabel}
        <span style={{ fontSize: 10, opacity: 0.6 }}>{pickerOpen ? '▲' : '▼'}</span>
      </button>
      {pickerOpen && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: 180,
            maxHeight: 260, overflowY: 'auto', background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', padding: 8,
          }}
        >
          {filteredFleet.map((b) => (
            <div key={b.busId} style={{ padding: '5px 4px' }}>
              <Checkbox
                checked={selectedBusIds.includes(b.busId)}
                onChange={() => toggleBus(b.busId)}
                label={`${b.busNo}${tripIsLive(b.status) ? ' · live' : b.lat != null ? ' · last' : ''}`}
              />
            </div>
          ))}
          {filteredFleet.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedBusIds(filteredFleet.map((b) => b.busId))}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontSize: 12, color: '#2563eb',
                background: 'none', border: 'none', borderTop: '1px solid var(--border)', cursor: 'pointer',
                padding: '6px 4px 2px', marginTop: 4,
              }}
            >
              Select all
            </button>
          )}
          {selectedBusIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedBusIds([])}
              style={{
                display: 'block', width: '100%', textAlign: 'left', fontSize: 12, color: '#2563eb',
                background: 'none', border: 'none', borderTop: selectedBusIds.length && filteredFleet.length ? 'none' : '1px solid var(--border)', cursor: 'pointer',
                padding: '6px 4px 2px', marginTop: 0,
              }}
            >
              Unselect all (show every last location)
            </button>
          )}
        </div>
      )}
    </div>
  )

  if (!API_KEY) {
    return (
      <div className="col ai-center jc-center" style={{ height, borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--surface-2)' }}>
        <div className="t-sm muted">Map not configured</div>
      </div>
    )
  }

  const initialCenter = busPoints[0]
    ? { lat: busPoints[0].lat, lng: busPoints[0].lng }
    : routePaths[0]?.path[0] ?? DEFAULT_CENTER

  return (
    <div>
      <div className="row gap8 ai-center" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        {busSelector}
        {routeOptions.length > 0 && (
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Route
            <select
              aria-label="Route"
              value={routeFilter}
              onChange={(e) => { setRouteFilter(e.target.value); setRouteFilterTouched(true) }}
              style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }}
            >
              <option value="">All routes</option>
              {routeOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        {statusOptions.length > 0 && (
          <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            Status
            <select
              aria-label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {fleet.length > 0 && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bus, route or driver…"
            style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: 12, minWidth: 180 }}
          />
        )}
      </div>
      <div style={{ position: 'relative', height, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          defaultCenter={initialCenter}
          defaultZoom={13}
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          {routePaths.map((r, i) => {
            const geom = routeGeometryByRouteId[r.routeId]
            return geom?.status === 'available'
              ? <RoadRoutePolyline key={r.routeId} geometry={geom} strokeColor={ROUTE_COLORS[i % ROUTE_COLORS.length]} />
              : geom?.status === 'unavailable'
                ? null // handled by the badge below, not a per-route line
                : null // still loading — no line yet, not a straight-line placeholder
          })}
          {routePaths.flatMap((r) => r.stops.map((s) => (
            <AdvancedMarker key={s.id} position={{ lat: s.lat as number, lng: s.lng as number }}>
              <StopPin
                sequence={s.sequence}
                name={s.name}
                onClick={onStopClick ? () => onStopClick(s.id) : undefined}
              />
            </AdvancedMarker>
          )))}
          {busPoints.map((b) => (
            <LiveBusMarker
              key={b.id}
              busId={b.id}
              lat={b.lat}
              lng={b.lng}
              heading={b.live ? b.heading : null}
              color={b.live ? (b.moving ? '#16a34a' : '#2563eb') : '#64748b'}
              label={`${b.busNo}${b.showSpeed ? ` · ${Math.round(b.speedKmh!)} km/h` : b.live ? '' : ' · last'}`}
              onClick={onBusClick ? () => onBusClick(b.id) : undefined}
            />
          ))}
          {highlightStop ? (
            <AdvancedMarker position={{ lat: highlightStop.lat, lng: highlightStop.lng }}>
              <span style={{
                background: '#2563eb', color: '#fff', padding: '4px 8px', borderRadius: 8,
                fontSize: 11, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              }}>
                ★ {highlightStop.name}
              </span>
            </AdvancedMarker>
          ) : null}
          <FitStops stops={
            [
              ...busPoints.map((b) => ({ lat: b.lat, lng: b.lng })),
              ...routePaths.flatMap((r) => r.path),
              ...(highlightStop ? [{ lat: highlightStop.lat, lng: highlightStop.lng }] : []),
            ]
          } />
        </Map>
      </APIProvider>
      {busPoints.length === 0 && routePaths.length === 0 && (
        <div className="col ai-center jc-center" style={{ position: 'absolute', inset: 0, gap: 8, textAlign: 'center', padding: 24, pointerEvents: 'none', background: 'rgba(0,0,0,0.03)' }}>
          <div className="fw6">No bus location yet</div>
          <div className="t-sm muted">Last location stays on the map after a trip. The driver app sends live GPS when pickup or drop is running.</div>
        </div>
      )}
      {selectedBusIds.length > 0 && routePaths.some((r) => routeGeometryByRouteId[r.routeId]?.status === 'unavailable') && (
        <RouteUnavailableBadge />
      )}
      </div>
    </div>
  )
}
