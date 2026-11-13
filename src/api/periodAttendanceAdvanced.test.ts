import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  listPeriodAttendanceAdvanced,
  listAllPeriodAttendanceRecords,
  getPeriodAttendanceClassDaySummary,
  listPeriodAttendanceSubjectSummaries,
  listPeriodAttendanceTeacherSummaries,
  getPeriodAttendanceRangeSummary,
  getPeriodAttendanceAudit,
  periodRowsToAttendanceRecords,
  collapsePeriodRowsToDaily,
  periodCountsByClass,
  classWiseDayHero,
  classWiseHeroDisplay,
  buildClassStudentSummaries,
  studentDayHeadcount,
  studentDayStatusById,
  buildClassDailyTrend,
  mergeSubjectSummariesBySubject,
  type PeriodAttendanceAdvancedRow,
  type AdvSubjectSummaryRow,
} from './periodAttendanceAdvanced'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const wireRow = {
  id: 'par1',
  class_id: 'c1',
  grade: 'IV',
  section: 'B',
  class_label: 'IV-B',
  student_id: 's1',
  student_name: 'Asha Kumar',
  admission_no: 'STU/26/0001',
  date: '2026-08-13',
  period: 2,
  period_id: 'p2',
  subject: 'Math',
  subject_id: 'sub1',
  start_time: '09:00',
  end_time: '09:40',
  status: 'present',
  assigned_teacher_id: 't1',
  assigned_teacher_name: 'Ravi Sharma',
  marked_by: 'u1',
  marked_by_name: 'Ravi Sharma',
  marked_by_role: 'teacher',
  marked_at: '2026-08-13T09:05:00Z',
  geo_fence_status: 'not_required',
}

describe('listPeriodAttendanceAdvanced', () => {
  it('GETs /attendance/period-records with filter query params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        items: [wireRow],
        total_count: 1,
        page: 1,
        page_size: 25,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await listPeriodAttendanceAdvanced({
      preset: 'today',
      from: '2026-08-13',
      to: '2026-08-13',
      classId: 'c1',
      grade: 'IV',
      section: 'B',
      subject: 'Math',
      period: 2,
      assignedTeacherId: 't1',
      markedBy: 'u1',
      markedByRole: 'teacher',
      status: 'present',
      q: 'asha',
      page: 1,
      pageSize: 25,
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/attendance/period-records')
    expect(url).toContain('preset=today')
    expect(url).toContain('from=2026-08-13')
    expect(url).toContain('to=2026-08-13')
    expect(url).toContain('classId=c1')
    expect(url).toContain('grade=IV')
    expect(url).toContain('section=B')
    expect(url).toContain('subject=Math')
    expect(url).toContain('period=2')
    expect(url).toContain('assignedTeacherId=t1')
    expect(url).toContain('markedBy=u1')
    expect(url).toContain('markedByRole=teacher')
    expect(url).toContain('status=present')
    expect(url).toContain('q=asha')
    expect(url).toContain('page=1')
    expect(url).toContain('pageSize=25')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method ?? 'GET').toBe('GET')
  })

  it('pages through GET /attendance/period-records for a full SQL export', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [wireRow], total_count: 2, page: 1, page_size: 1 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: { items: [{ ...wireRow, id: 'par2' }], total_count: 2, page: 2, page_size: 1 },
      }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = await listAllPeriodAttendanceRecords({ from: '2026-08-01', to: '2026-08-13', preset: 'custom', pageSize: 1 })
    expect(rows).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/attendance/period-records')
  })

  it('maps snake_case page envelope to camelCase types', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        items: [wireRow],
        total_count: 42,
        page: 2,
        page_size: 10,
      },
    })))

    const page = await listPeriodAttendanceAdvanced({ page: 2, pageSize: 10 })
    expect(page.totalCount).toBe(42)
    expect(page.page).toBe(2)
    expect(page.pageSize).toBe(10)
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      id: 'par1',
      classId: 'c1',
      grade: 'IV',
      section: 'B',
      classLabel: 'IV-B',
      studentId: 's1',
      studentName: 'Asha Kumar',
      admissionNo: 'STU/26/0001',
      date: '2026-08-13',
      period: 2,
      periodId: 'p2',
      subject: 'Math',
      subjectId: 'sub1',
      startTime: '09:00',
      endTime: '09:40',
      status: 'present',
      assignedTeacherId: 't1',
      assignedTeacherName: 'Ravi Sharma',
      markedBy: 'u1',
      markedByName: 'Ravi Sharma',
      markedByRole: 'teacher',
      markedAt: '2026-08-13T09:05:00Z',
      geoFenceStatus: 'not_required',
    })
  })

  it('returns an empty page when items are missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { items: null, total_count: 0, page: 1, page_size: 25 },
    })))

    const page = await listPeriodAttendanceAdvanced()
    expect(page.items).toEqual([])
    expect(page.totalCount).toBe(0)
  })
})

describe('getPeriodAttendanceClassDaySummary', () => {
  it('GETs the class-day summary and maps snake_case fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        total_students: 30, present: 25, absent: 3, late: 1, leave: 1, not_marked: 0,
        attendance_percentage: 86.67, total_periods: 30, marked_periods: 30, pending_periods: 0,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const summary = await getPeriodAttendanceClassDaySummary('c1', '2026-08-13')

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/attendance/period-records/summary/class')
    expect(url).toContain('classId=c1')
    expect(url).toContain('date=2026-08-13')
    expect(summary).toMatchObject({
      totalStudents: 30, present: 25, absent: 3, late: 1, leave: 1, notMarked: 0,
      attendancePercentage: 86.67, totalPeriods: 30, markedPeriods: 30, pendingPeriods: 0,
    })
  })
})

describe('listPeriodAttendanceSubjectSummaries', () => {
  it('GETs subject summaries for a class + range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        subject: 'Math', teacher_name: 'Ravi Sharma', periods: 20, marked: 18, pending: 2,
        present: 16, absent: 2, late: 0, attendance_percentage: 88.9,
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await listPeriodAttendanceSubjectSummaries('c1', { preset: 'last_30_days' })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/attendance/period-records/summary/subjects')
    expect(url).toContain('classId=c1')
    expect(url).toContain('preset=last_30_days')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ subject: 'Math', teacherName: 'Ravi Sharma', periods: 20, marked: 18, pending: 2 })
  })

  it('returns an empty array when the response is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: null })))
    const rows = await listPeriodAttendanceSubjectSummaries('c1')
    expect(rows).toEqual([])
  })
})

describe('listPeriodAttendanceTeacherSummaries', () => {
  it('GETs teacher summaries for a range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        teacher_id: 't1', teacher_name: 'Ravi Sharma', classes: 3, sections: 4, subjects: 2,
        expected_periods: 40, marked_periods: 38, pending_periods: 2,
        teacher_marked: 30, staff_marked: 5, principal_marked: 2, admin_marked: 1,
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await listPeriodAttendanceTeacherSummaries({ preset: 'this_week' })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/attendance/period-records/summary/teachers')
    expect(url).toContain('preset=this_week')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ teacherId: 't1', teacherName: 'Ravi Sharma', expectedPeriods: 40, markedPeriods: 38 })
  })
})

describe('getPeriodAttendanceRangeSummary', () => {
  it('GETs the range rollup with combinable filters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        total_marked_periods: 120, present: 100, absent: 10, late: 8, leave: 2,
        attendance_percentage: 90,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rollup = await getPeriodAttendanceRangeSummary({
      preset: 'last_90_days', classId: 'c1', subject: 'Math', teacherId: 't1',
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/attendance/period-records/summary/range')
    expect(url).toContain('preset=last_90_days')
    expect(url).toContain('classId=c1')
    expect(url).toContain('subject=Math')
    expect(url).toContain('teacherId=t1')
    expect(rollup).toMatchObject({ totalMarkedPeriods: 120, present: 100, absent: 10, late: 8, leave: 2, attendancePercentage: 90 })
    expect(rollup.presentStudents).toBeNull()
  })

  it('maps student headcount fields when the API sends them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        total_marked_periods: 8, present: 7, absent: 1, late: 0, leave: 0,
        attendance_percentage: 87.5,
        present_students: 1, absent_students: 0, late_students: 0,
      },
    })))
    const rollup = await getPeriodAttendanceRangeSummary({ preset: 'custom', from: '2026-11-12', to: '2026-11-12' })
    expect(rollup.presentStudents).toBe(1)
    expect(rollup.absentStudents).toBe(0)
    expect(rollup.lateStudents).toBe(0)
  })
})

describe('studentDayHeadcount', () => {
  it('counts a student once when several periods are present', () => {
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => ({ studentId: 's1', date: '2026-11-12', status: 'present', period: i + 1 })),
      { studentId: 's1', date: '2026-11-12', status: 'absent', period: 8 },
      { studentId: 's2', date: '2026-11-12', status: 'absent', period: 1 },
    ]
    expect(studentDayHeadcount(rows)).toEqual({ presentStudents: 1, absentStudents: 1, lateStudents: 0, leaveStudents: 0 })
    expect(studentDayStatusById(rows).get('s1')).toBe('present')
    expect(studentDayStatusById(rows).get('s2')).toBe('absent')
  })

  it('counts a leave-only day as leave, not absent', () => {
    const rows = [
      { studentId: 's3', date: '2026-11-12', status: 'leave', period: 1 },
      { studentId: 's3', date: '2026-11-12', status: 'leave', period: 2 },
    ]
    expect(studentDayHeadcount(rows).leaveStudents).toBe(1)
    expect(studentDayStatusById(rows).get('s3')).toBe('leave')
  })
})

describe('listPeriodAttendanceAdvanced geo/updatedBy fields', () => {
  it('sends geoFenceStatus and maps geo/updatedBy columns', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        items: [{
          ...wireRow,
          geo_fence_status: 'outside',
          geo_distance_meters: 42,
          geo_captured_at: '2026-08-13T09:05:30Z',
          updated_by: 'u2',
          updated_by_name: 'Principal Rao',
          updated_by_role: 'principal',
          updated_at: '2026-08-13T09:06:00Z',
        }],
        total_count: 1,
        page: 1,
        page_size: 25,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const page = await listPeriodAttendanceAdvanced({ geoFenceStatus: 'outside' })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('geoFenceStatus=outside')
    expect(page.items[0]).toMatchObject({
      geoFenceStatus: 'outside',
      geoDistanceMeters: 42,
      geoCapturedAt: '2026-08-13T09:05:30Z',
      updatedBy: 'u2',
      updatedByName: 'Principal Rao',
      updatedByRole: 'principal',
      updatedAt: '2026-08-13T09:06:00Z',
    })
  })
})

describe('getPeriodAttendanceAudit', () => {
  it('GETs the audit trail for a record, newest first', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [
        {
          id: 'a2', record_id: 'par1', class_id: 'c1', student_id: 's1', date: '2026-08-13',
          period: 2, subject: 'Math', from_status: 'present', to_status: 'absent',
          actor_id: 'u2', actor_name: 'Principal Rao', actor_role: 'principal', at: '2026-08-13T09:06:00Z',
        },
        {
          id: 'a1', record_id: 'par1', class_id: 'c1', student_id: 's1', date: '2026-08-13',
          period: 2, subject: 'Math', from_status: null, to_status: 'present',
          actor_id: 'u1', actor_name: 'Ravi Sharma', actor_role: 'teacher', at: '2026-08-13T09:05:00Z',
        },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rows = await getPeriodAttendanceAudit('par1')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/attendance/period-records/par1/audit')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ fromStatus: 'present', toStatus: 'absent', actorName: 'Principal Rao' })
    expect(rows[1]).toMatchObject({ fromStatus: null, toStatus: 'present', actorName: 'Ravi Sharma' })
  })

  it('returns an empty array when the response is not an array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: null })))
    expect(await getPeriodAttendanceAudit('par1')).toEqual([])
  })
})

describe('period row SQL helpers', () => {
  const base: PeriodAttendanceAdvancedRow = {
    id: 'p1', classId: 'c1', grade: 'IV', section: 'B', classLabel: 'IV-B',
    studentId: 's1', studentName: 'Asha', admissionNo: '1', date: '2026-08-26',
    period: 1, subject: 'Math', status: 'absent', geoFenceStatus: 'not_required',
  }

  it('maps period rows to attendance records', () => {
    const rows = periodRowsToAttendanceRecords([
      { ...base, status: 'present' },
      { ...base, id: 'p2', status: 'unknown' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ studentId: 's1', classId: 'c1', status: 'present' })
  })

  it('collapses a mixed day to present for absence streaks', () => {
    const daily = collapsePeriodRowsToDaily([
      { ...base, period: 1, status: 'absent' },
      { ...base, id: 'p2', period: 2, status: 'present' },
    ])
    expect(daily).toHaveLength(1)
    expect(daily[0].status).toBe('present')
  })

  it('counts period marks per class for a day', () => {
    const m = periodCountsByClass([
      { ...base, status: 'present' },
      { ...base, id: 'p2', studentId: 's2', status: 'absent' },
      { ...base, id: 'p3', date: '2026-08-25', status: 'present' },
    ], '2026-08-26')
    expect(m.get('c1')).toEqual({ present: 1, absent: 1, total: 2 })
  })

  it('counts a UTC datetime on the browser calendar day', () => {
    const instant = '2026-08-25T18:30:00.000Z'
    const d = new Date(instant)
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const m = periodCountsByClass([{ ...base, date: instant, status: 'present' }], local)
    expect(m.get('c1')).toEqual({ present: 1, absent: 0, total: 1 })
  })
})

describe('buildClassStudentSummaries', () => {
  const base: PeriodAttendanceAdvancedRow = {
    id: 'p1', classId: 'c1', grade: 'IV', section: 'B', classLabel: 'IV-B',
    studentId: 's1', studentName: 'Asha', admissionNo: '1', date: '2026-08-01',
    period: 1, subject: 'Math', status: 'present', geoFenceStatus: 'not_required',
  }

  it('aggregates present/absent/late counts and percentage per student', () => {
    const rows = buildClassStudentSummaries([
      { ...base, period: 1, date: '2026-08-01', status: 'present' },
      { ...base, id: 'p2', period: 2, date: '2026-08-01', status: 'absent' },
      { ...base, id: 'p3', period: 1, date: '2026-08-02', status: 'late' },
      { ...base, id: 'p4', studentId: 's2', studentName: 'Ben', period: 1, date: '2026-08-01', status: 'present' },
    ])
    expect(rows).toHaveLength(2)
    const asha = rows.find((r) => r.studentId === 's1')!
    expect(asha).toMatchObject({ present: 1, absent: 1, late: 1, attendancePercentage: 33 })
    const ben = rows.find((r) => r.studentId === 's2')!
    expect(ben).toMatchObject({ present: 1, absent: 0, late: 0, attendancePercentage: 100, tier: 'excellent' })
  })

  it('counts half_day as attended and ignores unrecognized statuses', () => {
    const rows = buildClassStudentSummaries([
      { ...base, period: 1, status: 'half_day' },
      { ...base, id: 'p2', period: 2, status: 'unknown' },
    ])
    expect(rows).toEqual([expect.objectContaining({ present: 1, absent: 0, late: 0, attendancePercentage: 100 })])
  })

  it('buckets attendance tiers matching Excellent/Good/Watch/Critical thresholds', () => {
    const rowsFor = (presentCount: number, total: number) => buildClassStudentSummaries(
      Array.from({ length: total }, (_, i) => ({
        ...base, id: `p${i}`, period: i + 1, status: i < presentCount ? 'present' : 'absent',
      })),
    )
    expect(rowsFor(100, 100)[0].tier).toBe('excellent')
    expect(rowsFor(90, 100)[0].tier).toBe('good')
    expect(rowsFor(80, 100)[0].tier).toBe('watch')
    expect(rowsFor(60, 100)[0].tier).toBe('critical')
  })

  it('returns at most the 6 most recent periods (status + subject), in chronological order', () => {
    const rows = buildClassStudentSummaries(
      Array.from({ length: 8 }, (_, i) => ({
        ...base, id: `p${i}`, period: 1, date: `2026-08-0${i + 1}`, status: 'present',
      })).map((r, i) => (i === 7 ? { ...r, status: 'absent', subject: 'Science' } : r)),
    )
    expect(rows[0].periods).toHaveLength(8)
    expect(rows[0].periods[0].date).toBe('2026-08-01')
    expect(rows[0].recentPeriods).toHaveLength(6)
    // most recent (8th day) mark is last
    expect(rows[0].recentPeriods[5]).toEqual({ status: 'absent', subject: 'Science', date: '2026-08-08', period: 1 })
  })

  it('carries the subject, date, and period through each recent period', () => {
    const rows = buildClassStudentSummaries([
      { ...base, period: 1, date: '2026-08-01', subject: 'Math', status: 'present' },
      { ...base, id: 'p2', period: 2, date: '2026-08-01', subject: 'English', status: 'absent' },
    ])
    expect(rows[0].recentPeriods).toEqual([
      { status: 'present', subject: 'Math', date: '2026-08-01', period: 1 },
      { status: 'absent', subject: 'English', date: '2026-08-01', period: 2 },
    ])
  })

  it('sorts students alphabetically by name', () => {
    const rows = buildClassStudentSummaries([
      { ...base, studentId: 's2', studentName: 'Zara', period: 1, status: 'present' },
      { ...base, studentId: 's1', studentName: 'Asha', period: 1, status: 'present' },
    ])
    expect(rows.map((r) => r.studentName)).toEqual(['Asha', 'Zara'])
  })
})

describe('buildClassDailyTrend', () => {
  const base: PeriodAttendanceAdvancedRow = {
    id: 'p1', classId: 'c1', grade: 'IV', section: 'B', classLabel: 'IV-B',
    studentId: 's1', studentName: 'Asha', admissionNo: '1', date: '2026-08-01',
    period: 1, subject: 'Math', status: 'present', geoFenceStatus: 'not_required',
  }

  it('buckets rows by calendar day and computes % (present-or-later counts as attended)', () => {
    const trend = buildClassDailyTrend([
      { ...base, period: 1, date: '2026-08-01', status: 'present' },
      { ...base, id: 'p2', period: 2, date: '2026-08-01', status: 'absent' },
      { ...base, id: 'p3', period: 1, date: '2026-08-02', status: 'late' },
    ])
    expect(trend).toEqual([
      { label: '1', value: 50, empty: false },
      { label: '2', value: 100, empty: false },
    ])
  })

  it('sorts days chronologically and ignores unrecognized statuses', () => {
    const trend = buildClassDailyTrend([
      { ...base, id: 'p1', date: '2026-08-05', status: 'present' },
      { ...base, id: 'p2', date: '2026-08-01', status: 'present' },
      { ...base, id: 'p3', date: '2026-08-03', status: 'unknown' },
    ])
    expect(trend.map((t) => t.label)).toEqual(['1', '5'])
  })

  it('returns an empty array when there are no rows', () => {
    expect(buildClassDailyTrend([])).toEqual([])
  })
})

describe('mergeSubjectSummariesBySubject', () => {
  const base: AdvSubjectSummaryRow = {
    subject: 'Mathematics', teacherName: 'Meera Krishnan', periods: 10, marked: 10,
    pending: 0, present: 9, absent: 1, late: 0, attendancePercentage: 90,
  }

  it('collapses multiple per-teacher rows for the same subject into one, recomputing the percentage', () => {
    const merged = mergeSubjectSummariesBySubject([
      { ...base, teacherName: 'Meera Krishnan', periods: 10, marked: 10, present: 9, absent: 1, late: 0 },
      { ...base, teacherName: 'Ravi Rao', periods: 10, marked: 10, present: 5, absent: 5, late: 0 },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({
      subject: 'Mathematics', teacherName: null, periods: 20, marked: 20,
      present: 14, absent: 6, late: 0, attendancePercentage: 70,
    })
  })

  it('leaves distinct subjects as separate rows', () => {
    const merged = mergeSubjectSummariesBySubject([
      { ...base, subject: 'Mathematics' },
      { ...base, subject: 'Science' },
    ])
    expect(merged.map((r) => r.subject).sort()).toEqual(['Mathematics', 'Science'])
  })

  it('counts late marks as attended when recomputing the merged percentage', () => {
    const merged = mergeSubjectSummariesBySubject([
      { ...base, present: 5, late: 5, absent: 0, marked: 10 },
      { ...base, present: 0, late: 0, absent: 10, marked: 10 },
    ])
    expect(merged[0]).toMatchObject({ marked: 20, attendancePercentage: 50 })
  })
})

describe('classWiseDayHero', () => {
  it('uses period range rollup instead of empty principal daily totals', () => {
    const hero = classWiseDayHero({
      range: {
        totalMarkedPeriods: 40,
        present: 32,
        absent: 6,
        late: 2,
        leave: 0,
        attendancePercentage: 85,
      },
    })
    expect(hero).toEqual({ present: 34, marked: 40, absent: 6, pct: 85 })
  })

  it('falls back to per-class period counts when the range rollup is empty', () => {
    const localByClass = new Map([
      ['c1', { present: 10, absent: 2, total: 12 }],
      ['c2', { present: 8, absent: 0, total: 8 }],
    ])
    const hero = classWiseDayHero({
      range: { totalMarkedPeriods: 0, present: 0, absent: 0, late: 0, leave: 0, attendancePercentage: null },
      localByClass,
    })
    expect(hero).toEqual({ present: 18, marked: 20, absent: 2, pct: 90 })
  })

  it('is unmarked when no period marks exist', () => {
    expect(classWiseDayHero({})).toEqual({ present: 0, marked: 0, absent: 0, pct: null })
  })
})

describe('classWiseHeroDisplay', () => {
  it('does not treat an in-flight load as unmarked', () => {
    expect(classWiseHeroDisplay({ loading: true, hero: { present: 0, marked: 0, absent: 0, pct: null } })).toEqual({
      pctLabel: 'Loading…',
      presentLabel: '—',
      absentLabel: '—',
      markedLabel: '—',
    })
  })

  it('shows Not marked only after the range request has finished empty', () => {
    expect(classWiseHeroDisplay({ loading: false, hero: { present: 0, marked: 0, absent: 0, pct: null } }).pctLabel)
      .toBe('Not marked')
  })
})
