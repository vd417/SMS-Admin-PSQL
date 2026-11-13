/* Student monthly attendance — API/SQL only (no browser SoT). */
import { request } from './client'
import { ApiError } from './ApiError'
import { listAttendance, listClassAttendanceRange, toAttendanceDate, type AttendanceRecord, type AttendanceStatus } from './attendance'
import type { MonthValue } from '@/types'

function isMissingEndpoint(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405)
}

/** `null` for anything that isn't a real mark — a malformed/missing status must
 *  never be silently treated as "present". */
function asStatus(v: unknown): AttendanceStatus | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (s === 'late' || s === 'absent' || s === 'present') return s
  return null
}

/** `null` when the row has no recognizable status — dropped by the caller. */
function toRecord(row: Record<string, unknown>): AttendanceRecord | null {
  const status = asStatus(row.status)
  if (!status) return null
  return {
    id: row.id != null ? String(row.id) : '',
    tenantId: row.tenant_id != null ? String(row.tenant_id) : row.tenantId != null ? String(row.tenantId) : undefined,
    classId: row.class_id != null ? String(row.class_id) : row.classId != null ? String(row.classId) : '',
    studentId: row.student_id != null ? String(row.student_id) : row.studentId != null ? String(row.studentId) : '',
    date: row.date != null ? String(row.date) : '',
    status,
    markedBy: row.marked_by != null ? String(row.marked_by) : row.markedBy != null ? String(row.markedBy) : null,
  }
}

function localDateIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Weekdays (Mon–Fri) from `from` through `to` inclusive (YYYY-MM-DD). */
export function weekdaysBetween(from: string, to: string): string[] {
  const start = new Date(`${toAttendanceDate(from)}T12:00:00`)
  const end = new Date(`${toAttendanceDate(to)}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
  const out: string[] = []
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow === 0 || dow === 6) continue
    out.push(localDateIso(d))
  }
  return out
}

function monthKey(dateRaw: string): string {
  const iso = toAttendanceDate(dateRaw)
  return iso.slice(0, 7) // YYYY-MM
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Present+late count as attended for %. */
function isAttended(status: AttendanceStatus): boolean {
  return status === 'present' || status === 'late'
}

/** A month bar enriched with its YYYY-MM key + raw counts (for drill-down). */
export interface MonthAttendance extends MonthValue {
  key: string
  present: number
  total: number
}

/** One student's day mark (for the daily drill-down under a month). */
export interface DayAttendance {
  date: string // YYYY-MM-DD
  status: AttendanceStatus
}

/** Roll up one student's day marks into keyed month bars (only months with marks). */
export function monthlyBreakdown(
  records: AttendanceRecord[],
  studentId: string,
): MonthAttendance[] {
  const byMonth = new Map<string, { attended: number; total: number }>()
  for (const r of records) {
    if (r.studentId !== studentId) continue
    const key = monthKey(r.date)
    if (!/^\d{4}-\d{2}$/.test(key)) continue
    const cur = byMonth.get(key) ?? { attended: 0, total: 0 }
    cur.total += 1
    if (isAttended(r.status)) cur.attended += 1
    byMonth.set(key, cur)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, v]) => {
      const monthIdx = Number(ym.slice(5, 7)) - 1
      return {
        key: ym,
        label: MONTH_LABELS[monthIdx] ?? ym,
        value: v.total ? Math.round((v.attended / v.total) * 100) : 0,
        present: v.attended,
        total: v.total,
      }
    })
}

/** Roll up one student's day marks into month % bars (only months with marks). */
export function rollupMonthlyAttendance(
  records: AttendanceRecord[],
  studentId: string,
): MonthValue[] {
  return monthlyBreakdown(records, studentId).map(({ label, value }) => ({ label, value }))
}

function shiftMonth(end: Date, delta: number): string {
  const d = new Date(end.getFullYear(), end.getMonth() + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function blankMonth(key: string): MonthAttendance {
  const monthIdx = Number(key.slice(5, 7)) - 1
  return { key, label: MONTH_LABELS[monthIdx] ?? key, value: 0, present: 0, total: 0 }
}

/** Start calendar year of the Indian academic session (April–March) for a date. */
export function academicYearStart(ref: Date = new Date()): number {
  return ref.getMonth() >= 3 ? ref.getFullYear() : ref.getFullYear() - 1
}

/** The 12 month keys (Apr → next Mar) for the academic session starting `startYear`. */
export function academicYearMonthKeys(startYear: number): string[] {
  const keys: string[] = []
  for (let m = 4; m <= 12; m++) keys.push(`${startYear}-${String(m).padStart(2, '0')}`)
  for (let m = 1; m <= 3; m++) keys.push(`${startYear + 1}-${String(m).padStart(2, '0')}`)
  return keys
}

/** Fill an explicit list of YYYY-MM keys with a student's marks (blank where none). */
export function monthlySeriesForKeys(
  records: AttendanceRecord[],
  studentId: string,
  keys: string[],
): MonthAttendance[] {
  const byKey = new Map(monthlyBreakdown(records, studentId).map((m) => [m.key, m]))
  return keys.map((key) => byKey.get(key) ?? blankMonth(key))
}

/**
 * Continuous month axis for the bar chart: every month from `monthsBack` before
 * `end` through `monthsForward` after it. Months with no marks are returned with
 * total = 0 (render them blank); months with marks carry their real %.
 */
export function monthlySeries(
  records: AttendanceRecord[],
  studentId: string,
  opts: { monthsBack?: number; monthsForward?: number; end?: Date } = {},
): MonthAttendance[] {
  const monthsBack = opts.monthsBack ?? 5
  const monthsForward = opts.monthsForward ?? 1
  const end = opts.end ?? new Date()
  const keys: string[] = []
  for (let delta = -monthsBack; delta <= monthsForward; delta++) keys.push(shiftMonth(end, delta))
  return monthlySeriesForKeys(records, studentId, keys)
}

/** Daily marks for one student within a given YYYY-MM, sorted ascending. */
export function dailyMarksForMonth(
  records: AttendanceRecord[],
  studentId: string,
  ym: string,
): DayAttendance[] {
  return records
    .filter((r) => r.studentId === studentId && monthKey(r.date) === ym)
    .map((r) => ({ date: toAttendanceDate(r.date), status: r.status }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** One cell in the full-month grid — status is null when no mark was recorded. */
export interface DayCell {
  date: string // YYYY-MM-DD
  status: AttendanceStatus | null
  weekend: boolean
}

/**
 * Every calendar day of a month for one student. Days with a recorded mark
 * carry the status; unmarked days are returned with status = null (shown blank).
 */
export function monthDailyGrid(
  records: AttendanceRecord[],
  studentId: string,
  ym: string,
): DayCell[] {
  if (!/^\d{4}-\d{2}$/.test(ym)) return []
  const marks = new Map(dailyMarksForMonth(records, studentId, ym).map((d) => [d.date, d.status]))
  const [y, m] = ym.split('-').map(Number)
  const count = new Date(y, m, 0).getDate() // last day of month
  const out: DayCell[] = []
  for (let i = 1; i <= count; i++) {
    const date = `${ym}-${String(i).padStart(2, '0')}`
    const dow = new Date(`${date}T12:00:00`).getDay()
    out.push({ date, status: marks.get(date) ?? null, weekend: dow === 0 || dow === 6 })
  }
  return out
}

async function tryStudentAttendanceApi(
  studentId: string,
  from: string,
  to: string,
): Promise<AttendanceRecord[] | null> {
  try {
    const data = await request<Record<string, unknown>[] | null>(`/students/${studentId}/attendance`, {
      query: { from, to },
    })
    return (data ?? []).map((row) => toRecord(row)).filter((r): r is AttendanceRecord => r != null)
  } catch (err) {
    if (isMissingEndpoint(err)) return null
    throw err
  }
}

async function tryClassRangeAttendanceApi(
  classId: string,
  from: string,
  to: string,
): Promise<AttendanceRecord[] | null> {
  try {
    return await listClassAttendanceRange(classId, from, to)
  } catch (err) {
    if (isMissingEndpoint(err)) return null
    throw err
  }
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return out
}

/** Load real day marks for a student (range APIs first, else weekday day-scan). */
export async function listStudentAttendanceHistory(
  studentId: string,
  classId: string | null | undefined,
  opts: { from?: string; to?: string } = {},
): Promise<AttendanceRecord[]> {
  const to = opts.to || localDateIso(new Date())
  const fromDefault = new Date(`${to}T12:00:00`)
  fromDefault.setDate(fromDefault.getDate() - 120) /* ~4 months of weekdays */
  const from = opts.from || localDateIso(fromDefault)

  const studentRows = await tryStudentAttendanceApi(studentId, from, to)
  if (studentRows !== null) {
    return studentRows
      .filter((r) => r.studentId === studentId || !r.studentId)
      .map((r) => ({ ...r, studentId: r.studentId || studentId }))
  }

  if (!classId) return []

  const classRange = await tryClassRangeAttendanceApi(classId, from, to)
  if (classRange !== null) {
    return classRange.filter((r) => r.studentId === studentId)
  }

  /* Student + class-range endpoints missing → weekday day-scan via class API. */
  const days = weekdaysBetween(from, to)
  const batches = await mapPool(days, 6, async (day) => {
    try {
      const rows = await listAttendance(classId, day)
      return rows.filter((r) => r.studentId === studentId)
    } catch (err) {
      if (isMissingEndpoint(err)) return [] as AttendanceRecord[]
      throw err
    }
  })
  return batches.flat()
}

export function monthlyAttendanceFromHistory(
  records: AttendanceRecord[],
  studentId: string,
): MonthValue[] {
  return rollupMonthlyAttendance(records, studentId)
}

/** Official period attendance summary from SaaS API (same formula for all apps). */
export interface PeriodAttendanceSummary {
  totalMarkedPeriods: number
  presentPeriods: number
  latePeriods: number
  absentPeriods: number
  leavePeriods: number
  /** null when unmarked — do not display as 0%. */
  attendancePercentage: number | null
  /** UI-only day badge; never use as official %. */
  presentTodayBadge: boolean | null
}

export async function getStudentAttendanceSummary(
  studentId: string,
  from?: string,
  to?: string,
): Promise<PeriodAttendanceSummary> {
  const query: Record<string, string> = {}
  if (from) query.from = from
  if (to) query.to = to
  const wire = await request<Record<string, unknown>>(
    `/students/${encodeURIComponent(studentId)}/attendance/summary`,
    { query },
  )
  const pct = wire.attendance_percentage ?? wire.attendancePercentage
  const badge = wire.present_today_badge ?? wire.presentTodayBadge
  return {
    totalMarkedPeriods: Number(wire.total_marked_periods ?? wire.totalMarkedPeriods ?? 0),
    presentPeriods: Number(wire.present_periods ?? wire.presentPeriods ?? 0),
    latePeriods: Number(wire.late_periods ?? wire.latePeriods ?? 0),
    absentPeriods: Number(wire.absent_periods ?? wire.absentPeriods ?? 0),
    leavePeriods: Number(wire.leave_periods ?? wire.leavePeriods ?? 0),
    attendancePercentage: pct == null || pct === '' ? null : Number(pct),
    presentTodayBadge: badge == null || badge === '' ? null : Boolean(badge),
  }
}

/** This month's official period % for each student. Missing or unmarked ids are left out. */
export async function studentMonthAttendancePct(
  studentIds: string[],
  from: string,
  to: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  await mapPool(studentIds.filter(Boolean), 6, async (id) => {
    try {
      const summary = await getStudentAttendanceSummary(id, from, to)
      if (summary.attendancePercentage == null || summary.totalMarkedPeriods <= 0) return
      out.set(id.toLowerCase(), Math.round(summary.attendancePercentage))
    } catch {
      /* one student failing must not blank the rest of the list */
    }
  })
  return out
}

export async function getClassAttendanceSummary(
  classId: string,
  from?: string,
  to?: string,
): Promise<PeriodAttendanceSummary> {
  const query: Record<string, string> = {}
  if (from) query.from = from
  if (to) query.to = to
  const wire = await request<Record<string, unknown>>(
    `/classes/${encodeURIComponent(classId)}/attendance/summary`,
    { query },
  )
  const pct = wire.attendance_percentage ?? wire.attendancePercentage
  const badge = wire.present_today_badge ?? wire.presentTodayBadge
  return {
    totalMarkedPeriods: Number(wire.total_marked_periods ?? wire.totalMarkedPeriods ?? 0),
    presentPeriods: Number(wire.present_periods ?? wire.presentPeriods ?? 0),
    latePeriods: Number(wire.late_periods ?? wire.latePeriods ?? 0),
    absentPeriods: Number(wire.absent_periods ?? wire.absentPeriods ?? 0),
    leavePeriods: Number(wire.leave_periods ?? wire.leavePeriods ?? 0),
    attendancePercentage: pct == null || pct === '' ? null : Number(pct),
    presentTodayBadge: badge == null || badge === '' ? null : Boolean(badge),
  }
}

/**
 * @deprecated Official attendance % comes from GET .../attendance/summary (period marks).
 * Kept for any legacy daily rollups; do not use for official CRM/app percentages.
 */
export function attendancePctByStudent(records: AttendanceRecord[]): Map<string, number> {
  const acc = new Map<string, { attended: number; total: number }>()
  for (const r of records) {
    if (!r.studentId) continue
    const cur = acc.get(r.studentId) ?? { attended: 0, total: 0 }
    cur.total += 1
    if (isAttended(r.status)) cur.attended += 1
    acc.set(r.studentId, cur)
  }
  const out = new Map<string, number>()
  for (const [id, v] of acc) {
    out.set(id, v.total ? Math.round((v.attended / v.total) * 100) : 0)
  }
  return out
}
