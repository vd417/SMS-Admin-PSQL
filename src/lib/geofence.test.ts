import { describe, it, expect } from 'vitest'
import {
  validateGeofenceInput, haversineMeters, testPositionInFence, nearestRadiusPreset,
  RADIUS_PRESETS, readMapLatLng, circleBounds, fencePreviewDiameterPx,
} from './geofence'

describe('validateGeofenceInput', () => {
  it('accepts valid campus coordinates', () => {
    expect(validateGeofenceInput(12.97, 77.59, 250)).toBeNull()
  })
  it('rejects 0,0', () => {
    expect(validateGeofenceInput(0, 0, 250)).toMatch(/0,0/)
  })
  it('rejects radius out of range', () => {
    expect(validateGeofenceInput(12, 77, 10)).toMatch(/30/)
  })
})

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(12.97, 77.59, 12.97, 77.59)).toBeLessThan(1)
  })
})

describe('testPositionInFence', () => {
  const campus = { lat: 12.9716, lng: 77.5946, radius: 250 }

  it('marks same point as inside', () => {
    const r = testPositionInFence(campus.lat, campus.lng, campus.radius, campus.lat, campus.lng)
    expect(r.inside).toBe(true)
    expect(r.distanceMeters).toBeLessThan(1)
  })

  it('marks far point as outside', () => {
    const r = testPositionInFence(campus.lat, campus.lng, campus.radius, 13.1, 77.8)
    expect(r.inside).toBe(false)
  })
})

describe('nearestRadiusPreset', () => {
  it('keeps 100, 200 and 300 m exact', () => {
    expect(RADIUS_PRESETS).toEqual([100, 200, 300])
    expect(nearestRadiusPreset(100)).toBe(100)
    expect(nearestRadiusPreset(200)).toBe(200)
    expect(nearestRadiusPreset(300)).toBe(300)
  })
  it('snaps a value between presets to the closer one', () => {
    expect(nearestRadiusPreset(180)).toBe(200)
    expect(nearestRadiusPreset(240)).toBe(200)
  })
})

describe('readMapLatLng', () => {
  it('reads a literal click point', () => {
    expect(readMapLatLng({ lat: 17.385, lng: 78.4867 })).toEqual({ lat: 17.385, lng: 78.4867 })
  })
  it('calls lat/lng when the map hands back a LatLng', () => {
    expect(readMapLatLng({ lat: () => 17.385, lng: () => 78.4867 })).toEqual({ lat: 17.385, lng: 78.4867 })
  })
  it('rejects a missing point', () => {
    expect(readMapLatLng(null)).toBeNull()
  })
})

describe('circleBounds', () => {
  it('makes a 300 m circle three times a 100 m circle', () => {
    const small = circleBounds(17.4, 78.5, 100)
    const large = circleBounds(17.4, 78.5, 300)
    const span = (b: { north: number; south: number }) => b.north - b.south
    expect(span(large) / span(small)).toBeCloseTo(3, 5)
  })
})

describe('fencePreviewDiameterPx', () => {
  it('draws a larger circle for a larger radius', () => {
    const a = fencePreviewDiameterPx(100)
    const b = fencePreviewDiameterPx(200)
    const c = fencePreviewDiameterPx(300)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })
})
