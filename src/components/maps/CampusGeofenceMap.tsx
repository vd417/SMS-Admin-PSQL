import { useEffect } from 'react'
import { APIProvider, Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps'
import { Icon } from '@/components/ui'
import { formatCoords } from '@/lib/geofence'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 }
const DEFAULT_ZOOM = 5

type Props = {
  lat: number | null
  lng: number | null
  radiusMeters: number
  name?: string | null
  height?: number
  /** When set, a map click places the campus centre. */
  onPick?: (lat: number, lng: number) => void
}

function campusPoint(lat: number | null, lng: number | null): { lat: number; lng: number } | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null
  return { lat, lng }
}

function FenceCircle({ lat, lng, radiusMeters }: { lat: number; lng: number; radiusMeters: number }) {
  const map = useMap()
  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const circle = new google.maps.Circle({
      map,
      center: { lat, lng },
      radius: Math.max(30, radiusMeters),
      strokeColor: '#2563eb',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#2563eb',
      fillOpacity: 0.18,
      clickable: false,
    })
    const bounds = circle.getBounds()
    if (bounds) map.fitBounds(bounds, 36)
    else {
      map.setCenter({ lat, lng })
      map.setZoom(16)
    }
    return () => circle.setMap(null)
  }, [map, lat, lng, radiusMeters])
  return null
}

function CampusPin({ name }: { name: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translateY(-6px)' }}>
      <span
        style={{
          background: 'var(--surface, #fff)', color: 'var(--text, #111)',
          padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border, #d4d4d8)',
          fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', marginBottom: 4,
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        }}
      >
        {name}
      </span>
      <span style={{ color: 'var(--brand-600, #2563eb)' }} aria-hidden>
        <Icon name="pin" size={22} />
      </span>
    </div>
  )
}

/** Google Map of the campus geo-fence centre and radius. */
export function CampusGeofenceMap({
  lat, lng, radiusMeters, name, height = 280, onPick,
}: Props) {
  const placed = campusPoint(lat, lng)
  const label = (name && name.trim()) || 'Campus'

  if (!API_KEY) {
    return (
      <div
        className="col ai-center jc-center"
        style={{ height, borderRadius: 10, border: '1px dashed var(--border)', background: 'var(--surface-2)', gap: 6, textAlign: 'center', padding: 24 }}
      >
        <div className="fw6">Map not configured</div>
        <div className="t-sm muted">Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in <code>.env.local</code> to show the campus on the map.</div>
        {placed && <div className="t-xs muted3">{label} · {formatCoords(placed.lat, placed.lng)} · {radiusMeters} m</div>}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <APIProvider apiKey={API_KEY}>
        <Map
          mapId={MAP_ID}
          defaultCenter={placed ?? DEFAULT_CENTER}
          defaultZoom={placed ? 16 : DEFAULT_ZOOM}
          gestureHandling="greedy"
          disableDefaultUI={false}
          clickableIcons={false}
          style={{ width: '100%', height: '100%' }}
          onClick={(e) => {
            const p = e.detail.latLng
            if (!p || !onPick) return
            onPick(p.lat, p.lng)
          }}
        >
          {placed && (
            <>
              <FenceCircle lat={placed.lat} lng={placed.lng} radiusMeters={radiusMeters} />
              <AdvancedMarker position={placed} title={label}>
                <CampusPin name={label} />
              </AdvancedMarker>
            </>
          )}
        </Map>
      </APIProvider>
      {!placed && (
        <div
          className="t-xs muted3"
          style={{
            position: 'absolute', bottom: 8, left: 10, right: 10,
            pointerEvents: 'none',
            background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
            borderRadius: 8, padding: '6px 10px',
          }}
        >
          {onPick ? 'Click the map (or capture GPS) to set the campus centre.' : 'Campus location is not set yet.'}
        </div>
      )}
    </div>
  )
}
