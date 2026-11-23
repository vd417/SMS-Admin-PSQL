/* ============================================================
   SchoolMate — School console: live Dashboard + Approvals inbox
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApp, useToast } from '@/lib/hooks'
import { can } from '@/lib/gating'
import { formatStudentRoll } from '@/lib/studentRoll'
import {
  Card, PageHead, Badge, Btn, Icon, Avatar,
  Donut, LineChart, Legend, Empty, Modal, Field, Textarea, Segmented,
} from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { Spark } from '@/components/charts/Charts'
import { academicYearStart } from '@/api/studentAttendance'
import dashSchool from '@/assets/dash-school.jpg'
import dashStudents from '@/assets/dash-students.jpg'
import dashTeachers from '@/assets/dash-teachers.jpg'
import dashStaff from '@/assets/dash-staff.jpg'
import './dashboardBoard.css'
import { useApprovals } from '@/api/hooks/useApprovals'
import { inboxApprovals, type ApprovalFilter } from '@/api/approvals'
import { useActOnApproval } from '@/api/hooks/useApprovalMutations'
import { useCrmPeopleSnapshot } from '@/api/hooks/useCrmDashboard'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { usePrincipalAttendance } from '@/api/hooks/usePrincipalAttendance'
import { usePeriodAttendanceRangeSummary, useDashboardAttendanceTrend } from '@/api/hooks/usePeriodAttendanceAdvanced'
import { listAllPeriodAttendanceRecords, studentDayHeadcount, studentDayStatusById } from '@/api/periodAttendanceAdvanced'
import { listStudentsPage } from '@/api/students'
import { useFeeReportSummary } from '@/api/hooks/useFeeReports'
import { useAnnouncements } from '@/api/hooks/useAnnouncements'
import { useFeePayments } from '@/api/hooks/useFeePayments'
import { useDashboardExamBands } from '@/api/hooks/useExams'
import {
  countPeoplePresent, PEOPLE_ATTENDANCE_CHANGED,
  explicitPeopleStatus, fetchRemotePeopleAttendance, type CheckInInfo,
} from '@/api/peopleAttendance'
import type { AttendanceStatus } from '@/api/attendance'
import { fmtMoney, fmtNum } from '@/lib/format'
import { principalStaffToCheckInMap } from '@/lib/geoAttendanceDemo'
import { enrollmentByStageFromCounts } from '@/lib/dashboardLive'
import type { Approval, ApprovalStatus, Role, Student } from '@/types'

function announcementTone(type?: string): BadgeTone {
  const t = (type || '').toLowerCase()
  if (t.includes('fee') || t.includes('payment') || t.includes('receipt')) return 'warning'
  if (t.includes('exam')) return 'brand'
  if (t.includes('event')) return 'info'
  return 'neutral'
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function canSeeLiveAttendance(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'principal' || role === 'vice_principal'
}

/* ============================================================
   School Dashboard
   ============================================================ */
type SplitCounts = { present: number; absent: number; late: number; leave: number; unmarked: number }

function emptySplit(): SplitCounts {
  return { present: 0, absent: 0, late: 0, leave: 0, unmarked: 0 }
}

function buildStudentSplit(
  students: Student[],
  status: Map<string, 'present' | 'absent' | 'late' | 'leave'>,
) {
  const boys = emptySplit()
  const girls = emptySplit()
  const classes = new Map<string, SplitCounts & { grade: string; section: string }>()
  for (const student of students) {
    const mark = status.get(student.id) ?? 'unmarked'
    const gender = student.gender === 'M' ? boys : student.gender === 'F' ? girls : null
    if (gender) gender[mark] += 1
    const grade = student.grade || '—'
    const section = student.section || '—'
    const key = `${grade}\0${section}`
    const row = classes.get(key) ?? { grade, section, ...emptySplit() }
    row[mark] += 1
    classes.set(key, row)
  }
  return {
    boys,
    girls,
    classes: [...classes.values()].sort((a, b) =>
      a.grade.localeCompare(b.grade, undefined, { numeric: true }) || a.section.localeCompare(b.section)),
  }
}

type PeopleMark = 'present' | 'absent' | 'late' | 'leave'

function peopleMarkOf(
  person: { id: string; name: string },
  marks: Record<string, AttendanceStatus>,
  opts: { checkIn: Map<string, CheckInInfo>; principalKnown: boolean },
): PeopleMark | null {
  const mark = marks[person.id]
  if (mark === 'late') return 'late'
  if (mark === 'absent') return 'absent'
  if (mark === 'leave') return 'leave'
  if (mark === 'present' || mark === 'half_day') return 'present'
  const status = explicitPeopleStatus(person, marks, opts)
  if (status === 'late') return 'late'
  if (status === 'absent') return 'absent'
  if (status === 'present' || status === 'half_day') return 'present'
  return null
}

function countPeopleMarks(
  people: { id: string; name: string }[],
  marks: Record<string, AttendanceStatus>,
  opts: { checkIn: Map<string, CheckInInfo>; principalKnown: boolean },
): SplitCounts {
  const counts = emptySplit()
  for (const person of people) {
    const mark = peopleMarkOf(person, marks, opts)
    if (mark) counts[mark] += 1
    else counts.unmarked += 1
  }
  return counts
}

const PIE_COLOR = {
  present: '#22C55E',
  absent: '#DC2626',
  late: '#D97706',
  unmarked: '#94A3B8',
  leave: '#7C3AED',
  boys: '#0EA5E9',
  girls: '#EC4899',
} as const

function markedSegments(counts: SplitCounts) {
  return [
    { value: counts.present, color: PIE_COLOR.present, label: 'Present' },
    { value: counts.absent, color: PIE_COLOR.absent, label: 'Absent' },
    { value: counts.late, color: PIE_COLOR.late, label: 'Late' },
    { value: counts.leave, color: PIE_COLOR.leave, label: 'Leave' },
  ].filter((part) => part.value > 0)
}

function ColorPie({ segments, caption }: { segments: { value: number; color: string; label: string }[]; caption: string }) {
  const total = segments.reduce((sum, part) => sum + part.value, 0)
  if (!total) {
    return (
      <div className="col ai-center gap8" style={{ minWidth: 140 }}>
        <div className="t-sm fw6">{caption}</div>
        <div className="t-xs muted3">No marks yet</div>
      </div>
    )
  }
  return (
    <div className="col ai-center gap10" style={{ minWidth: 160 }}>
      <Donut
        segments={segments}
        size={132}
        thickness={16}
        center={<div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fmtNum(total)}</div>
          <div className="t-xs muted3">{caption}</div>
        </div>}
      />
      <Legend items={segments.map((part) => ({ color: part.color, label: `${part.label} — ${fmtNum(part.value)}` }))} />
    </div>
  )
}

function SchoolDashboard() {
  const app = useApp()
  const s = app.school
  const cur = s.currency
  const liveAtt = canSeeLiveAttendance(app.role)
  const today = todayIso()
  const [pie, setPie] = useState<null | 'students' | 'teachers' | 'staff'>(null)
  const [classGrade, setClassGrade] = useState<string | null>(null)
  const [classSection, setClassSection] = useState<string | null>(null)
  const [subjectName, setSubjectName] = useState<string | null>(null)

  const peopleQ = useCrmPeopleSnapshot()
  const teachersQ = useTeachers()
  const staffQ = useStaff()
  const attQ = usePrincipalAttendance(today, liveAtt)
  const periodDayQ = usePeriodAttendanceRangeSummary(
    { preset: 'custom', from: today, to: today },
    liveAtt,
  )
  const feeQ = useFeeReportSummary()
  const paymentsQ = useFeePayments()
  const announcementsQ = useAnnouncements()
  /* Trend waits for today's KPI so 8 week rollups do not starve the first paint. */
  const trendQ = useDashboardAttendanceTrend(liveAtt && (periodDayQ.isSuccess || periodDayQ.isError))
  const examBandsQ = useDashboardExamBands()

  /* Teacher/staff marks from API (memory cache after success); never hydrate from localStorage. */
  const [teacherMarks, setTeacherMarks] = useState<Record<string, AttendanceStatus>>({})
  const [staffMarks, setStaffMarks] = useState<Record<string, AttendanceStatus>>({})
  const [peopleMarksReady, setPeopleMarksReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    setTeacherMarks({})
    setStaffMarks({})
    setPeopleMarksReady(false)
    void Promise.all([
      fetchRemotePeopleAttendance('teachers', today)
        .then((m) => { if (!cancelled) setTeacherMarks(m) })
        .catch(() => { if (!cancelled) setTeacherMarks({}) }),
      fetchRemotePeopleAttendance('staff', today)
        .then((m) => { if (!cancelled) setStaffMarks(m) })
        .catch(() => { if (!cancelled) setStaffMarks({}) }),
    ]).finally(() => { if (!cancelled) setPeopleMarksReady(true) })
    const bump = () => {
      void fetchRemotePeopleAttendance('teachers', today)
        .then((m) => { if (!cancelled) setTeacherMarks(m) })
        .catch(() => { /* keep last API snapshot */ })
      void fetchRemotePeopleAttendance('staff', today)
        .then((m) => { if (!cancelled) setStaffMarks(m) })
        .catch(() => { /* keep last API snapshot */ })
    }
    window.addEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
    window.addEventListener('focus', bump)
    return () => {
      cancelled = true
      window.removeEventListener(PEOPLE_ATTENDANCE_CHANGED, bump)
      window.removeEventListener('focus', bump)
    }
  }, [today])

  const liveStudents = peopleQ.data?.studentCount ?? 0
  const liveTeachers = peopleQ.data?.teacherCount ?? 0
  const teacherMen = (teachersQ.data ?? []).filter((t) => t.gender === 'M').length
  const teacherWomen = (teachersQ.data ?? []).filter((t) => t.gender === 'F').length
  const liveSupport = peopleQ.data?.staffCount ?? 0
  const countsLoading = peopleQ.isLoading
  const rosterLoading = teachersQ.isLoading || staffQ.isLoading
  const liveGrades = peopleQ.data?.uniqueGrades ?? 0

  const headcountFromApi = periodDayQ.data?.presentStudents != null
    && periodDayQ.data.absentStudents != null
    && periodDayQ.data.lateStudents != null
  const todayMarksQ = useQuery({
    queryKey: ['dashboard', 'today-student-headcount', today],
    queryFn: () => listAllPeriodAttendanceRecords({ preset: 'custom', from: today, to: today }),
    enabled: liveAtt && periodDayQ.isSuccess && (!headcountFromApi || pie === 'students'),
    staleTime: 15_000,
  })
  const studentHead = !liveAtt ? null
    : headcountFromApi
      ? {
          presentStudents: periodDayQ.data!.presentStudents!,
          absentStudents: periodDayQ.data!.absentStudents!,
          lateStudents: periodDayQ.data!.lateStudents!,
          leaveStudents: 0,
        }
      : todayMarksQ.data
        ? studentDayHeadcount(todayMarksQ.data)
        : null
  const studentHeadLoading = liveAtt && (periodDayQ.isPending || (!headcountFromApi && todayMarksQ.isLoading))
  const studentsPresentCount = studentHead?.presentStudents ?? 0
  const studentsAbsentCount = studentHead?.absentStudents ?? 0
  const studentsLateCount = studentHead?.lateStudents ?? 0
  const studentsLeaveCount = studentHead?.leaveStudents ?? 0
  const studentsMarked = studentsPresentCount + studentsAbsentCount + studentsLateCount + studentsLeaveCount
  const studentsUnmarked = Math.max(0, liveStudents - studentsMarked)
  const studentHeadRate = liveStudents ? Math.round((studentsPresentCount / liveStudents) * 100) : 0
  const rosterQ = useQuery({
    queryKey: ['dashboard', 'student-roster'],
    queryFn: async () => {
      const all: Student[] = []
      let cursor: string | undefined
      for (let page = 0; page < 30; page++) {
        const batch = await listStudentsPage({ limit: 200, cursor })
        all.push(...batch.rows)
        if (!batch.nextCursor) break
        cursor = batch.nextCursor
      }
      return all
    },
    enabled: liveAtt,
    staleTime: 30_000,
  })
  const studentStatus = useMemo(
    () => studentDayStatusById(todayMarksQ.data ?? []),
    [todayMarksQ.data],
  )
  const studentSplit = useMemo(() => buildStudentSplit(rosterQ.data ?? [], studentStatus), [rosterQ.data, studentStatus])
  const classGroups = useMemo(() => {
    const byGrade = new Map<string, SplitCounts>()
    for (const row of studentSplit.classes) {
      const cur = byGrade.get(row.grade) ?? emptySplit()
      cur.present += row.present
      cur.absent += row.absent
      cur.late += row.late
      cur.leave += row.leave
      cur.unmarked += row.unmarked
      byGrade.set(row.grade, cur)
    }
    return [...byGrade.entries()]
      .map(([grade, counts]) => ({ grade, ...counts }))
      .sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }))
  }, [studentSplit])
  const sectionSubjects = useMemo(() => {
    if (!classGrade || !classSection) return []
    const ids = new Set(
      (rosterQ.data ?? [])
        .filter((student) => student.grade === classGrade && (student.section || '—') === classSection)
        .map((student) => student.id),
    )
    const bySubject = new Map<string, SplitCounts & { period: number }>()
    for (const row of todayMarksQ.data ?? []) {
      const inSection = ids.has(row.studentId)
        || (row.grade === classGrade && (row.section || '—') === classSection)
      if (!inSection) continue
      const status = String(row.status ?? '').trim().toLowerCase().replace(/-/g, '_')
      const bucket = status === 'present' || status === 'half_day' ? 'present'
        : status === 'late' ? 'late'
        : status === 'absent' ? 'absent'
        : status === 'leave' ? 'leave'
        : null
      if (!bucket) continue
      const subject = row.subject.trim() || '—'
      const cur = bySubject.get(subject) ?? { ...emptySplit(), period: row.period }
      cur[bucket] += 1
      cur.period = Math.min(cur.period, row.period || cur.period)
      bySubject.set(subject, cur)
    }
    return [...bySubject.entries()]
      .map(([subject, counts]) => ({ subject, ...counts }))
      .sort((a, b) => a.period - b.period || a.subject.localeCompare(b.subject))
  }, [classGrade, classSection, rosterQ.data, todayMarksQ.data])
  const subjectStudents = useMemo(() => {
    if (!classGrade || !classSection || !subjectName) return []
    const roster = rosterQ.data ?? []
    const byId = new Map(roster.map((student) => [student.id, student]))
    const ids = new Set(
      roster
        .filter((student) => student.grade === classGrade && (student.section || '—') === classSection)
        .map((student) => student.id),
    )
    const seen = new Map<string, { id: string; name: string; roll: number; period: number; status: 'present' | 'absent' | 'late' | 'leave' }>()
    for (const row of todayMarksQ.data ?? []) {
      const inSection = ids.has(row.studentId)
        || (row.grade === classGrade && (row.section || '—') === classSection)
      if (!inSection || (row.subject.trim() || '—') !== subjectName) continue
      const status = String(row.status ?? '').trim().toLowerCase().replace(/-/g, '_')
      const bucket = status === 'present' || status === 'half_day' ? 'present'
        : status === 'late' ? 'late'
        : status === 'absent' ? 'absent'
        : status === 'leave' ? 'leave'
        : null
      if (!bucket) continue
      const student = byId.get(row.studentId)
      const cur = seen.get(row.studentId)
      if (cur && cur.period > row.period) continue
      seen.set(row.studentId, {
        id: row.studentId,
        name: student?.name || row.studentName || '—',
        roll: student?.roll ?? 0,
        period: row.period,
        status: bucket,
      })
    }
    return [...seen.values()].sort((a, b) => (a.roll || 9999) - (b.roll || 9999) || a.name.localeCompare(b.name))
  }, [classGrade, classSection, subjectName, rosterQ.data, todayMarksQ.data])
  const peopleOpts = useMemo(
    () => ({
      checkIn: attQ.isSuccess ? principalStaffToCheckInMap(attQ.data?.staff ?? []) : new Map<string, CheckInInfo>(),
      principalKnown: attQ.isSuccess,
    }),
    [attQ.data, attQ.isSuccess],
  )
  const teacherSplit = useMemo(
    () => countPeopleMarks(teachersQ.data ?? [], teacherMarks, peopleOpts),
    [teachersQ.data, teacherMarks, peopleOpts],
  )
  const staffSplit = useMemo(
    () => countPeopleMarks(staffQ.data ?? [], staffMarks, peopleOpts),
    [staffQ.data, staffMarks, peopleOpts],
  )
  const peopleDetail = useMemo(() => {
    const marks = pie === 'teachers' ? teacherMarks : staffMarks
    const roster = pie === 'teachers'
      ? (teachersQ.data ?? []).map((person) => ({ id: person.id, code: person.code?.trim() || person.id, name: person.name }))
      : pie === 'staff'
        ? (staffQ.data ?? []).map((person) => ({ id: person.id, code: person.code?.trim() || person.id, name: person.name }))
        : []
    return roster
      .map((person) => ({ ...person, status: peopleMarkOf(person, marks, peopleOpts) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [pie, teachersQ.data, staffQ.data, teacherMarks, staffMarks, peopleOpts])

  /* Teachers & staff: app check-in OR CRM mark — same rule as Attendance roster. */
  const teachersPresent = useMemo(() => {
    const teachers = teachersQ.data ?? []
    if (!teachers.length) return 0
    const checkIn = attQ.isSuccess ? principalStaffToCheckInMap(attQ.data?.staff ?? []) : new Map<string, CheckInInfo>()
    return countPeoplePresent(
      teachers.map((t) => ({ id: t.id, name: t.name })),
      teacherMarks,
      { checkIn, principalKnown: attQ.isSuccess },
    )
  }, [teachersQ.data, attQ.data, attQ.isSuccess, teacherMarks])

  const teacherRate = liveTeachers ? Math.round((teachersPresent / liveTeachers) * 100) : 0

  const supportPresent = useMemo(() => {
    const staff = staffQ.data ?? []
    if (!staff.length) return 0
    const checkIn = attQ.isSuccess ? principalStaffToCheckInMap(attQ.data?.staff ?? []) : new Map<string, CheckInInfo>()
    return countPeoplePresent(
      staff.map((p) => ({ id: p.id, name: p.name })),
      staffMarks,
      { checkIn, principalKnown: attQ.isSuccess },
    )
  }, [staffQ.data, attQ.data, attQ.isSuccess, staffMarks])

  const supportRate = liveSupport ? Math.round((supportPresent / liveSupport) * 100) : 0

  const feesToday = feeQ.data?.collectedToday ?? 0
  const outstanding = feeQ.data?.outstanding ?? 0
  const collectedPct = feeQ.data?.pct ?? 0
  const collectedTerm = feeQ.data?.collectedTerm ?? 0
  const defaulters = feeQ.data?.defaulters ?? 0
  const latestPayment = feeQ.data?.latestPayment
  const feeLoading = feeQ.isLoading
  const feeReady = Boolean(feeQ.data) || feeQ.isError
  const ratio = liveTeachers ? Math.round(liveStudents / liveTeachers) : 0

  const attTrend = useMemo(() => (trendQ.data ?? []).filter((p) => !p.empty), [trendQ.data])
  const attSpark = attTrend.map((p) => p.value)

  const recentPayments = useMemo(() => {
    const rows = paymentsQ.data ?? []
    return [...rows]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.id) - Number(a.id))
      .slice(0, 5)
  }, [paymentsQ.data])

  const activity = useMemo(() => {
    const rows: { time: string; text: string }[] = []
    for (const p of recentPayments) {
      rows.push({
        time: p.date || 'recent',
        text: `Fee payment — ${fmtMoney(p.amount, cur)} · ${p.studentName} (${p.cls})${p.mode ? ` · ${p.mode}` : ''}`,
      })
    }
    if (!recentPayments.length && latestPayment) {
      rows.push({
        time: latestPayment.date || 'recent',
        text: `Fee payment — ${fmtMoney(latestPayment.amount, cur)} · ${latestPayment.studentName} (${latestPayment.cls})`,
      })
    }
    if (feeReady && !feeLoading) {
      rows.push({
        time: 'fees',
        text: `Fees · collected today ${fmtMoney(feesToday, cur)} · outstanding ${fmtMoney(outstanding, cur)} · ${fmtNum(defaulters)} due`,
      })
    }
    if (studentHead && !studentHeadLoading) {
      rows.push({
        time: 'today',
        text: `Students · ${fmtNum(studentsPresentCount)} of ${fmtNum(liveStudents)} present today`,
      })
    }
    if (teachersQ.isSuccess) {
      rows.push({
        time: 'today',
        text: `Teachers · ${fmtNum(teachersPresent)} of ${fmtNum(liveTeachers)} present (${teacherRate}%)`,
      })
    }
    if (staffQ.isSuccess) {
      rows.push({
        time: 'today',
        text: `Staff · ${fmtNum(supportPresent)} of ${fmtNum(liveSupport)} present (${supportRate}%)`,
      })
    }
    return rows
  }, [
    recentPayments, latestPayment, cur, feeReady, feeLoading,
    feesToday, outstanding, defaulters,
    studentHead, studentHeadLoading, studentsPresentCount, liveStudents,
    teachersQ.isSuccess, teachersPresent, liveTeachers, teacherRate,
    staffQ.isSuccess, supportPresent, liveSupport, supportRate,
  ])

  const liveAnnouncements = useMemo(() => {
    return (announcementsQ.data ?? []).slice(0, 6).map((a) => ({
      tag: a.type || a.ch || 'Notice',
      tone: announcementTone(a.type || a.ch || a.title),
      title: a.title,
      when: a.when,
    }))
  }, [announcementsQ.data])

  const stageSlices = useMemo(
    () => enrollmentByStageFromCounts(peopleQ.data?.grades ?? []),
    [peopleQ.data?.grades],
  )
  const gender = {
    boys: peopleQ.data?.boys ?? 0,
    girls: peopleQ.data?.girls ?? 0,
    unspecified: peopleQ.data?.unspecified ?? 0,
  }
  const examBands = examBandsQ.data?.bands ?? []
  const greetName = (app.user?.name || '').trim().split(/\s+/)[0] || 'there'
  const yearStart = academicYearStart()
  const yearLabel = `${yearStart} – ${String(yearStart + 1).slice(-2)}`
  const dateLabel = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const feeSpark = recentPayments.map((p) => p.amount).reverse()

  return (
    <div className="sm-dash col gap20">
      <section className="sd-welcome">
        <SchoolArt school={s} />
        <div className="sd-welcome-copy" style={{ flex: 1 }}>
          <h1>Welcome back, {greetName}!</h1>
          <p>Have a great day at {s.name}</p>
        </div>
        <div className="sd-date">
          <span className="ic"><Icon name="calendar" size={18} /></span>
          <div>
            <b>{dateLabel}</b>
            <span>Academic year {yearLabel}</span>
          </div>
        </div>
      </section>

      <div className="sd-kpis">
        <button type="button" className="sd-kpi blue" onClick={() => app.go('school.sis')}>
          <div className="sd-kpi-top">
            <span className="sd-kpi-ic"><Icon name="users" size={16} /></span>
            <span className="sd-kpi-label">Total enrolment</span>
            <Icon name="chevRight" size={16} className="sd-kpi-go" />
          </div>
          <div className="sd-kpi-val">{countsLoading ? '—' : fmtNum(liveStudents)}</div>
          <div className="sd-kpi-delta up">{countsLoading ? 'Loading roster…' : `${fmtNum(liveGrades)} grade${liveGrades === 1 ? '' : 's'}`}</div>
        </button>
        <button type="button" className="sd-kpi green" onClick={() => app.go('school.attendance')}>
          <div className="sd-kpi-top">
            <span className="sd-kpi-ic"><Icon name="calendar" size={16} /></span>
            <span className="sd-kpi-label">Today's attendance</span>
            <Icon name="chevRight" size={16} className="sd-kpi-go" />
          </div>
          <div className="sd-kpi-val">{studentHeadLoading || countsLoading ? '—' : `${fmtNum(studentsPresentCount)}/${fmtNum(liveStudents)}`}</div>
          <div className={studentHeadRate > 0 ? 'sd-kpi-delta up' : 'sd-kpi-delta down'}>
            {studentHeadLoading || countsLoading ? 'Loading…' : `${studentHeadRate}%`}
          </div>
          {attSpark.length >= 2 ? <div className="sd-kpi-spark"><Spark data={attSpark} w={180} h={36} color="#16a34a" /></div> : null}
        </button>
        <button type="button" className="sd-kpi violet" onClick={() => app.go('school.fees')}>
          <div className="sd-kpi-top">
            <span className="sd-kpi-ic"><Icon name="rupee" size={16} /></span>
            <span className="sd-kpi-label">Fees collected today</span>
            <Icon name="chevRight" size={16} className="sd-kpi-go" />
          </div>
          <div className="sd-kpi-val">{feeLoading ? '—' : fmtMoney(feesToday, cur)}</div>
          <div className={collectedPct > 0 ? 'sd-kpi-delta up' : 'sd-kpi-delta down'}>
            {feeLoading ? 'Loading…' : `${collectedPct}% of term`}
          </div>
          {feeSpark.length >= 2 ? <div className="sd-kpi-spark"><Spark data={feeSpark} w={180} h={36} color="#7c3aed" /></div> : null}
        </button>
        <button type="button" className="sd-kpi peach" onClick={() => app.go('school.fees')}>
          <div className="sd-kpi-top">
            <span className="sd-kpi-ic"><Icon name="wallet" size={16} /></span>
            <span className="sd-kpi-label">Outstanding dues</span>
            <Icon name="chevRight" size={16} className="sd-kpi-go" />
          </div>
          <div className="sd-kpi-val">{feeLoading ? '—' : fmtMoney(outstanding, cur)}</div>
          <div className={defaulters > 0 ? 'sd-kpi-delta down' : 'sd-kpi-delta up'}>
            {feeLoading ? 'Loading…' : `${fmtNum(defaulters)} due`}
          </div>
        </button>
      </div>

      <div className="sd-people">
        <PeopleCard
          tone="violet" label="Students" art={<ArtStudents />}
          count={liveStudents}
          sub={liveTeachers ? `Student–teacher ratio ${ratio}:1` : 'On the school roster'}
          present={studentsPresentCount}
          loading={countsLoading}
          onClick={() => app.go('school.sis')}
        />
        <PeopleCard
          tone="green" label="Teachers" art={<ArtTeacher />}
          count={liveTeachers} sub={`Male ${fmtNum(teacherMen)} · Female ${fmtNum(teacherWomen)}`}
          present={teachersPresent}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => app.go('school.teachers')}
        />
        <PeopleCard
          tone="blue" label="Support staff" art={<ArtStaff />}
          count={liveSupport} sub="From attendance"
          present={supportPresent}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => app.go('school.staff')}
        />
      </div>

      <div className="sd-atts">
        <AttendanceDonut
          title="Students attendance"
          icon="users"
          present={studentsPresentCount}
          absent={studentsAbsentCount}
          late={studentsLateCount}
          leave={studentsLeaveCount}
          unmarked={studentsUnmarked}
          boys={studentSplit.boys.present}
          girls={studentSplit.girls.present}
          loading={studentHeadLoading || countsLoading}
          onClick={() => { setClassGrade(null); setClassSection(null); setSubjectName(null); setPie('students') }}
        />
        <AttendanceDonut
          title="Teachers attendance"
          icon="cap"
          present={teacherSplit.present}
          absent={teacherSplit.absent}
          late={teacherSplit.late}
          leave={teacherSplit.leave}
          unmarked={teacherSplit.unmarked}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => setPie('teachers')}
        />
        <AttendanceDonut
          title="Staff attendance"
          icon="briefcase"
          present={staffSplit.present}
          absent={staffSplit.absent}
          late={staffSplit.late}
          leave={staffSplit.leave}
          unmarked={staffSplit.unmarked}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => setPie('staff')}
        />
      </div>

      <Modal
        open={pie != null}
        onClose={() => { setPie(null); setClassGrade(null); setClassSection(null); setSubjectName(null) }}
        size="xl"
        icon="users"
        title={pie === 'teachers' ? 'Teachers today' : pie === 'staff' ? 'Staff today' : subjectName ? `${subjectName} · Class ${classGrade} ${classSection}` : classSection ? `Class ${classGrade} · Section ${classSection}` : classGrade ? `Class ${classGrade}` : 'Classes today'}
        sub={pie === 'students'
          ? (subjectName
            ? 'Roll and name for this subject period'
            : classSection
            ? 'Click a subject to see students'
            : classGrade
              ? 'Click a section to see each subject'
              : 'Click a class to see its sections')
          : 'ID and name · green present, red absent, amber late, purple leave'}
      >
        {pie === 'students' && (
          rosterQ.isLoading || (todayMarksQ.isLoading && !todayMarksQ.data) ? (
            <Empty icon="users" title="Loading students…" body="Reading today’s class attendance." />
          ) : classGrade == null ? (
            <div className="col gap16">
              <Legend items={[
                { color: PIE_COLOR.present, label: 'Present' },
                { color: PIE_COLOR.absent, label: 'Absent' },
                { color: PIE_COLOR.late, label: 'Late' },
                { color: PIE_COLOR.leave, label: 'Leave' },
                { color: PIE_COLOR.boys, label: 'Boys' },
                { color: PIE_COLOR.girls, label: 'Girls' },
              ]} />
              <div className="row wrap gap16">
                <ColorPie caption="Boys" segments={markedSegments(studentSplit.boys)} />
                <ColorPie caption="Girls" segments={markedSegments(studentSplit.girls)} />
              </div>
              {classGroups.length === 0 ? (
                <Empty icon="users" title="No classes yet" body="Class pies appear after students are on the roster." />
              ) : (
              <div className="row wrap gap16">
                {classGroups.map((row) => (
                  <button key={row.grade} type="button" onClick={() => { setSubjectName(null); setClassSection(null); setClassGrade(row.grade) }} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', padding: 8 }}>
                    <ColorPie caption={`Class ${row.grade}`} segments={markedSegments(row)} />
                  </button>
                ))}
              </div>
              )}
            </div>
          ) : classSection == null ? (
            <div className="col gap16">
              <Btn size="sm" variant="ghost" icon="arrowLeft" onClick={() => { setSubjectName(null); setClassSection(null); setClassGrade(null) }}>All classes</Btn>
              <Legend items={[
                { color: PIE_COLOR.present, label: 'Present' },
                { color: PIE_COLOR.absent, label: 'Absent' },
                { color: PIE_COLOR.late, label: 'Late' },
                { color: PIE_COLOR.leave, label: 'Leave' },
              ]} />
              <div className="row wrap gap16">
                {studentSplit.classes.filter((row) => row.grade === classGrade).map((row) => (
                  <button key={row.section} type="button" onClick={() => { setSubjectName(null); setClassSection(row.section) }} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', padding: 8 }}>
                    <ColorPie caption={`Section ${row.section}`} segments={markedSegments(row)} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            subjectName == null ? (
            <div className="col gap16">
              <Btn size="sm" variant="ghost" icon="arrowLeft" onClick={() => { setSubjectName(null); setClassSection(null) }}>Sections</Btn>
              <Legend items={[
                { color: PIE_COLOR.present, label: 'Present' },
                { color: PIE_COLOR.absent, label: 'Absent' },
                { color: PIE_COLOR.late, label: 'Late' },
                { color: PIE_COLOR.leave, label: 'Leave' },
              ]} />
              {sectionSubjects.length === 0 ? (
                <Empty icon="check" title="No period marks" body="Subject pies appear after this section is marked today." />
              ) : (
                <div className="row wrap gap16">
                  {sectionSubjects.map((row) => (
                    <button key={row.subject} type="button" onClick={() => setSubjectName(row.subject)} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 12, cursor: 'pointer', padding: 8 }}>
                      <ColorPie caption={row.subject} segments={markedSegments(row)} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="col gap12">
              <Btn size="sm" variant="ghost" icon="arrowLeft" onClick={() => setSubjectName(null)}>Subjects</Btn>
              {subjectStudents.length === 0 ? (
                <Empty icon="users" title="No students" body="No period mark for this subject." />
              ) : (
                <div className="col gap8">
                  <div className="row ai-center gap12 t-xs muted3">
                    <div style={{ width: 56 }}>Roll</div>
                    <div style={{ flex: 1 }}>Name</div>
                    <div>Status</div>
                  </div>
                  {subjectStudents.map((student) => (
                    <div key={student.id} className="row ai-center gap12">
                      <div className="t-sm fw6" style={{ width: 56 }}>{formatStudentRoll(student.roll)}</div>
                      <div className="t-md" style={{ flex: 1 }}>{student.name}</div>
                      <Badge tone={student.status === 'present' ? 'success' : student.status === 'absent' ? 'danger' : student.status === 'late' ? 'warning' : 'brand'}>
                        {student.status === 'present' ? 'Present' : student.status === 'absent' ? 'Absent' : student.status === 'late' ? 'Late' : 'Leave'}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
          )
        )}
        {(pie === 'teachers' || pie === 'staff') && (
          <div className="col gap16">
            <Legend items={[
              { color: PIE_COLOR.present, label: 'Present' },
              { color: PIE_COLOR.absent, label: 'Absent' },
              { color: PIE_COLOR.late, label: 'Late' },
              { color: PIE_COLOR.leave, label: 'Leave' },
            ]} />
            <ColorPie caption={pie === 'teachers' ? 'Teachers' : 'Staff'} segments={markedSegments(pie === 'teachers' ? teacherSplit : staffSplit)} />
            {peopleDetail.length === 0 ? (
              <Empty icon="users" title="No one on the roster" body="Names appear when people are added." />
            ) : (
              <div className="col gap8">
                <div className="row ai-center gap12 t-xs muted3">
                  <div style={{ width: 140 }}>ID</div>
                  <div style={{ flex: 1 }}>Name</div>
                  <div>Status</div>
                </div>
                {peopleDetail.map((person) => (
                  <div key={person.id} className="row ai-center gap12">
                    <div className="t-sm fw6" style={{ width: 140 }}>{person.code}</div>
                    <div className="t-md" style={{ flex: 1 }}>{person.name}</div>
                    <Badge tone={person.status === 'present' ? 'success' : person.status === 'absent' ? 'danger' : person.status === 'late' ? 'warning' : person.status === 'leave' ? 'brand' : 'neutral'}>
                      {person.status === 'present' ? 'Present' : person.status === 'absent' ? 'Absent' : person.status === 'late' ? 'Late' : person.status === 'leave' ? 'Leave' : 'Not marked'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <div className="sd-more">
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="trend" size={16} /></span>
            <div>
              <div className="sd-att-title">Attendance trend</div>
              <div className="sd-att-sub">{trendQ.isLoading ? 'Loading…' : attTrend.length ? 'Weekly average · period marks' : '0 present · 0%'}</div>
            </div>
            <button type="button" className="sd-att-link" onClick={() => app.go('school.attendance')}>View details →</button>
          </div>
          {attTrend.length >= 2 ? (
            <div style={{ marginTop: 8 }}>
              <LineChart
                series={[{ data: attTrend.map((p) => p.value), color: '#818cf8', label: 'Attendance %' }]}
                labels={attTrend.map((p) => p.label)} yMax={100} yFmt={(v) => `${Math.round(v)}%`}
              />
            </div>
          ) : (
            <div className="sd-att-body">
              <Ring rate={attTrend[0]?.value ?? 0} />
              <ul className="sd-att-legend">
                <li><i style={{ background: PIE_COLOR.present }} />This week<b>{attTrend[0] ? `${attTrend[0].value}%` : '0%'}</b></li>
                <li><i style={{ background: '#94a3b8' }} />Weeks marked<b>{fmtNum(attTrend.length)}</b></li>
              </ul>
            </div>
          )}
        </section>
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="rupee" size={16} /></span>
            <div>
              <div className="sd-att-title">Fee collection</div>
              <div className="sd-att-sub">{feeLoading ? 'Loading…' : `${fmtMoney(collectedTerm, cur)} collected · ${collectedPct}%`}</div>
            </div>
            <button type="button" className="sd-att-link" onClick={() => app.go('school.fees')}>View details →</button>
          </div>
          <div className="sd-att-body">
            <Ring rate={feeLoading ? 0 : collectedPct} />
            <ul className="sd-att-legend wide">
              <li><i style={{ background: PIE_COLOR.present }} />Collected<b>{feeLoading ? '—' : fmtMoney(collectedTerm, cur)}</b></li>
              <li><i style={{ background: '#94a3b8' }} />Outstanding<b>{feeLoading ? '—' : fmtMoney(outstanding, cur)}</b></li>
              <li><i style={{ background: PIE_COLOR.late }} />Due<b>{feeLoading ? '—' : fmtNum(defaulters)}</b></li>
              <li><i style={{ background: '#818cf8' }} />Today<b>{feeLoading ? '—' : fmtMoney(feesToday, cur)}</b></li>
            </ul>
          </div>
        </section>
      </div>

      <div className="sd-more-3">
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="layers" size={16} /></span>
            <div>
              <div className="sd-att-title">Enrolment by stage</div>
              <div className="sd-att-sub">{countsLoading ? 'Loading…' : `${fmtNum(liveStudents)} students`}</div>
            </div>
          </div>
          <div className="sd-att-body">
            <Donut
              segments={stageSlices.filter((st) => st.value > 0)}
              size={128} thickness={12}
              center={<div style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{countsLoading ? '—' : fmtNum(liveStudents)}</div><div className="t-xs muted3">students</div></div>}
            />
            <ul className="sd-att-legend">
              {(stageSlices.filter((st) => st.value > 0).length ? stageSlices.filter((st) => st.value > 0) : [{ label: 'Primary', value: 0, color: '#94a3b8' }]).map((st) => (
                <li key={st.label}><i style={{ background: st.color }} />{st.label}<b>{countsLoading ? '—' : fmtNum(st.value)}</b></li>
              ))}
            </ul>
          </div>
        </section>
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="users" size={16} /></span>
            <div>
              <div className="sd-att-title">Gender ratio</div>
              <div className="sd-att-sub">{countsLoading ? 'Loading…' : `${fmtNum(gender.boys)} boys · ${fmtNum(gender.girls)} girls`}</div>
            </div>
          </div>
          <div className="sd-att-body">
            <Donut
              segments={[
                { value: gender.boys, color: PIE_COLOR.boys, label: 'Boys' },
                { value: gender.girls, color: PIE_COLOR.girls, label: 'Girls' },
                ...(gender.unspecified ? [{ value: gender.unspecified, color: '#94a3b8', label: 'Unspecified' }] : []),
              ].filter((part) => part.value > 0)}
              size={128} thickness={12}
              center={<div style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{countsLoading ? '—' : `${gender.boys}:${gender.girls}`}</div><div className="t-xs muted3">boys : girls</div></div>}
            />
            <ul className="sd-att-legend">
              <li><i style={{ background: PIE_COLOR.boys }} />Boys<b>{countsLoading ? '—' : fmtNum(gender.boys)}</b></li>
              <li><i style={{ background: PIE_COLOR.girls }} />Girls<b>{countsLoading ? '—' : fmtNum(gender.girls)}</b></li>
              {gender.unspecified ? <li><i style={{ background: '#94a3b8' }} />Unspecified<b>{fmtNum(gender.unspecified)}</b></li> : null}
            </ul>
          </div>
        </section>
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="cap" size={16} /></span>
            <div>
              <div className="sd-att-title">Result distribution</div>
              <div className="sd-att-sub">{examBandsQ.data?.examName || '0 marked · 0%'}</div>
            </div>
          </div>
          {examBands.length === 0 ? (
            <div className="sd-att-body">
              <Ring rate={0} />
              <ul className="sd-att-legend">
                <li><i style={{ background: PIE_COLOR.present }} />Marked<b>0</b></li>
                <li><i style={{ background: '#94a3b8' }} />Bands<b>0</b></li>
              </ul>
            </div>
          ) : (
            <div className="sd-att-body">
              <Donut
                segments={examBands.map((b) => ({ value: b.value, color: b.color, label: b.label }))}
                size={128} thickness={12}
                center={<div style={{ textAlign: 'center' }}><div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{fmtNum(examBands.reduce((n, b) => n + b.value, 0))}</div><div className="t-xs muted3">marked</div></div>}
              />
              <ul className="sd-att-legend">
                {examBands.map((b) => <li key={b.label}><i style={{ background: b.color }} />{b.label}<b>{fmtNum(b.value)}</b></li>)}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className="sd-more">
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="zap" size={16} /></span>
            <div>
              <div className="sd-att-title">Live activity</div>
              <div className="sd-att-sub">{activity.length ? `${fmtNum(activity.length)} updates` : '0 updates'}</div>
            </div>
          </div>
          <ul className="sd-att-legend wide" style={{ marginTop: 12 }}>
            {(activity.length ? activity : [{ time: '', text: 'Fee payments and attendance show here' }]).map((a, i) => (
              <li key={i}>
                <i style={{ background: ['#22C55E', '#3B82F6', '#7C3AED', '#F59E0B'][i % 4] }} />
                <span>{a.text}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="sd-card">
          <div className="sd-att-head">
            <span className="sd-att-ic"><Icon name="bell" size={16} /></span>
            <div>
              <div className="sd-att-title">Announcements</div>
              <div className="sd-att-sub">{liveAnnouncements.length ? `${fmtNum(liveAnnouncements.length)} notices` : '0 notices'}</div>
            </div>
            <button type="button" className="sd-att-link" onClick={() => app.go('school.comm')}>View details →</button>
          </div>
          <ul className="sd-att-legend wide" style={{ marginTop: 12 }}>
            {announcementsQ.isLoading ? <li><i style={{ background: '#94a3b8' }} />Loading<b>—</b></li>
              : liveAnnouncements.length === 0 ? <li><i style={{ background: '#94a3b8' }} />Notices<b>0</b></li>
              : liveAnnouncements.map((a, i) => (
                <li key={i}><i style={{ background: ['#3B82F6', '#22C55E', '#7C3AED', '#F59E0B'][i % 4] }} />{a.title}<b>{a.when || a.tag}</b></li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function AttendanceDonut({
  title, icon, present, absent = 0, late = 0, leave = 0, unmarked, boys, girls, loading, onClick,
}: {
  title: string
  icon: string
  present: number
  absent?: number
  late?: number
  leave?: number
  unmarked: number
  boys?: number
  girls?: number
  loading?: boolean
  onClick: () => void
}) {
  const total = present + absent + late + leave + unmarked
  const rate = total ? Math.round((present / total) * 100) : 0
  const rows = [
    { color: PIE_COLOR.present, label: 'Present', value: present },
    { color: PIE_COLOR.absent, label: 'Absent', value: absent },
    { color: PIE_COLOR.late, label: 'Late', value: late },
    { color: PIE_COLOR.leave, label: 'Leave', value: leave },
    ...(boys != null ? [{ color: PIE_COLOR.boys, label: 'Boys', value: boys }] : []),
    ...(girls != null ? [{ color: PIE_COLOR.girls, label: 'Girls', value: girls }] : []),
  ]
  return (
    <button type="button" className="sd-att" onClick={onClick}>
      <div className="sd-att-head">
        <span className="sd-att-ic"><Icon name={icon} size={16} /></span>
        <div>
          <div className="sd-att-title">{title}</div>
          <div className="sd-att-sub">{loading ? 'Loading…' : `${fmtNum(present)} present · ${rate}%`}</div>
        </div>
        <span className="sd-att-link">View details →</span>
      </div>
      <div className="sd-att-body">
        <Ring rate={loading ? 0 : rate} />
        <ul className="sd-att-legend">
          {rows.map((row) => (
            <li key={row.label}><i style={{ background: row.color }} />{row.label}<b>{loading ? '—' : fmtNum(row.value)}</b></li>
          ))}
        </ul>
      </div>
    </button>
  )
}

function Ring({ rate }: { rate: number }) {
  const r = 46
  const c = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, rate)) / 100) * c
  return (
    <svg className="sd-ring" width="128" height="128" viewBox="0 0 128 128" aria-hidden>
      <circle cx="64" cy="64" r={r} fill="none" stroke="#e7eef8" strokeWidth="12" />
      {dash > 0 ? (
        <circle cx="64" cy="64" r={r} fill="none" stroke="#818cf8" strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`} transform="rotate(-90 64 64)" />
      ) : null}
      <text x="64" y="70" textAnchor="middle" fontSize="26" fontWeight="800" fill="#0f172a">{rate}%</text>
    </svg>
  )
}

function PeopleCard({ tone, label, count, sub, present, ok, loading, onClick, art }: {
  tone: 'violet' | 'green' | 'blue' | 'peach'
  label: string
  count: number | string
  sub: string
  present?: number
  ok?: string
  loading?: boolean
  onClick: () => void
  art: ReactNode
}) {
  const figure = typeof count === 'number' ? fmtNum(count) : count
  const line = ok ?? `✓ ${fmtNum(present ?? 0)} present`
  return (
    <button type="button" className={`sd-person ${tone}`} onClick={onClick}>
      <div className="sd-person-main">
        <div className="sd-person-label">{label}</div>
        <div className="sd-person-val">{loading ? '—' : figure}</div>
        <div className="sd-person-sub">{sub}</div>
        <div className="sd-person-ok">{loading ? 'Loading…' : line}</div>
        <span className="sd-person-link">View all →</span>
      </div>
      {art}
    </button>
  )
}

function SchoolArt({ school }: { school: { name: string; imageUrl?: string | null; logoUrl?: string | null } }) {
  const src = school.imageUrl?.trim() || school.logoUrl?.trim()
  if (src) return <img className="sd-art sd-art-school sd-art-photo" src={src} alt={school.name} />
  return <img className="sd-art sd-art-school" src={dashSchool} alt="" />
}
function ArtStudents() {
  return <img className="sd-art sd-art-people" src={dashStudents} alt="" />
}
function ArtTeacher() {
  return <img className="sd-art sd-art-people" src={dashTeachers} alt="" />
}
function ArtStaff() {
  return <img className="sd-art sd-art-people" src={dashStaff} alt="" />
}

/* ============================================================
   Approvals Inbox
   ============================================================ */
const PRIORITY_TONE: Record<Approval['priority'], BadgeTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
}

const STATUS_TONE: Record<ApprovalStatus, BadgeTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}

const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
}

const TAB_META: Record<ApprovalFilter, { sub: string; emptyTitle: string; emptyBody: string }> = {
  pending: {
    sub: 'Pending your action',
    emptyTitle: 'All caught up',
    emptyBody: 'No approvals pending your action.',
  },
  approved: {
    sub: 'Approved requests',
    emptyTitle: 'No approved requests',
    emptyBody: 'Approved leave and workflow items will appear here.',
  },
  rejected: {
    sub: 'Rejected requests',
    emptyTitle: 'No rejected requests',
    emptyBody: 'Rejected items and their notes are kept here for reference.',
  },
  all: {
    sub: 'Full approval track record',
    emptyTitle: 'No approval history',
    emptyBody: 'Pending, approved, and rejected requests will show here.',
  },
}

/** Requester role/designation for the card. An account-role token ("school.teacher",
 *  "vice_principal", "accountant") is cleaned + title-cased; a real job title already in
 *  human form ("PGT Maths", "Head Clerk") is shown as-is so it isn't mangled. */
function prettyRole(raw?: string): string {
  const s = (raw ?? '').trim()
  if (!s) return 'Requester'
  if (/^[a-z]+([._][a-z]+)*$/.test(s)) {
    return s.replace(/^school\./, '').replace(/[._]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return s
}

export function ApprovalCard({
  a,
  currency,
  showActions,
  onApprove,
  onReject,
  canOpenStudent = false,
  onOpenStudent,
}: {
  a: Approval
  currency: string
  showActions: boolean
  onApprove: (a: Approval) => void
  onReject: (a: Approval) => void
  canOpenStudent?: boolean
  onOpenStudent?: (studentId: string) => void
}) {
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)
  return (
    <Card>
      <div className="row ai-center jc-between gap12 wrap">
        <div className="row ai-center gap8 wrap">
          <Badge tone={STATUS_TONE[a.status]} dot>{STATUS_LABEL[a.status]}</Badge>
          <Badge tone={PRIORITY_TONE[a.priority]} solid={a.priority === 'high'}>
            {a.priority} priority
          </Badge>
          <Badge tone="neutral" icon="layers">{a.type}</Badge>
          <span className="t-xs muted3">{a.id}</span>
        </div>
        <span className="t-xs muted3 row ai-center gap6">
          <Icon name="clock" size={13} />{a.age}{a.age ? ' ago' : ''}
        </span>
      </div>

      <div className="sm-card-title" style={{ marginTop: 12 }}>{a.title}</div>
      <div className="t-sm muted" style={{ marginTop: 4 }}>{a.detail}</div>

      {a.student && (() => {
        const s = a.student
        const parts = [
          s.cls ? `Class ${s.cls}${s.section ? `-${s.section}` : ''}` : (s.section ? `Section ${s.section}` : ''),
          s.roll != null ? `Roll ${formatStudentRoll(s.roll)}` : '',
          s.adm ? `Adm ${s.adm}` : '',
        ].filter(Boolean)
        const label = `${s.name ?? 'Student'}${parts.length ? ' · ' + parts.join(' · ') : ''}`
        const clickable = canOpenStudent && !!s.id && !!onOpenStudent
        return (
          <div className="t-sm" style={{ marginTop: 8 }}>
            <span className="muted3">For student: </span>
            {clickable ? (
              <button type="button" className="sm-gate-link" onClick={() => onOpenStudent!(s.id!)}>
                {label}
              </button>
            ) : (
              <span className="fw6">{label}</span>
            )}
          </div>
        )
      })()}

      {a.attachmentUrls && a.attachmentUrls.length > 0 && (
        <div className="row gap8 wrap ai-center" style={{ marginTop: 10 }}>
          <span className="t-xs muted3">Attachment{a.attachmentUrls.length > 1 ? 's' : ''}:</span>
          {a.attachmentUrls.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setZoomUrl(url)}
              title="Click to view"
              style={{ border: 'none', padding: 0, background: 'none', cursor: 'pointer', lineHeight: 0 }}
            >
              <img
                src={url}
                alt={`Attachment ${i + 1}`}
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', display: 'block', border: '1px solid var(--border)' }}
              />
            </button>
          ))}
        </div>
      )}

      {zoomUrl && (
        <div
          onClick={() => setZoomUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,.8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, cursor: 'zoom-out',
          }}
        >
          <img
            src={zoomUrl}
            alt="Attachment"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '92vw', maxHeight: '92vh', borderRadius: 10, objectFit: 'contain', background: '#fff' }}
          />
          <button
            type="button"
            onClick={() => setZoomUrl(null)}
            aria-label="Close"
            style={{ position: 'fixed', top: 16, right: 20, background: 'rgba(255,255,255,.15)', color: '#fff', border: 'none', borderRadius: 8, width: 36, height: 36, cursor: 'pointer', fontSize: 18 }}
          >
            ✕
          </button>
        </div>
      )}

      {a.status !== 'pending' && (a.decidedBy || a.decidedNote) && (
        <div className="t-sm" style={{
          marginTop: 10, padding: '10px 12px', borderRadius: 10,
          background: a.status === 'rejected' ? 'var(--danger-bg)' : 'var(--success-bg)',
          color: a.status === 'rejected' ? 'var(--danger)' : 'var(--success)',
        }}>
          {a.decidedBy && (
            <div className="fw6" style={{ marginBottom: a.decidedNote ? 4 : 0 }}>
              {a.status === 'rejected' ? 'Rejected by ' : 'Approved by '}{a.decidedBy}
            </div>
          )}
          {a.decidedNote && (
            <div>
              <span className="fw6">{a.status === 'rejected' ? 'Rejection note: ' : 'Decision note: '}</span>
              {a.decidedNote}
            </div>
          )}
        </div>
      )}

      <div className="row ai-center jc-between gap12 wrap" style={{ marginTop: 14 }}>
        <div className="row ai-center gap10">
          <Avatar name={a.requester} size={32} />
          <div>
            <div className="t-md" style={{ fontWeight: 600 }}>{a.requester}</div>
            <div className="t-xs muted3">{prettyRole(a.role)}{a.roleTitle ? ` · ${a.roleTitle}` : ''}</div>
          </div>
          {a.amount != null && (
            <Badge tone="info" icon="rupee" style={{ marginLeft: 6 }}>
              {fmtMoney(a.amount, currency)}
            </Badge>
          )}
        </div>
        {showActions && a.status === 'pending' && (
          <div className="row ai-center gap8">
            <Btn variant="secondary" icon="x" onClick={() => onReject(a)}>Reject</Btn>
            <Btn variant="primary" icon="check" onClick={() => onApprove(a)}>Approve</Btn>
          </div>
        )}
      </div>
    </Card>
  )
}

type RequesterCategory = 'all' | 'student' | 'teacher' | 'staff' | 'admin'

/** Buckets an approval's free-text requester role into Student / Teacher / Staff / Admin.
 *  A parent submitting on a student's behalf counts as "student". Principal and vice
 *  principal count as "admin" (school management), not plain "staff". */
function requesterCategory(role: string): Exclude<RequesterCategory, 'all'> {
  const r = role.toLowerCase()
  if (r.includes('student') || r.includes('parent')) return 'student'
  if (r.includes('teacher')) return 'teacher'
  if (r.includes('admin') || r.includes('principal')) return 'admin'
  return 'staff'
}

function ApprovalsInbox() {
  const app = useApp()
  const toast = useToast()
  const [tab, setTab] = useState<ApprovalFilter>('pending')
  const [category, setCategory] = useState<RequesterCategory>('all')
  const [acted, setActed] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<Approval | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const [rejectErr, setRejectErr] = useState('')
  const actOn = useActOnApproval()

  const { data: approvalsData, isLoading } = useApprovals({ status: tab })
  const scopedList = inboxApprovals(approvalsData ?? [], app.role, tab, acted)
  const list = category === 'all'
    ? scopedList
    : scopedList.filter((a) => requesterCategory(a.role) === category)
  const meta = TAB_META[tab]

  const approve = (a: Approval) => {
    setActed((prev) => new Set(prev).add(a.id))
    actOn.mutate(
      { id: a.id, status: 'approved' },
      {
        onSuccess: () => toast.success('Approved', `${a.title} — ${a.id}`),
        onError: () => setActed((prev) => { const next = new Set(prev); next.delete(a.id); return next }),
      },
    )
  }

  const openReject = (a: Approval) => {
    setRejecting(a)
    setRejectNote('')
    setRejectErr('')
  }

  const closeReject = () => {
    if (actOn.isPending) return
    setRejecting(null)
    setRejectNote('')
    setRejectErr('')
  }

  const confirmReject = () => {
    if (!rejecting) return
    const note = rejectNote.trim()
    if (!note) {
      setRejectErr('Add a short reason for rejection')
      return
    }
    setRejectErr('')
    setActed((prev) => new Set(prev).add(rejecting.id))
    actOn.mutate(
      { id: rejecting.id, status: 'rejected', decidedNote: note },
      {
        onSuccess: () => {
          toast.danger('Rejected', `${rejecting.title} — ${rejecting.id}`)
          setRejecting(null)
          setRejectNote('')
        },
        onError: () => setActed((prev) => { const next = new Set(prev); next.delete(rejecting.id); return next }),
      },
    )
  }

  const showActions = tab === 'pending' || tab === 'all'

  return (
    <div className="col gap20">
      <PageHead title="Leave Requests" sub={meta.sub} />

      <Segmented
        value={tab}
        onChange={(v) => setTab(v as ApprovalFilter)}
        options={[
          { value: 'pending', label: 'Pending' },
          { value: 'approved', label: 'Approved' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'all', label: 'All' },
        ]}
      />

      <Segmented
        value={category}
        onChange={(v) => setCategory(v as RequesterCategory)}
        options={[
          { value: 'all', label: 'All requesters' },
          { value: 'student', label: 'Student' },
          { value: 'teacher', label: 'Teacher' },
          { value: 'staff', label: 'Staff' },
          { value: 'admin', label: 'Admin' },
        ]}
      />

      {isLoading ? (
        <Empty icon="inbox" title="Loading…" body="Fetching approval records." />
      ) : list.length === 0 && category !== 'all' && scopedList.length > 0 ? (
        <Empty icon="checkCircle" title="No matching requests" body={`No ${category} requests in this list.`} />
      ) : list.length === 0 ? (
        <Empty icon="checkCircle" title={meta.emptyTitle} body={meta.emptyBody} />
      ) : (
        <div className="col gap16">
          {list.map((a) => (
            <ApprovalCard
              key={a.id}
              a={a}
              currency={app.school.currency}
              showActions={showActions}
              onApprove={approve}
              onReject={openReject}
              canOpenStudent={can(app.role, 'sis', 'V')}
              onOpenStudent={(id) => app.go('school.student', { focus: id })}
            />
          ))}
        </div>
      )}

      <Modal
        open={rejecting != null}
        onClose={closeReject}
        size="sm"
        icon="x"
        title="Reject approval"
        sub={rejecting?.title}
        footer={(
          <div className="row ai-center jc-end gap8">
            <Btn variant="secondary" onClick={closeReject} disabled={actOn.isPending}>Cancel</Btn>
            <Btn variant="danger" icon="x" onClick={confirmReject} disabled={actOn.isPending}>
              {actOn.isPending ? 'Rejecting…' : 'Reject'}
            </Btn>
          </div>
        )}
      >
        <Field
          label="Rejection note"
          required
          hint="This note is saved on the request and visible to the requester."
          error={rejectErr}
        >
          <Textarea
            rows={4}
            placeholder="Reason for rejection…"
            value={rejectNote}
            onChange={(e) => { setRejectNote(e.target.value); if (rejectErr) setRejectErr('') }}
            autoFocus
          />
        </Field>
      </Modal>
    </div>
  )
}

/* ---------- export contract ---------- */
export const dashboardScreens: Record<string, ComponentType> = {
  'school.dashboard': SchoolDashboard,
  'school.approvals': ApprovalsInbox,
}
