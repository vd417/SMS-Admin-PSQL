import { request } from './client'
import { snakeToCamel, camelToSnake } from './mapper'
import { tokenStore } from './auth/tokenStore'

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'half_day'

export interface AttendanceMark {
  studentId: string
  status: AttendanceStatus
}

export interface AttendanceRecord {
  id: string
  tenantId?: string
  classId: string
  studentId: string
  date: string
  status: AttendanceStatus
  markedBy?: string | null
}

export interface AttendanceRollCall {
  date: string
  day: string
  period: number | null
  subject: string | null
  startTime: string | null
  endTime: string | null
  teacherId: string | null
  teacherName: string | null
  classTeacherId: string | null
  classTeacherName: string | null
  canMark: boolean
  reason: string
  marked: boolean
}

/** `null` for anything that isn't a real mark — a malformed/missing status must
 *  never be silently treated as "present". */
function asStatus(v: unknown): AttendanceStatus | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'late' || s === 'absent' || s === 'present' || s === 'half_day') return s
  if (s === 'half-day' || s === 'half day') return 'half_day'
  return null
}

/** `null` when the row has no recognizable status — dropped by the caller rather
 *  than counted as a real "present" mark. */
function toRecord(row: Record<string, unknown>): AttendanceRecord | null {
  const c = snakeToCamel<Record<string, unknown>>(row)
  const status = asStatus(c.status)
  if (!status) return null
  return {
    id: c.id != null ? String(c.id) : '',
    tenantId: c.tenantId != null ? String(c.tenantId) : undefined,
    classId: c.classId != null ? String(c.classId) : '',
    studentId: c.studentId != null ? String(c.studentId) : '',
    date: c.date != null ? String(c.date) : '',
    status,
    markedBy: c.markedBy != null ? String(c.markedBy) : null,
  }
}

/** Normalize to YYYY-MM-DD for API date query/body. */
export function toAttendanceDate(date: string): string {
  const m = String(date).trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : String(date).slice(0, 10)
}

/** Calendar day of a mark in the browser timezone (ISO `…Z` midnight can shift the prefix). */
export function attendanceCalendarDate(raw: string): string {
  const s = String(raw).trim()
  if (!s) return s
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) return s.slice(0, 10)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return toAttendanceDate(s)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* ---------- session memory cache (after successful API only — never browser SoT) ---------- */

const memory = new Map<string, AttendanceRecord[]>()

function dayKey(classId: string, day: string): string {
  const tenant = tokenStore.getTenantId() || 'default'
  return `${tenant}:${classId}:${day}`
}

/** Test helper — drop in-memory student-attendance cache. */
export function clearAttendanceMemory(): void {
  memory.clear()
}

function cacheDay(classId: string, day: string, rows: AttendanceRecord[]): void {
  memory.set(dayKey(classId, day), rows.map((r) => ({ ...r })))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ATTENDANCE_CHANGED, { detail: { classId, day } }))
  }
}

export const ATTENDANCE_CHANGED = 'sms:attendance-changed'

/** Fired after a class period save so overview / trend / live KPIs refresh together. */
export const ATTENDANCE_SAVED_EVENT = 'sms-attendance-saved'

/** Session cache for one class+day (empty if never fetched/saved this session). */
export function listCachedAttendanceDay(classId: string, date: string): AttendanceRecord[] {
  return memory.get(dayKey(classId, toAttendanceDate(date))) ?? []
}

/** Every in-memory student attendance mark for the current tenant (session only). */
export function listCachedAttendance(): AttendanceRecord[] {
  const tenant = tokenStore.getTenantId() || 'default'
  const prefix = `${tenant}:`
  const out: AttendanceRecord[] = []
  for (const [key, rows] of memory) {
    if (!key.startsWith(prefix)) continue
    out.push(...rows)
  }
  return out
}

/** @deprecated Use {@link listCachedAttendance}. */
export const listAllLocalAttendance = listCachedAttendance

/** In-memory marks for a class within a date range (inclusive). */
export function listCachedAttendanceRange(
  classId: string,
  from: string,
  to: string,
): AttendanceRecord[] {
  const lo = toAttendanceDate(from)
  const hi = toAttendanceDate(to)
  return listCachedAttendance().filter((r) => {
    if (r.classId !== classId) return false
    const d = toAttendanceDate(r.date)
    return d >= lo && d <= hi
  })
}

/** @deprecated Use {@link listCachedAttendanceRange}. */
export const listLocalAttendanceRange = listCachedAttendanceRange

/** In-memory marks for a student within a date range. */
export function listCachedAttendanceForStudent(
  studentId: string,
  from: string,
  to: string,
): AttendanceRecord[] {
  const lo = toAttendanceDate(from)
  const hi = toAttendanceDate(to)
  return listCachedAttendance().filter((r) => {
    if (r.studentId !== studentId) return false
    const d = toAttendanceDate(r.date)
    return d >= lo && d <= hi
  })
}

/** @deprecated Use {@link listCachedAttendanceForStudent}. */
export const listLocalAttendanceForStudent = listCachedAttendanceForStudent

/**
 * GET a class day's marks from the backend. Fail-closed: throws on any error
 * (including 404/405). Callers must not fall back to browser storage.
 */
export async function listAttendance(classId: string, date: string): Promise<AttendanceRecord[]> {
  const day = toAttendanceDate(date)
  const data = await request<Record<string, unknown>[] | null>(`/classes/${classId}/attendance`, {
    query: { date: day },
  })
  const rows = (data ?? []).map((row) => toRecord(row)).filter((r): r is AttendanceRecord => r != null)
  cacheDay(classId, day, rows)
  return rows
}

/**
 * GET class marks for an inclusive date range. Fail-closed. Populates session
 * memory per day after a successful response.
 */
export async function listClassAttendanceRange(
  classId: string,
  from: string,
  to: string,
): Promise<AttendanceRecord[]> {
  const lo = toAttendanceDate(from)
  const hi = toAttendanceDate(to)
  const data = await request<Record<string, unknown>[] | null>(`/classes/${classId}/attendance`, {
    query: { from: lo, to: hi },
  })
  const rows = (data ?? []).map((row) => toRecord(row)).filter((r): r is AttendanceRecord => r != null)
  const byDay = new Map<string, AttendanceRecord[]>()
  for (const r of rows) {
    const d = toAttendanceDate(r.date)
    const list = byDay.get(d) ?? []
    list.push(r)
    byDay.set(d, list)
  }
  for (const [d, list] of byDay) cacheDay(classId, d, list)
  return rows
}

export async function getAttendanceRollCall(classId: string, date: string): Promise<AttendanceRollCall> {
  const data = await request<Record<string, unknown>>(`/classes/${classId}/attendance/roll-call`, {
    query: { date: toAttendanceDate(date) },
  })
  return snakeToCamel<AttendanceRollCall>(data)
}

export interface ClassDayTimetableSlot {
  id: string
  period: number
  subject: string | null
  subjectId: string | null
  startTime: string | null
  endTime: string | null
  teacherId: string | null
  teacherName: string | null
  isCurrent: boolean
  marked: boolean
  canMark: boolean
}

export interface PeriodAttendanceRecord {
  id: string
  tenantId?: string
  classId: string
  studentId: string
  date: string
  period: number
  periodId?: string | null
  subject: string
  subjectId?: string | null
  status: AttendanceStatus
  markedBy?: string | null
  markedByRole?: string | null
}

function toPeriodRecord(row: Record<string, unknown>): PeriodAttendanceRecord | null {
  const c = snakeToCamel<Record<string, unknown>>(row)
  const status = asStatus(c.status)
  if (!status) return null
  return {
    id: c.id != null ? String(c.id) : '',
    tenantId: c.tenantId != null ? String(c.tenantId) : undefined,
    classId: c.classId != null ? String(c.classId) : '',
    studentId: c.studentId != null ? String(c.studentId) : '',
    date: c.date != null ? String(c.date) : '',
    period: Number(c.period) || 0,
    periodId: c.periodId != null ? String(c.periodId) : null,
    subject: c.subject != null ? String(c.subject) : '',
    subjectId: c.subjectId != null ? String(c.subjectId) : null,
    status,
    markedBy: c.markedBy != null ? String(c.markedBy) : null,
    markedByRole: c.markedByRole != null ? String(c.markedByRole) : null,
  }
}

function toDaySlot(row: Record<string, unknown>): ClassDayTimetableSlot {
  const c = snakeToCamel<Record<string, unknown>>(row)
  return {
    id: c.id != null ? String(c.id) : '',
    period: Number(c.period) || 0,
    subject: c.subject != null ? String(c.subject) : null,
    subjectId: c.subjectId != null ? String(c.subjectId) : null,
    startTime: c.startTime != null ? String(c.startTime) : null,
    endTime: c.endTime != null ? String(c.endTime) : null,
    teacherId: c.teacherId != null ? String(c.teacherId) : null,
    teacherName: c.teacherName != null ? String(c.teacherName) : null,
    isCurrent: Boolean(c.isCurrent),
    marked: Boolean(c.marked),
    canMark: Boolean(c.canMark),
  }
}

/** GET teaching periods for a class on a calendar day (from SaaS timetable). */
export async function listClassDayTimetable(
  classId: string,
  date: string,
): Promise<ClassDayTimetableSlot[]> {
  const data = await request<Record<string, unknown>[] | null>(`/classes/${classId}/timetable/day`, {
    query: { date: toAttendanceDate(date) },
  })
  return (data ?? []).map((row) => toDaySlot(row))
}

/** GET period attendance marks for one class+date+period+subject. Fail-closed. */
export async function listPeriodAttendance(
  classId: string,
  args: { date: string; period: number; subject: string },
): Promise<PeriodAttendanceRecord[]> {
  const day = toAttendanceDate(args.date)
  const data = await request<Record<string, unknown>[] | null>(`/classes/${classId}/attendance/periods`, {
    query: {
      date: day,
      period: args.period,
      subject: args.subject,
    },
  })
  return (data ?? [])
    .map((row) => toPeriodRecord(row))
    .filter((r): r is PeriodAttendanceRecord => r != null)
}

/** POST upsert period attendance. Fail-closed — no browser SoT. */
export async function savePeriodAttendance(
  classId: string,
  args: {
    date: string
    period: number
    subject: string
    subjectId?: string | null
    periodId?: string | null
    records: AttendanceMark[]
  },
): Promise<void> {
  const day = toAttendanceDate(args.date)
  const records = args.records
    .filter((r) => r.studentId)
    .map((r) => ({ studentId: r.studentId, status: r.status }))
  if (!records.length) throw new Error('No students to save')
  await request<unknown>(`/classes/${classId}/attendance/periods`, {
    method: 'POST',
    body: camelToSnake({
      date: day,
      period: args.period,
      subject: args.subject,
      subjectId: args.subjectId ?? null,
      periodId: args.periodId ?? null,
      records,
    }),
  })
  await listPeriodAttendance(classId, { date: day, period: args.period, subject: args.subject })
}

export async function saveAttendance(
  classId: string,
  args: { date: string; records: AttendanceMark[] },
): Promise<void> {
  const day = toAttendanceDate(args.date)
  const records = args.records
    .filter((r) => r.studentId)
    .map((r) => ({ studentId: r.studentId, status: r.status }))
  if (!records.length) throw new Error('No students to save')
  await request<unknown>(`/classes/${classId}/attendance`, {
    method: 'POST',
    body: camelToSnake({ date: day, records }),
  })
  await listAttendance(classId, day)
}

/** Run async work over items with a fixed concurrency (avoids saturating the API). */
export async function mapPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (!items.length) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let next = 0
  const workers = Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  })
  await Promise.all(workers)
}
