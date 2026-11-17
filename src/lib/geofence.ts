import type { Role } from '@/types'
import { can } from './gating'

/** Campus radius presets (metres). Exact values — do not snap a saved fence onto a neighbour. */
export const RADIUS_PRESETS = [100, 200, 300] as const

/** Validate campus geo-fence inputs before save. */
export function validateGeofenceInput(lat: number, lng: number, radiusMeters: number): string | null {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.'
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return 'Longitude must be between -180 and 180.'
  if (!Number.isFinite(radiusMeters) || radiusMeters < 30 || radiusMeters > 5000) {
    return 'Radius must be between 30 m and 5 km.'
  }
  if (lat === 0 && lng === 0) return 'Set a real campus location (0,0 is not valid).'
  return null
}

/** Great-circle distance between two WGS-84 points (metres). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type FenceTestResult = {
  distanceMeters: number
  inside: boolean
  atBoundary: boolean
}

/** Client-side fence test — mirrors server punch tolerance (accuracy cap 30 m). */
export function testPositionInFence(
  campusLat: number,
  campusLng: number,
  radiusMeters: number,
  testLat: number,
  testLng: number,
  accuracyMeters = 0,
): FenceTestResult {
  const ACCURACY_CAP = 30
  const distanceMeters = haversineMeters(campusLat, campusLng, testLat, testLng)
  const effectiveRadius = radiusMeters + Math.min(accuracyMeters, ACCURACY_CAP)
  const inside = distanceMeters <= effectiveRadius
  const atBoundary = inside && distanceMeters > radiusMeters * 0.85
  return {
    distanceMeters: Math.round(distanceMeters * 10) / 10,
    inside,
    atBoundary,
  }
}

/** Owner, admin, and principals with attendance edit/approve can configure the campus fence. */
export function canConfigureGeofence(role: Role): boolean {
  if (role === 'owner' || role === 'admin') return true
  return can(role, 'attendance', 'A') || can(role, 'attendance', 'E')
}

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`
}

/** Visual circle size (px). Linear in metres so 100 / 200 / 300 m are easy to tell apart. */
export function fencePreviewDiameterPx(radiusMeters: number): number {
  const clamped = Math.min(Math.max(radiusMeters, 0), 500)
  const scaled = 70 + (clamped / 300) * 110
  return Math.round(Math.min(220, Math.max(72, scaled)))
}

/**
 * Click payloads are either `{ lat, lng }` or a Maps `LatLng` whose `lat`/`lng` are methods.
 * Passing the methods through makes the campus pin land off the click.
 */
export function readMapLatLng(
  point: { lat: number | (() => number); lng: number | (() => number) } | null | undefined,
): { lat: number; lng: number } | null {
  if (!point) return null
  const lat = typeof point.lat === 'function' ? point.lat() : point.lat
  const lng = typeof point.lng === 'function' ? point.lng() : point.lng
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

/** Bounding box of a circle on the ground. 300 m is three times 100 m, not the same box. */
export function circleBounds(lat: number, lng: number, radiusMeters: number): {
  north: number
  south: number
  east: number
  west: number
} {
  const radius = Math.max(radiusMeters, 1)
  const dLat = radius / 111_320
  const cos = Math.cos((lat * Math.PI) / 180)
  const dLng = radius / (111_320 * Math.max(Math.abs(cos), 0.01))
  return { north: lat + dLat, south: lat - dLat, east: lng + dLng, west: lng - dLng }
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}°, ${lng.toFixed(5)}°`
}

export function nearestRadiusPreset(radiusMeters: number): number {
  return RADIUS_PRESETS.reduce((best, p) => (
    Math.abs(p - radiusMeters) < Math.abs(best - radiusMeters) ? p : best
  ), RADIUS_PRESETS[0])
}
