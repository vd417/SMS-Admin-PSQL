import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ApiError } from './ApiError'
import {
  loadPeopleAttendance, cachePeopleAttendance, savePeopleAttendance,
  clearPeopleAttendanceMemory, listCachedPeopleAttendance,
  effectivePeopleStatus, countPeoplePresent, type CheckInInfo,
  fetchRemotePeopleAttendance, savePeopleAttendanceRemote, pushPeopleAttendance,
  collectPeopleMarksToSave, listPersonAttendanceHistory, listPeopleAttendanceRange,
  listPeopleAttendanceRegister, PEOPLE_ATTENDANCE_CHANGED,
  attendancePctByPerson, mergeAttendanceDays, attendanceSpans,
} from './peopleAttendance'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function notFound(): Response {
  return jsonResponse({ error: { code: 'not_found', message: 'x' } }, 404)
}

beforeEach(() => {
  clearPeopleAttendanceMemory()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('peopleAttendance cache', () => {
  it('caches and loads marks for a date in memory only', () => {
    cachePeopleAttendance('teachers', '2026-07-16', { t1: 'present', t2: 'absent' })
    expect(loadPeopleAttendance('teachers', '2026-07-16')).toEqual({ t1: 'present', t2: 'absent' })
    expect(loadPeopleAttendance('teachers', '2026-07-15')).toEqual({})
    expect(loadPeopleAttendance('staff', '2026-07-16')).toEqual({})
    expect(localStorage.length).toBe(0)
  })

  it('savePeopleAttendance throws — remote save required', () => {
    expect(() => savePeopleAttendance('staff', '2026-07-16', { s1: 'late' }))
      .toThrow(/savePeopleAttendanceRemote/)
    expect(loadPeopleAttendance('staff', '2026-07-16')).toEqual({})
  })

  it('listCachedPeopleAttendance reads only memory', () => {
    cachePeopleAttendance('teachers', '2026-07-16', { t1: 'present' })
    cachePeopleAttendance('teachers', '2026-07-15', { t2: 'absent' })
    const rows = listCachedPeopleAttendance('teachers')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.date).sort()).toEqual(['2026-07-15', '2026-07-16'])
  })
})

describe('effectivePeopleStatus', () => {
  const p = { id: 't1', name: 'Asha Rao' }

  it('honours an explicit CRM mark above everything else', () => {
    const checkIn = new Map<string, CheckInInfo>([['t1', { checkedIn: true }]])
    expect(effectivePeopleStatus('teachers', p, { t1: 'absent' }, { checkIn, principalKnown: true }))
      .toBe('absent')
  })

  it('keeps admin half-day above a teacher-app check-in', () => {
    const checkIn = new Map<string, CheckInInfo>([['t1', { checkedIn: true }]])
    expect(effectivePeopleStatus('teachers', p, { t1: 'half_day' }, { checkIn, principalKnown: true }))
      .toBe('half_day')
  })

  it('uses teacher-app check-in when no manual mark', () => {
    const checkIn = new Map<string, CheckInInfo>([['t1', { checkedIn: true }]])
    expect(effectivePeopleStatus('teachers', p, {}, { checkIn, principalKnown: true })).toBe('present')
  })

  it('marks a known-but-not-checked-in teacher absent once the feed loaded', () => {
    const checkIn = new Map<string, CheckInInfo>([['t1', { checkedIn: false }]])
    expect(effectivePeopleStatus('teachers', p, {}, { checkIn, principalKnown: true })).toBe('absent')
  })

  it('defaults staff to absent (no app feed) but unknown teachers to present', () => {
    expect(effectivePeopleStatus('staff', { id: 's1', name: 'Ravi' }, {})).toBe('absent')
    expect(effectivePeopleStatus('teachers', p, {}, { principalKnown: false })).toBe('present')
  })

  it('matches teacher-app check-ins by name when id differs', () => {
    const checkIn = new Map<string, CheckInInfo>([['asha rao', { checkedIn: true }]])
    expect(effectivePeopleStatus('teachers', p, {}, { checkIn, principalKnown: true })).toBe('present')
  })
})

describe('countPeoplePresent', () => {
  it('maps half_day from GET /staff-attendance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ person_id: 's1', status: 'half_day' }, { person_id: 's2', status: 'half-day' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const marks = await fetchRemotePeopleAttendance('staff', '2026-08-26')
    expect(marks).toEqual({ s1: 'half_day', s2: 'half_day' })
  })

  it('POSTs half_day without turning it into a check-in', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ person_id: 's1', status: 'half_day' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await savePeopleAttendanceRemote('staff', '2026-08-26', { s1: 'half_day' })
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.records).toEqual([{ person_id: 's1', status: 'half_day' }])
    expect(JSON.stringify(body)).not.toMatch(/check_in|checkIn/)
    expect(loadPeopleAttendance('staff', '2026-08-26')).toEqual({ s1: 'half_day' })
  })

  it('counts present/late across manual marks and check-ins', () => {
    const people = [
      { id: 't1', name: 'A' },
      { id: 't2', name: 'B' },
      { id: 't3', name: 'C' },
    ]
    const checkIn = new Map<string, CheckInInfo>([
      ['t1', { checkedIn: true }],
      ['t2', { checkedIn: false }],
      ['t3', { checkedIn: false }],
    ])
    // t1 checked in (present), t2 not checked in (absent), t3 manually marked late (present)
    const present = countPeoplePresent(people, { t3: 'late' }, { checkIn, principalKnown: true })
    expect(present).toBe(2)
  })

  it('counts admin half-day as on campus', () => {
    const staff = [{ id: 's1', name: 'X' }, { id: 's2', name: 'Y' }]
    expect(countPeoplePresent(staff, { s1: 'half_day', s2: 'absent' })).toBe(1)
  })

  it('counts staff via manual marks; unmarked staff never count as present', () => {
    const staff = [{ id: 's1', name: 'X' }, { id: 's2', name: 'Y' }]
    expect(countPeoplePresent(staff, { s2: 'present' })).toBe(1)
  })
})

describe('fetchRemotePeopleAttendance', () => {
  it('GETs /staff-attendance?person_type=&date= and maps person_id/status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ person_id: 't1', status: 'absent' }, { person_id: 't2', status: 'present' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const marks = await fetchRemotePeopleAttendance('teachers', '2026-07-16')
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/staff-attendance')
    expect(url).toContain('person_type=teacher')
    expect(url).toContain('date=2026-07-16')
    expect(marks).toEqual({ t1: 'absent', t2: 'present' })
    expect(loadPeopleAttendance('teachers', '2026-07-16')).toEqual({ t1: 'absent', t2: 'present' })
  })

  it('does not emit PEOPLE_ATTENDANCE_CHANGED (GET must not retrigger GET)', async () => {
    const hits = vi.fn()
    window.addEventListener(PEOPLE_ATTENDANCE_CHANGED, hits)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    await fetchRemotePeopleAttendance('teachers', '2026-07-16')
    expect(hits).not.toHaveBeenCalled()
    window.removeEventListener(PEOPLE_ATTENDANCE_CHANGED, hits)
  })

  it('throws ApiError (fail-closed) when the endpoint is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(notFound())
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchRemotePeopleAttendance('staff', '2026-07-16')).rejects.toBeInstanceOf(ApiError)
    expect(loadPeopleAttendance('staff', '2026-07-16')).toEqual({})
  })
})

describe('savePeopleAttendanceRemote', () => {
  it('POSTs /staff-attendance then reloads from GET (SQL), never localStorage', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ person_id: 's1', status: 'present' }, { person_id: 's2', status: 'absent' }],
      }))
    vi.stubGlobal('fetch', fetchMock)
    await savePeopleAttendanceRemote('staff', '2026-07-16', { s1: 'present', s2: 'absent' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/staff-attendance')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.person_type).toBe('staff')
    expect(body.date).toBe('2026-07-16')
    expect(body.records).toEqual(
      expect.arrayContaining([{ person_id: 's1', status: 'present' }, { person_id: 's2', status: 'absent' }]),
    )
    expect(String(fetchMock.mock.calls[1][0])).toContain('/staff-attendance')
    expect(String(fetchMock.mock.calls[1][0])).toContain('person_type=staff')
    expect((fetchMock.mock.calls[1][1] as RequestInit).method ?? 'GET').toBe('GET')
    expect(loadPeopleAttendance('staff', '2026-07-16')).toEqual({ s1: 'present', s2: 'absent' })
    expect(localStorage.length).toBe(0)
  })

  it('emits PEOPLE_ATTENDANCE_CHANGED once after POST+GET', async () => {
    const hits = vi.fn()
    window.addEventListener(PEOPLE_ATTENDANCE_CHANGED, hits)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ person_id: 's1', status: 'present' }] }))
    vi.stubGlobal('fetch', fetchMock)
    await savePeopleAttendanceRemote('staff', '2026-07-16', { s1: 'present' })
    expect(hits).toHaveBeenCalledTimes(1)
    window.removeEventListener(PEOPLE_ATTENDANCE_CHANGED, hits)
  })

  it('throws and does not cache when the backend call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(notFound())
    vi.stubGlobal('fetch', fetchMock)
    await expect(savePeopleAttendanceRemote('teachers', '2026-07-16', { t1: 'present' }))
      .rejects.toBeInstanceOf(ApiError)
    expect(loadPeopleAttendance('teachers', '2026-07-16')).toEqual({})
  })

  it('throws when there are no marks', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(savePeopleAttendanceRemote('teachers', '2026-07-16', {})).rejects.toThrow(/No people/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('pushPeopleAttendance', () => {
  it('delegates to savePeopleAttendanceRemote (fail-closed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(notFound()))
    await expect(pushPeopleAttendance('teachers', '2026-07-16', { t1: 'present' }))
      .rejects.toBeInstanceOf(ApiError)
  })
})

describe('collectPeopleMarksToSave', () => {
  it('saves admin draft and prior CRM marks, never punch-inferred present', () => {
    const roster = [
      { id: 's1', name: 'No phone' },
      { id: 's2', name: 'Has app' },
      { id: 's3', name: 'Unmarked' },
    ]
    const checkIn = new Map<string, CheckInInfo>([['s2', { checkedIn: true }]])
    const marks = collectPeopleMarksToSave(
      roster,
      { s1: 'present' },
      { s1: 'half_day' },
      { checkIn, principalKnown: true },
    )
    expect(marks).toEqual({ s1: 'half_day' })
    expect(marks.s2).toBeUndefined()
  })
})

describe('listPersonAttendanceHistory', () => {
  it('GETs /staff-attendance/{id} from SQL for a date range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ id: 'r1', person_id: 's1', date: '2026-08-26', status: 'half_day' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = await listPersonAttendanceHistory('staff', 's1', '2026-08-01', '2026-08-31')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/staff-attendance/s1')
    expect(url).toContain('person_type=staff')
    expect(url).toContain('from=2026-08-01')
    expect(url).toContain('to=2026-08-31')
    expect(rows[0]).toMatchObject({ studentId: 's1', status: 'half_day' })
    expect(localStorage.length).toBe(0)
  })
})

describe('listPeopleAttendanceRange', () => {
  it('GETs /staff-attendance?from&to from SQL in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [
        { id: 'r1', person_id: 't1', date: '2026-08-01T00:00:00', status: 'present' },
        { id: 'r2', person_id: 't2', date: '2026-08-20', status: 'half_day' },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = await listPeopleAttendanceRange('teachers', '2026-08-01', '2026-08-31')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/staff-attendance')
    expect(url).not.toContain('/staff-attendance/t')
    expect(url).toContain('person_type=teacher')
    expect(url).toContain('from=2026-08-01')
    expect(url).toContain('to=2026-08-31')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ studentId: 't1', date: '2026-08-01', status: 'present' })
    expect(localStorage.length).toBe(0)
  })
})

describe('attendancePctByPerson', () => {
  it('counts present, late, and half day over marked days, and ignores unmarked people', () => {
    const pct = attendancePctByPerson([
      { studentId: 't1', status: 'present' },
      { studentId: 't1', status: 'late' },
      { studentId: 't1', status: 'absent' },
      { studentId: 't1', status: 'half_day' },
      { studentId: 't1', status: 'leave' },
      { studentId: 't2', status: 'absent' },
    ])
    expect(pct.get('t1')).toBe(60)
    expect(pct.get('t2')).toBe(0)
    expect(pct.has('t3')).toBe(false)
  })

  it('matches ids ignoring case', () => {
    const pct = attendancePctByPerson([{ studentId: 'T1', status: 'present' }])
    expect(pct.get('t1')).toBe(100)
  })
})

describe('attendanceSpans', () => {
  it('keeps this month separate from the rest of the loaded span', () => {
    const spans = attendanceSpans(
      [
        { studentId: 't1', date: '2026-10-01', status: 'absent' },
        { studentId: 't1', date: '2026-11-02', status: 'present' },
      ],
      [],
      '2026-11-01',
      '2026-11-14',
    )
    expect(spans.month.get('t1')).toBe(100)
    expect(spans.overall.get('t1')).toBe(50)
  })
})

describe('mergeAttendanceDays', () => {
  it('counts an app check-in as present only on a day with no roll-call mark', () => {
    const pct = mergeAttendanceDays(
      [
        { studentId: 'T1', date: '2026-11-01', status: 'absent' },
        { studentId: 'T1', date: '2026-11-02', status: 'present' },
      ],
      [{ personId: 't1', dates: ['2026-11-01', '2026-11-03'] }],
    )
    expect(pct.get('t1')).toBe(67)
  })
})

describe('listPeopleAttendanceRegister', () => {
  it('filters the SQL range to the given roster ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [
        { person_id: 't1', date: '2026-08-01', status: 'present' },
        { person_id: 't2', date: '2026-08-01', status: 'absent' },
      ],
    })))
    const rows = await listPeopleAttendanceRegister('teachers', '2026-08-01', '2026-08-31', ['t2'])
    expect(rows).toHaveLength(1)
    expect(rows[0].studentId).toBe('t2')
  })
})

