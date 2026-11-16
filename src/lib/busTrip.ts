/** A pickup or drop the driver app already started. Idle and maintenance are not a trip. */
export function tripIsLive(status: string | undefined): boolean {
  return status === 'running' || status === 'on_route' || status === 'at_stop' || status === 'delayed'
}

/** Real GPS, not the 0,0 placeholder stored when a trip has never pinged. */
export function hasGpsFix(lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null) return false
  return !(lat === 0 && lng === 0)
}

/** Keep last known coordinates for idle buses; drop only missing / 0,0. */
export function withMapPosition<T extends { lat?: number | null; lng?: number | null }>(bus: T): T {
  if (hasGpsFix(bus.lat, bus.lng)) return bus
  return { ...bus, lat: null, lng: null }
}
