import { describe, it, expect } from 'vitest'
import { tripIsLive } from './busTrip'

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
