/* ============================================================
   Campus geo-fence settings — shared by Attendance & Settings
   ============================================================ */
import { useEffect, useRef, useState } from 'react'
import { useToast } from '@/lib/hooks'
import {
  Card, CardHead, Btn, Badge, Input, Field, Segmented,
} from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { useSchoolLocation, useUpsertSchoolLocation, useDeleteSchoolLocation } from '@/api/hooks/useSchoolLocation'
import { CampusGeofenceMap } from '@/components/maps/CampusGeofenceMap'
import {
  RADIUS_PRESETS, validateGeofenceInput, formatCoords, googleMapsUrl,
  testPositionInFence,
  type FenceTestResult,
} from '@/lib/geofence'
import { capturePreciseGps, gpsFailureMessage, type GpsFix } from '@/lib/deviceGps'

function RadiusPresets({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="col gap6">
      <span className="t-xs muted3">Radius preset</span>
      <Segmented
        value={value}
        onChange={onChange}
        options={RADIUS_PRESETS.map((m) => ({ value: String(m), label: `${m} m` }))}
      />
    </div>
  )
}

function TestResultBanner({ result }: { result: FenceTestResult }) {
  const tone: BadgeTone = result.inside ? (result.atBoundary ? 'warning' : 'success') : 'danger'
  const label = result.inside
    ? (result.atBoundary ? 'At boundary — check-in may succeed' : 'Inside fence — check-in would succeed')
    : 'Outside fence — check-in would be rejected'
  return (
    <div className="row ai-center gap10" style={{
      padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)',
      background: 'var(--surface-2)',
    }}>
      <Badge tone={tone} dot>{label}</Badge>
      <span className="t-sm muted">{result.distanceMeters} m from centre</span>
    </div>
  )
}

export type CampusGeofenceSettingsProps = {
  schoolName: string
  canConfigure: boolean
  /** Auto-prompt GPS on first visit when fence is not configured. */
  autoPromptGps?: boolean
  /** Compact card for Settings page vs embedded in Attendance tab. */
  compact?: boolean
  onConfiguredChange?: (configured: boolean) => void
}

export function CampusGeofenceSettings({
  schoolName, canConfigure, autoPromptGps = false, compact = false, onConfiguredChange,
}: CampusGeofenceSettingsProps) {
  const toast = useToast()
  const locQ = useSchoolLocation(true)
  const saveMut = useUpsertSchoolLocation()
  const deleteMut = useDeleteSchoolLocation()

  const location = locQ.data
  const configured = Boolean(location && (location.lat !== 0 || location.lng !== 0))

  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmSave, setConfirmSave] = useState(false)
  const [pendingCoords, setPendingCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState('200')
  const [name, setName] = useState('')
  const [locating, setLocating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<FenceTestResult | null>(null)
  const [autoTried, setAutoTried] = useState(false)

  useEffect(() => {
    onConfiguredChange?.(configured)
  }, [configured, onConfiguredChange])

  useEffect(() => {
    if (!configured && canConfigure) setEditing(true)
  }, [configured, canConfigure])

  // Hydrate from the saved fence once per server value. A fresh GPS capture sets
  // unsavedGps so a refetch cannot put the old centre back on the map.
  const hydratedKey = useRef<string | null>(null)
  const unsavedGps = useRef(false)
  const gpsAbort = useRef<AbortController | null>(null)
  useEffect(() => () => gpsAbort.current?.abort(), [])
  useEffect(() => {
    if (!location) {
      hydratedKey.current = null
      return
    }
    if (unsavedGps.current) return
    const key = `${location.lat},${location.lng},${location.radiusMeters}`
    if (hydratedKey.current === key) return
    hydratedKey.current = key
    setLat(String(location.lat))
    setLng(String(location.lng))
    setRadius(String(location.radiusMeters))
    setName(location.name ?? '')
  }, [location])

  const captureGps = async (): Promise<GpsFix | null> => {
    gpsAbort.current?.abort()
    const controller = new AbortController()
    gpsAbort.current = controller
    setLocating(true)
    try {
      const result = await capturePreciseGps({ signal: controller.signal })
      if (result.ok) return result.fix
      const copy = gpsFailureMessage(result)
      if (copy) toast.danger(copy.title, copy.body)
      return null
    } finally {
      if (gpsAbort.current === controller) setLocating(false)
    }
  }

  const applyGpsFix = (pos: GpsFix) => {
    unsavedGps.current = true
    const latStr = pos.lat.toFixed(6)
    const lngStr = pos.lng.toFixed(6)
    setLat(latStr)
    setLng(lngStr)
    return { lat: Number(latStr), lng: Number(lngStr), accuracy: pos.accuracy }
  }

  const useDeviceLocation = async () => {
    const pos = await captureGps()
    if (!pos) return
    const fix = applyGpsFix(pos)
    toast.success('Location captured', `${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)} · ±${Math.round(fix.accuracy)} m. Save when the pin looks right.`)
    return fix
  }

  // Changing an existing fence moves the zone every staff/teacher check-in verifies
  // against, so a save over a configured fence is confirmed first. First-time setup
  // (no fence yet) saves in one step — there's nothing to overwrite.
  const requestSave = (coords?: { lat: number; lng: number }) => {
    const latN = coords?.lat ?? Number(lat)
    const lngN = coords?.lng ?? Number(lng)
    const radiusN = Number(radius)
    const err = validateGeofenceInput(latN, lngN, radiusN)
    if (err) {
      toast.danger('Invalid fence', err)
      return
    }
    if (configured) {
      setPendingCoords({ lat: latN, lng: lngN })
      setConfirmSave(true)
      return
    }
    void save(coords)
  }

  const confirmSaveNow = async () => {
    const coords = pendingCoords
    setConfirmSave(false)
    setPendingCoords(null)
    await save(coords ?? undefined)
  }

  const save = async (coords?: { lat: number; lng: number }) => {
    const latN = coords?.lat ?? Number(lat)
    const lngN = coords?.lng ?? Number(lng)
    const radiusN = Number(radius)
    const err = validateGeofenceInput(latN, lngN, radiusN)
    if (err) {
      toast.danger('Invalid fence', err)
      return
    }
    try {
      await saveMut.mutateAsync({
        lat: latN,
        lng: lngN,
        radius_meters: Math.round(radiusN),
        name: name.trim() || schoolName,
      })
      unsavedGps.current = false
      setEditing(false)
      setTestResult(null)
      toast.success('Campus geo-fence saved', `${Math.round(radiusN)} m radius · app check-ins verify against this zone.`)
    } catch (e) {
      toast.danger('Could not save', e instanceof Error ? e.message : 'Try again.')
    }
  }

  const setFenceFromDevice = async () => {
    const pos = await captureGps()
    if (!pos) return
    const fix = applyGpsFix(pos)
    requestSave({ lat: fix.lat, lng: fix.lng })
  }

  const runTest = async () => {
    if (!configured || !location) {
      toast.danger('No fence', 'Save a campus location before testing.')
      return
    }
    setTesting(true)
    setTestResult(null)
    const pos = await captureGps()
    setTesting(false)
    if (!pos) return
    const result = testPositionInFence(
      location.lat, location.lng, location.radiusMeters,
      pos.lat, pos.lng, pos.accuracy,
    )
    setTestResult(result)
  }

  const resetFence = async () => {
    try {
      await deleteMut.mutateAsync()
      unsavedGps.current = false
      setEditing(true)
      setConfirmReset(false)
      setTestResult(null)
      setLat('')
      setLng('')
      setRadius('200')
      setName('')
      toast.success('Geo-fence reset', 'Campus location removed. Configure again to enable GPS check-in.')
    } catch (e) {
      toast.danger('Could not reset', e instanceof Error ? e.message : 'Try again.')
    }
  }

  useEffect(() => {
    if (!autoPromptGps || autoTried || configured || !canConfigure) return
    setAutoTried(true)
    void useDeviceLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPromptGps, autoTried, configured, canConfigure])

  const showForm = editing || !configured
  const previewLat = Number(lat)
  const previewLng = Number(lng)
  const previewRadius = Number(radius)
  const mapLat = Number.isFinite(previewLat) ? previewLat : null
  const mapLng = Number.isFinite(previewLng) ? previewLng : null
  const mapRadius = Number.isFinite(previewRadius) && previewRadius > 0 ? previewRadius : 200
  const pickOnMap = (plat: number, plng: number) => {
    setLat(plat.toFixed(6))
    setLng(plng.toFixed(6))
  }
  const statusBadge = configured
    ? <Badge tone="success" icon="checkCircle">Active</Badge>
    : <Badge tone="neutral" icon="alert">Inactive</Badge>

  const inner = (
    <>
      {!canConfigure && !configured && (
        <div style={{ padding: compact ? 0 : 16 }}>
          <span className="t-sm muted">Campus geo-fence is not configured. Ask your school admin to set it in Settings or Attendance → Geo-fence.</span>
        </div>
      )}

      {canConfigure && showForm && (
        <div className="col gap16" style={{ padding: compact ? '16px 0 0' : 16, borderTop: compact ? undefined : '1px solid var(--border)' }}>
          <div>
            <div className="t-md fw6">Set school location</div>
            <div className="t-sm muted3" style={{ marginTop: 4 }}>
              Stand at the school gate, capture GPS, choose a radius, and save. Teacher &amp; staff app check-ins verify against this zone.
            </div>
          </div>
          <CampusGeofenceMap
            lat={mapLat}
            lng={mapLng}
            radiusMeters={mapRadius}
            name={name.trim() || schoolName}
            height={compact ? 240 : 280}
            onPick={pickOnMap}
          />
          <Field label="Campus label">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={schoolName} />
          </Field>
          <RadiusPresets value={radius} onChange={setRadius} />
          <div className="sm-grid-2 gap12">
            <Field label="Latitude">
              <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="12.971600" />
            </Field>
            <Field label="Longitude">
              <Input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="77.594600" />
            </Field>
          </div>
          {confirmSave ? (
            <div className="row ai-center gap8 wrap">
              <span className="t-sm muted">Update campus fence? Teacher &amp; staff app check-ins will verify against the new zone.</span>
              <Btn variant="primary" size="sm" icon="check" disabled={saveMut.isPending} onClick={() => { void confirmSaveNow() }}>
                {saveMut.isPending ? 'Saving…' : 'Confirm change'}
              </Btn>
              <Btn variant="ghost" size="sm" disabled={saveMut.isPending} onClick={() => { setConfirmSave(false); setPendingCoords(null) }}>Cancel</Btn>
            </div>
          ) : (
            <div className="row ai-center gap8 wrap">
              <Btn variant="primary" icon="pin" disabled={locating || saveMut.isPending} onClick={() => { void setFenceFromDevice() }}>
                {locating ? 'Getting GPS…' : saveMut.isPending ? 'Saving…' : 'Set school location (GPS)'}
              </Btn>
              <Btn variant="secondary" icon="pin" disabled={locating} onClick={() => { void useDeviceLocation() }}>
                Capture GPS only
              </Btn>
              <Btn variant="secondary" icon="check" disabled={saveMut.isPending} onClick={() => requestSave()}>
                Save coordinates
              </Btn>
              {configured && (
                <Btn variant="ghost" onClick={() => setEditing(false)}>Cancel</Btn>
              )}
            </div>
          )}
        </div>
      )}

      {configured && location && canConfigure && !showForm && (
        <div className="col gap12" style={{ padding: compact ? '16px 0 0' : '12px 16px' }}>
          <CampusGeofenceMap
            lat={location.lat}
            lng={location.lng}
            radiusMeters={location.radiusMeters}
            name={location.name || schoolName}
            height={compact ? 240 : 320}
          />
          <div className="row ai-center jc-between wrap gap8">
            <div>
              <div className="t-md fw6">{location.name || schoolName}</div>
              <div className="t-sm muted3">{location.radiusMeters} m radius · {formatCoords(location.lat, location.lng)}</div>
            </div>
            {statusBadge}
          </div>
          <div className="row ai-center gap8 wrap">
            <Btn
              variant="secondary"
              size="sm"
              icon="globe"
              onClick={() => window.open(googleMapsUrl(location.lat, location.lng), '_blank', 'noopener')}
            >
              Open in Google Maps
            </Btn>
            <Btn variant="secondary" size="sm" icon="edit" onClick={() => setEditing(true)}>Edit location</Btn>
            <Btn variant="secondary" size="sm" icon="pin" disabled={testing || locating} onClick={() => { void runTest() }}>
              {testing ? 'Testing…' : 'Test geo-fence'}
            </Btn>
            {!confirmReset ? (
              <Btn variant="ghost" size="sm" icon="trash" onClick={() => setConfirmReset(true)}>Reset geo-fence</Btn>
            ) : (
              <div className="row ai-center gap8">
                <span className="t-sm muted">Remove campus fence?</span>
                <Btn variant="danger" size="sm" disabled={deleteMut.isPending} onClick={() => { void resetFence() }}>
                  {deleteMut.isPending ? 'Resetting…' : 'Confirm reset'}
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>Cancel</Btn>
              </div>
            )}
          </div>
          {testResult && <TestResultBanner result={testResult} />}
        </div>
      )}

      {configured && location && !canConfigure && (
        <div className="col gap8" style={{ padding: compact ? '12px 0 0' : '12px 16px' }}>
          <CampusGeofenceMap
            lat={location.lat}
            lng={location.lng}
            radiusMeters={location.radiusMeters}
            name={location.name || schoolName}
            height={compact ? 220 : 280}
          />
          <div className="row ai-center jc-between">
            <span className="t-sm muted">{location.name || schoolName} · {location.radiusMeters} m</span>
            {statusBadge}
          </div>
        </div>
      )}
    </>
  )

  if (compact) {
    return (
      <Card>
        <CardHead
          title="Campus geo-fence"
          sub="GPS centre & radius for teacher & staff check-in (Platinum)"
          icon="pin"
          action={statusBadge}
        />
        <div style={{ padding: '0 16px 16px' }}>{inner}</div>
      </Card>
    )
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {inner}
    </div>
  )
}
