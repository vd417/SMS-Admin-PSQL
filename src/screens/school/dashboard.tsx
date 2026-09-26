/* ============================================================
   SchoolMate — School console: live Dashboard + Approvals inbox
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType, type CSSProperties } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import {
  Card, CardHead, Kpi, PageHead, Badge, Btn, Icon, Avatar,
  Donut, Bars, LineChart, Legend, Empty, Modal, Field, Textarea, Segmented,
} from '@/components/ui'
import type { BadgeTone } from '@/components/ui'
import { SchoolPhoto } from '@/components/SchoolMark'
import { useApprovals } from '@/api/hooks/useApprovals'
import { inboxApprovals, type ApprovalFilter } from '@/api/approvals'
import { useActOnApproval } from '@/api/hooks/useApprovalMutations'
import { useCrmPeopleSnapshot } from '@/api/hooks/useCrmDashboard'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { usePrincipalAttendance } from '@/api/hooks/usePrincipalAttendance'
import { usePeriodAttendanceRangeSummary, useDashboardAttendanceTrend } from '@/api/hooks/usePeriodAttendanceAdvanced'
import { classWiseDayHero } from '@/api/periodAttendanceAdvanced'
import { useFeeReportSummary } from '@/api/hooks/useFeeReports'
import { useAnnouncements } from '@/api/hooks/useAnnouncements'
import { useFeePayments } from '@/api/hooks/useFeePayments'
import { useDashboardExamBands } from '@/api/hooks/useExams'
import {
  countPeoplePresent, PEOPLE_ATTENDANCE_CHANGED,
  fetchRemotePeopleAttendance, type CheckInInfo,
} from '@/api/peopleAttendance'
import type { AttendanceStatus } from '@/api/attendance'
import { fmtMoney, fmtNum } from '@/lib/format'
import { principalStaffToCheckInMap } from '@/lib/geoAttendanceDemo'
import { studentLiveAttendance } from '@/lib/studentLiveAttendance'
import { enrollmentByStageFromCounts } from '@/lib/dashboardLive'
import type { Approval, ApprovalStatus, Role } from '@/types'

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
function SchoolDashboard() {
  const app = useApp()
  const s = app.school
  const cur = s.currency
  const liveAtt = canSeeLiveAttendance(app.role)
  const today = todayIso()

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
  const liveSupport = peopleQ.data?.staffCount ?? 0
  const countsLoading = peopleQ.isLoading
  const rosterLoading = teachersQ.isLoading || staffQ.isLoading
  const liveGrades = peopleQ.data?.uniqueGrades ?? 0

  const studentHero = classWiseDayHero({ range: periodDayQ.data })
  const studentAtt = studentLiveAttendance({
    loaded: !liveAtt || periodDayQ.isSuccess || periodDayQ.isError,
    presentTotal: studentHero.present,
    studentTotal: studentHero.marked,
    overallPct: studentHero.pct,
    enrollment: liveStudents,
  })
  const studentTotal = studentAtt.marked > 0 ? studentAtt.marked : liveStudents
  const studentsPresent = studentAtt.present
  const attendancePct = studentAtt.pct

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

  const peoplePresent = teachersPresent + supportPresent
  const peopleTotal = liveTeachers + liveSupport
  const peopleRate = peopleTotal ? Math.round((peoplePresent / peopleTotal) * 100) : 0
  const staffAway = Math.max(0, peopleTotal - peoplePresent)

  const feesToday = feeQ.data?.collectedToday ?? 0
  const outstanding = feeQ.data?.outstanding ?? 0
  const collectedPct = feeQ.data?.pct ?? 0
  const collectedTerm = feeQ.data?.collectedTerm ?? 0
  const billedTerm = feeQ.data?.billedTerm ?? 0
  const defaulters = feeQ.data?.defaulters ?? 0
  const feeByClass = feeQ.data?.byClass ?? []
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
    if (periodDayQ.isSuccess && attendancePct != null) {
      rows.push({
        time: 'today',
        text: `Students · ${studentAtt.footnote} (${attendancePct}%)`,
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
    periodDayQ.isSuccess, attendancePct, studentAtt.footnote,
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
  const attLiveLabel = periodDayQ.isFetching ? 'Refreshing…' : (periodDayQ.isSuccess ? 'Live today' : 'Live roster')

  return (
    <div className="col gap20">
      <div className="row ai-center gap16 wrap" style={{ marginBottom: 4 }}>
        <SchoolPhoto school={s} size={88} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="t-xs muted3" style={{ letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 600 }}>
            Dashboard
          </div>
          <h1 className="sm-pagehead-title" style={{ margin: '2px 0 4px' }}>{s.name}</h1>
          <div className="t-sm muted">{s.city}{s.tz ? ` · ${s.tz}` : ''}</div>
        </div>
      </div>

      {/* ---- KPI row ---- */}
      <div className="sm-kpi-grid">
        <Kpi
          icon="users" iconBg="color-mix(in srgb, #635BFF 12%, white)" iconColor="#635BFF"
          label="Total enrollment" value={countsLoading ? '—' : fmtNum(liveStudents)}
          foot={countsLoading
            ? 'Loading roster…'
            : `${fmtNum(liveGrades)} grade${liveGrades === 1 ? '' : 's'} · ${fmtNum(peopleTotal)} staff`}
        />
        <Kpi
          icon="check" iconBg="color-mix(in srgb, #22C55E 12%, white)" iconColor="#22C55E"
          label="Today's attendance" value={attendancePct == null ? '—' : `${attendancePct}%`}
          delta={attLiveLabel} deltaDir="up"
          foot={studentAtt.footnote}
          spark={attSpark.length >= 2 ? attSpark : undefined} sparkColor="#166534"
        />
        <Kpi
          icon="rupee" iconBg="color-mix(in srgb, #0EA5E9 12%, white)" iconColor="#0EA5E9"
          label="Fees collected today" value={feeLoading ? '—' : fmtMoney(feesToday, cur)}
          foot={feeLoading
            ? 'Loading…'
            : `Term ${fmtMoney(collectedTerm, cur)} · ${collectedPct}% of ${fmtMoney(billedTerm, cur)} billed`}
        />
        <Kpi
          icon="wallet" iconBg="color-mix(in srgb, #F93016 12%, white)" iconColor="#F93016"
          label="Outstanding dues" value={feeLoading ? '—' : fmtMoney(outstanding, cur)}
          foot={feeLoading ? 'Loading…' : `${fmtNum(defaulters)} student invoice(s) due / partial`}
        />
        <Kpi
          icon="briefcase" iconBg="color-mix(in srgb, #A855F7 12%, white)" iconColor="#A855F7"
          label="Teachers & staff" value={rosterLoading || !peopleMarksReady ? '—' : `${fmtNum(peoplePresent)}/${fmtNum(peopleTotal)}`}
          delta={peopleTotal ? `${peopleRate}%` : undefined} deltaDir="up"
          foot={rosterLoading || !peopleMarksReady
            ? 'Loading staff…'
            : `Teachers ${fmtNum(teachersPresent)}/${fmtNum(liveTeachers)} · Staff ${fmtNum(supportPresent)}/${fmtNum(liveSupport)} · ${fmtNum(staffAway)} away`}
        />
      </div>

      {/* ---- People at a glance ---- */}
      <div className="sm-grid-3">
        <PeopleCard
          icon="users" tone="var(--brand-600)" label="Students"
          count={liveStudents} sub={liveTeachers ? `Student–teacher ratio ${ratio}:1 · ${attLiveLabel}` : attLiveLabel}
          rate={studentAtt.meter} present={studentsPresent} total={studentTotal}
          foot={studentAtt.footnote}
          loading={liveAtt && periodDayQ.isPending}
          onClick={() => app.go('school.attendance')}
        />
        <PeopleCard
          icon="cap" tone="var(--success)" label="Teachers"
          count={liveTeachers} sub="Teacher app check-in + Attendance marks"
          rate={teacherRate} present={teachersPresent} total={liveTeachers}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => app.go('school.attendance')}
        />
        <PeopleCard
          icon="briefcase" tone="var(--info)" label="Support staff"
          count={liveSupport} sub="From Attendance · Staff tab"
          rate={supportRate} present={supportPresent} total={liveSupport}
          loading={rosterLoading || !peopleMarksReady}
          onClick={() => app.go('school.attendance')}
        />
      </div>

      {/* ---- Trends: attendance line + fee donut ---- */}
      <div className="sm-grid-2">
        <Card>
          <CardHead
            title="Attendance trend"
            sub={trendQ.isLoading
              ? 'Loading last 8 weeks…'
              : (attTrend.length
                ? 'Weekly average · period marks'
                : 'No period marks in the last 8 weeks')}
            icon="trend"
            action={<Btn size="sm" variant="ghost" icon="check" onClick={() => app.go('school.attendance')}>Open attendance</Btn>}
          />
          <div style={{ marginTop: 12 }}>
            {trendQ.isLoading ? (
              <Empty icon="trend" title="Loading trend…" body="Fetching weekly period attendance." />
            ) : attTrend.length === 0 ? (
              <Empty icon="trend" title="No attendance trend yet" body="Weekly % appears after period marks are saved." />
            ) : attTrend.length === 1 ? (
              <div className="t-md">
                {attTrend[0].label}: <strong>{attTrend[0].value}%</strong>
                <div className="t-xs muted3" style={{ marginTop: 6 }}>Need at least two marked weeks for a chart.</div>
              </div>
            ) : (
              <LineChart
                series={[{ data: attTrend.map((p) => p.value), color: 'var(--brand-600)', label: 'Attendance %' }]}
                labels={attTrend.map((p) => p.label)} yMax={100} yFmt={(v) => `${Math.round(v)}%`}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Fee collection"
            sub={feeLoading ? 'Loading…' : `Term billed ${fmtMoney(billedTerm, cur)}`}
            icon="rupee" iconBg="var(--success-bg)" iconColor="var(--success)"
            action={<Btn size="sm" variant="ghost" icon="rupee" onClick={() => app.go('school.fees')}>Open fees</Btn>}
          />
          <div className="row ai-center jc-between gap16 wrap" style={{ marginTop: 12 }}>
            <Donut
              segments={[
                { value: Math.max(collectedPct, 0), color: 'var(--success)', label: 'Collected' },
                { value: Math.max(100 - collectedPct, 0), color: 'var(--surface-3)', label: 'Pending' },
              ]}
              size={148} thickness={18}
              center={
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                    {feeLoading ? '—' : `${collectedPct}%`}
                  </div>
                  <div className="t-xs muted3" style={{ marginTop: 2 }}>collected</div>
                </div>
              }
            />
            <div className="col gap12" style={{ flex: 1, minWidth: 160 }}>
              <Legend items={[
                { color: 'var(--success)', label: `Collected — ${feeLoading ? '—' : fmtMoney(collectedTerm, cur)}` },
                { color: 'var(--surface-3)', label: `Outstanding — ${feeLoading ? '—' : fmtMoney(outstanding, cur)}` },
              ]} />
              <div className="t-sm muted">
                {feeLoading
                  ? 'Loading fee summary…'
                  : `${fmtNum(defaulters)} due / partial · today ${fmtMoney(feesToday, cur)}`}
              </div>
              {latestPayment && (
                <div className="t-xs muted3">
                  Latest · {fmtMoney(latestPayment.amount, cur)} · {latestPayment.studentName} ({latestPayment.cls})
                </div>
              )}
            </div>
          </div>
          {feeByClass.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="t-xs muted3" style={{ marginBottom: 8 }}>Outstanding by class</div>
              <Bars
                data={feeByClass.slice(0, 8).map((c) => ({
                  value: c.value,
                  label: c.label,
                  color: c.value > 0 ? 'var(--warning)' : 'var(--success)',
                }))}
                h={120}
                valueFmt={(v) => fmtMoney(v, cur)}
              />
            </div>
          )}
        </Card>
      </div>

      {/* ---- Composition: stages · gender · results ---- */}
      <div className="sm-grid-3">
        <Card>
          <CardHead title="Enrolment by stage" icon="layers" iconBg="var(--info-bg)" iconColor="var(--info)" />
          {countsLoading ? (
            <Empty icon="layers" title="Loading enrolment…" body="Counting students by grade." />
          ) : liveStudents === 0 || stageSlices.every((st) => st.value === 0) ? (
            <Empty icon="layers" title="No enrolment yet" body="Stage split appears after students are on the roster." />
          ) : (
            <>
              <div className="row ai-center jc-center" style={{ margin: '8px 0 14px' }}>
                <Donut
                  segments={stageSlices.filter((st) => st.value > 0)}
                  size={138} thickness={16}
                  center={<div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fmtNum(liveStudents)}</div>
                    <div className="t-xs muted3">students</div>
                  </div>}
                />
              </div>
              <Legend items={stageSlices.filter((st) => st.value > 0).map((st) => ({
                color: st.color,
                label: `${st.label} — ${fmtNum(st.value)}`,
              }))} />
            </>
          )}
        </Card>

        <Card>
          <CardHead title="Gender ratio" icon="users" iconBg="var(--platinum-bg)" iconColor="var(--platinum)" />
          {countsLoading ? (
            <Empty icon="users" title="Loading gender…" body="Counting recorded student gender." />
          ) : liveStudents === 0 ? (
            <Empty icon="users" title="No students yet" body="Gender ratio uses each student’s recorded gender." />
          ) : (
            <>
              <div className="row ai-center jc-center" style={{ margin: '8px 0 14px' }}>
                <Donut
                  segments={[
                    ...(gender.boys ? [{ value: gender.boys, color: '#0ea5e9', label: 'Boys' }] : []),
                    ...(gender.girls ? [{ value: gender.girls, color: '#ec4899', label: 'Girls' }] : []),
                    ...(gender.unspecified ? [{ value: gender.unspecified, color: '#94a3b8', label: 'Unspecified' }] : []),
                  ]}
                  size={138} thickness={16}
                  center={<div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>
                      {gender.boys}:{gender.girls}
                    </div>
                    <div className="t-xs muted3">boys : girls</div>
                  </div>}
                />
              </div>
              <Legend items={[
                { color: '#0ea5e9', label: `Boys — ${fmtNum(gender.boys)}` },
                { color: '#ec4899', label: `Girls — ${fmtNum(gender.girls)}` },
                ...(gender.unspecified ? [{ color: '#94a3b8', label: `Unspecified — ${fmtNum(gender.unspecified)}` }] : []),
              ]} />
            </>
          )}
        </Card>

        <Card>
          <CardHead
            title="Result distribution"
            sub={examBandsQ.data?.examName ? examBandsQ.data.examName : 'Latest exam · saved grades'}
            icon="cap" iconBg="var(--gold-bg)" iconColor="var(--gold)"
          />
          <div style={{ marginTop: 12 }}>
            {examBandsQ.isLoading ? (
              <Empty icon="cap" title="Loading results…" body="Reading saved exam grades." />
            ) : examBands.length === 0 ? (
              <Empty icon="cap" title="No exam grades yet" body="Grade bands appear after marks are saved on an exam paper." />
            ) : (
              <>
                <Bars
                  data={examBands.map((b) => ({ value: b.value, label: b.label, color: b.color }))}
                  h={150} valueFmt={(v) => `${v}`}
                />
                <div className="t-xs muted3" style={{ marginTop: 8 }}>
                  Students per band · {fmtNum(examBands.reduce((n, b) => n + b.value, 0))} marked papers
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* ---- Live activity + announcements ---- */}
      <div className="sm-grid-2">
        <Card>
          <CardHead
            title="Live activity"
            sub="Fees · attendance · staff"
            icon="zap" iconBg="var(--warning-bg)" iconColor="var(--warning)"
            action={<Badge tone="success" dot>Live</Badge>}
          />
          <div className="col gap12" style={{ marginTop: 12 }}>
            {activity.length === 0 ? (
              <Empty icon="zap" title="No live activity yet" body="Fee payments and attendance will show here." />
            ) : activity.map((a, i) => (
              <div key={i} className="row ai-center gap12">
                <span className="sm-dot-live" />
                <div className="t-md" style={{ flex: 1 }}>{a.text}</div>
                <div className="t-xs muted3" style={{ whiteSpace: 'nowrap' }}>{a.time}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Announcements"
            sub="School-wide notices"
            icon="bell" iconBg="var(--danger-bg)" iconColor="var(--danger)"
            action={<Btn size="sm" variant="ghost" onClick={() => app.go('school.comm')}>View all</Btn>}
          />
          <div className="col gap12" style={{ marginTop: 12 }}>
            {announcementsQ.isLoading ? (
              <div className="t-sm muted">Loading announcements…</div>
            ) : liveAnnouncements.length === 0 ? (
              <Empty icon="bell" title="No announcements" body="Published notices will appear here." />
            ) : liveAnnouncements.map((a, i) => (
              <div key={i} className="row ai-center gap12">
                <Badge tone={a.tone}>{a.tag}</Badge>
                <div className="t-md" style={{ flex: 1 }}>{a.title}</div>
                <div className="t-xs muted3" style={{ whiteSpace: 'nowrap' }}>{a.when}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ---------- People-at-a-glance card ---------- */
function PeopleCard({ icon, tone, label, count, sub, rate, present, total, foot, loading, onClick }: {
  icon: string; tone: string; label: string; count: number; sub: string
  rate: number; present: number; total: number; foot?: string; loading?: boolean; onClick: () => void
}) {
  return (
    <Card hover onClick={onClick} className="sm-kpi sm-people-card" style={{ '--kpi-accent': tone } as CSSProperties}>
      <div className="row ai-center jc-between">
        <div className="row ai-center gap12">
          <span className="sm-kpi-ic" style={{ marginBottom: 0 }}>
            <Icon name={icon} size={18} />
          </span>
          <div>
            <div className="sm-kpi-val" style={{ fontSize: 24 }}>{fmtNum(count)}</div>
            <div className="sm-kpi-label">{label}</div>
          </div>
        </div>
        <Icon name="chevRight" size={18} className="sm-people-chev" />
      </div>
      <div className="t-sm sm-people-sub" style={{ marginTop: 10 }}>{sub}</div>
      <div className="row ai-center gap8" style={{ marginTop: 10 }}>
        <div className="sm-meter sm-people-meter" style={{ flex: 1, width: 'auto' }}>
          <span style={{ width: `${loading ? 0 : rate}%` }} />
        </div>
        <span className="t-xs sm-kpi-foot" style={{ whiteSpace: 'nowrap', marginTop: 0 }}>
          {loading ? 'Loading…' : (foot ?? `${fmtNum(present)} of ${fmtNum(total)} present`)}
        </span>
      </div>
    </Card>
  )
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

function ApprovalCard({
  a,
  currency,
  showActions,
  onApprove,
  onReject,
}: {
  a: Approval
  currency: string
  showActions: boolean
  onApprove: (a: Approval) => void
  onReject: (a: Approval) => void
}) {
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

      {a.attachmentUrls && a.attachmentUrls.length > 0 && (
        <div className="row gap8 wrap" style={{ marginTop: 10 }}>
          {a.attachmentUrls.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer">
              <img
                src={url}
                alt={`Attachment ${i + 1}`}
                style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', display: 'block' }}
              />
            </a>
          ))}
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
            <div className="t-xs muted3">{a.role || 'Requester'}</div>
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
      <PageHead title="Approvals" sub={meta.sub} />

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
