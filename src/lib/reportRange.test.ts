import { describe, expect, it } from 'vitest'
import { rangeForPreset } from './reportRange'

const now = new Date(2026, 10, 10, 15, 0, 0)

describe('report date presets', () => {
  it('uses the local calendar, Monday-start week, and the previous month', () => {
    expect(rangeForPreset('today', now)).toEqual({ from: '2026-11-10', to: '2026-11-10' })
    expect(rangeForPreset('yesterday', now)).toEqual({ from: '2026-11-09', to: '2026-11-09' })
    expect(rangeForPreset('week', now)).toEqual({ from: '2026-11-09', to: '2026-11-10' })
    expect(rangeForPreset('lastWeek', now)).toEqual({ from: '2026-11-02', to: '2026-11-08' })
    expect(rangeForPreset('month', now)).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(rangeForPreset('lastMonth', now)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(rangeForPreset('year', now)).toEqual({ from: '2026-01-01', to: '2026-11-10' })
  })
})
