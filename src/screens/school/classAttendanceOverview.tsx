/* ============================================================
   SchoolMate — Class Attendance Overview
   Shared trend + subject-breakdown + per-student table for one class/section,
   over an explicit [from, to] date range. Used by the top-level "Class Attendance"
   tab (its own From/To picker) and by the Advanced tab's "Class" subview (a fixed
   30-day-back-from-date window, computed by that caller).
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Badge, Bars, Btn, Card, CardHead, DataTable, Empty, Search, type BadgeTone, type Column } from '@/components/ui'
import { usePeriodAttendanceClassStudents, usePeriodAttendanceSubjectSummaries } from '@/api/hooks/usePeriodAttendanceAdvanced'
import { useTimetable } from '@/api/hooks/useTimetable'
import { useClasses } from '@/api/hooks/useClasses'
import { useStudents } from '@/api/hooks/useStudents'
import { findTimetableSlot, timetableSlotsForClassDate, type TimetableSlot } from '@/api/timetable'
import { mergeSubjectSummariesBySubject, type AdvSubjectSummaryRow, type ClassStudentSummaryRow, type ClassStudentRecentPeriod, type ClassStudentAttendanceTier } from '@/api/periodAttendanceAdvanced'
import { attendanceCalendarDate, type AttendanceStatus as AttStatus } from '@/api/attendance'
import { studentMatchesClass } from '@/lib/classMatch'
import { useApp, useToast } from '@/lib/hooks'
import { downloadReportXls, openReportPdf, type ReportSpec, type ReportMeta, type CellColor } from '@/lib/reportExport'
import { downloadReportXlsx } from '@/lib/reportXlsx'

type DisplayPeriod = { date: string; period: number; status: AttStatus | null; subject: string }

/** Every calendar date from `from` to `to`, inclusive. */
function datesBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [from]
  const out: string[] = []
  for (const d = start; d <= end; d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return out
}

/** Expands a student's marked periods with a blank dot for every OTHER timetabled period on the
 *  same dates, so each displayed day shows its full published schedule — not only what got marked.
 *  Pass `restrictToDates` to show only those dates (e.g. every date in the selected range, or just
 *  the single day the day-stepper currently has selected) — marks on any other date are dropped.
 *  Without it, only dates that already have at least one mark are shown. */
function expandWithUnmarkedPeriods(
  recentPeriods: ClassStudentRecentPeriod[], classId: string, timetableSlots: TimetableSlot[], restrictToDates?: string[],
): DisplayPeriod[] {
  const byDate = new Map<string, ClassStudentRecentPeriod[]>()
  for (const p of recentPeriods) {
    const list = byDate.get(p.date) ?? []
    list.push(p)
    byDate.set(p.date, list)
  }
  const dates = restrictToDates ? [...restrictToDates].sort() : [...byDate.keys()].sort()

  const out: DisplayPeriod[] = []
  for (const date of dates) {
    const marked = byDate.get(date) ?? []
    const markedByPeriod = new Map(marked.map((m) => [m.period, m]))
    const daySlots = timetableSlotsForClassDate(timetableSlots, classId, date)
    const periods = new Set([...daySlots.map((s) => s.period), ...marked.map((m) => m.period)])
    for (const period of [...periods].sort((a, b) => a - b)) {
      const m = markedByPeriod.get(period)
      if (m) {
        out.push({ date, period, status: m.status, subject: m.subject })
        continue
      }
      const slot = daySlots.find((s) => s.period === period)
      out.push({ date, period, status: null, subject: slot?.subject?.trim() || '—' })
    }
  }
  return out
}

function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value)}%`
}

function rangeLabel(from: string, to: string): string {
  return from === to ? from : `${from} – ${to}`
}

/** Adds a blank (no marks, no bar) row for every timetable subject that has no marked-attendance
 *  summary yet, so the card lists all subjects this class is taught — not only the ones marked so far. */
function withTimetablePlaceholders(
  merged: AdvSubjectSummaryRow[], classId: string, timetableSlots: TimetableSlot[],
): AdvSubjectSummaryRow[] {
  const seen = new Set(merged.map((s) => s.subject))
  const placeholders: AdvSubjectSummaryRow[] = []
  for (const slot of timetableSlots) {
    if (slot.classId !== classId) continue
    const subject = slot.subject?.trim()
    if (!subject || seen.has(subject)) continue
    seen.add(subject)
    placeholders.push({
      subject, teacherName: slot.teacherName, periods: 0, marked: 0, pending: 0,
      present: 0, absent: 0, late: 0, attendancePercentage: null,
    })
  }
  return [...merged, ...placeholders]
}

const PERIOD_STATUS_LABEL: Record<AttStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', half_day: 'Half day', pending: 'Pending' }
const PERIOD_STATUS_LETTER: Record<AttStatus, string> = { present: 'P', late: 'L', absent: 'A', half_day: 'H', pending: 'N' }
/** Present = full green, Late = light green, Absent = red — status shown as a colored letter dot;
 *  subject/time only appear in the tooltip (kept off the dot to avoid repeating it per student). */
const PERIOD_STATUS_STYLE: Record<AttStatus, { tone: BadgeTone; solid: boolean }> = {
  present: { tone: 'success', solid: true },
  late: { tone: 'success', solid: false },
  absent: { tone: 'danger', solid: true },
  half_day: { tone: 'info', solid: false },
  pending: { tone: 'neutral', solid: false },
}
const PERIOD_DOT_STYLE: CSSProperties = {
  padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', minWidth: 18, minHeight: 18,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
/** Explicit light grey (not the theme's --surface-3, which can be too close to the card
 *  background to read as a distinct "unmarked" indicator) — visible in both light and dark mode. */
const PERIOD_BLANK_DOT_STYLE: CSSProperties = {
  ...PERIOD_DOT_STYLE, background: '#E5E7EB', color: '#6B7280', border: '1px solid #D1D5DB',
}

const CLASS_STUDENT_TIER_TONE: Record<ClassStudentAttendanceTier, BadgeTone> = {
  excellent: 'success', good: 'success', watch: 'warning', critical: 'danger',
}
const CLASS_STUDENT_TIER_LABEL: Record<ClassStudentAttendanceTier, string> = {
  excellent: 'Excellent', good: 'Good', watch: 'Watch', critical: 'Critical',
}

/** One dot cell for a single student/date/period — shared by the inline multi-period column and
 *  the one-column-per-subject layout. `status` null = unmarked (blank dot, no letter). */
function periodDotCell(date: string, period: number, subject: string, timeLabel: string, status: AttStatus | null) {
  if (status == null) {
    return (
      <span title={`${date} · Period ${period}${timeLabel} · ${subject} · Not marked`}>
        <Badge tone="neutral" style={PERIOD_BLANK_DOT_STYLE} />
      </span>
    )
  }
  const style = PERIOD_STATUS_STYLE[status]
  return (
    <span title={`${date} · Period ${period}${timeLabel} · ${subject} · ${PERIOD_STATUS_LABEL[status]}`}>
      <Badge tone={style.tone} solid={style.solid} style={PERIOD_DOT_STYLE}>{PERIOD_STATUS_LETTER[status]}</Badge>
    </span>
  )
}

/** One column per period scheduled on `date` (per the live timetable) — subject as the column
 *  header, cell shows only the status letter (or blank) for that student/period. */
function daySubjectColumns(classId: string, timetableSlots: TimetableSlot[], date: string): Column<ClassStudentSummaryRow>[] {
  return timetableSlotsForClassDate(timetableSlots, classId, date).map((slot) => {
    const subject = slot.subject?.trim() || `Period ${slot.period}`
    const timeLabel = slot.startTime && slot.endTime ? ` (${slot.startTime}–${slot.endTime})` : ''
    return {
      key: `period-${slot.period}`, label: subject, align: 'center',
      render: (r: ClassStudentSummaryRow) => {
        // A mark's date can be a full UTC datetime, not a bare date — normalize before comparing
        // (same as findTimetableSlot elsewhere in this file), or every mark silently fails to match.
        const mark = r.recentPeriods.find((p) => attendanceCalendarDate(p.date) === date && p.period === slot.period)
        return periodDotCell(date, slot.period, subject, timeLabel, mark?.status ?? null)
      },
    }
  })
}

/** Single "Recent periods" column showing every period across `restrictToDates` (or every date
 *  that has a mark, if not given) inline, subject printed on each dot. Used where a per-subject
 *  column layout doesn't apply (the Advanced tab's Class subview spans many marks/dates at once). */
function inlineRecentPeriodsColumn(classId: string, timetableSlots: TimetableSlot[], restrictToDates?: string[]): Column<ClassStudentSummaryRow> {
  return {
    key: 'recentPeriods', label: 'Recent periods',
    render: (r) => (
      <div className="row gap4" style={{ flexWrap: 'wrap', maxWidth: 260 }}>
        {expandWithUnmarkedPeriods(r.recentPeriods, classId, timetableSlots, restrictToDates).map((p, i) => {
          if (p.status == null) {
            return (
              <span key={i} title={`${p.date} · Period ${p.period} · ${p.subject} · Not marked`}>
                <Badge tone="neutral" style={{ ...PERIOD_BLANK_DOT_STYLE, width: 'auto' }}>{p.subject}</Badge>
              </span>
            )
          }
          // Live-timetable slot for this mark; falls back to what was recorded on the mark
          // itself if the timetable has no matching published slot (e.g. not yet configured).
          const slot = findTimetableSlot(timetableSlots, classId, p.date, p.period)
          const liveSubject = slot?.subject?.trim() || p.subject
          const timeLabel = slot?.startTime && slot?.endTime ? ` (${slot.startTime}–${slot.endTime})` : ''
          const style = PERIOD_STATUS_STYLE[p.status]
          return (
            <span key={i} title={`${p.date} · Period ${p.period}${timeLabel} · ${liveSubject} · ${PERIOD_STATUS_LABEL[p.status]}`}>
              <Badge tone={style.tone} solid={style.solid} style={PERIOD_DOT_STYLE}>
                {PERIOD_STATUS_LETTER[p.status]} {liveSubject}
              </Badge>
            </span>
          )
        })}
      </div>
    ),
  }
}

/** `daySubjects`: one column per subject scheduled on that single day (live timetable), cell shows
 *  only the status letter. `inline`: the original single "Recent periods" column with subject
 *  printed per dot, covering `restrictToDates` (or every dated mark, if omitted). */
type RecentPeriodsMode = { kind: 'daySubjects'; date: string } | { kind: 'inline'; restrictToDates?: string[] }

function classStudentColumns(classId: string, timetableSlots: TimetableSlot[], mode: RecentPeriodsMode): Column<ClassStudentSummaryRow>[] {
  const recentPeriodsColumns = mode.kind === 'daySubjects'
    ? daySubjectColumns(classId, timetableSlots, mode.date)
    : [inlineRecentPeriodsColumn(classId, timetableSlots, mode.restrictToDates)]
  return [
    { key: 'studentName', label: 'Student', render: (r) => <span className="fw6">{r.studentName}</span>, sortValue: (r) => r.studentName },
    { key: 'present', label: 'Present', align: 'right', sortValue: (r) => r.present },
    { key: 'absent', label: 'Absent', align: 'right', sortValue: (r) => r.absent },
    { key: 'late', label: 'Late', align: 'right', sortValue: (r) => r.late },
    {
      key: 'attendancePercentage', label: 'Attendance', align: 'right',
      render: (r) => <b>{pct(r.attendancePercentage)}</b>, sortValue: (r) => r.attendancePercentage ?? -1,
    },
    ...recentPeriodsColumns,
    {
      key: 'tier', label: 'Status',
      render: (r) => <Badge tone={CLASS_STUDENT_TIER_TONE[r.tier]}>{CLASS_STUDENT_TIER_LABEL[r.tier]}</Badge>,
    },
  ]
}

/** Plain-text "Recent periods" cell for export (PDF/Excel can't render the colored dots) — mirrors
 *  the inline column's on-screen text: "P Computer, A English, Art" (blank periods show just the subject). */
function recentPeriodsExportCell(
  r: ClassStudentSummaryRow, classId: string, timetableSlots: TimetableSlot[], restrictToDates?: string[],
): string {
  return expandWithUnmarkedPeriods(r.recentPeriods, classId, timetableSlots, restrictToDates)
    .map((p) => {
      if (p.status == null) return p.subject
      const slot = findTimetableSlot(timetableSlots, classId, p.date, p.period)
      const liveSubject = slot?.subject?.trim() || p.subject
      return `${PERIOD_STATUS_LETTER[p.status]} ${liveSubject}`
    })
    .join(', ')
}

/** Pastel background + matching dark text for each P/A/L status, plus a neutral grey for an
 *  unmarked ('-') cell — same red/green scheme as the on-screen dots, applied to PDF/Excel exports. */
const EXPORT_STATUS_COLOR: Record<AttStatus, CellColor> = {
  present: { bg: '#DCFCE7', text: '#166534' },
  late: { bg: '#ECFDF5', text: '#15803D' },
  absent: { bg: '#FEE2E2', text: '#991B1B' },
  half_day: { bg: '#DBEAFE', text: '#1E40AF' },
  pending: { bg: '#F1F5F9', text: '#334155' },
}
const EXPORT_BLANK_COLOR: CellColor = { bg: '#F3F4F6', text: '#6B7280' }

/** Builds the exportable (PDF/Excel) report matching what's currently on screen: one column per
 *  subject in daySubjects mode (with the same red/green status coloring as the on-screen dots), or
 *  a single summarized "Recent periods" column in inline mode. */
function buildAttendanceReportSpec(
  studentRows: ClassStudentSummaryRow[], classId: string, timetableSlots: TimetableSlot[],
  mode: RecentPeriodsMode, title: string, subtitle: string,
): ReportSpec {
  const daySlots = mode.kind === 'daySubjects' ? timetableSlotsForClassDate(timetableSlots, classId, mode.date) : []
  const subjectCols = daySlots.map((s) => s.subject?.trim() || `Period ${s.period}`)
  const columns = mode.kind === 'daySubjects'
    ? ['Student', 'Present', 'Absent', 'Late', 'Attendance %', ...subjectCols, 'Status']
    : ['Student', 'Present', 'Absent', 'Late', 'Attendance %', 'Recent periods', 'Status']
  const align: ('l' | 'r')[] = mode.kind === 'daySubjects'
    ? ['l', 'r', 'r', 'r', 'r', ...subjectCols.map(() => 'l' as const), 'l']
    : ['l', 'r', 'r', 'r', 'r', 'l', 'l']
  const baseColCount = 5 // Student, Present, Absent, Late, Attendance %
  const rows: (string | number)[][] = []
  const cellColor: (CellColor | undefined)[][] = []
  for (const r of studentRows) {
    const base: (string | number)[] = [r.studentName, r.present, r.absent, r.late, pct(r.attendancePercentage)]
    const middle: (string | number)[] = []
    const middleColor: (CellColor | undefined)[] = []
    if (mode.kind === 'daySubjects') {
      for (const slot of daySlots) {
        const mark = r.recentPeriods.find((p) => attendanceCalendarDate(p.date) === mode.date && p.period === slot.period)
        middle.push(mark ? PERIOD_STATUS_LETTER[mark.status] : '-')
        middleColor.push(mark ? EXPORT_STATUS_COLOR[mark.status] : EXPORT_BLANK_COLOR)
      }
    } else {
      middle.push(recentPeriodsExportCell(r, classId, timetableSlots, mode.restrictToDates))
      middleColor.push(undefined)
    }
    rows.push([...base, ...middle, CLASS_STUDENT_TIER_LABEL[r.tier]])
    cellColor.push([...Array(baseColCount).fill(undefined), ...middleColor, undefined])
  }
  return { title, subtitle, columns, rows, align, cellColor }
}

/** Trend + subject breakdown + per-student attendance table for one class/section over [from, to].
 *  `fullRoster`: list every student in the class (not only ones with marks in range), and expand
 *  Recent periods to every date in [from, to] — not only dates that already have a mark. Meant for
 *  narrow ranges (e.g. the top-level Class Attendance tab); leave off for wide ranges. */
export function ClassAttendanceOverview({
  classId, from, to, classLabel, onStudentClick, fullRoster = false,
}: {
  classId: string
  from: string
  to: string
  classLabel?: string
  onStudentClick?: (row: ClassStudentSummaryRow) => void
  fullRoster?: boolean
}) {
  const classStudentsQ = usePeriodAttendanceClassStudents(classId, { from, to }, Boolean(classId))
  const subjectSummariesQ = usePeriodAttendanceSubjectSummaries(classId, { preset: 'custom', from, to }, Boolean(classId))
  const timetableQ = useTimetable(Boolean(classId))
  const classesQ = useClasses()
  const rosterQ = useStudents({ enabled: fullRoster })

  const targetClass = fullRoster ? classesQ.data?.find((c) => c.id === classId) : undefined
  const rosterRows = useMemo<ClassStudentSummaryRow[] | null>(() => {
    if (!fullRoster || !targetClass) return null
    const marked = new Map((classStudentsQ.data?.students ?? []).map((r) => [r.studentId, r]))
    return (rosterQ.data ?? [])
      .filter((s) => studentMatchesClass(s, targetClass))
      .map((s) => marked.get(s.id) ?? {
        studentId: s.id, studentName: s.name, present: 0, absent: 0, late: 0,
        attendancePercentage: null, recentPeriods: [], tier: 'critical' as const,
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName))
  }, [fullRoster, targetClass, rosterQ.data, classStudentsQ.data])

  const allDates = fullRoster ? datesBetween(from, to) : undefined
  const isMultiDay = Boolean(allDates && allDates.length > 1)

  // Recent periods shows one day at a time when the range spans several days (Next/Prev below),
  // so a wide range doesn't cram every day's dots into one row per student.
  const [dayIdx, setDayIdx] = useState(0)
  useEffect(() => { setDayIdx(0) }, [from, to])
  const dayDates = isMultiDay ? [allDates![Math.min(dayIdx, allDates!.length - 1)]] : allDates

  const recentPeriodsMode: RecentPeriodsMode = fullRoster
    ? { kind: 'daySubjects', date: dayDates![0] }
    : { kind: 'inline', restrictToDates: dayDates }
  const columns = classStudentColumns(classId, timetableQ.data ?? [], recentPeriodsMode)
  const studentRows = fullRoster ? rosterRows : classStudentsQ.data?.students
  const studentsLoading = classStudentsQ.isLoading || (fullRoster && (classesQ.isLoading || rosterQ.isLoading))

  const [studentQuery, setStudentQuery] = useState('')
  const filteredRows = useMemo(() => {
    const q = studentQuery.trim().toLowerCase()
    if (!q) return studentRows
    return studentRows?.filter((r) => r.studentName.toLowerCase().includes(q))
  }, [studentRows, studentQuery])

  const app = useApp()
  const toast = useToast()
  const reportMeta: ReportMeta = useMemo(() => ({
    schoolName: app.school.name,
    schoolCity: app.school.city,
    logoUrl: app.school.logoUrl,
    logoInitials: app.school.logo,
    brandColor: app.school.color,
    currency: app.school.currency,
    period: rangeLabel(from, to),
  }), [app.school, from, to])

  const exportSpec = () => buildAttendanceReportSpec(
    filteredRows ?? [], classId, timetableQ.data ?? [], recentPeriodsMode,
    'Class Attendance', `${classLabel ?? ''} — ${rangeLabel(from, to)}`.trim(),
  )
  const exportPdf = () => {
    if (!filteredRows?.length) return
    openReportPdf(exportSpec(), reportMeta)
  }
  const exportExcel = async () => {
    if (!filteredRows?.length) return
    const spec = exportSpec()
    try {
      await downloadReportXlsx(spec, reportMeta)
      toast.success('Exported .xlsx', 'Class attendance downloaded with chart & logo.')
    } catch {
      downloadReportXls(spec, reportMeta)
      toast.success('Exported .xls', 'Class attendance downloaded — opens in Excel.')
    }
  }

  return (
    <>
      <div className="sm-grid-2">
        <Card>
          <CardHead title="Attendance trend" sub={`${rangeLabel(from, to)} · average by day`} icon="trend" />
          <div style={{ marginTop: 12 }}>
            {classStudentsQ.isLoading ? (
              <div className="sm-att-adv-state t-sm muted">Loading trend…</div>
            ) : !classStudentsQ.data?.dailyTrend.length ? (
              <Empty icon="trend" title="No attendance trend yet" body="Daily % appears after period marks are saved." />
            ) : (
              <Bars
                data={classStudentsQ.data.dailyTrend.map((p) => ({ value: p.value, label: p.label, empty: p.empty }))}
                valueFmt={(v) => `${Math.round(v)}%`}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHead title="Subject attendance" sub={classLabel} icon="book" />
          <div style={{ marginTop: 12 }}>
            {subjectSummariesQ.isLoading ? (
              <div className="sm-att-adv-state t-sm muted">Loading subjects…</div>
            ) : (() => {
              const subjects = withTimetablePlaceholders(
                mergeSubjectSummariesBySubject(subjectSummariesQ.data ?? []), classId, timetableQ.data ?? [],
              )
              return !subjects.length ? (
                <Empty icon="book" title="No subject attendance yet" body="Subjects appear once this class's timetable is published or period marks are saved." />
              ) : subjects.map((s) => (
                <div key={s.subject} style={{ marginBottom: 14 }}>
                  <div className="row ai-center jc-between t-sm" style={{ marginBottom: 6 }}>
                    <span>{s.subject}</span>
                    <b>{pct(s.attendancePercentage)}</b>
                  </div>
                  <div className="sm-meter">
                    <span style={{ width: `${s.attendancePercentage ?? 0}%` }} />
                  </div>
                </div>
              ))
            })()}
          </div>
        </Card>
      </div>
      <Card style={{ marginTop: 16 }}>
        <div className="row ai-center jc-between" style={{ marginBottom: 12 }}>
          <div>
            <div className="fw6">Student attendance — {rangeLabel(from, to)}</div>
            {onStudentClick && <div className="t-xs muted">Click a student's row to view their period records →</div>}
          </div>
          {isMultiDay && (
            <div className="row ai-center gap8">
              <Btn variant="secondary" size="sm" disabled={dayIdx === 0} onClick={() => setDayIdx((i) => Math.max(0, i - 1))}>← Prev</Btn>
              <span className="t-xs muted">Recent periods: {dayDates![0]} ({dayIdx + 1} of {allDates!.length})</span>
              <Btn
                variant="secondary" size="sm" disabled={dayIdx === allDates!.length - 1}
                onClick={() => setDayIdx((i) => Math.min(allDates!.length - 1, i + 1))}
              >
                Next →
              </Btn>
            </div>
          )}
        </div>
        <div className="row ai-center jc-between" style={{ marginBottom: 12, gap: 8 }}>
          <Search value={studentQuery} onChange={setStudentQuery} placeholder="Search student…" style={{ maxWidth: 260 }} />
          <div className="row ai-center gap8">
            <Btn variant="secondary" size="sm" disabled={!filteredRows?.length} onClick={exportPdf}>Export PDF</Btn>
            <Btn variant="secondary" size="sm" disabled={!filteredRows?.length} onClick={() => void exportExcel()}>Export Excel</Btn>
          </div>
        </div>
        {studentsLoading ? (
          <div className="sm-att-adv-state t-sm muted">Loading student attendance…</div>
        ) : classStudentsQ.isError ? (
          <div className="sm-att-adv-state">
            <div>
              <div className="fw6">Could not load student attendance.</div>
              <div className="t-sm muted">{classStudentsQ.error instanceof Error ? classStudentsQ.error.message : 'Please try again.'}</div>
            </div>
            <Btn variant="secondary" size="sm" onClick={() => classStudentsQ.refetch()}>Retry</Btn>
          </div>
        ) : !studentRows?.length ? (
          <Empty
            icon="users"
            title={fullRoster ? 'No students found for this section' : 'No period marks in this range'}
            body={fullRoster ? 'Add students to this class to see them here.' : 'Student rows appear once period attendance is marked for this section.'}
          />
        ) : !filteredRows?.length ? (
          <Empty icon="users" title="No students match your search" body="Try a different name." />
        ) : (
          <DataTable
            columns={columns}
            rows={filteredRows}
            pageSize={10}
            rowKey={(r) => r.studentId}
            initialSort={{ key: 'studentName', dir: 'asc' }}
            onRowClick={onStudentClick}
          />
        )}
      </Card>
    </>
  )
}
