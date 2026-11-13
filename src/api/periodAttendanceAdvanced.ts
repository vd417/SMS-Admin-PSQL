/* Advanced period attendance list — CRM read API (fail closed, no browser SoT). */
import { request } from './client'
import { snakeToCamel } from './mapper'
import { attendanceCalendarDate, type AttendanceRecord, type AttendanceStatus } from './attendance'
import type { TrendPoint } from '@/lib/attendanceTrend'

export type PeriodAttendanceAdvancedFilters = {
  preset?: string
  from?: string
  to?: string
  classId?: string
  grade?: string
  section?: string
  subject?: string
  period?: number
  assignedTeacherId?: string
  markedBy?: string
  markedByRole?: string
  status?: string
  q?: string
  page?: number
  pageSize?: number
  geoFenceStatus?: string
}

export type PeriodAttendanceAdvancedRow = {
  id: string
  classId: string
  grade: string
  section: string
  classLabel: string
  studentId: string
  studentName: string
  admissionNo: string
  date: string
  period: number
  periodId?: string | null
  subject: string
  subjectId?: string | null
  startTime?: string | null
  endTime?: string | null
  status: string
  assignedTeacherId?: string | null
  assignedTeacherName?: string | null
  markedBy?: string | null
  markedByName?: string | null
  markedByRole?: string | null
  markedAt?: string | null
  geoFenceStatus: string
  geoDistanceMeters?: number | null
  geoCapturedAt?: string | null
  updatedBy?: string | null
  updatedByName?: string | null
  updatedByRole?: string | null
  updatedAt?: string | null
}

export type PeriodAttendanceAdvancedPage = {
  items: PeriodAttendanceAdvancedRow[]
  totalCount: number
  page: number
  pageSize: number
}

function filterQuery(filters: PeriodAttendanceAdvancedFilters): Record<string, string | number | undefined> {
  return {
    preset: filters.preset,
    from: filters.from,
    to: filters.to,
    classId: filters.classId,
    grade: filters.grade,
    section: filters.section,
    subject: filters.subject,
    period: filters.period,
    assignedTeacherId: filters.assignedTeacherId,
    markedBy: filters.markedBy,
    markedByRole: filters.markedByRole,
    status: filters.status,
    q: filters.q,
    page: filters.page,
    pageSize: filters.pageSize,
    geoFenceStatus: filters.geoFenceStatus,
  }
}

function toRow(raw: Record<string, unknown>): PeriodAttendanceAdvancedRow {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    id: String(row.id ?? ''),
    classId: String(row.classId ?? ''),
    grade: String(row.grade ?? ''),
    section: String(row.section ?? ''),
    classLabel: String(row.classLabel ?? ''),
    studentId: String(row.studentId ?? ''),
    studentName: String(row.studentName ?? ''),
    admissionNo: String(row.admissionNo ?? ''),
    date: String(row.date ?? ''),
    period: Number(row.period) || 0,
    periodId: row.periodId != null ? String(row.periodId) : null,
    subject: String(row.subject ?? ''),
    subjectId: row.subjectId != null ? String(row.subjectId) : null,
    startTime: row.startTime != null ? String(row.startTime) : null,
    endTime: row.endTime != null ? String(row.endTime) : null,
    status: String(row.status ?? ''),
    assignedTeacherId: row.assignedTeacherId != null ? String(row.assignedTeacherId) : null,
    assignedTeacherName: row.assignedTeacherName != null ? String(row.assignedTeacherName) : null,
    markedBy: row.markedBy != null ? String(row.markedBy) : null,
    markedByName: row.markedByName != null ? String(row.markedByName) : null,
    markedByRole: row.markedByRole != null ? String(row.markedByRole) : null,
    markedAt: row.markedAt != null ? String(row.markedAt) : null,
    geoFenceStatus: String(row.geoFenceStatus ?? 'not_required'),
    geoDistanceMeters: row.geoDistanceMeters != null ? Number(row.geoDistanceMeters) : null,
    geoCapturedAt: row.geoCapturedAt != null ? String(row.geoCapturedAt) : null,
    updatedBy: row.updatedBy != null ? String(row.updatedBy) : null,
    updatedByName: row.updatedByName != null ? String(row.updatedByName) : null,
    updatedByRole: row.updatedByRole != null ? String(row.updatedByRole) : null,
    updatedAt: row.updatedAt != null ? String(row.updatedAt) : null,
  }
}

/** Paginated, server-filtered period attendance rows for the Advanced CRM tab. */
export async function listPeriodAttendanceAdvanced(
  filters: PeriodAttendanceAdvancedFilters = {},
): Promise<PeriodAttendanceAdvancedPage> {
  const wire = await request<Record<string, unknown>>('/attendance/period-records', {
    query: filterQuery(filters),
  })
  const page = snakeToCamel<Record<string, unknown>>(wire)
  const itemsRaw = Array.isArray(wire.items)
    ? wire.items as Record<string, unknown>[]
    : Array.isArray(page.items)
      ? page.items as Record<string, unknown>[]
      : []
  return {
    items: itemsRaw.map(toRow),
    totalCount: Number(page.totalCount ?? wire.total_count ?? 0),
    page: Number(page.page ?? wire.page ?? filters.page ?? 1),
    pageSize: Number(page.pageSize ?? wire.page_size ?? filters.pageSize ?? 25),
  }
}

/** Page through SQL period-records for export (no browser SoT). */
export async function listAllPeriodAttendanceRecords(
  filters: PeriodAttendanceAdvancedFilters = {},
): Promise<PeriodAttendanceAdvancedRow[]> {
  const pageSize = Math.min(100, filters.pageSize ?? 100)
  const items: PeriodAttendanceAdvancedRow[] = []
  for (let page = 1; page <= 200; page++) {
    const res = await listPeriodAttendanceAdvanced({ ...filters, page, pageSize })
    items.push(...res.items)
    if (res.items.length === 0 || items.length >= res.totalCount) break
  }
  return items
}

export function asPeriodAttendanceStatus(v: unknown): AttendanceStatus | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/-/g, '_')
  if (s === 'present' || s === 'late' || s === 'absent' || s === 'half_day') return s
  return null
}

function isOnCampusStatus(status: AttendanceStatus): boolean {
  return status === 'present' || status === 'late' || status === 'half_day'
}

/** One AttendanceRecord per period mark (SQL period-records → trend / export). */
export function periodRowsToAttendanceRecords(rows: PeriodAttendanceAdvancedRow[]): AttendanceRecord[] {
  const out: AttendanceRecord[] = []
  for (const r of rows) {
    const status = asPeriodAttendanceStatus(r.status)
    if (!status || !r.studentId) continue
    const date = attendanceCalendarDate(r.date)
    out.push({
      id: r.id || `${r.classId}-${r.studentId}-${date}-P${r.period}`,
      classId: r.classId,
      studentId: r.studentId,
      date,
      status,
      markedBy: r.markedBy ?? null,
    })
  }
  return out
}

/** Collapse periods to one status per student+date for absence streaks: present if any period was attended. */
export function collapsePeriodRowsToDaily(rows: PeriodAttendanceAdvancedRow[]): AttendanceRecord[] {
  const byKey = new Map<string, AttendanceRecord>()
  for (const rec of periodRowsToAttendanceRecords(rows)) {
    const key = `${rec.studentId}|${rec.date}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...rec, id: `${rec.studentId}-${rec.date}` })
      continue
    }
    if (isOnCampusStatus(rec.status) && !isOnCampusStatus(prev.status)) {
      byKey.set(key, { ...prev, status: rec.status })
    }
  }
  return [...byKey.values()]
}

/** Period-mark counts per class for one calendar day (collapsed-card fallback after SQL GET). */
export function periodCountsByClass(
  rows: PeriodAttendanceAdvancedRow[],
  date: string,
): Map<string, { present: number; absent: number; total: number }> {
  const day = attendanceCalendarDate(date)
  const m = new Map<string, { present: number; absent: number; total: number }>()
  for (const r of rows) {
    if (attendanceCalendarDate(r.date) !== day || !r.classId) continue
    const status = asPeriodAttendanceStatus(r.status)
    if (!status) continue
    const cur = m.get(r.classId) ?? { present: 0, absent: 0, total: 0 }
    cur.total += 1
    if (status === 'absent') cur.absent += 1
    else cur.present += 1
    m.set(r.classId, cur)
  }
  return m
}

/** School-wide day hero for Students · class-wise (period marks, not daily AttendanceRecords). */
export function classWiseDayHero(input: {
  range?: AdvRangeRollup | null
  localByClass?: Map<string, { present: number; absent: number; total: number }>
}): { present: number; marked: number; absent: number; pct: number | null } {
  const rangeMarked = input.range?.totalMarkedPeriods ?? 0
  if (rangeMarked > 0 && input.range) {
    const present = (input.range.present ?? 0) + (input.range.late ?? 0)
    const pct = input.range.attendancePercentage != null
      ? Math.round(Number(input.range.attendancePercentage))
      : Math.round((present / rangeMarked) * 100)
    return {
      present,
      marked: rangeMarked,
      absent: (input.range.absent ?? 0) + (input.range.leave ?? 0),
      pct,
    }
  }
  let present = 0
  let marked = 0
  let absent = 0
  for (const c of input.localByClass?.values() ?? []) {
    present += c.present
    absent += c.absent
    marked += c.total
  }
  if (marked > 0) {
    return { present, marked, absent, pct: Math.round((present / marked) * 100) }
  }
  return { present: 0, marked: 0, absent: 0, pct: null }
}

export type ClassStudentAttendanceTier = 'excellent' | 'good' | 'watch' | 'critical'

/** `subject` is whatever was recorded on the mark at the time (a later timetable edit never
 *  retroactively changes it — the backend stores it as a column, not a live timetable join).
 *  `date`/`period` are included so a caller can additionally resolve the *current* published
 *  timetable's subject for this slot, if that's what the UI wants to show instead/alongside. */
export type ClassStudentRecentPeriod = {
  status: AttendanceStatus
  subject: string
  date: string
  period: number
}

export type ClassStudentSummaryRow = {
  studentId: string
  studentName: string
  present: number
  absent: number
  late: number
  attendancePercentage: number | null
  /** Every marked period in the range, chronological. Day columns read this so a day with more than six periods still shows the earliest subjects. */
  periods: ClassStudentRecentPeriod[]
  /** Chronological, most recent last, capped to CLASS_STUDENT_RECENT_PERIODS. */
  recentPeriods: ClassStudentRecentPeriod[]
  tier: ClassStudentAttendanceTier
}

const CLASS_STUDENT_RECENT_PERIODS = 6

function classStudentTier(pct: number | null): ClassStudentAttendanceTier {
  if (pct == null) return 'critical'
  if (pct >= 98) return 'excellent'
  if (pct >= 85) return 'good'
  if (pct >= 75) return 'watch'
  return 'critical'
}

/** Per-student present/absent/late counts + recent period-status sequence, for the Advanced tab's Class subview table. */
export function buildClassStudentSummaries(rows: PeriodAttendanceAdvancedRow[]): ClassStudentSummaryRow[] {
  const byStudent = new Map<string, { name: string; marks: { date: string; period: number; status: AttendanceStatus; subject: string }[] }>()
  for (const r of rows) {
    const status = asPeriodAttendanceStatus(r.status)
    if (!status || !r.studentId) continue
    const cur = byStudent.get(r.studentId) ?? { name: r.studentName, marks: [] }
    cur.marks.push({ date: r.date, period: r.period, status, subject: r.subject })
    byStudent.set(r.studentId, cur)
  }

  const out: ClassStudentSummaryRow[] = []
  for (const [studentId, { name, marks }] of byStudent) {
    marks.sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period)
    let present = 0
    let absent = 0
    let late = 0
    for (const m of marks) {
      if (m.status === 'absent') absent += 1
      else if (m.status === 'late') late += 1
      else present += 1 /* present + half_day both count as attended */
    }
    const total = marks.length
    const pct = total > 0 ? Math.round((present / total) * 100) : null
    const periods = marks.map((m) => ({ status: m.status, subject: m.subject, date: m.date, period: m.period }))
    out.push({
      studentId,
      studentName: name,
      present,
      absent,
      late,
      attendancePercentage: pct,
      periods,
      recentPeriods: periods.slice(-CLASS_STUDENT_RECENT_PERIODS),
      tier: classStudentTier(pct),
    })
  }
  return out.sort((a, b) => a.studentName.localeCompare(b.studentName))
}

/** Day-by-day attendance % for a class, derived from the same raw rows as buildClassStudentSummaries (no extra fetch). */
export function buildClassDailyTrend(rows: PeriodAttendanceAdvancedRow[]): TrendPoint[] {
  const byDay = new Map<string, { present: number; total: number }>()
  for (const r of rows) {
    const status = asPeriodAttendanceStatus(r.status)
    if (!status) continue
    const day = attendanceCalendarDate(r.date)
    const cur = byDay.get(day) ?? { present: 0, total: 0 }
    cur.total += 1
    if (status !== 'absent') cur.present += 1
    byDay.set(day, cur)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, c]) => ({
      label: String(new Date(`${day}T00:00:00`).getDate()),
      value: c.total > 0 ? Math.round((c.present / c.total) * 100) : 0,
      empty: c.total === 0,
    }))
}

/** Copy for the class-wise day hero — never treat an in-flight request as unmarked. */
export function classWiseHeroDisplay(input: {
  loading: boolean
  hero: { present: number; marked: number; absent: number; pct: number | null }
}): { pctLabel: string; presentLabel: string; absentLabel: string; markedLabel: string } {
  if (input.loading) {
    return { pctLabel: 'Loading…', presentLabel: '—', absentLabel: '—', markedLabel: '—' }
  }
  const { hero } = input
  return {
    pctLabel: hero.pct == null ? 'Not marked' : `${hero.pct}%`,
    presentLabel: String(hero.present),
    absentLabel: String(hero.absent),
    markedLabel: String(hero.marked),
  }
}

export type AdvClassDaySummary = {
  totalStudents: number
  present: number
  absent: number
  late: number
  leave: number
  notMarked: number
  attendancePercentage: number | null
  totalPeriods: number
  markedPeriods: number
  pendingPeriods: number
}

export type AdvSubjectSummaryRow = {
  subject: string
  teacherName: string | null
  periods: number
  marked: number
  pending: number
  present: number
  absent: number
  late: number
  attendancePercentage: number | null
}

/** Collapse per-(subject, teacher) rows into one row per subject (e.g. a subject taught by multiple teachers). */
export function mergeSubjectSummariesBySubject(rows: AdvSubjectSummaryRow[]): AdvSubjectSummaryRow[] {
  const byName = new Map<string, AdvSubjectSummaryRow>()
  for (const r of rows) {
    const cur = byName.get(r.subject)
    if (!cur) {
      byName.set(r.subject, { ...r, teacherName: null })
      continue
    }
    cur.periods += r.periods
    cur.marked += r.marked
    cur.pending += r.pending
    cur.present += r.present
    cur.absent += r.absent
    cur.late += r.late
    cur.attendancePercentage = cur.marked > 0 ? Math.round(((cur.present + cur.late) / cur.marked) * 100) : null
  }
  return [...byName.values()]
}

export type AdvTeacherSummaryRow = {
  teacherId: string
  teacherName: string
  classes: number
  sections: number
  subjects: number
  expectedPeriods: number
  markedPeriods: number
  pendingPeriods: number
  teacherMarked: number
  staffMarked: number
  principalMarked: number
  adminMarked: number
}

export type AdvRangeRollup = {
  totalMarkedPeriods: number
  present: number
  absent: number
  late: number
  leave: number
  attendancePercentage: number | null
  /** Distinct students for the range. Null when the API still returns period totals only. */
  presentStudents: number | null
  absentStudents: number | null
  lateStudents: number | null
}

type DayBuckets = { present: number; late: number; absent: number; leave: number }

function dayStatusFromBuckets(counts: DayBuckets): 'present' | 'absent' | 'late' | 'leave' | null {
  const marked = counts.present + counts.late + counts.absent + counts.leave
  if (marked <= 0) return null
  const attended = counts.present + counts.late
  if (counts.leave > attended && counts.leave >= counts.absent) return 'leave'
  if (attended * 2 < marked) return 'absent'
  if (counts.present === 0 && counts.late > 0) return 'late'
  return 'present'
}

function bucketsByStudentDay(rows: { studentId: string; date: string; status: string }[]): Map<string, DayBuckets> {
  const byStudentDay = new Map<string, DayBuckets>()
  for (const row of rows) {
    if (!row.studentId) continue
    const status = String(row.status ?? '').trim().toLowerCase().replace(/-/g, '_')
    const bucket = status === 'present' || status === 'half_day' ? 'present'
      : status === 'late' ? 'late'
      : status === 'absent' ? 'absent'
      : status === 'leave' ? 'leave'
      : null
    if (!bucket) continue
    const key = `${row.studentId}|${attendanceCalendarDate(row.date)}`
    const cur = byStudentDay.get(key) ?? { present: 0, late: 0, absent: 0, leave: 0 }
    cur[bucket] += 1
    byStudentDay.set(key, cur)
  }
  return byStudentDay
}

/** One count per student per day. A student with several present periods counts once.
 *  Present when present + late is at least half of that day's marks. */
export function studentDayHeadcount(
  rows: { studentId: string; date: string; status: string }[],
): { presentStudents: number; absentStudents: number; lateStudents: number; leaveStudents: number } {
  let presentStudents = 0
  let absentStudents = 0
  let lateStudents = 0
  let leaveStudents = 0
  for (const counts of bucketsByStudentDay(rows).values()) {
    const status = dayStatusFromBuckets(counts)
    if (status === 'present') presentStudents += 1
    else if (status === 'absent') absentStudents += 1
    else if (status === 'late') lateStudents += 1
    else if (status === 'leave') leaveStudents += 1
  }
  return { presentStudents, absentStudents, lateStudents, leaveStudents }
}

/** One status per student for the marks given (a single day). */
export function studentDayStatusById(
  rows: { studentId: string; date: string; status: string }[],
): Map<string, 'present' | 'absent' | 'late' | 'leave'> {
  const out = new Map<string, 'present' | 'absent' | 'late' | 'leave'>()
  for (const [key, counts] of bucketsByStudentDay(rows)) {
    const status = dayStatusFromBuckets(counts)
    if (!status) continue
    const studentId = key.slice(0, key.lastIndexOf('|'))
    out.set(studentId, status)
  }
  return out
}

export type PeriodAttendanceRangeFilters = {
  preset?: string
  from?: string
  to?: string
  classId?: string
  grade?: string
  section?: string
  studentId?: string
  subject?: string
  teacherId?: string
}

function toClassDaySummary(raw: Record<string, unknown>): AdvClassDaySummary {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    totalStudents: Number(row.totalStudents) || 0,
    present: Number(row.present) || 0,
    absent: Number(row.absent) || 0,
    late: Number(row.late) || 0,
    leave: Number(row.leave) || 0,
    notMarked: Number(row.notMarked) || 0,
    attendancePercentage: row.attendancePercentage != null ? Number(row.attendancePercentage) : null,
    totalPeriods: Number(row.totalPeriods) || 0,
    markedPeriods: Number(row.markedPeriods) || 0,
    pendingPeriods: Number(row.pendingPeriods) || 0,
  }
}

function toSubjectSummaryRow(raw: Record<string, unknown>): AdvSubjectSummaryRow {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    subject: String(row.subject ?? ''),
    teacherName: row.teacherName != null ? String(row.teacherName) : null,
    periods: Number(row.periods) || 0,
    marked: Number(row.marked) || 0,
    pending: Number(row.pending) || 0,
    present: Number(row.present) || 0,
    absent: Number(row.absent) || 0,
    late: Number(row.late) || 0,
    attendancePercentage: row.attendancePercentage != null ? Number(row.attendancePercentage) : null,
  }
}

function toTeacherSummaryRow(raw: Record<string, unknown>): AdvTeacherSummaryRow {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    teacherId: String(row.teacherId ?? ''),
    teacherName: String(row.teacherName ?? ''),
    classes: Number(row.classes) || 0,
    sections: Number(row.sections) || 0,
    subjects: Number(row.subjects) || 0,
    expectedPeriods: Number(row.expectedPeriods) || 0,
    markedPeriods: Number(row.markedPeriods) || 0,
    pendingPeriods: Number(row.pendingPeriods) || 0,
    teacherMarked: Number(row.teacherMarked) || 0,
    staffMarked: Number(row.staffMarked) || 0,
    principalMarked: Number(row.principalMarked) || 0,
    adminMarked: Number(row.adminMarked) || 0,
  }
}

function toRangeRollup(raw: Record<string, unknown>): AdvRangeRollup {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    totalMarkedPeriods: Number(row.totalMarkedPeriods) || 0,
    present: Number(row.present) || 0,
    absent: Number(row.absent) || 0,
    late: Number(row.late) || 0,
    leave: Number(row.leave) || 0,
    attendancePercentage: row.attendancePercentage != null ? Number(row.attendancePercentage) : null,
    presentStudents: row.presentStudents == null || row.presentStudents === '' ? null : Number(row.presentStudents),
    absentStudents: row.absentStudents == null || row.absentStudents === '' ? null : Number(row.absentStudents),
    lateStudents: row.lateStudents == null || row.lateStudents === '' ? null : Number(row.lateStudents),
  }
}

/** Class + single-day KPI summary (present/absent/late/leave/notMarked, marked vs pending periods). */
export async function getPeriodAttendanceClassDaySummary(
  classId: string,
  date: string,
): Promise<AdvClassDaySummary> {
  const wire = await request<Record<string, unknown>>('/attendance/period-records/summary/class', {
    query: { classId, date },
  })
  return toClassDaySummary(wire)
}

/** Per-subject rollup for a class across a date range/preset. */
export async function listPeriodAttendanceSubjectSummaries(
  classId: string,
  filters: { preset?: string; from?: string; to?: string } = {},
): Promise<AdvSubjectSummaryRow[]> {
  const wire = await request<Record<string, unknown>[]>('/attendance/period-records/summary/subjects', {
    query: { classId, preset: filters.preset, from: filters.from, to: filters.to },
  })
  return Array.isArray(wire) ? wire.map(toSubjectSummaryRow) : []
}

/** Per-teacher rollup across a date range/preset (expected vs marked vs pending, marker-role breakdown). */
export async function listPeriodAttendanceTeacherSummaries(
  filters: { preset?: string; from?: string; to?: string } = {},
): Promise<AdvTeacherSummaryRow[]> {
  const wire = await request<Record<string, unknown>[]>('/attendance/period-records/summary/teachers', {
    query: { preset: filters.preset, from: filters.from, to: filters.to },
  })
  return Array.isArray(wire) ? wire.map(toTeacherSummaryRow) : []
}

/** Range rollup (week/month/30/60/90 or custom) filtered by class/section/student/subject/teacher. */
export async function getPeriodAttendanceRangeSummary(
  filters: PeriodAttendanceRangeFilters = {},
): Promise<AdvRangeRollup> {
  const wire = await request<Record<string, unknown>>('/attendance/period-records/summary/range', {
    query: {
      preset: filters.preset,
      from: filters.from,
      to: filters.to,
      classId: filters.classId,
      grade: filters.grade,
      section: filters.section,
      studentId: filters.studentId,
      subject: filters.subject,
      teacherId: filters.teacherId,
    },
  })
  return toRangeRollup(wire)
}

export type PeriodAttendanceAuditRow = {
  id: string
  recordId: string
  classId: string
  studentId: string
  date: string
  period: number
  subject: string
  fromStatus: string | null
  toStatus: string
  actorId: string | null
  actorName: string | null
  actorRole: string | null
  at: string
}

function toAuditRow(raw: Record<string, unknown>): PeriodAttendanceAuditRow {
  const row = snakeToCamel<Record<string, unknown>>(raw)
  return {
    id: String(row.id ?? ''),
    recordId: String(row.recordId ?? ''),
    classId: String(row.classId ?? ''),
    studentId: String(row.studentId ?? ''),
    date: String(row.date ?? ''),
    period: Number(row.period) || 0,
    subject: String(row.subject ?? ''),
    fromStatus: row.fromStatus != null ? String(row.fromStatus) : null,
    toStatus: String(row.toStatus ?? ''),
    actorId: row.actorId != null ? String(row.actorId) : null,
    actorName: row.actorName != null ? String(row.actorName) : null,
    actorRole: row.actorRole != null ? String(row.actorRole) : null,
    at: String(row.at ?? ''),
  }
}

/** Edit history for a single period attendance record (newest first). */
export async function getPeriodAttendanceAudit(recordId: string): Promise<PeriodAttendanceAuditRow[]> {
  const wire = await request<Record<string, unknown>[]>(`/attendance/period-records/${recordId}/audit`)
  return Array.isArray(wire) ? wire.map(toAuditRow) : []
}
