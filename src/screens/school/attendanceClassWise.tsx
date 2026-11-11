/* Class-wise student attendance — day/month filters, loads marks from API
   (same table the teacher app writes to). */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import {
  Card, CardHead, Btn, Modal, Badge, Avatar, Search, Segmented, Select, Input,
  Icon, Empty, type BadgeTone,
} from '@/components/ui'
import { Donut, Bars, LineChart } from '@/components/charts/Charts'
import { useClasses } from '@/api/hooks/useClasses'
import type { SchoolClass } from '@/api/classes'
import { useStudents } from '@/api/hooks/useStudents'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { useClassDayTimetable, usePeriodAttendance, useSavePeriodAttendance } from '@/api/hooks/useAttendance'
import { usePrincipalAttendance } from '@/api/hooks/usePrincipalAttendance'
import { usePeriodAttendanceRangeSummary } from '@/api/hooks/usePeriodAttendanceAdvanced'
import { studentPhotoUrl } from '@/api/studentExtras'
import { compareClassesAscending, gradeRank } from '@/lib/defaultClasses'
import { listClassAttendanceRange, mapPool, ATTENDANCE_CHANGED, ATTENDANCE_SAVED_EVENT, type AttendanceStatus, type AttendanceRecord } from '@/api/attendance'
import { listPeopleAttendanceRange, PEOPLE_ATTENDANCE_CHANGED } from '@/api/peopleAttendance'
import {
  listAllPeriodAttendanceRecords,
  periodRowsToAttendanceRecords,
  collapsePeriodRowsToDaily,
  periodCountsByClass,
  classWiseDayHero,
  classWiseHeroDisplay,
  getPeriodAttendanceRangeSummary,
} from '@/api/periodAttendanceAdvanced'
import {
  flagAbsenceStreaks, loadAlertConfig, saveAlertConfig, normalizeAlertConfig,
  DEFAULT_ALERT_CONFIG, dueForAutoSend, getLastAutoSent, markAutoSent,
  type AttendanceAlertConfig,
} from '@/lib/attendanceAlerts'
import { notifyAbsence, pickGuardianContacts, pickPeopleContacts, type AbsenceAudience } from '@/lib/attendanceNotify'
import { fetchAlertConfig, persistAlertConfig } from '@/api/attendanceAlertConfig'
import {
  dailyTrend, weeklyTrend, monthlyTrend, quarterlyTrend, trendComposition, trendLookbackDays,
  type TrendMode, type TrendPoint, type Composition,
} from '@/lib/attendanceTrend'
import {
  compositionFromRollups, mapPoolResults, RANGE_TREND_CONCURRENCY, trendFromWeekRollups, trendWindowsForMode,
} from '@/lib/dashboardLive'
import type { Student } from '@/types'
import { subjStyle } from '@/lib/subjectStyle'
import { classLabel, classCode, studentMatchesClass } from '@/lib/classMatch'

type AttStatus = AttendanceStatus

/** Present/absent tallied from locally-saved marks for one class on a given day. */
export interface LocalCount { present: number; absent: number; total: number }

const STATUS_TONE: Record<AttStatus, BadgeTone> = { present: 'success', late: 'warning', absent: 'danger', half_day: 'warning', pending: 'neutral' }
const STATUS_LABEL: Record<AttStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', half_day: 'Half day', pending: 'Pending' }
const STATUS_OPTS = [
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
]

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoDaysBack(days: number, end = todayIso()): { from: string; to: string } {
  const fromDate = new Date(`${end}T12:00:00`)
  fromDate.setDate(fromDate.getDate() - days)
  const from = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-${String(fromDate.getDate()).padStart(2, '0')}`
  return { from, to: end }
}

async function loadStudentAttendanceFromSql(
  from: string,
  to: string,
  classIds: string[],
  daily = false,
): Promise<AttendanceRecord[]> {
  const periodRows = await listAllPeriodAttendanceRecords({ from, to, preset: 'custom' })
  if (periodRows.length) {
    return daily ? collapsePeriodRowsToDaily(periodRows) : periodRowsToAttendanceRecords(periodRows)
  }
  const out: AttendanceRecord[] = []
  await mapPool(classIds, 3, async (id) => {
    out.push(...await listClassAttendanceRange(id, from, to))
  })
  return out
}

/** Stable hue from class id/name so each class keeps its colour code. */
function classHue(c: SchoolClass): number {
  return hashHue(c.id || classLabel(c))
}

/** Stable hue from an arbitrary key (0–359). */
function hashHue(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % 360
}

/** Short grade badge, e.g. Nursery → NUR, IV → IV. */
function gradeCode(grade: string): string {
  const g = grade.trim()
  if (!g) return '—'
  return (g.length > 4 ? g.slice(0, 3) : g).toUpperCase()
}

function daysInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return []
  const count = new Date(y, m, 0).getDate()
  return Array.from({ length: count }, (_, i) => {
    const day = String(i + 1).padStart(2, '0')
    return `${month}-${day}`
  })
}

function ClassPanel({
  cls,
  date,
  students,
  editable,
  open,
  onToggle,
  summaryPresent,
  summaryTotal,
  summaryPct,
  summaryMarked,
  localCount,
}: {
  cls: SchoolClass
  date: string
  students: Student[]
  editable: boolean
  open: boolean
  onToggle: () => void
  summaryPresent?: number
  summaryTotal?: number
  summaryPct?: number
  summaryMarked?: number
  localCount?: LocalCount
}) {
  const toast = useToast()
  const classId = cls.id!
  const dayTtQ = useClassDayTimetable(open ? classId : null, date)
  const slots = dayTtQ.data ?? []
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const current = slots.find((s) => s.isCurrent)
    const first = slots[0]
    const pick = current ?? first
    setSelectedSlotId((prev) => {
      if (prev && slots.some((s) => s.id === prev)) return prev
      return pick?.id ?? null
    })
  }, [open, classId, date, slots])

  const selected = slots.find((s) => s.id === selectedSlotId) ?? null
  const period = selected?.period ?? null
  const subject = selected?.subject ?? null
  const periodQ = usePeriodAttendance(open ? classId : null, date, period, subject)
  const savePeriod = useSavePeriodAttendance()
  const [draft, setDraft] = useState<Record<string, AttStatus>>({})
  const canEditAttendance = Boolean(editable && selected?.canMark)

  const savedMap = useMemo(() => {
    const m: Record<string, AttStatus> = {}
    for (const r of periodQ.data ?? []) {
      if (r.studentId && r.status) m[r.studentId] = r.status
    }
    return m
  }, [periodQ.data])

  useEffect(() => { setDraft({}) }, [classId, date, selectedSlotId, periodQ.dataUpdatedAt])

  const roster = useMemo(
    () => students
      .filter((s) => studentMatchesClass(s, cls))
      .slice()
      .sort((a, b) => (a.roll ?? 0) - (b.roll ?? 0) || a.name.localeCompare(b.name)),
    [students, cls],
  )
  /** `null` means nobody has marked this student for the selected period yet. */
  const statusOf = (id: string): AttStatus | null => draft[id] ?? savedMap[id] ?? null
  const fromServer = (periodQ.data?.length ?? 0) > 0
  const periodPresent = roster.filter((s) => {
    const st = statusOf(s.id)
    return st === 'present' || st === 'late'
  }).length
  const periodAbsent = roster.filter((s) => statusOf(s.id) === 'absent').length
  const periodLate = roster.filter((s) => statusOf(s.id) === 'late').length
  const periodMarkedCount = roster.filter((s) => statusOf(s.id) != null).length
  const periodUnmarked = Math.max(0, roster.length - periodMarkedCount)
  const hasDraft = Object.keys(draft).length > 0
  const periodsMarked = slots.filter((s) => s.marked).length
  const periodSaved = Boolean(fromServer || selected?.marked)
  const periodPct = periodMarkedCount
    ? Math.round(((periodPresent) / periodMarkedCount) * 100)
    : null

  /* Collapsed header: day-level period progress. Open body uses selected-period counts. */
  let present: number
  let total: number
  let marked: boolean
  if (open) {
    total = roster.length
    present = periodPresent
    marked = periodSaved || hasDraft || periodMarkedCount > 0
  } else if ((summaryMarked ?? 0) > 0 || (summaryPresent != null && summaryPresent > 0) || (summaryTotal != null && summaryTotal > 0)) {
    total = Math.max(roster.length, summaryTotal ?? 0)
    present = summaryPresent ?? 0
    marked = true
  } else if (localCount != null && localCount.total > 0) {
    total = Math.max(roster.length, localCount.total)
    present = localCount.present
    marked = true
  } else {
    total = roster.length
    present = 0
    marked = periodsMarked > 0
  }
  const absent = open
    ? periodAbsent
    : (marked ? Math.max(0, total - present) : 0)
  const pct = open
    ? (periodPct ?? 0)
    : (marked && total ? Math.round((present / total) * 100) : (marked ? (summaryPct ?? 0) : 0))

  const setStatus = (id: string, st: AttStatus) => setDraft((d) => ({ ...d, [id]: st }))
  const markAllPresent = () =>
    setDraft((d) => ({ ...d, ...Object.fromEntries(roster.map((s) => [s.id, 'present' as AttStatus])) }))
  const markAllAbsent = () =>
    setDraft((d) => ({ ...d, ...Object.fromEntries(roster.map((s) => [s.id, 'absent' as AttStatus])) }))

  const submit = async () => {
    if (!selected || !subject) {
      toast.danger('Pick a period', 'Select a timetable period before saving.')
      return
    }
    if (!roster.length) {
      toast.danger('No students', 'No students matched this class. Check grade/section on the student.')
      return
    }
    const records = roster
      .filter((s) => draft[s.id] !== undefined || savedMap[s.id] !== undefined)
      .map((s) => ({ studentId: s.id, status: statusOf(s.id) as AttStatus }))
    if (!records.length) {
      toast.danger('Nothing to save', 'Mark at least one student before submitting.')
      return
    }
    try {
      await savePeriod.mutateAsync({
        classId,
        date,
        period: selected.period,
        subject,
        subjectId: selected.subjectId,
        periodId: selected.id,
        records,
      })
      toast.success('Attendance saved', `${classLabel(cls)} · P${selected.period} ${subject} · ${periodPresent}/${roster.length} present`)
      setDraft({})
      window.dispatchEvent(new Event(ATTENDANCE_SAVED_EVENT))
    } catch (err) {
      toast.danger('Could not save', err instanceof Error ? err.message : 'Try again')
    }
  }

  const code = classCode(cls)
  const hue = classHue(cls)
  const accent = `hsl(${hue} 58% 42%)`
  const selectedTone = selected ? subjStyle(selected.subject ?? '—') : null
  const pctColor = pct >= 90 ? 'var(--success)' : pct >= 75 ? 'var(--warning)' : 'var(--danger)'
  const rollLabel = (roll: number | null | undefined) =>
    roll != null && roll > 0 ? `Roll ${roll}` : 'No roll no.'

  const headBadge = open
    ? (hasDraft
      ? <Badge tone="warning" dot>Unsaved</Badge>
      : periodSaved
        ? <Badge tone="success" dot>P{selected?.period} saved</Badge>
        : <Badge tone="neutral" dot>P{selected?.period ?? '—'} open</Badge>)
    : (periodsMarked > 0
      ? <Badge tone="success" dot>{periodsMarked}/{slots.length || '—'} periods</Badge>
      : marked
        ? <Badge tone="success" dot>Marked</Badge>
        : <Badge tone="neutral" dot>Not marked</Badge>)

  return (
    <div className="sm-att-class" style={{ borderLeftColor: accent }}>
      <button type="button" className="sm-att-class-head" onClick={onToggle}>
        <div className="row ai-center gap12" style={{ minWidth: 0 }}>
          <span
            className="sm-att-class-code"
            style={{ background: accent, color: '#fff', borderColor: 'transparent', boxShadow: `0 2px 8px -2px ${accent}` }}
            title={classLabel(cls)}
          >
            {code}
          </span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div className="row ai-center gap8 wrap">
              <span className="t-md fw7">{classLabel(cls)}</span>
              {cls.room && cls.room !== '—' ? <span className="t-xs muted3">Room {cls.room}</span> : null}
              {headBadge}
            </div>
            <div className="row ai-center gap6 wrap" style={{ marginTop: 5 }}>
              {open ? (
                <>
                  <span className="sm-att-chip" style={{ color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)', background: 'color-mix(in srgb, var(--success) 12%, transparent)' }}>
                    <Icon name="check" size={12} /> {periodPresent} present
                  </span>
                  {periodLate > 0 && (
                    <span className="sm-att-chip" style={{ color: 'var(--warning)', borderColor: 'color-mix(in srgb, var(--warning) 35%, transparent)', background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }}>
                      {periodLate} late
                    </span>
                  )}
                  <span
                    className="sm-att-chip"
                    style={periodAbsent > 0
                      ? { color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }
                      : { color: 'var(--text-3)' }}
                  >
                    <Icon name="x" size={12} /> {periodAbsent} absent
                  </span>
                  {periodUnmarked > 0 && (
                    <span className="sm-att-chip" style={{ color: 'var(--text-3)' }}>
                      {periodUnmarked} unmarked
                    </span>
                  )}
                </>
              ) : marked ? (
                <>
                  <span className="sm-att-chip" style={{ color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)', background: 'color-mix(in srgb, var(--success) 12%, transparent)' }}>
                    <Icon name="check" size={12} /> {present} present
                  </span>
                  <span
                    className="sm-att-chip"
                    style={absent > 0
                      ? { color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }
                      : { color: 'var(--text-3)' }}
                  >
                    <Icon name="x" size={12} /> {absent} absent
                  </span>
                </>
              ) : (
                <span className="sm-att-chip" style={{ color: 'var(--text-3)' }}>Attendance not taken</span>
              )}
              <span className="sm-att-chip" style={{ color: 'var(--text-2)' }}>
                <Icon name="users" size={12} /> {roster.length} students
              </span>
            </div>
          </div>
        </div>
        <div className="row ai-center gap12">
          {(open ? periodMarkedCount > 0 : marked) ? (
            <Donut
              size={48}
              thickness={7}
              segments={[
                { value: present || 0, color: pctColor },
                { value: Math.max(0, (open ? periodMarkedCount : total) - present), color: 'color-mix(in srgb, var(--danger) 22%, var(--surface-2))' },
              ]}
              center={<span className="t-xs fw7" style={{ color: pctColor }}>{open && periodPct == null ? '—' : `${pct}%`}</span>}
            />
          ) : (
            <Donut
              size={48}
              thickness={7}
              segments={[{ value: 1, color: 'var(--surface-3)' }]}
              center={<span className="t-sm fw7" style={{ color: 'var(--text-3)' }}>—</span>}
            />
          )}
          <Icon name="chevDown" size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </div>
      </button>

      {open && (
        <div className="sm-att-class-body">
          {dayTtQ.isLoading ? (
            <div className="t-sm muted" style={{ padding: '12px 16px' }}>Loading timetable…</div>
          ) : dayTtQ.isError ? (
            <div style={{ padding: 8 }}><Empty icon="alert" title="Could not load timetable" body="Check your connection and try again." /></div>
          ) : slots.length === 0 ? (
            <div style={{ padding: 8 }}>
              <Empty
                icon="calendar"
                title="No periods today"
                body="No teaching periods for this class on this date (Mon–Sat only). Publish this class’s grid under Academics → Timetable — only published classes show periods here."
              />
            </div>
          ) : roster.length === 0 ? (
            <div style={{ padding: 8 }}><Empty icon="users" title="No students" body="No students enrolled in this class." /></div>
          ) : (
            <>
              <div className="sm-att-period-strip" role="tablist" aria-label="Periods">
                {slots.map((slot) => {
                  const active = slot.id === selected?.id
                  const tone = subjStyle(slot.subject ?? '—')
                  const chipStyle = {
                    '--att-subj-fg': tone.fg,
                    '--att-subj-bg': tone.bg,
                    '--att-subj-bd': tone.bd,
                  } as CSSProperties
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={['sm-att-period', active && 'on', slot.marked && 'marked', slot.isCurrent && 'current'].filter(Boolean).join(' ')}
                      style={chipStyle}
                      onClick={() => setSelectedSlotId(slot.id)}
                      title={`${slot.subject ?? 'Period'} · ${slot.teacherName ?? 'No teacher'}${slot.marked ? ' · saved' : ''}`}
                    >
                      <span className="sm-att-period-swatch" aria-hidden />
                      <span className="sm-att-period-num">P{slot.period}</span>
                      <span className="sm-att-period-sub">{slot.subject ?? '—'}</span>
                      {slot.isCurrent ? <span className="sm-att-period-tag">Now</span> : null}
                      {slot.marked ? <span className="sm-att-period-dot" aria-hidden /> : null}
                    </button>
                  )
                })}
              </div>

              {selected && selectedTone && (
                <div className="sm-att-period-meta">
                  <div className="sm-att-period-meta-main">
                    <div className="t-md fw7 row ai-center gap8">
                      <span
                        className="sm-att-subj-dot"
                        style={{ background: selectedTone.fg }}
                        aria-hidden
                      />
                      <span style={{ color: selectedTone.fg }}>
                        P{selected.period} · {selected.subject ?? 'Subject'}
                      </span>
                    </div>
                    <div className="t-xs muted3" style={{ marginTop: 2 }}>
                      {[
                        selected.startTime || selected.endTime
                          ? `${selected.startTime || '—'}–${selected.endTime || '—'}`
                          : null,
                        selected.teacherName || null,
                        date,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <div className="row ai-center gap8 wrap">
                    {hasDraft
                      ? <Badge tone="warning" dot>Unsaved changes</Badge>
                      : periodSaved
                        ? <Badge tone="success" icon="check">Saved</Badge>
                        : <Badge tone="neutral" dot>Not marked</Badge>}
                    {canEditAttendance && (
                      <>
                        <Btn size="sm" variant="secondary" onClick={markAllPresent}>All present</Btn>
                        <Btn size="sm" variant="ghost" onClick={markAllAbsent}>All absent</Btn>
                      </>
                    )}
                  </div>
                </div>
              )}

              {selected && !selected.canMark && (
                <div className="t-xs muted" style={{ padding: '0 16px 10px' }}>
                  View only — {selected.teacherName || 'the assigned teacher'} marks this period
                </div>
              )}

              {periodQ.isLoading ? (
                <div className="t-sm muted" style={{ padding: '12px 16px' }}>Loading marks…</div>
              ) : (
                <div className="col">
                  {roster.map((s) => {
                    const st = statusOf(s.id)
                    const photo = studentPhotoUrl(s.id)
                    return (
                      <div key={s.id} className="sm-att-row">
                        <div className="row ai-center gap12" style={{ minWidth: 0 }}>
                          <Avatar name={s.name} hue={s.avatarHue} size={40} src={photo} />
                          <div style={{ minWidth: 0 }}>
                            <div className="t-md fw6">{s.name}</div>
                            <div className="t-xs muted3">{rollLabel(s.roll)}</div>
                          </div>
                        </div>
                        {canEditAttendance
                          ? <Segmented value={st ?? ''} onChange={(v) => setStatus(s.id, v as AttStatus)} options={STATUS_OPTS} />
                          : st
                            ? <Badge tone={STATUS_TONE[st]} dot>{STATUS_LABEL[st]}</Badge>
                            : <Badge tone="neutral">Not marked</Badge>}
                      </div>
                    )
                  })}
                </div>
              )}
              {canEditAttendance && (
                <div className="sm-att-save-bar">
                  <span className="t-xs muted3">
                    {periodMarkedCount}/{roster.length} marked
                    {hasDraft ? ' · unsaved' : ''}
                  </span>
                  <Btn
                    variant="primary"
                    icon="check"
                    disabled={savePeriod.isPending || !roster.length || (!hasDraft && periodSaved)}
                    onClick={() => { void submit() }}
                  >
                    {savePeriod.isPending
                      ? 'Saving…'
                      : `Save P${selected?.period ?? ''} attendance`}
                  </Btn>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

type ClassSummary = { present: number; total: number; pct: number; marked?: number }

/** Present/total + whether the section is actually marked for the day.
    Priority: principal summary (server / teacher app) → local saved marks → unmarked. */
function sectionCounts(
  cls: SchoolClass,
  summaryById: Map<string, ClassSummary>,
  students: Student[],
  localByClass: Map<string, LocalCount>,
): { present: number; total: number; marked: boolean } {
  const rosterSize = students.filter((s) => studentMatchesClass(s, cls)).length
  const classKey = cls.id?.toLowerCase() ?? ''
  const sum = summaryById.get(classKey)
  if (sum && (sum.marked ?? 0) > 0) {
    return { present: sum.present, total: Math.max(rosterSize, sum.total), marked: true }
  }
  const local = localByClass.get(cls.id!)
  if (local && local.total > 0) {
    return { present: local.present, total: Math.max(rosterSize, local.total), marked: true }
  }
  return { present: 0, total: rosterSize, marked: false }
}

/* ============================================================
   Grade group — shows a grade first; expands to its sections (A/B/C).
   ============================================================ */
function GradeGroup({
  grade, sections, date, students, editable, summaryById, localByClass, open, onToggle, openClassId, onToggleClass,
}: {
  grade: string
  sections: SchoolClass[]
  date: string
  students: Student[]
  editable: boolean
  summaryById: Map<string, ClassSummary>
  localByClass: Map<string, LocalCount>
  open: boolean
  onToggle: () => void
  openClassId: string | null
  onToggleClass: (id: string) => void
}) {
  const agg = useMemo(() => {
    let present = 0
    let roll = 0
    let markedRoll = 0
    let markedSections = 0
    for (const c of sections) {
      const { present: p, total, marked } = sectionCounts(c, summaryById, students, localByClass)
      roll += total
      if (marked) {
        present += p
        markedRoll += total
        markedSections += 1
      }
    }
    return { present, roll, markedRoll, markedSections }
  }, [sections, summaryById, students, localByClass])

  const anyMarked = agg.markedSections > 0
  const absent = Math.max(0, agg.markedRoll - agg.present)
  const pct = agg.markedRoll ? Math.round((agg.present / agg.markedRoll) * 100) : 0
  const pctColor = pct >= 90 ? 'var(--success)' : pct >= 75 ? 'var(--warning)' : 'var(--danger)'
  const hue = hashHue(grade)
  const accent = `hsl(${hue} 58% 42%)`
  const code = gradeCode(grade)

  return (
    <div className="sm-att-class" style={{ borderLeftColor: accent }}>
      <button type="button" className="sm-att-class-head" onClick={onToggle}>
        <div className="row ai-center gap12" style={{ minWidth: 0 }}>
          <span
            className="sm-att-class-code"
            style={{ background: accent, color: '#fff', borderColor: 'transparent', boxShadow: `0 2px 8px -2px ${accent}` }}
            title={grade}
          >
            {code}
          </span>
          <div style={{ minWidth: 0, textAlign: 'left' }}>
            <div className="row ai-center gap8 wrap">
              <span className="t-md fw7">{grade}</span>
              <span className="t-xs muted3">{sections.length} section{sections.length === 1 ? '' : 's'}</span>
              {agg.markedSections === 0
                ? <Badge tone="neutral" dot>Not marked</Badge>
                : agg.markedSections < sections.length
                  ? <Badge tone="warning" dot>{agg.markedSections}/{sections.length} marked</Badge>
                  : <Badge tone="success" dot>Marked</Badge>}
            </div>
            <div className="row ai-center gap6 wrap" style={{ marginTop: 5 }}>
              {anyMarked ? (
                <>
                  <span className="sm-att-chip" style={{ color: 'var(--success)', borderColor: 'color-mix(in srgb, var(--success) 35%, transparent)', background: 'color-mix(in srgb, var(--success) 12%, transparent)' }}>
                    <Icon name="check" size={12} /> {agg.present} present
                  </span>
                  <span
                    className="sm-att-chip"
                    style={absent > 0
                      ? { color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)' }
                      : { color: 'var(--text-3)' }}
                  >
                    <Icon name="x" size={12} /> {absent} absent
                  </span>
                </>
              ) : (
                <span className="sm-att-chip" style={{ color: 'var(--text-3)' }}>Attendance not taken</span>
              )}
              <span className="sm-att-chip" style={{ color: 'var(--text-2)' }}>
                <Icon name="users" size={12} /> {agg.roll} roll
              </span>
            </div>
          </div>
        </div>
        <div className="row ai-center gap12">
          {anyMarked ? (
            <Donut
              size={48}
              thickness={7}
              segments={[
                { value: agg.present, color: pctColor },
                { value: absent, color: 'color-mix(in srgb, var(--danger) 22%, var(--surface-2))' },
              ]}
              center={<span className="t-xs fw7" style={{ color: pctColor }}>{pct}%</span>}
            />
          ) : (
            <Donut
              size={48}
              thickness={7}
              segments={[{ value: 1, color: 'var(--surface-3)' }]}
              center={<span className="t-sm fw7" style={{ color: 'var(--text-3)' }}>—</span>}
            />
          )}
          <Icon name="chevDown" size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
        </div>
      </button>

      {open && (
        <div className="sm-att-class-body">
          <div className="sm-att-class-list" style={{ padding: 12, gap: 8 }}>
            {sections.map((c) => {
              const sum = summaryById.get(c.id!.toLowerCase())
              return (
                <ClassPanel
                  key={c.id}
                  cls={c}
                  date={date}
                  students={students}
                  editable={editable}
                  open={openClassId === c.id}
                  onToggle={() => onToggleClass(c.id!)}
                  summaryPresent={sum?.present}
                  summaryTotal={sum?.total}
                  summaryPct={sum?.pct}
                  summaryMarked={sum?.marked}
                  localCount={localByClass.get(c.id!)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Attendance trend — day / week / month / quarter % from real marks.
   Scope: all classes, a grade, or a section · audience: students, teachers,
   staff, everyone · bars or line · optional A/B compare. Composition pie.
   ============================================================ */
const TREND_COUNT: Record<TrendMode, number> = { day: 14, week: 8, month: 6, quarter: 4 }
const TREND_SUB: Record<TrendMode, string> = {
  day: 'Last 14 days',
  week: 'Last 8 weeks',
  month: 'Last 6 months',
  quarter: 'Last 4 quarters',
}
type Audience = 'students' | 'teachers' | 'staff' | 'everyone'
const AUDIENCE_OPTS = [
  { value: 'students', label: 'Students' },
  { value: 'teachers', label: 'Teachers' },
  { value: 'staff', label: 'Staff' },
  { value: 'everyone', label: 'Everyone' },
]
const COMPARE_COLORS = ['var(--brand-600)', '#7c3aed']

function trendFor(records: AttendanceRecord[], mode: TrendMode, count: number): TrendPoint[] {
  if (mode === 'day') return dailyTrend(records, count)
  if (mode === 'week') return weeklyTrend(records, count)
  if (mode === 'month') return monthlyTrend(records, count)
  return quarterlyTrend(records, count)
}

const EMPTY_COMP: Composition = { present: 0, late: 0, absent: 0, total: 0, pct: 0 }

function studentRangeScope(grade: string, section: string): { classId?: string; grade?: string } {
  if (section !== 'all') return { classId: section }
  if (grade !== 'all') return { grade }
  return {}
}

function addComp(a: Composition, b: Composition): Composition {
  const present = a.present + b.present
  const late = a.late + b.late
  const absent = a.absent + b.absent
  const total = present + late + absent
  return { present, late, absent, total, pct: total ? Math.round(((present + late) / total) * 100) : 0 }
}

function mergeSeries(a: TrendPoint[], b: TrendPoint[]): TrendPoint[] {
  const n = Math.max(a.length, b.length)
  return Array.from({ length: n }, (_, i) => {
    const pa = a[i]
    const pb = b[i]
    const parts = [pa, pb].filter((p): p is TrendPoint => Boolean(p) && !p.empty)
    const label = pa?.label ?? pb?.label ?? ''
    if (!parts.length) return { label, value: 0, empty: true }
    const value = Math.round(parts.reduce((s, p) => s + p.value, 0) / parts.length)
    return { label, value }
  })
}

async function loadStudentRangeTrend(grade: string, section: string, mode: TrendMode): Promise<{ series: TrendPoint[]; comp: Composition }> {
  const windows = trendWindowsForMode(mode)
  const scope = studentRangeScope(grade, section)
  const rollups = await mapPoolResults(windows, RANGE_TREND_CONCURRENCY, (w) =>
    getPeriodAttendanceRangeSummary({ preset: 'custom', from: w.from, to: w.to, ...scope }))
  return { series: trendFromWeekRollups(windows, rollups), comp: compositionFromRollups(rollups) }
}

async function loadPeopleTrend(group: 'teachers' | 'staff', from: string, to: string, mode: TrendMode, count: number): Promise<{ series: TrendPoint[]; comp: Composition }> {
  const rows = await listPeopleAttendanceRange(group, from, to)
  return { series: trendFor(rows, mode, count), comp: trendComposition(rows, mode, count) }
}

async function loadAudienceTrend(
  audience: Audience,
  grade: string,
  section: string,
  mode: TrendMode,
  count: number,
  from: string,
  to: string,
): Promise<{ series: TrendPoint[]; comp: Composition }> {
  if (audience === 'students') return loadStudentRangeTrend(grade, section, mode)
  if (audience === 'teachers') return loadPeopleTrend('teachers', from, to, mode, count)
  if (audience === 'staff') return loadPeopleTrend('staff', from, to, mode, count)
  const [students, teachers, staff] = await Promise.all([
    loadStudentRangeTrend(grade, section, mode),
    loadPeopleTrend('teachers', from, to, mode, count),
    loadPeopleTrend('staff', from, to, mode, count),
  ])
  return {
    series: mergeSeries(mergeSeries(students.series, teachers.series), staff.series),
    comp: addComp(addComp(students.comp, teachers.comp), staff.comp),
  }
}

/** One scope's composition pie + legend. */
function TrendPie({ comp, title }: { comp: Composition; title?: string }) {
  const pctColor = comp.pct >= 90 ? 'var(--success)' : comp.pct >= 75 ? 'var(--warning)' : 'var(--danger)'
  const legend = [
    { label: 'Present', value: comp.present, color: 'var(--success)' },
    { label: 'Late', value: comp.late, color: 'var(--warning)' },
    { label: 'Absent', value: comp.absent, color: 'var(--danger)' },
  ]
  return (
    <div className="sm-att-trend-pie">
      <Donut
        size={132}
        thickness={20}
        gap={3}
        segments={[
          { value: comp.present, color: 'var(--success)' },
          { value: comp.late, color: 'var(--warning)' },
          { value: comp.absent, color: 'var(--danger)' },
        ]}
        center={
          <div style={{ textAlign: 'center', lineHeight: 1.05 }}>
            <div className="fw7" style={{ fontSize: 24, color: pctColor }}>{comp.pct}%</div>
            <div className="t-xs muted3">present</div>
          </div>
        }
      />
      <div className="col gap6" style={{ minWidth: 128 }}>
        {title && <div className="t-sm fw7" style={{ marginBottom: 2 }}>{title}</div>}
        {legend.map((l) => (
          <div key={l.label} className="row ai-center jc-between gap10">
            <span className="row ai-center gap6 t-sm">
              <span style={{ width: 10, height: 10, borderRadius: 3, background: l.color, display: 'inline-block' }} />
              {l.label}
            </span>
            <span className="t-sm fw7">{l.value}</span>
          </div>
        ))}
        <div className="row ai-center jc-between gap10" style={{ borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
          <span className="t-sm muted">Total marks</span>
          <span className="t-sm fw7">{comp.total}</span>
        </div>
      </div>
    </div>
  )
}

/** Scope selector row (audience + grade + section). */
function ScopeControls({
  classes, audience, grade, section, onAudience, onGrade, onSection,
}: {
  classes: SchoolClass[]
  audience: Audience
  grade: string
  section: string
  onAudience: (v: Audience) => void
  onGrade: (v: string) => void
  onSection: (v: string) => void
}) {
  const gradeOptions = useMemo(() => {
    const seen = new Map<string, number>()
    for (const c of classes) {
      const g = (c.grade || classLabel(c)).trim()
      if (g) seen.set(g, gradeRank(g))
    }
    const grades = [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => g)
    return [{ value: 'all', label: 'All classes' }, ...grades.map((g) => ({ value: g, label: g }))]
  }, [classes])
  const sectionOptions = useMemo(() => {
    if (grade === 'all') return [{ value: 'all', label: 'All sections' }]
    const secs = classes.filter((c) => (c.grade || classLabel(c)).trim() === grade).slice().sort(compareClassesAscending)
    return [{ value: 'all', label: 'All sections' }, ...secs.map((c) => ({ value: c.id!, label: classLabel(c) }))]
  }, [classes, grade])
  const classScope = audience === 'students'
  return (
    <div className="row ai-center gap8 wrap">
      <Segmented value={audience} onChange={(v) => onAudience(v as Audience)} options={AUDIENCE_OPTS} />
      <Select options={gradeOptions} value={grade} onChange={(e) => onGrade(e.target.value)} disabled={!classScope} />
      <Select options={sectionOptions} value={section} onChange={(e) => onSection(e.target.value)} disabled={!classScope || grade === 'all'} />
    </div>
  )
}

function scopeText(audience: Audience, classes: SchoolClass[], grade: string, section: string): string {
  if (audience !== 'students') return audience.charAt(0).toUpperCase() + audience.slice(1)
  if (grade === 'all') return 'All classes'
  if (section === 'all') return `${grade} · all sections`
  const c = classes.find((x) => x.id === section)
  return c ? classLabel(c) : grade
}

function AttendanceTrendCard({ classes }: { classes: SchoolClass[] }) {
  const [mode, setMode] = useState<TrendMode>('week')
  const [chartType, setChartType] = useState<'bars' | 'line'>('bars')
  const [compare, setCompare] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [seriesA, setSeriesA] = useState<TrendPoint[]>([])
  const [seriesB, setSeriesB] = useState<TrendPoint[]>([])
  const [compA, setCompA] = useState<Composition>(EMPTY_COMP)
  const [compB, setCompB] = useState<Composition>(EMPTY_COMP)
  const [trendLoading, setTrendLoading] = useState(true)
  // Scope A
  const [audA, setAudA] = useState<Audience>('students')
  const [gradeA, setGradeA] = useState('all')
  const [sectionA, setSectionA] = useState('all')
  // Scope B (compare)
  const [audB, setAudB] = useState<Audience>('students')
  const [gradeB, setGradeB] = useState('all')
  const [sectionB, setSectionB] = useState('all')

  useEffect(() => {
    const bump = () => setReloadKey((n) => n + 1)
    window.addEventListener(ATTENDANCE_SAVED_EVENT, bump)
    window.addEventListener(ATTENDANCE_CHANGED, bump)
    window.addEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
    return () => {
      window.removeEventListener(ATTENDANCE_SAVED_EVENT, bump)
      window.removeEventListener(ATTENDANCE_CHANGED, bump)
      window.removeEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const { from, to } = isoDaysBack(trendLookbackDays(mode))
    const count = TREND_COUNT[mode]
    setTrendLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const a = await loadAudienceTrend(audA, gradeA, sectionA, mode, count, from, to)
          const b = compare
            ? await loadAudienceTrend(audB, gradeB, sectionB, mode, count, from, to)
            : { series: [] as TrendPoint[], comp: EMPTY_COMP }
          if (cancelled) return
          setSeriesA(a.series)
          setCompA(a.comp)
          setSeriesB(b.series)
          setCompB(b.comp)
        } catch {
          if (cancelled) return
          setSeriesA([])
          setSeriesB([])
          setCompA(EMPTY_COMP)
          setCompB(EMPTY_COMP)
        } finally {
          if (!cancelled) setTrendLoading(false)
        }
      })()
    }, 150)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [reloadKey, mode, audA, gradeA, sectionA, compare, audB, gradeB, sectionB])

  // Class scope only applies to students.
  useEffect(() => { if (audA !== 'students') { setGradeA('all'); setSectionA('all') } }, [audA])
  useEffect(() => { if (audB !== 'students') { setGradeB('all'); setSectionB('all') } }, [audB])

  const markedA = seriesA.filter((p) => !p.empty)
  const avgA = markedA.length ? Math.round(markedA.reduce((a, p) => a + p.value, 0) / markedA.length) : 0
  const hasData = markedA.length > 0 || (compare && seriesB.some((p) => !p.empty))

  const barData = seriesA.map((p) => ({
    value: p.value,
    label: p.label,
    empty: p.empty,
    color: p.value >= 90 ? 'var(--success)' : p.value >= 75 ? 'var(--warning)' : 'var(--danger)',
    valueLabel: p.empty ? '—' : `${p.value}%`,
  }))
  const chartLabels = seriesA.map((p) => p.label)
  const labelA = scopeText(audA, classes, gradeA, sectionA)
  const labelB = scopeText(audB, classes, gradeB, sectionB)
  const lineSeries = compare
    ? [
        { data: seriesA.map((p) => p.value), color: COMPARE_COLORS[0], label: labelA },
        { data: seriesB.map((p) => p.value), color: COMPARE_COLORS[1], label: labelB },
      ]
    : [{ data: seriesA.map((p) => p.value), color: COMPARE_COLORS[0], label: labelA }]

  return (
    <Card pad={false} style={{ marginBottom: 16 }}>
      <CardHead
        title="Attendance trend"
        sub={compare ? `${TREND_SUB[mode]} · ${labelA} vs ${labelB}` : `${TREND_SUB[mode]} · ${labelA}`}
        icon="trend"
        action={
          <div className="row ai-center gap8 wrap">
            {hasData && !compare && <Badge tone={avgA >= 90 ? 'success' : avgA >= 75 ? 'warning' : 'danger'} dot>Avg {avgA}%</Badge>}
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as TrendMode)}
              options={[
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
                { value: 'month', label: 'Monthly' },
                { value: 'quarter', label: 'Quarterly' },
              ]}
            />
            <Segmented
              value={chartType}
              onChange={(v) => setChartType(v as 'bars' | 'line')}
              options={[{ value: 'bars', label: 'Bars' }, { value: 'line', label: 'Line' }]}
            />
            <Btn size="sm" variant={compare ? 'primary' : 'secondary'} icon="trend" onClick={() => setCompare((c) => !c)}>
              {compare ? 'Comparing' : 'Compare'}
            </Btn>
          </div>
        }
      />

      <div className="row ai-center gap12 wrap" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        {compare && <span className="t-xs fw7" style={{ color: COMPARE_COLORS[0] }}>A</span>}
        <ScopeControls
          classes={classes} audience={audA} grade={gradeA} section={sectionA}
          onAudience={setAudA} onGrade={setGradeA} onSection={setSectionA}
        />
        {compare && (
          <>
            <span className="t-xs fw7" style={{ color: COMPARE_COLORS[1] }}>B</span>
            <ScopeControls
              classes={classes} audience={audB} grade={gradeB} section={sectionB}
              onAudience={setAudB} onGrade={setGradeB} onSection={setSectionB}
            />
          </>
        )}
      </div>

      {trendLoading ? (
        <div style={{ padding: 16 }}>
          <Empty icon="trend" title="Loading trend…" body="Fetching period marks for this window." />
        </div>
      ) : hasData ? (
        compare ? (
          <div style={{ padding: 16 }}>
            <div className="row gap16 wrap" style={{ marginBottom: 12 }}>
              <TrendPie comp={compA} title={`A · ${labelA}`} />
              <TrendPie comp={compB} title={`B · ${labelB}`} />
            </div>
            <LineChart series={lineSeries} labels={chartLabels} yMax={100} yFmt={(v) => `${Math.round(v)}%`} h={200} />
            <div className="row ai-center gap16 wrap" style={{ marginTop: 8 }}>
              {lineSeries.map((s) => (
                <span key={s.label} className="row ai-center gap6 t-sm">
                  <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="sm-att-trend-body">
            <TrendPie comp={compA} />
            <div className="sm-att-trend-bars">
              {chartType === 'bars'
                ? <Bars data={barData} h={170} />
                : <LineChart series={lineSeries} labels={chartLabels} yMax={100} yFmt={(v) => `${Math.round(v)}%`} h={190} />}
            </div>
          </div>
        )
      ) : (
        <div style={{ padding: 16 }}>
          <Empty icon="trend" title="No attendance yet" body="Mark attendance for a few days to see the trend and breakdown here." />
        </div>
      )}
    </Card>
  )
}

/* ============================================================
   Absence alerts — consecutive-absence streak warnings + parent notify.
   Threshold is configurable; escalates from in-app notice to email.
   ============================================================ */
interface FlaggedPerson {
  kind: AbsenceAudience
  id: string
  name: string
  subtitle: string
  avatarHue?: number
  photo?: string
  streak: number
  lastDate: string
}

const KIND_CHIP: Record<AbsenceAudience, { label: string; color: string }> = {
  students: { label: 'Student', color: 'var(--brand-600)' },
  teachers: { label: 'Teacher', color: '#7c3aed' },
  staff: { label: 'Staff', color: '#0d9488' },
}

function AbsenceAlertsPanel({
  students, editable, schoolName,
}: { students: Student[]; editable: boolean; schoolName: string }) {
  const toast = useToast()
  const teachers = useTeachers().data ?? []
  const staff = useStaff().data ?? []
  const classes = useClasses().data ?? []
  const [cfg, setCfg] = useState<AttendanceAlertConfig | null>(null)
  const [cfgStatus, setCfgStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cfgError, setCfgError] = useState('')
  const [studentRecs, setStudentRecs] = useState<AttendanceRecord[]>([])
  const [teacherRecs, setTeacherRecs] = useState<AttendanceRecord[]>([])
  const [staffRecs, setStaffRecs] = useState<AttendanceRecord[]>([])
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState<null | 'app' | 'email'>(null)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => ({
    noticeDays: DEFAULT_ALERT_CONFIG.noticeDays,
    emailDays: DEFAULT_ALERT_CONFIG.emailDays,
    autoSend: DEFAULT_ALERT_CONFIG.autoSend,
    autoTime: DEFAULT_ALERT_CONFIG.autoTime,
    autoChannel: DEFAULT_ALERT_CONFIG.autoChannel,
  }))
  const warnedRef = useRef(false)

  const loadConfigFromApi = () => {
    setCfgStatus('loading')
    setCfgError('')
    void fetchAlertConfig()
      .then((server) => {
        if (!server) {
          setCfg(null)
          setCfgStatus('error')
          setCfgError('Alert settings unavailable from the server.')
          return
        }
        const saved = saveAlertConfig(server)
        setCfg(saved)
        setDraft({
          noticeDays: saved.noticeDays, emailDays: saved.emailDays,
          autoSend: saved.autoSend, autoTime: saved.autoTime, autoChannel: saved.autoChannel,
        })
        setCfgStatus('ready')
      })
      .catch((err) => {
        setCfg(null)
        setCfgStatus('error')
        setCfgError(err instanceof Error ? err.message : 'Could not load alert settings.')
      })
  }

  // API is the only Source of Truth — no browser config fallback.
  useEffect(() => {
    loadConfigFromApi()
  }, [])

  // Load absence history from SQL when the alerts UI is opened (or after a save).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const { from, to } = isoDaysBack(90)
    const ids = classes.map((c) => c.id).filter(Boolean) as string[]
    void (async () => {
      try {
        const [studentsMarks, teacherMarks, staffMarks] = await Promise.all([
          loadStudentAttendanceFromSql(from, to, ids, true),
          listPeopleAttendanceRange('teachers', from, to),
          listPeopleAttendanceRange('staff', from, to),
        ])
        if (cancelled) return
        setStudentRecs(studentsMarks)
        setTeacherRecs(teacherMarks)
        setStaffRecs(staffMarks)
      } catch {
        if (cancelled) return
        setStudentRecs([])
        setTeacherRecs([])
        setStaffRecs([])
      }
    })()
    return () => { cancelled = true }
  }, [classes, open, reloadKey])

  useEffect(() => {
    const bump = () => setReloadKey((n) => n + 1)
    window.addEventListener(ATTENDANCE_SAVED_EVENT, bump)
    window.addEventListener(ATTENDANCE_CHANGED, bump)
    window.addEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
    return () => {
      window.removeEventListener(ATTENDANCE_SAVED_EVENT, bump)
      window.removeEventListener(ATTENDANCE_CHANGED, bump)
      window.removeEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
    }
  }, [])

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const teacherById = useMemo(() => new Map(teachers.map((t) => [t.id, t])), [teachers])
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff])

  const dayNum = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }

  // Flagged people — only when server config is ready (no invented thresholds).
  const alerts = useMemo<FlaggedPerson[]>(() => {
    if (!cfg) return []
    const out: FlaggedPerson[] = []
    for (const a of flagAbsenceStreaks(studentRecs, cfg.noticeDays)) {
      const s = studentById.get(a.id)
      if (!s) continue
      out.push({
        kind: 'students', id: a.id, name: s.name, avatarHue: s.avatarHue, photo: studentPhotoUrl(s.id),
        subtitle: `${s.cls || '—'} · last absent ${dayNum(a.lastDate)}`, streak: a.streak, lastDate: a.lastDate,
      })
    }
    for (const a of flagAbsenceStreaks(teacherRecs, cfg.noticeDays)) {
      const t = teacherById.get(a.id)
      if (!t) continue
      out.push({
        kind: 'teachers', id: a.id, name: t.name, avatarHue: t.avatarHue,
        subtitle: `${t.dept || t.desig || 'Teacher'} · last absent ${dayNum(a.lastDate)}`, streak: a.streak, lastDate: a.lastDate,
      })
    }
    for (const a of flagAbsenceStreaks(staffRecs, cfg.noticeDays)) {
      const st = staffById.get(a.id)
      if (!st) continue
      out.push({
        kind: 'staff', id: a.id, name: st.name, avatarHue: st.avatarHue,
        subtitle: `${st.role || st.dept || 'Staff'} · last absent ${dayNum(a.lastDate)}`, streak: a.streak, lastDate: a.lastDate,
      })
    }
    return out.sort((x, y) => y.streak - x.streak || x.name.localeCompare(y.name))
  }, [cfg, studentRecs, teacherRecs, staffRecs, studentById, teacherById, staffById])

  const emailable = useMemo(
    () => (cfg ? alerts.filter((a) => a.streak >= cfg.emailDays) : []),
    [alerts, cfg],
  )

  // Warning "popup" — surface once when alerts first appear this session.
  useEffect(() => {
    if (!cfg) return
    if (alerts.length && !warnedRef.current) {
      warnedRef.current = true
      toast.danger(
        `${alerts.length} attendance alert${alerts.length === 1 ? '' : 's'}`,
        `${alerts.length} ${alerts.length === 1 ? 'person has' : 'people have'} been absent ${cfg.noticeDays}+ days in a row. Review and notify.`,
      )
    }
    if (!alerts.length) warnedRef.current = false
  }, [alerts.length, cfg, toast])

  const setDays = (which: 'noticeDays' | 'emailDays', raw: string) => {
    const v = Number(raw)
    if (!Number.isFinite(v)) return
    setDraft((d) => ({ ...d, [which]: v }))
  }

  const dirty = !!cfg && (
    draft.noticeDays !== cfg.noticeDays
    || draft.emailDays !== cfg.emailDays
    || draft.autoSend !== cfg.autoSend
    || draft.autoTime !== cfg.autoTime
    || draft.autoChannel !== cfg.autoChannel
  )

  const saveThresholds = async () => {
    if (!cfg) return
    const next = normalizeAlertConfig({ ...cfg, ...draft })
    try {
      const saved = await persistAlertConfig(next)
      setCfg(saved)
      setCfgStatus('ready')
      setDraft({
        noticeDays: saved.noticeDays, emailDays: saved.emailDays,
        autoSend: saved.autoSend, autoTime: saved.autoTime, autoChannel: saved.autoChannel,
      })
      toast.success(
        'Alert settings saved',
        saved.autoSend
          ? `Auto-${saved.autoChannel === 'email' ? 'email' : 'notify'} daily at ${saved.autoTime}.`
          : `Warn after ${saved.noticeDays} · email after ${saved.emailDays} days.`,
      )
    } catch (err) {
      toast.danger(
        'Could not save alert settings',
        err instanceof Error ? err.message : 'Server unavailable — settings were not saved.',
      )
    }
  }

  const contactsFor = (kind: AbsenceAudience, ids: string[]) => {
    if (kind === 'students') return pickGuardianContacts(students, ids)
    if (kind === 'teachers') return pickPeopleContacts(teachers, ids)
    return pickPeopleContacts(staff, ids)
  }

  const send = async (mode: 'app' | 'email') => {
    if (!cfg) {
      toast.danger('Settings unavailable', 'Load alert settings from the server before sending.')
      return
    }
    const list = mode === 'email' ? emailable : alerts
    if (!list.length) {
      toast.danger('Nothing to send', mode === 'email'
        ? `No one has reached the ${cfg.emailDays}-day email threshold yet.`
        : 'No one is currently flagged.')
      return
    }
    setBusy(mode)
    try {
      const groups = new Map<AbsenceAudience, string[]>()
      for (const a of list) groups.set(a.kind, [...(groups.get(a.kind) ?? []), a.id])
      let people = 0, emails = 0
      const channels = mode === 'email' ? { app: true, email: true, sms: false } : { app: true, email: false, sms: false }
      for (const [kind, ids] of groups) {
        const res = await notifyAbsence(kind, ids, contactsFor(kind, ids), schoolName, channels, {
          days: mode === 'email' ? cfg.emailDays : cfg.noticeDays,
        })
        people += res.students
        emails += res.emails
      }
      toast.success(
        mode === 'email' ? 'Notifications emailed' : 'App notice sent',
        `${people} flagged · ${emails} email${emails === 1 ? '' : 's'} · students → parents, teachers/staff → self`,
      )
    } catch (err) {
      toast.danger('Could not send alert', err instanceof Error ? err.message : 'Try again')
    } finally {
      setBusy(null)
    }
  }

  // Human-readable schedule status (reflects the saved config, not the draft).
  const scheduleStatus = (() => {
    if (!cfg) return cfgStatus === 'loading' ? 'Loading settings…' : 'Settings unavailable — retry to load from the server.'
    if (dirty) return 'Unsaved changes — click Save to apply.'
    if (!cfg.autoSend) return 'Off — send manually from the buttons below.'
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const lastAuto = getLastAutoSent()
    const [h, m] = cfg.autoTime.split(':').map(Number)
    const sched = new Date(now); sched.setHours(h, m, 0, 0)
    const when = lastAuto === today
      ? `tomorrow at ${cfg.autoTime}`
      : now < sched ? `today at ${cfg.autoTime}` : 'now (sends while the CRM is open)'
    return `Auto-${cfg.autoChannel === 'email' ? 'email' : 'notify'} · next ${when}${lastAuto ? ` · last sent ${lastAuto}` : ''}`
  })()

  // Scheduled auto-send: only when API config is loaded into session memory.
  const sendRef = useRef(send)
  sendRef.current = send
  const listRef = useRef({ alerts, emailable })
  listRef.current = { alerts, emailable }
  useEffect(() => {
    if (!editable || !cfg) return
    const check = () => {
      const c = loadAlertConfig()
      if (!c || !dueForAutoSend(c, new Date(), getLastAutoSent())) return
      markAutoSent() // dedupe today even if the list is empty
      const list = c.autoChannel === 'email' ? listRef.current.emailable : listRef.current.alerts
      if (list.length) void sendRef.current(c.autoChannel)
    }
    check()
    const id = window.setInterval(check, 60_000)
    return () => window.clearInterval(id)
  }, [editable, cfg])

  const noticeDaysLabel = cfg?.noticeDays ?? '—'
  const emailDaysLabel = cfg?.emailDays ?? '—'

  return (
    <>
      {/* Compact bell trigger — the full panel lives in a modal to keep the page clean. */}
      <button
        type="button"
        className="sm-att-alert-bell"
        onClick={() => setOpen(true)}
        aria-label="Open absence alerts"
        title="Absence alerts"
      >
        <span className="sm-att-alert-bell-ic">
          <Icon name="bell" size={16} />
          {alerts.length > 0 && <span className="sm-att-alert-bell-dot">{alerts.length}</span>}
        </span>
        <span className="t-sm fw6">Absence alerts</span>
        {cfgStatus === 'error'
          ? <span className="t-xs" style={{ color: 'var(--danger)' }}>Unavailable</span>
          : cfgStatus === 'loading'
            ? <span className="t-xs muted3">Loading…</span>
            : alerts.length > 0
              ? <span className="t-xs" style={{ color: 'var(--danger)' }}>{alerts.length} flagged</span>
              : <span className="t-xs muted3">All clear</span>}
        {cfg?.autoSend && (
          <span className="t-xs fw6 row ai-center gap4" style={{
            color: 'var(--brand-600)', background: 'color-mix(in srgb, var(--brand-600) 12%, transparent)',
            padding: '1px 8px', borderRadius: 999,
          }}>
            <Icon name="clock" size={11} /> {cfg.autoTime}
          </span>
        )}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        icon="bell"
        title={<span className="row ai-center gap8">Absence alerts{alerts.length > 0 && <Badge tone="danger" dot>{alerts.length}</Badge>}</span>}
        sub={cfg
          ? `Students, teachers & staff absent ${noticeDaysLabel}+ days in a row · email escalates at ${emailDaysLabel}+ days`
          : 'Alert thresholds load from the server'}
        footer={editable && cfg && alerts.length > 0 ? (
          <div className="row ai-center jc-between gap12 wrap" style={{ width: '100%' }}>
            <span className="t-xs muted3">
              {emailable.length
                ? `${emailable.length} past the ${cfg.emailDays}-day email threshold.`
                : `No one past the ${cfg.emailDays}-day email threshold yet.`}
            </span>
            <div className="row ai-center gap8">
              <Btn size="sm" variant="secondary" icon="bell" disabled={busy != null} onClick={() => { void send('app') }}>
                {busy === 'app' ? 'Sending…' : 'Send app notice'}
              </Btn>
              <Btn size="sm" variant="primary" icon="inbox" disabled={busy != null || !emailable.length} onClick={() => { void send('email') }}>
                {busy === 'email' ? 'Emailing…' : 'Email / notify'}
              </Btn>
            </div>
          </div>
        ) : undefined}
      >
        {cfgStatus === 'loading' && (
          <div className="t-sm muted" style={{ padding: '16px 0' }}>Loading alert settings from the server…</div>
        )}
        {cfgStatus === 'error' && (
          <div className="col gap12" style={{ padding: '8px 0 16px' }}>
            <Empty
              icon="alert"
              title="Alert settings unavailable"
              body={cfgError || 'Could not load settings from the database. Browser storage is not used as a fallback.'}
            />
            <Btn variant="secondary" icon="refresh" onClick={loadConfigFromApi}>Retry</Btn>
          </div>
        )}
        {cfgStatus === 'ready' && cfg && (
        <>
        <div className="row ai-center gap8 wrap" style={{ marginBottom: 12 }}>
          <label className="t-xs muted3 row ai-center gap6">
            Warn after
            <Input
              type="number" min={1} max={60} value={draft.noticeDays}
              onChange={(e) => setDays('noticeDays', e.target.value)}
              style={{ width: 64 }}
            />
            days
          </label>
          <label className="t-xs muted3 row ai-center gap6">
            Email after
            <Input
              type="number" min={1} max={60} value={draft.emailDays}
              onChange={(e) => setDays('emailDays', e.target.value)}
              style={{ width: 64 }}
            />
            days
          </label>
          <Btn size="sm" variant={dirty ? 'primary' : 'secondary'} icon="check" disabled={!dirty} onClick={() => { void saveThresholds() }}>
            Save
          </Btn>
        </div>

        <div
          className="row ai-center gap10 wrap"
          style={{ marginBottom: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}
        >
          <label className="t-sm fw6 row ai-center gap8" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draft.autoSend}
              onChange={(e) => setDraft((d) => ({ ...d, autoSend: e.target.checked }))}
            />
            <Icon name="bell" size={14} /> Auto-send daily
          </label>
          <label className="t-xs muted3 row ai-center gap6">
            at
            <Input
              type="time"
              value={draft.autoTime}
              disabled={!draft.autoSend}
              onChange={(e) => setDraft((d) => ({ ...d, autoTime: e.target.value }))}
              style={{ width: 120 }}
            />
          </label>
          <Segmented
            value={draft.autoChannel}
            onChange={(v) => setDraft((d) => ({ ...d, autoChannel: v as 'app' | 'email' }))}
            options={[{ value: 'app', label: 'App notice' }, { value: 'email', label: 'Email' }]}
          />
          <span
            className="t-xs"
            style={{ flex: 1, minWidth: 160, color: dirty ? 'var(--warning)' : cfg.autoSend ? 'var(--brand-600)' : 'var(--text-3)' }}
          >
            {scheduleStatus}
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="row ai-center gap8" style={{ padding: '8px 0' }}>
            <Badge tone="success" icon="check">All clear</Badge>
            <span className="t-sm muted">No student, teacher or staff has {cfg.noticeDays}+ consecutive absences right now.</span>
          </div>
        ) : (
          <div className="col" style={{ margin: '0 -20px' }}>
            {alerts.map((a) => {
              const critical = a.streak >= cfg.emailDays
              const chip = KIND_CHIP[a.kind]
              return (
                <div
                  key={`${a.kind}-${a.id}`}
                  className="sm-att-row"
                  style={critical ? {
                    background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                    boxShadow: 'inset 3px 0 0 var(--danger)',
                  } : undefined}
                >
                  <div className="row ai-center gap12" style={{ minWidth: 0 }}>
                    <Avatar name={a.name} hue={a.avatarHue} size={44} src={a.photo} />
                    <div style={{ minWidth: 0 }}>
                      <div className="row ai-center gap6">
                        <span className="t-md fw6">{a.name}</span>
                        <span className="t-xs fw6" style={{
                          color: chip.color, background: `color-mix(in srgb, ${chip.color} 14%, transparent)`,
                          padding: '1px 7px', borderRadius: 999,
                        }}>{chip.label}</span>
                      </div>
                      <div className="t-xs muted3">{a.subtitle}</div>
                    </div>
                  </div>
                  <Badge tone={critical ? 'danger' : 'warning'} dot>
                    {a.streak} day{a.streak === 1 ? '' : 's'} absent
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
        </>
        )}
      </Modal>
    </>
  )
}

export function ClassWiseStudents({ editable, leadership }: { editable: boolean; leadership: boolean }) {
  const app = useApp()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const { data: students = [], isLoading: studentsLoading } = useStudents()
  const [mode, setMode] = useState<'day' | 'month'>('day')
  const [date, setDate] = useState(todayIso)
  const [month, setMonth] = useState(() => todayIso().slice(0, 7))
  const [q, setQ] = useState('')
  const [openGradeId, setOpenGradeId] = useState<string | null>(null)
  const [openClassId, setOpenClassId] = useState<string | null>(null)
  const [localTick, setLocalTick] = useState(0)
  const [localByClass, setLocalByClass] = useState<Map<string, LocalCount>>(new Map())

  useEffect(() => {
    if (mode === 'month' && !date.startsWith(month)) {
      const days = daysInMonth(month)
      setDate(days.includes(todayIso()) && todayIso().startsWith(month) ? todayIso() : (days[0] ?? `${month}-01`))
    }
  }, [mode, month, date])

  const principalQ = usePrincipalAttendance(date, leadership)
  const periodDayQ = usePeriodAttendanceRangeSummary(
    { preset: 'custom', from: date, to: date },
    leadership,
  )
  const liveClasses = useMemo(
    () => classes.filter((c) => c.id).slice().sort(compareClassesAscending),
    [classes],
  )

  const summaryById = useMemo(() => {
    const m = new Map<string, { present: number; total: number; pct: number; marked: number }>()
    for (const row of principalQ.data?.classes ?? []) {
      m.set(String(row.classId).toLowerCase(), {
        present: row.present,
        total: row.total,
        pct: Number(row.pct) || 0,
        marked: row.marked ?? 0,
      })
    }
    return m
  }, [principalQ.data])

  // Refresh class counts after a student period save.
  useEffect(() => {
    const bump = () => setLocalTick((n) => n + 1)
    window.addEventListener(ATTENDANCE_SAVED_EVENT, bump)
    window.addEventListener(ATTENDANCE_CHANGED, bump)
    return () => {
      window.removeEventListener(ATTENDANCE_SAVED_EVENT, bump)
      window.removeEventListener(ATTENDANCE_CHANGED, bump)
    }
  }, [])

  /* Present/absent tallied from SQL period-records for the selected day. */
  useEffect(() => {
    let cancelled = false
    void listAllPeriodAttendanceRecords({ from: date, to: date, preset: 'custom' })
      .then((rows) => {
        if (!cancelled) setLocalByClass(periodCountsByClass(rows, date))
      })
      .catch(() => { if (!cancelled) setLocalByClass(new Map()) })
    return () => { cancelled = true }
  }, [date, localTick])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    const list = !term
      ? liveClasses
      : liveClasses.filter((c) =>
        classLabel(c).toLowerCase().includes(term)
        || classCode(c).toLowerCase().includes(term)
        || (c.grade || '').toLowerCase().includes(term))
    return list
  }, [liveClasses, q])

  /* Group sections under their grade so we show grades first, then sections on click. */
  const gradeGroups = useMemo(() => {
    const map = new Map<string, SchoolClass[]>()
    for (const c of filtered) {
      const g = (c.grade || classLabel(c)).trim() || '—'
      const arr = map.get(g)
      if (arr) arr.push(c)
      else map.set(g, [c])
    }
    return [...map.entries()]
      .map(([grade, secs]) => ({ grade, sections: secs.slice().sort(compareClassesAscending) }))
      .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.grade.localeCompare(b.grade))
  }, [filtered])

  /* While searching, auto-expand matching grades so results are visible. */
  const searching = q.trim().length > 0

  const dayHero = classWiseDayHero({
    range: periodDayQ.data,
    localByClass,
  })
  const heroLoading = leadership && periodDayQ.isPending && localByClass.size === 0
  const hero = classWiseHeroDisplay({ loading: heroLoading, hero: dayHero })
  const presentTotal = dayHero.present
  const attendancePct = dayHero.pct
  const absentOrUnmarked = dayHero.absent
  const monthDays = mode === 'month' ? daysInMonth(month) : []

  return (
    <>
    {leadership && (
      <AbsenceAlertsPanel students={students} editable={editable} schoolName={app.school?.name || 'School'} />
    )}
    {leadership && <AttendanceTrendCard classes={liveClasses} />}
    <Card pad={false}>
      <CardHead
        title="Students · class-wise"
        sub={leadership
          ? 'Owner / Admin / Principal can mark present / absent for any class. Teacher app marks also show here.'
          : 'Open a class to mark or review attendance.'}
        icon="users"
        action={
          <div className="row ai-center gap8 wrap">
            <Segmented
              value={mode}
              onChange={(v) => setMode(v as 'day' | 'month')}
              options={[
                { value: 'day', label: 'Day' },
                { value: 'month', label: 'Month' },
              ]}
            />
            {mode === 'day' ? (
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            ) : (
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                style={{ width: 150 }}
              />
            )}
            <Search value={q} onChange={setQ} placeholder="Find class…" style={{ width: 160 }} />
          </div>
        }
      />

      {leadership && (
        <div className="sm-att-hero">
          <div className="row ai-center gap16 wrap">
            <Donut
              size={96}
              thickness={13}
              segments={[
                { value: presentTotal, color: 'var(--success)' },
                { value: absentOrUnmarked, color: 'var(--danger)' },
              ]}
              center={
                <div style={{ textAlign: 'center', lineHeight: 1.1 }}>
                  <div className="fw7" style={{ fontSize: 18 }}>
                    {heroLoading ? '—' : (attendancePct == null ? '—' : `${attendancePct}%`)}
                  </div>
                  <div className="t-xs muted3">periods</div>
                </div>
              }
            />
            <div className="sm-att-hero-kpis" style={{ flex: 1 }}>
              <div>
                <div className="sm-att-hero-val">
                  {hero.pctLabel}
                </div>
                <div className="t-sm muted">{heroLoading ? 'Loading today’s attendance' : 'Today’s attendance'}</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{hero.presentLabel}</div>
                <div className="t-xs muted3">Present / late</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{hero.absentLabel}</div>
                <div className="t-xs muted3">Absent / leave</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{hero.markedLabel}</div>
                <div className="t-xs muted3">Marked periods</div>
              </div>
            </div>
          </div>
          <div className="row ai-center gap8 wrap">
            <Badge tone="info" icon="phone">Teacher app synced</Badge>
            <span className="t-xs muted3">{date}</span>
          </div>
          <div className="sm-meter" style={{ width: '100%', height: 8, marginTop: 4 }}>
            <span style={{
              width: `${attendancePct ?? 0}%`,
              background: 'var(--success)',
            }} />
          </div>
        </div>
      )}

      {mode === 'month' && (
        <div className="sm-att-days">
          {monthDays.map((d) => {
            const dayNum = Number(d.slice(-2))
            const on = d === date
            return (
              <button
                key={d}
                type="button"
                className={['sm-att-day', on && 'on'].filter(Boolean).join(' ')}
                onClick={() => setDate(d)}
              >
                {dayNum}
              </button>
            )
          })}
        </div>
      )}

      {classesLoading || studentsLoading ? (
        <div style={{ padding: 24 }}><span className="t-sm muted">Loading classes…</span></div>
      ) : gradeGroups.length === 0 ? (
        <div style={{ padding: 8 }}><Empty icon="grid" title="No classes" body="Add classes in Academics first." /></div>
      ) : (
        <div className="sm-att-class-list">
          {gradeGroups.map(({ grade, sections }) => (
            <GradeGroup
              key={grade}
              grade={grade}
              sections={sections}
              date={date}
              students={students}
              editable={editable}
              summaryById={summaryById}
              localByClass={localByClass}
              open={searching || openGradeId === grade}
              onToggle={() => setOpenGradeId((g) => (g === grade ? null : grade))}
              openClassId={openClassId}
              onToggleClass={(id) => setOpenClassId((cur) => (cur === id ? null : id))}
            />
          ))}
        </div>
      )}
    </Card>
    </>
  )
}
