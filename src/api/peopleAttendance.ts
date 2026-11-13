/* Daily teacher/staff roll-call. `/v1/staff-attendance` is the source of truth;
   in-memory Map is a session read cache populated only after successful fetch/save. */
import { request } from './client'
import { camelToSnake } from './mapper'
import { tokenStore } from './auth/tokenStore'
import { toAttendanceDate, type AttendanceRecord, type AttendanceStatus } from './attendance'

export type PeopleAttGroup = 'teachers' | 'staff'

/** `/v1/staff-attendance` uses the singular form for its `person_type` param. */
function personTypeOf(group: PeopleAttGroup): 'teacher' | 'staff' {
  return group === 'teachers' ? 'teacher' : 'staff'
}

/** `null` for anything that isn't a real mark — a malformed/missing status must
 *  never be silently treated as "present". */
function asStatus(v: unknown): AttendanceStatus | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (s === 'late' || s === 'absent' || s === 'present' || s === 'half_day' || s === 'leave') return s
  return null
}

const memory = new Map<string, Record<string, AttendanceStatus>>()

function cacheKey(group: PeopleAttGroup, date: string): string {
  const tenant = tokenStore.getTenantId() || 'default'
  return `${tenant}:${group}:${date}`
}

/** Test helper — drop in-memory people-attendance cache. */
export function clearPeopleAttendanceMemory(): void {
  memory.clear()
}

/**
 * GET a day's marks from the backend. Fail-closed: throws on any error
 * (including 404/405). Callers must not fall back to browser storage.
 */
export async function fetchRemotePeopleAttendance(
  group: PeopleAttGroup,
  date: string,
): Promise<Record<string, AttendanceStatus>> {
  const rows = await request<Record<string, unknown>[] | null>('/staff-attendance', {
    query: { person_type: personTypeOf(group), date },
  })
  const out: Record<string, AttendanceStatus> = {}
  for (const row of rows ?? []) {
    const id = row.person_id != null ? String(row.person_id) : ''
    const status = asStatus(row.status)
    if (id && status) out[id] = status
  }
  cachePeopleAttendance(group, date, out)
  return out
}

/**
 * Persist a day's marks to `/staff-attendance`, then reload from GET (SQL).
 * Throws on API failure — callers must not toast success unless this resolves.
 * Emits {@link PEOPLE_ATTENDANCE_CHANGED} once after the confirmed GET (never on GET-only).
 */
export async function savePeopleAttendanceRemote(
  group: PeopleAttGroup,
  date: string,
  marks: Record<string, AttendanceStatus>,
): Promise<Record<string, AttendanceStatus>> {
  const records = Object.entries(marks).map(([personId, status]) => ({ personId, status }))
  if (!records.length) throw new Error('No people to save')
  await request<unknown>('/staff-attendance', {
    method: 'POST',
    body: camelToSnake({ personType: personTypeOf(group), date, records }),
  })
  const fresh = await fetchRemotePeopleAttendance(group, date)
  emitPeopleAttendanceChanged(group, date)
  return fresh
}

/** @deprecated Use {@link savePeopleAttendanceRemote}. POST-only; throws on failure. */
export async function pushPeopleAttendance(
  group: PeopleAttGroup,
  date: string,
  marks: Record<string, AttendanceStatus>,
): Promise<void> {
  await savePeopleAttendanceRemote(group, date, marks)
}

/** Read marks from the in-memory session cache (empty if never fetched/saved this session). */
export function loadPeopleAttendance(group: PeopleAttGroup, date: string): Record<string, AttendanceStatus> {
  return memory.get(cacheKey(group, date)) ?? {}
}

/** All in-memory roll-call marks for a group (session cache only — not browser SoT). */
export function listCachedPeopleAttendance(group: PeopleAttGroup): AttendanceRecord[] {
  const out: AttendanceRecord[] = []
  const tenant = tokenStore.getTenantId() || 'default'
  const prefix = `${tenant}:${group}:`
  for (const [key, marks] of memory) {
    if (!key.startsWith(prefix)) continue
    const date = key.slice(prefix.length)
    for (const [id, status] of Object.entries(marks)) {
      out.push({ id: `${group}-${id}-${date}`, classId: '', studentId: id, date, status })
    }
  }
  return out
}

/** @deprecated Use {@link listCachedPeopleAttendance}. */
export const listAllLocalPeopleAttendance = listCachedPeopleAttendance

export const PEOPLE_ATTENDANCE_CHANGED = 'sms:people-attendance-changed'

function emitPeopleAttendanceChanged(group: PeopleAttGroup, date: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(PEOPLE_ATTENDANCE_CHANGED, { detail: { group, date } }))
}

/** Update the in-memory read cache only (not an authoritative save). Does not emit. */
export function cachePeopleAttendance(
  group: PeopleAttGroup,
  date: string,
  marks: Record<string, AttendanceStatus>,
): void {
  memory.set(cacheKey(group, date), { ...marks })
}

/** @deprecated Removed — local-only writes are not allowed. Use {@link savePeopleAttendanceRemote}. */
export function savePeopleAttendance(
  _group: PeopleAttGroup,
  _date: string,
  _marks: Record<string, AttendanceStatus>,
): never {
  throw new Error('savePeopleAttendance requires the API; use savePeopleAttendanceRemote')
}

export function isPeoplePresent(status: AttendanceStatus | undefined): boolean {
  return status === 'present' || status === 'late' || status === 'half_day'
}

export function isPeopleHalfDay(status: AttendanceStatus | undefined): boolean {
  return status === 'half_day'
}

/**
 * Persist only admin CRM marks (prior saved + current draft).
 * App check-in/out stays on punches — never copied into staff-attendance.
 */
export function collectPeopleMarksToSave(
  roster: { id: string; name: string }[],
  saved: Record<string, AttendanceStatus>,
  draft: Record<string, AttendanceStatus>,
  _opts: EffectiveStatusOpts = {},
): Record<string, AttendanceStatus> {
  const out: Record<string, AttendanceStatus> = {}
  for (const person of roster) {
    const status = draft[person.id] ?? saved[person.id]
    if (status) out[person.id] = status
  }
  return out
}

/** Count present/late marks for the given person ids (manual CRM roll-call). */
export function countMarkedPresent(
  marks: Record<string, AttendanceStatus>,
  ids: string[],
): number {
  return ids.reduce((n, id) => n + (isPeoplePresent(marks[id]) ? 1 : 0), 0)
}

export interface CheckInInfo {
  checkedIn: boolean
  at?: string | null
  checkOutAt?: string | null
}

/** Normalize person id/name keys for punch lookup maps. */
export function normalizePersonKey(value: string): string {
  return value.trim().toLowerCase().replace(/[{}]/g, '')
}

export function lookupStaffCheckIn(
  checkIn: Map<string, CheckInInfo>,
  person: { id: string; name: string },
): CheckInInfo | undefined {
  return checkIn.get(normalizePersonKey(person.id))
    ?? checkIn.get(person.id)
    ?? checkIn.get(normalizePersonKey(person.name))
}

export interface EffectiveStatusOpts {
  /** Teacher-app check-ins keyed by teacherId AND lowercased name. */
  checkIn?: Map<string, CheckInInfo>
  /** True once the principal/teacher-app feed has loaded for this date. */
  principalKnown?: boolean
}

/**
 * Resolve a person's status for a day. One source of truth shared by the
 * Attendance roster, the summary cards, and the Dashboard so they never disagree.
 * Priority: explicit CRM mark → teacher-app check-in → roll-call default.
 * Staff have no app check-in feed, so they default to absent until CRM marks them present;
 * teachers with no check-in feed loaded yet default to present (unknown, not yet contradicted).
 */
export function effectivePeopleStatus(
  group: PeopleAttGroup,
  person: { id: string; name: string },
  marks: Record<string, AttendanceStatus>,
  opts: EffectiveStatusOpts = {},
): AttendanceStatus {
  return explicitPeopleStatus(person, marks, opts) ?? (group === 'staff' ? 'absent' : 'present')
}

/**
 * Same resolution as {@link effectivePeopleStatus} but returns `null` instead
 * of the unknown roll-call default when nobody has actually marked this person
 * yet (no CRM mark, no app check-in). Use this to decide what gets *persisted*
 * on submit — the roll-call default is a display placeholder only and must
 * never be written as if it were a real mark.
 */
export function explicitPeopleStatus(
  person: { id: string; name: string },
  marks: Record<string, AttendanceStatus>,
  opts: EffectiveStatusOpts = {},
): AttendanceStatus | null {
  const mark = marks[person.id]
  if (mark) return mark
  if (opts.checkIn) {
    const hit = lookupStaffCheckIn(opts.checkIn, person)
    if (hit?.checkedIn || hit?.at) return 'present'
    if (opts.principalKnown && hit && !hit.checkedIn && !hit.at) return 'absent'
  }
  return null
}

/** Count present/late people from explicit marks/check-ins only — unmarked people never count as present. */
export function countPeoplePresent(
  people: { id: string; name: string }[],
  marks: Record<string, AttendanceStatus>,
  opts: EffectiveStatusOpts = {},
): number {
  return people.reduce(
    (n, p) => n + (isPeoplePresent(explicitPeopleStatus(p, marks, opts) ?? undefined) ? 1 : 0),
    0,
  )
}

function mapStaffAttendanceRows(
  group: PeopleAttGroup,
  rows: Record<string, unknown>[] | null,
  fallbackPersonId = '',
): AttendanceRecord[] {
  const out: AttendanceRecord[] = []
  for (const row of rows ?? []) {
    const id = row.person_id != null ? String(row.person_id) : fallbackPersonId
    const status = asStatus(row.status)
    const date = row.date != null ? toAttendanceDate(String(row.date)) : ''
    if (!id || !status || !date) continue
    out.push({
      id: row.id != null ? String(row.id) : `${group}-${id}-${date}`,
      classId: '',
      studentId: id,
      date,
      status,
      markedBy: row.marked_by != null ? String(row.marked_by) : null,
    })
  }
  return out
}

/** GET one person's staff-attendance history from SQL (no browser SoT). */
export async function listPersonAttendanceHistory(
  group: PeopleAttGroup,
  personId: string,
  from: string,
  to: string,
): Promise<AttendanceRecord[]> {
  const rows = await request<Record<string, unknown>[] | null>(`/staff-attendance/${personId}`, {
    query: { person_type: personTypeOf(group), from, to },
  })
  return mapStaffAttendanceRows(group, rows, personId)
}

/** GET every teacher or staff mark in a date range from SQL (one request, no browser SoT). */
export async function listPeopleAttendanceRange(
  group: PeopleAttGroup,
  from: string,
  to: string,
): Promise<AttendanceRecord[]> {
  const rows = await request<Record<string, unknown>[] | null>('/staff-attendance', {
    query: { person_type: personTypeOf(group), from: toAttendanceDate(from), to: toAttendanceDate(to) },
  })
  return mapStaffAttendanceRows(group, rows)
}

/**
 * Official attendance percent per person from roll-call marks.
 * Present, late, and half day count as attended. Leave and absent stay in the
 * marked total. Days with no mark are left out. Empty when nobody was marked.
 */
export function attendancePctByPerson(
  rows: Pick<AttendanceRecord, 'studentId' | 'status'>[],
): Map<string, number> {
  const by = new Map<string, { marked: number; attended: number }>()
  for (const row of rows) {
    if (!row.studentId) continue
    const key = row.studentId.toLowerCase()
    const cur = by.get(key) ?? { marked: 0, attended: 0 }
    cur.marked += 1
    if (row.status === 'present' || row.status === 'late' || row.status === 'half_day') cur.attended += 1
    by.set(key, cur)
  }
  const out = new Map<string, number>()
  for (const [id, counts] of by) {
    if (counts.marked > 0) out.set(id, Math.round((counts.attended / counts.marked) * 100))
  }
  return out
}

/**
 * One status per person per day. A roll-call mark wins. A teacher-app check-in
 * fills a day that was never marked, and counts as present — same idea as the
 * student list, which only counts days that were actually recorded.
 */
function dayBuckets(
  marks: Pick<AttendanceRecord, 'studentId' | 'date' | 'status'>[],
  checkIns: { personId: string; dates: string[] }[],
): Map<string, Map<string, AttendanceStatus>> {
  const days = new Map<string, Map<string, AttendanceStatus>>()
  const slot = (id: string) => {
    const key = id.toLowerCase()
    let bucket = days.get(key)
    if (!bucket) {
      bucket = new Map()
      days.set(key, bucket)
    }
    return bucket
  }
  for (const row of marks) {
    if (!row.studentId || !row.date) continue
    slot(row.studentId).set(row.date, row.status)
  }
  for (const person of checkIns) {
    const bucket = slot(person.personId)
    for (const date of person.dates) {
      if (date && !bucket.has(date)) bucket.set(date, 'present')
    }
  }
  return days
}

function pctInWindow(
  days: Map<string, Map<string, AttendanceStatus>>,
  from?: string,
  to?: string,
): Map<string, number> {
  const rows: Pick<AttendanceRecord, 'studentId' | 'status'>[] = []
  for (const [id, byDate] of days) {
    for (const [date, status] of byDate) {
      if (from && date < from) continue
      if (to && date > to) continue
      rows.push({ studentId: id, status })
    }
  }
  return attendancePctByPerson(rows)
}

export function mergeAttendanceDays(
  marks: Pick<AttendanceRecord, 'studentId' | 'date' | 'status'>[],
  checkIns: { personId: string; dates: string[] }[],
): Map<string, number> {
  return pctInWindow(dayBuckets(marks, checkIns))
}

/** This calendar month and the whole loaded span, from the same marks. */
export function attendanceSpans(
  marks: Pick<AttendanceRecord, 'studentId' | 'date' | 'status'>[],
  checkIns: { personId: string; dates: string[] }[],
  monthFrom: string,
  monthTo: string,
): { month: Map<string, number>; overall: Map<string, number> } {
  const days = dayBuckets(marks, checkIns)
  return {
    month: pctInWindow(days, monthFrom, monthTo),
    overall: pctInWindow(days),
  }
}

async function checkInDates(personId: string): Promise<string[]> {
  try {
    const rows = await request<Record<string, unknown>[] | null>(
      `/principal/staff/${personId}/attendance/history`,
      { query: { limit: 366, offset_minutes: -new Date().getTimezoneOffset() } },
    )
    const dates: string[] = []
    for (const row of rows ?? []) {
      const checkIn = row.check_in ?? row.checkIn
      const date = row.date != null ? toAttendanceDate(String(row.date)) : ''
      if (checkIn && date) dates.push(date)
    }
    return dates
  } catch {
    return []
  }
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (!items.length) return
  let next = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await fn(item)
    }
  })
  await Promise.all(workers)
}

/** Roll-call marks plus app check-ins for the roster. Keys are lowercase ids. */
export async function rosterAttendancePct(
  group: PeopleAttGroup,
  personIds: string[],
  from: string,
  to: string,
): Promise<Map<string, number>> {
  let marks: AttendanceRecord[] = []
  try {
    marks = await listPeopleAttendanceRange(group, from, to)
  } catch {
    marks = []
  }
  const lo = toAttendanceDate(from)
  const hi = toAttendanceDate(to)
  const checkIns: { personId: string; dates: string[] }[] = []
  await mapPool(personIds.filter(Boolean), 6, async (personId) => {
    const dates = (await checkInDates(personId)).filter((d) => d >= lo && d <= hi)
    checkIns.push({ personId, dates })
  })
  return mergeAttendanceDays(marks, checkIns)
}

export function calendarMonthToDate(now = new Date()): { from: string; to: string } {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${d}` }
}

/** Month and session percents from one roll-call plus check-in load. */
export async function rosterAttendanceSpans(
  group: PeopleAttGroup,
  personIds: string[],
  from: string,
  to: string,
): Promise<{ month: Map<string, number>; overall: Map<string, number> }> {
  let marks: AttendanceRecord[] = []
  try {
    marks = await listPeopleAttendanceRange(group, from, to)
  } catch {
    marks = []
  }
  const lo = toAttendanceDate(from)
  const hi = toAttendanceDate(to)
  const checkIns: { personId: string; dates: string[] }[] = []
  await mapPool(personIds.filter(Boolean), 6, async (personId) => {
    const dates = (await checkInDates(personId)).filter((d) => d >= lo && d <= hi)
    checkIns.push({ personId, dates })
  })
  const month = calendarMonthToDate()
  return attendanceSpans(marks, checkIns, month.from, month.to > hi ? hi : month.to)
}

/** Load teacher/staff marks for a date range from SQL, optionally limited to a roster. */
export async function listPeopleAttendanceRegister(
  group: PeopleAttGroup,
  from: string,
  to: string,
  personIds: string[],
): Promise<AttendanceRecord[]> {
  const all = await listPeopleAttendanceRange(group, from, to)
  if (!personIds.length) return all
  const want = new Set(personIds.filter(Boolean))
  return all.filter((r) => want.has(r.studentId))
}
