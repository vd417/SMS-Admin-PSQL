import { describe, expect, it } from 'vitest'
import { attendanceBackupKey, attendanceChangeWarnsOwner } from './attendanceCorrection'

describe('attendance corrections', () => {
  it('warns the owner from the third change in the month', () => {
    expect(attendanceChangeWarnsOwner(1)).toBe(false)
    expect(attendanceChangeWarnsOwner(2)).toBe(false)
    expect(attendanceChangeWarnsOwner(3)).toBe(true)
    expect(attendanceChangeWarnsOwner(5)).toBe(true)
  })

  it('keys a period backup by class, day, period, and subject', () => {
    expect(attendanceBackupKey('c1', '2026-11-14', 2, 'Math')).toBe('att-backup:c1:2026-11-14:2:math')
  })
})