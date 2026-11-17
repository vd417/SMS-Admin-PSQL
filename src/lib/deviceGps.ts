/** School-gate GPS. A network or IP fix is often tens of kilometres off and must not move the pin. */
export const GPS_MAX_ACCURACY_METERS = 100
export const GPS_WAIT_MS = 20_000

/** Fresh device GPS only. `maximumAge: 0` refuses a cached fix. */
export const PRECISE_GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
}

export type GpsFix = { lat: number; lng: number; accuracy: number }

export type GpsFailureReason = 'unsupported' | 'denied' | 'unavailable' | 'inaccurate' | 'timeout' | 'aborted'

export type GpsCaptureResult =
  | { ok: true; fix: GpsFix }
  | { ok: false; reason: GpsFailureReason; accuracy?: number }

type GeoReading = { coords: { latitude: number; longitude: number; accuracy: number } }
type GeoError = { code: number }
type GeoLike = {
  watchPosition: (
    success: (pos: GeoReading) => void,
    error?: (err: GeoError) => void,
    options?: PositionOptions,
  ) => number
  clearWatch: (id: number) => void
}

/** Accept a reading only when it is a real, precise device fix. */
export function acceptGpsReading(latitude: number, longitude: number, accuracy: number): GpsFix | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  if (latitude === 0 && longitude === 0) return null
  if (accuracy <= 0 || accuracy > GPS_MAX_ACCURACY_METERS) return null
  return { lat: latitude, lng: longitude, accuracy }
}

export function gpsFailureMessage(result: Extract<GpsCaptureResult, { ok: false }>): { title: string; body: string } | null {
  switch (result.reason) {
    case 'aborted':
      return null
    case 'unsupported':
      return { title: 'GPS unavailable', body: 'This browser does not support location.' }
    case 'denied':
      return { title: 'Location denied', body: 'Allow location access for this site, then try again. The school pin was left unchanged.' }
    case 'unavailable':
      return { title: 'Location unavailable', body: 'Turn on device GPS and try again. The school pin was left unchanged.' }
    case 'timeout':
      return { title: 'GPS timed out', body: 'No precise GPS fix arrived. Move outdoors, turn on device GPS, and try again. The school pin was left unchanged.' }
    case 'inaccurate':
      return {
        title: 'GPS not precise enough',
        body: `The device reported ±${Math.round(result.accuracy ?? 0)} m. A fix of ${GPS_MAX_ACCURACY_METERS} m or better is required, so the school pin was left unchanged.`,
      }
    default:
      return { title: 'Location unavailable', body: 'The school pin was left unchanged.' }
  }
}

/**
 * Watch until the browser produces a high-accuracy fix.
 * Coarse network readings are ignored. The map must not update until this resolves `ok`.
 */
export function capturePreciseGps(options?: {
  signal?: AbortSignal
  geo?: GeoLike | null
  waitMs?: number
}): Promise<GpsCaptureResult> {
  const source = options?.geo === undefined
    ? (typeof navigator !== 'undefined' ? navigator.geolocation : null)
    : options.geo
  if (!source) return Promise.resolve({ ok: false, reason: 'unsupported' })

  const waitMs = options?.waitMs ?? GPS_WAIT_MS
  const signal = options?.signal

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, reason: 'aborted' })
      return
    }

    let settled = false
    let watchId = 0
    let bestAccuracy = Infinity
    let timer = 0

    const finish = (result: GpsCaptureResult) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      try { source.clearWatch(watchId) } catch { /* watch was not started */ }
      resolve(result)
    }

    const onAbort = () => finish({ ok: false, reason: 'aborted' })
    signal?.addEventListener('abort', onAbort, { once: true })

    timer = window.setTimeout(() => {
      finish(Number.isFinite(bestAccuracy)
        ? { ok: false, reason: 'inaccurate', accuracy: bestAccuracy }
        : { ok: false, reason: 'timeout' })
    }, waitMs)

    const id = source.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords
        if (Number.isFinite(accuracy) && accuracy > 0) bestAccuracy = Math.min(bestAccuracy, accuracy)
        const fix = acceptGpsReading(latitude, longitude, accuracy)
        if (!fix) return
        finish({ ok: true, fix })
      },
      (err) => {
        if (err.code === 1) finish({ ok: false, reason: 'denied' })
        else if (err.code === 2) finish({ ok: false, reason: 'unavailable' })
      },
      PRECISE_GPS_OPTIONS,
    )
    watchId = id
    if (settled) {
      try { source.clearWatch(id) } catch { /* already stopped */ }
    }
  })
}
