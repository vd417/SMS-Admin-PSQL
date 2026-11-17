import { describe, it, expect } from 'vitest'
import {
  acceptGpsReading, capturePreciseGps, GPS_MAX_ACCURACY_METERS, PRECISE_GPS_OPTIONS,
} from './deviceGps'

describe('acceptGpsReading', () => {
  it('accepts a precise device fix', () => {
    expect(acceptGpsReading(28.620018, 77.366099, 8)).toEqual({
      lat: 28.620018, lng: 77.366099, accuracy: 8,
    })
  })

  it('rejects a coarse network fix that can be tens of kilometres off', () => {
    expect(acceptGpsReading(28.4, 77.1, 25_000)).toBeNull()
    expect(acceptGpsReading(28.620018, 77.366099, GPS_MAX_ACCURACY_METERS + 1)).toBeNull()
  })

  it('rejects 0,0 and non-finite readings', () => {
    expect(acceptGpsReading(0, 0, 5)).toBeNull()
    expect(acceptGpsReading(Number.NaN, 77, 5)).toBeNull()
  })
})

describe('capturePreciseGps', () => {
  it('asks for a fresh high-accuracy fix and ignores the coarse reading', async () => {
    let options: PositionOptions | undefined
    const result = await capturePreciseGps({
      waitMs: 1000,
      geo: {
        watchPosition(success, _error, opts) {
          options = opts
          success({ coords: { latitude: 28.4, longitude: 77.1, accuracy: 25_000 } })
          success({ coords: { latitude: 28.620018, longitude: 77.366099, accuracy: 12 } })
          return 1
        },
        clearWatch() {},
      },
    })
    expect(options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 })
    expect(PRECISE_GPS_OPTIONS.maximumAge).toBe(0)
    expect(result).toEqual({ ok: true, fix: { lat: 28.620018, lng: 77.366099, accuracy: 12 } })
  })

  it('does not return coordinates when every reading is too coarse', async () => {
    const result = await capturePreciseGps({
      waitMs: 20,
      geo: {
        watchPosition(success) {
          success({ coords: { latitude: 28.4, longitude: 77.1, accuracy: 25_000 } })
          return 7
        },
        clearWatch() {},
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('inaccurate')
      expect(result.accuracy).toBe(25_000)
      expect(result).not.toHaveProperty('fix')
    }
  })

  it('reports permission denied and does not emit a position', async () => {
    const result = await capturePreciseGps({
      waitMs: 1000,
      geo: {
        watchPosition(_success, error) {
          error?.({ code: 1 })
          return 3
        },
        clearWatch() {},
      },
    })
    expect(result).toEqual({ ok: false, reason: 'denied' })
  })
})
