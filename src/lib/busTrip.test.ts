import { describe, it, expect } from 'vitest'
import { hasGpsFix, tripIsLive, withMapPosition } from './busTrip'

describe('tripIsLive', () => {
  it('treats a pickup or drop already running as a trip that cannot be stopped here', () => {
    expect(tripIsLive('running')).toBe(true)
    expect(tripIsLive('on_route')).toBe(true)
    expect(tripIsLive('at_stop')).toBe(true)
    expect(tripIsLive('delayed')).toBe(true)
  })

  it('treats idle and maintenance as location-only, with no trip to end', () => {
    expect(tripIsLive('idle')).toBe(false)
    expect(tripIsLive('maintenance')).toBe(false)
    expect(tripIsLive(undefined)).toBe(false)
  })
})

describe('withMapPosition', () => {
  it('keeps last coordinates when the trip is not live', () => {
    const idle = withMapPosition({ busId: 'b1', status: 'idle', lat: 12.9, lng: 77.6 })
    expect(idle.lat).toBe(12.9)
    expect(idle.lng).toBe(77.6)
  })

  it('drops the ocean placeholder 0,0', () => {
    const empty = withMapPosition({ lat: 0, lng: 0 })
    expect(empty.lat).toBeNull()
    expect(empty.lng).toBeNull()
    expect(hasGpsFix(0, 0)).toBe(false)
  })
})
