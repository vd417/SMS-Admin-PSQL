/* ============================================================
   SchoolMate — Formatting + deterministic academic math
   Ported from data.jsx.
   ============================================================ */
import type { Student, Report, RankInfo, MonthValue } from '@/types'
import { students, subjects } from '@/data/mockDb'

export const fmtMoney = (n: number, cur = '₹'): string => cur + ' ' + Number(n).toLocaleString('en-IN')
export const fmtNum = (n: number): string => Number(n).toLocaleString('en-IN')

/** Readable day in IST from a date / ISO timestamp; empty → '—'. */
export function fmtDate(raw?: string): string {
  const s = (raw ?? '').trim()
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

/** Human-friendly, stable invoice number from a UUID + date: INV/YYYYMMDD/XXXXXX.
 *  Deterministic (same id → same number); the 6-char id suffix keeps it unique. */
export function feeInvoiceNo(id: string | undefined, dateIso?: string): string {
  const d = dateIso ? new Date(dateIso) : null
  const ymd = d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).replace(/-/g, '')
    : '00000000'
  const short = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || '------'
  return `INV/${ymd}/${short}`
}

function hash(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff
  return h
}

export function gradeFor(p: number): string {
  if (p >= 91) return 'A1'
  if (p >= 81) return 'A2'
  if (p >= 71) return 'B1'
  if (p >= 61) return 'B2'
  if (p >= 51) return 'C1'
  if (p >= 41) return 'C2'
  if (p >= 33) return 'D'
  return 'E'
}

export function gpaFor(g: string): number {
  return ({ A1: 10, A2: 9, B1: 8, B2: 7, C1: 6, C2: 5, D: 4, E: 3 } as Record<string, number>)[g] || 0
}

export function studentSubjectMarks(stu: Student, subj: string, examId?: string): number {
  const h = hash(stu.id + subj + (examId || ''))
  const base = stu.attendance ?? 0
  return Math.max(18, Math.min(99, Math.round(base * 0.55 + (h % 45) + (subj === 'Mathematics' ? -4 : subj === 'English' ? 4 : 0))))
}

export function reportFor(
  stu: Student,
  examId?: string,
  getMark?: (studentId: string, subject: string) => number | undefined,
  subjectList?: string[],
  opts?: { liveOnly?: boolean; getMax?: (subject: string) => number },
): Report {
  const subs = subjectList?.length ? subjectList : subjects
  const liveOnly = !!opts?.liveOnly
  const rows = subs.flatMap((s) => {
    const max = Math.max(1, Math.round(opts?.getMax?.(s) ?? 100))
    const override = getMark?.(stu.id, s)
    if (liveOnly && override == null) return []
    const marks = override ?? studentSubjectMarks(stu, s, examId)
    const pct = (marks / max) * 100
    const g = gradeFor(pct)
    return [{ subject: s, max, marks, grade: g, gpa: gpaFor(g), pass: pct >= 33 }]
  })
  if (!rows.length) {
    return { rows: [], total: 0, maxTotal: 0, pct: 0, grade: '—', gpa: 0, result: 'PASS' }
  }
  const total = rows.reduce((a, r) => a + r.marks, 0)
  const maxTotal = rows.reduce((a, r) => a + r.max, 0)
  const pct = +((total / maxTotal) * 100).toFixed(1)
  const gpa = +(rows.reduce((a, r) => a + r.gpa, 0) / rows.length).toFixed(1)
  return { rows, total, maxTotal, pct, grade: gradeFor(pct), gpa, result: rows.every((r) => r.pass) ? 'PASS' : 'COMPARTMENT' }
}

export function classRank(
  stu: Student,
  examId?: string,
  getMark?: (studentId: string, subject: string) => number | undefined,
  peers?: Student[],
  subjectList?: string[],
  opts?: { liveOnly?: boolean; getMax?: (subject: string) => number },
): RankInfo {
  const classPeers = peers ?? students.filter((s) => s.cls === stu.cls)
  const scored = classPeers
    .map((s) => {
      const r = reportFor(s, examId, getMark, subjectList, opts)
      return { id: s.id, pct: r.pct, rows: r.rows.length }
    })
    .filter((s) => !opts?.liveOnly || s.rows > 0)
    .sort((a, b) => b.pct - a.pct)
  if (opts?.liveOnly && !scored.length) {
    return { rank: 0, classSize: 0 }
  }
  const idx = scored.findIndex((s) => s.id === stu.id)
  return {
    rank: idx >= 0 ? idx + 1 : (opts?.liveOnly ? 0 : 1),
    classSize: opts?.liveOnly ? scored.length : classPeers.length,
  }
}

/** @deprecated Hash-seeded dummy months removed — use listStudentAttendanceHistory / useStudentMonthlyAttendance. */
export function attendanceMonths(_stu: Student): MonthValue[] {
  return []
}

/* ---- Toppers ranking (pure; pass an explicit student list) ---- */
export type TopperMetric = 'exam' | 'attendance'
export interface ScoredStudent { student: Student; score: number; secondary: number }
export interface ClassTopperGroup { cls: string; toppers: ScoredStudent[] }

export type TopperScoreOpts = {
  examId?: string
  getMark?: (studentId: string, subject: string) => number | undefined
  subjects?: string[]
  /** When true, exam % uses saved marks only — no hash/dummy scores. */
  liveOnly?: boolean
  /**
   * Live attendance % resolver from real day marks. Returns null when the
   * student has no recorded marks (excluded from Attendance toppers).
   */
  getAttendance?: (studentId: string) => number | null
  /** Per-subject max marks (from the exam paper). Defaults to 100 when absent. */
  getMax?: (subject: string) => number
}

/** Exam % — prefer live marks when opts.liveOnly; otherwise legacy seeded report. */
export function examPct(stu: Student, opts?: TopperScoreOpts): number | null {
  if (opts?.liveOnly) {
    const r = reportFor(stu, opts.examId, opts.getMark, opts.subjects, { liveOnly: true, getMax: opts.getMax })
    return r.rows.length ? r.pct : null
  }
  return reportFor(stu, opts?.examId, opts?.getMark, opts?.subjects, { getMax: opts?.getMax }).pct
}

/** Live attendance % when a resolver is supplied, else the SIS field. */
function attendanceScore(stu: Student, opts?: TopperScoreOpts): number | null {
  if (opts?.getAttendance) return opts.getAttendance(stu.id)
  return stu.attendance
}

function primaryScore(stu: Student, metric: TopperMetric, opts?: TopperScoreOpts): number | null {
  if (metric === 'attendance') return attendanceScore(stu, opts)
  return examPct(stu, opts)
}
function secondaryScore(stu: Student, metric: TopperMetric, opts?: TopperScoreOpts): number {
  if (metric === 'attendance') {
    const pct = examPct(stu, opts)
    return pct == null ? 0 : pct
  }
  return attendanceScore(stu, opts) ?? 0
}

function rankStudents(list: Student[], metric: TopperMetric, opts?: TopperScoreOpts): ScoredStudent[] {
  return list
    .map((s) => {
      const score = primaryScore(s, metric, opts)
      if (score == null) return null
      return { student: s, score, secondary: secondaryScore(s, metric, opts) }
    })
    .filter((row): row is ScoredStudent => row != null)
    .sort((a, b) =>
      b.score - a.score ||
      b.secondary - a.secondary ||
      a.student.id.localeCompare(b.student.id),
    )
}

export function overallToppers(
  list: Student[],
  metric: TopperMetric,
  limit: number,
  opts?: TopperScoreOpts,
): ScoredStudent[] {
  return rankStudents(list, metric, opts).slice(0, limit)
}

export function classToppers(
  list: Student[],
  metric: TopperMetric,
  perClass: number,
  opts?: TopperScoreOpts,
): ClassTopperGroup[] {
  const byCls = new Map<string, Student[]>()
  for (const s of list) {
    const arr = byCls.get(s.cls)
    if (arr) arr.push(s)
    else byCls.set(s.cls, [s])
  }
  return [...byCls.keys()]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((cls) => ({ cls, toppers: overallToppers(byCls.get(cls)!, metric, perClass, opts) }))
    .filter((g) => g.toppers.length > 0)
}
