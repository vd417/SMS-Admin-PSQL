import { describe, it, expect } from 'vitest'
import { fmtMoney, fmtNum, gradeFor, gpaFor, reportFor, classRank, overallToppers, classToppers, feeStatusForBalance } from './format'
import { students } from '@/data/mockDb'
import type { Student } from '@/types'

describe('format', () => {
  it('formats money in en-IN with currency', () => {
    expect(fmtMoney(150000)).toBe('₹ 1,50,000')
    expect(fmtMoney(1000, 'AED')).toBe('AED 1,000')
  })
  it('formats numbers in en-IN', () => {
    expect(fmtNum(2500000)).toBe('25,00,000')
  })
  describe('feeStatusForBalance', () => {
    it('reads a zero balance as Paid, whatever the reported status', () => {
      expect(feeStatusForBalance(0, 'due')).toBe('paid')
      expect(feeStatusForBalance(0, 'partial')).toBe('paid')
      expect(feeStatusForBalance(0, 'paid')).toBe('paid')
    })
    it('reads an overpaid / negative balance as Paid', () => {
      expect(feeStatusForBalance(-500, 'due')).toBe('paid')
    })
    it('keeps the reported status when a balance is still owed', () => {
      expect(feeStatusForBalance(1200, 'due')).toBe('due')
      expect(feeStatusForBalance(1200, 'partial')).toBe('partial')
    })
    it('treats a non-finite balance as unknown and keeps the reported status', () => {
      expect(feeStatusForBalance(NaN, 'due')).toBe('due')
    })
  })
  it('grades by percentage band', () => {
    expect(gradeFor(95)).toBe('A1')
    expect(gradeFor(85)).toBe('A2')
    expect(gradeFor(35)).toBe('D')
    expect(gradeFor(10)).toBe('E')
  })
  it('maps grade to gpa', () => {
    expect(gpaFor('A1')).toBe(10)
    expect(gpaFor('E')).toBe(3)
  })
  it('builds a deterministic report with PASS/COMPARTMENT', () => {
    const r = reportFor(students[0])
    expect(r.rows.length).toBeGreaterThan(0)
    expect(['PASS', 'COMPARTMENT']).toContain(r.result)
    expect(r.pct).toBe(reportFor(students[0]).pct)
  })
  it('reportFor computes percentage against each paper max marks, not a flat 100', () => {
    const getMark = (_sid: string, subj: string) => ({ Math: 25, Sci: 45 } as Record<string, number>)[subj]
    const r = reportFor(students[0], 'EX1', getMark, ['Math', 'Sci'], {
      liveOnly: true,
      getMax: (s) => (s === 'Math' ? 50 : 90),
    })
    // 25/50 + 45/90 → total 70 out of maxTotal 140 = 50%
    expect(r.maxTotal).toBe(140)
    expect(r.pct).toBe(50)
    expect(r.rows.find((row) => row.subject === 'Math')?.max).toBe(50)
  })

  it('ranks a student within its class (1-based, within class size)', () => {
    const { rank, classSize } = classRank(students[0])
    expect(rank).toBeGreaterThanOrEqual(1)
    expect(rank).toBeLessThanOrEqual(classSize)
  })
})

/* Minimal student factory — only the fields the topper helpers read. */
function mk(id: string, cls: string, attendance: number): Student {
  return {
    id, adm: 'ADM' + id, name: 'S' + id, gender: 'M', grade: cls, section: 'A',
    cls, roll: 1, guardian: 'G', phone: '0', attendance, feeStatus: 'paid',
    feeDue: 0, status: 'active', house: 'Red', avatarHue: 0,
  }
}

describe('topper ranking', () => {
  it('overallToppers sorts by attendance desc and respects the limit', () => {
    const list = [mk('a', 'X', 70), mk('b', 'X', 95), mk('c', 'X', 80)]
    const top = overallToppers(list, 'attendance', 2)
    expect(top.map((t) => t.student.id)).toEqual(['b', 'c'])
    expect(top[0].score).toBe(95)
  })

  it('overallToppers breaks attendance ties by id for determinism', () => {
    const list = [mk('b', 'X', 88), mk('a', 'X', 88)]
    const top = overallToppers(list, 'attendance', 2)
    expect(top.map((t) => t.student.id)).toEqual(['a', 'b'])
  })

  it('overallToppers ranks exam metric from live marks only (no dummy)', () => {
    const list = [mk('a', 'X', 70), mk('b', 'X', 95), mk('c', 'Y', 80)]
    const opts = {
      liveOnly: true as const,
      examId: 'EX1',
      subjects: ['English'],
      getMark: (sid: string, _subject: string) =>
        ({ a: 90, b: 70, c: 95 } as Record<string, number>)[sid],
    }
    const top = overallToppers(list, 'exam', 5, opts)
    expect(top.map((t) => t.student.id)).toEqual(['c', 'a', 'b'])
    expect(top[0].score).toBe(95)
    expect(top[0].secondary).toBe(80)
  })

  it('attendance metric ranks on live getAttendance, excluding students with no marks', () => {
    const list = [mk('a', 'X', 12), mk('b', 'X', 99), mk('c', 'X', 50)]
    // Live marks say a=95, c=80; b has no marks (null) → excluded. SIS % ignored.
    const liveAtt: Record<string, number | null> = { a: 95, b: null, c: 80 }
    const top = overallToppers(list, 'attendance', 10, {
      getAttendance: (sid) => liveAtt[sid] ?? null,
    })
    expect(top.map((t) => t.student.id)).toEqual(['a', 'c'])
    expect(top[0].score).toBe(95)
  })

  it('overallToppers exam liveOnly excludes students with no saved marks', () => {
    const list = [mk('a', 'X', 70), mk('b', 'X', 95)]
    const top = overallToppers(list, 'exam', 10, {
      liveOnly: true,
      examId: 'EX1',
      subjects: ['English'],
      getMark: (sid) => (sid === 'a' ? 88 : undefined),
    })
    expect(top.map((t) => t.student.id)).toEqual(['a'])
    expect(top[0].score).toBe(88)
  })

  it('classToppers groups by class and limits per class', () => {
    const list = [
      mk('a', 'X', 90), mk('b', 'X', 80), mk('c', 'X', 70), mk('d', 'X', 60),
      mk('e', 'Y', 95),
    ]
    const groups = classToppers(list, 'attendance', 3)
    const x = groups.find((g) => g.cls === 'X')!
    const y = groups.find((g) => g.cls === 'Y')!
    expect(x.toppers.map((t) => t.student.id)).toEqual(['a', 'b', 'c'])
    expect(y.toppers).toHaveLength(1)
  })

  it('classToppers orders classes naturally', () => {
    const list = [mk('a', 'X-2', 90), mk('b', 'X-10', 90), mk('c', 'X-1', 90)]
    const groups = classToppers(list, 'attendance', 1)
    expect(groups.map((g) => g.cls)).toEqual(['X-1', 'X-2', 'X-10'])
  })
})
