/* ============================================================
   SchoolMate — School console: administration screens.
   Reports · Settings · Identity & access (RBAC).
   Phase 5 screens. Frontend-only, mock data.

   - Reports is its own sidebar tab (Academic / Attendance /
     Finance / Operations categories with Excel export).
   - Settings covers school profile & branding, localization and
     plan / feature visibility with upgrade prompts.
   - Identity & access is Admin-only (the router guards non-admins)
     and pairs a Users table with an interactive permission matrix.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast, useTheme } from '@/lib/hooks'
import { useInviteUser } from '@/api/hooks/useUserMutations'
import { SchoolPhoto } from '@/components/SchoolMark'
import { EditSchoolProfileModal } from '@/components/EditSchoolProfileModal'
import { usePortfolioSchools } from '@/api/hooks/useOwner'
import {
  useSchoolIntegrations, useSaveSchoolIntegrations, useVerifySchoolRazorpay,
} from '@/api/hooks/useSchoolIntegrations'
import { useQueryClient } from '@tanstack/react-query'
import {
  assignableSchoolRoles,
  fromApiRole,
  getUserPermissions,
  listSchoolUsers,
  overridesFromApi,
  setUserPermissions,
  setUserRoles,
  removeUserAccess,
  setUserActive,
  type SchoolUserDto,
} from '@/api/users'
import { ApiError } from '@/api/client'
import { listInvitations, type Invitation } from '@/api/invitations'
import { useResendInvitation, useRevokeInvitation } from '@/api/hooks/useInvitationMutations'
import { useRoleTemplate, useSetRoleTemplate } from '@/api/hooks/useRoleTemplates'
import type { RoleTemplateOverride } from '@/api/roleTemplates'
import { useAuditLog } from '@/api/hooks/useAudit'
import type { AuditEntry } from '@/api/audit'
import { tierIncludes, caps, effectiveCaps, cellState, overrideCount, NEXT_CELL_STATE } from '@/lib/gating'
import { canConfigureGeofence } from '@/lib/geofence'
import { TierGate } from '@/components/shell/gates'
import { CampusGeofenceSettings } from '@/components/school/CampusGeofenceSettings'
import {
  PageHead, Tabs, Card, CardHead, Btn, Badge, TierPill, Avatar, Search, Select,
  Field, Input, Textarea, Toggle, Icon, Empty, DataTable, Spinner, Modal,
  type Column, type BadgeTone,
} from '@/components/ui'
import { ROLES, ROLE_META, PERMS, TIER_META } from '@/data/mockDb'
import type { Role, GateRole, Cap, Tier, CellState, UserOverrides, RazorpayStatus } from '@/types'
import { useStudents } from '@/api/hooks/useStudents'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { useFeeReportSummary } from '@/api/hooks/useFeeReports'
import { useFeeInvoices } from '@/api/hooks/useFeeInvoices'
import { usePayrollPreview } from '@/api/hooks/usePayroll'
import { useTransportFleet } from '@/api/hooks/useOperations'
import { useExams } from '@/api/hooks/useExams'
import { useExamPapers } from '@/api/hooks/useExamPapers'
import { useExamMarksMap } from '@/api/hooks/useGrades'
import { markKey } from '@/lib/examData'
import { currentPeriod, periodLabel } from '@/lib/payroll'
import { fmtMoney } from '@/lib/format'
import { downloadReportXls, openReportPdf, type ReportSpec, type ReportMeta } from '@/lib/reportExport'
import { downloadReportXlsx } from '@/lib/reportXlsx'
import type { Student, Teacher, Staff, FeeInvoice, FeeReportSummary, Exam } from '@/types'
import type { PayrollRun } from '@/api/payroll'
import type { ExamPaper } from '@/api/examPapers'
import type { FleetBus } from '@/api/operations'

/* ============================================================
   Reports
   ============================================================ */
interface RptRow { name: string; desc: string; spec: ReportSpec | null }
interface RptCat { value: string; label: string; icon: string; reports: RptRow[] }

const PERIODS = ['Term 1 · 2026', 'Term 2 · 2026', 'Mid-Term · 2026', 'Full Year · 2025-26']

const FLEET_STATUS: Record<string, string> = {
  on_route: 'On route', at_stop: 'At stop', delayed: 'Delayed', idle: 'Idle', maintenance: 'Maintenance',
}

const avgOf = (ns: number[]): number => (ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : 0)

function groupByClass(students: Student[]): [string, Student[]][] {
  const m = new Map<string, Student[]>()
  for (const s of students) {
    const k = s.cls || s.grade || '—'
    const arr = m.get(k)
    if (arr) arr.push(s)
    else m.set(k, [s])
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
}

function pickExam(exams: Exam[]): Exam | undefined {
  return exams.find((e) => e.marksEntered > 0) ?? exams.find((e) => e.published) ?? exams[0]
}

function academicReports(
  students: Student[],
  exam: Exam | undefined,
  papers: ExamPaper[],
  marksMap: Record<string, number>,
): RptRow[] {
  const classes = groupByClass(students)

  /* ---- Marks-based reports (real exam grades) ---- */
  const examId = exam?.id ?? ''
  const subjects = [...new Set(papers.map((p) => p.subject).filter(Boolean))]
  const maxBySubject = new Map<string, number>()
  for (const p of papers) maxBySubject.set(p.subject, (maxBySubject.get(p.subject) || 0) + (p.maxMarks || 0))
  const totalMax = [...maxBySubject.values()].reduce((a, b) => a + b, 0)
  const markOf = (sid: string, subj: string): number | undefined => marksMap[markKey(examId, sid, subj)]
  const scored = students.filter((s) => subjects.some((sub) => markOf(s.id, sub) != null))

  let markSheet: ReportSpec | null = null
  let subjAnalysis: ReportSpec | null = null
  if (exam && subjects.length > 0 && scored.length > 0) {
    markSheet = {
      title: 'Consolidated mark sheet',
      subtitle: `${exam.name} · subject-wise marks & totals.`,
      columns: ['Student ID', 'Student', 'Class', ...subjects, 'Total', '%'],
      align: ['l', 'l', 'l', ...subjects.map(() => 'r' as const), 'r', 'r'],
      summary: [
        { label: 'Exam', value: exam.name },
        { label: 'Students', value: String(scored.length) },
        { label: 'Max marks', value: String(totalMax) },
      ],
      rows: scored.map((s) => {
        const vals = subjects.map((sub) => markOf(s.id, sub) ?? 0)
        const total = vals.reduce((a, b) => a + b, 0)
        const pct = totalMax > 0 ? Math.round((total / totalMax) * 1000) / 10 : 0
        return [s.adm, s.name, s.cls, ...vals, total, pct]
      }),
    }
    subjAnalysis = {
      title: 'Subject analysis',
      subtitle: `${exam.name} · mean, highest & lowest per subject.`,
      columns: ['Subject', 'Students', 'Mean', 'Highest', 'Lowest', 'Max marks'],
      align: ['l', 'r', 'r', 'r', 'r', 'r'],
      chartTitle: 'Mean marks by subject',
      chart: subjects.map((sub) => {
        const ms = scored.map((s) => markOf(s.id, sub)).filter((m): m is number => m != null)
        return { label: sub, value: ms.length ? Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 10) / 10 : 0 }
      }),
      rows: subjects.map((sub) => {
        const ms = scored.map((s) => markOf(s.id, sub)).filter((m): m is number => m != null)
        const n = ms.length
        return [
          sub, n,
          n ? Math.round((ms.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0,
          n ? Math.max(...ms) : 0,
          n ? Math.min(...ms) : 0,
          maxBySubject.get(sub) || 0,
        ]
      }),
    }
  }

  const perf: ReportSpec = {
    title: 'Class performance summary',
    subtitle: 'Strength & average attendance per class & section.',
    columns: ['Class', 'Students', 'Boys', 'Girls', 'Avg attendance %'],
    align: ['l', 'r', 'r', 'r', 'r'],
    summary: [
      { label: 'Classes', value: String(classes.length) },
      { label: 'Students', value: String(students.length) },
    ],
    chartTitle: 'Average attendance by class (%)',
    chart: classes.map(([cls, list]) => ({ label: cls, value: avgOf(list.map((s) => s.attendance || 0)) })),
    rows: classes.map(([cls, list]) => [
      cls, list.length,
      list.filter((s) => s.gender === 'M').length,
      list.filter((s) => s.gender === 'F').length,
      avgOf(list.map((s) => s.attendance || 0)),
    ]),
  }
  const weak = students.filter((s) => (s.attendance ?? 100) < 75).sort((a, b) => (a.attendance ?? 0) - (b.attendance ?? 0))
  const weakSpec: ReportSpec = {
    title: 'Weak-student tracker',
    subtitle: 'Students below 75% attendance flagged for remedial follow-up.',
    columns: ['Student ID', 'Student', 'Class', 'Attendance %', 'Fee status'],
    align: ['l', 'l', 'l', 'r', 'l'],
    summary: [{ label: 'Flagged', value: String(weak.length) }],
    rows: weak.map((s) => [s.adm, s.name, s.cls, s.attendance ?? 0, s.feeStatus]),
  }
  return [
    { name: 'Consolidated mark sheet', desc: markSheet ? markSheet.subtitle! : 'Subject-wise marks & grades — no exam marks entered yet.', spec: markSheet },
    { name: 'Class performance summary', desc: perf.subtitle!, spec: perf },
    { name: 'Weak-student tracker', desc: weakSpec.subtitle!, spec: weakSpec },
    { name: 'Subject analysis', desc: subjAnalysis ? subjAnalysis.subtitle! : 'Mean, highest & lowest per subject — no exam marks entered yet.', spec: subjAnalysis },
  ]
}

function attendanceReports(students: Student[], teacherRows: Teacher[], staffRows: Staff[]): RptRow[] {
  const summarySpec: ReportSpec = {
    title: 'Student attendance summary',
    subtitle: 'Per-student attendance % for the period.',
    columns: ['Student ID', 'Student', 'Class', 'Attendance %', 'Status'],
    align: ['l', 'l', 'l', 'r', 'l'],
    rows: students.map((s) => [s.adm, s.name, s.cls, s.attendance ?? 0, s.status]),
  }
  const classes = groupByClass(students)
  const overview: ReportSpec = {
    title: 'Class attendance overview',
    subtitle: 'Average attendance rolled up per class.',
    columns: ['Class', 'Students', 'Avg attendance %'],
    align: ['l', 'r', 'r'],
    chartTitle: 'Average attendance by class (%)',
    chart: classes.map(([c, l]) => ({ label: c, value: avgOf(l.map((s) => s.attendance || 0)) })),
    rows: classes.map(([c, l]) => [c, l.length, avgOf(l.map((s) => s.attendance || 0))]),
  }
  const chronic = students.filter((s) => (s.attendance ?? 100) < 75).sort((a, b) => (a.attendance ?? 0) - (b.attendance ?? 0))
  const chronicSpec: ReportSpec = {
    title: 'Chronic absentee list',
    subtitle: 'Students under 75% attendance — contact guardians.',
    columns: ['Student ID', 'Student', 'Class', 'Attendance %', 'Guardian', 'Phone'],
    align: ['l', 'l', 'l', 'r', 'l', 'l'],
    summary: [{ label: 'Students', value: String(chronic.length) }],
    rows: chronic.map((s) => [s.adm, s.name, s.cls, s.attendance ?? 0, s.guardian, s.phone]),
  }
  const staffSpec: ReportSpec = {
    title: 'Staff attendance report',
    subtitle: 'Teaching & non-teaching staff attendance.',
    columns: ['Name', 'Type', 'Role / Dept', 'Attendance %', 'Status'],
    align: ['l', 'l', 'l', 'r', 'l'],
    summary: [{ label: 'Teachers', value: String(teacherRows.length) }, { label: 'Staff', value: String(staffRows.length) }],
    rows: [
      ...teacherRows.map((t) => [t.name, 'Teacher', t.desig || t.dept, t.attendance, t.status] as (string | number)[]),
      ...staffRows.map((s) => [s.name, 'Staff', s.role || s.dept, s.attendance, s.status] as (string | number)[]),
    ],
  }
  return [
    { name: 'Student attendance summary', desc: summarySpec.subtitle!, spec: summarySpec },
    { name: 'Class attendance overview', desc: overview.subtitle!, spec: overview },
    { name: 'Chronic absentee list', desc: chronicSpec.subtitle!, spec: chronicSpec },
    { name: 'Staff attendance report', desc: staffSpec.subtitle!, spec: staffSpec },
  ]
}

function financeReports(summary: FeeReportSummary | undefined, invoices: FeeInvoice[], payroll: PayrollRun | undefined, cur: string): RptRow[] {
  const collectionSpec: ReportSpec | null = summary ? {
    title: 'Fee collection summary',
    subtitle: 'Outstanding balance by class with term totals.',
    columns: ['Class', 'Invoices', 'Outstanding'],
    align: ['l', 'r', 'r'], money: [false, false, true],
    summary: [
      { label: 'Billed (term)', value: fmtMoney(summary.billedTerm, cur) },
      { label: 'Collected', value: fmtMoney(summary.collectedTerm, cur) },
      { label: 'Outstanding', value: fmtMoney(summary.outstanding, cur) },
      { label: 'Collected %', value: `${summary.pct}%` },
    ],
    chartTitle: 'Outstanding by class',
    chart: summary.byClass.map((c) => ({ label: c.label, value: c.value })),
    chartMoney: true,
    rows: summary.byClass.map((c) => [c.label, c.n, c.value]),
  } : null
  const due = invoices.filter((i) => (i.due || 0) > 0).sort((a, b) => b.due - a.due)
  const dueSpec: ReportSpec = {
    title: 'Outstanding dues register',
    subtitle: 'Student-wise pending balances.',
    columns: ['Student ID', 'Student', 'Class', 'Term', 'Total', 'Paid', 'Due', 'Status'],
    align: ['l', 'l', 'l', 'l', 'r', 'r', 'r', 'l'],
    money: [false, false, false, false, true, true, true, false],
    summary: [
      { label: 'Pending dues', value: String(due.length) },
      { label: 'Total due', value: fmtMoney(due.reduce((s, i) => s + (i.due || 0), 0), cur) },
    ],
    rows: due.map((i) => [i.studentAdm || '', i.studentName, i.cls, i.term, i.total, i.paid, i.due, i.status]),
  }
  const modeSpec: ReportSpec | null = summary ? {
    title: 'Daily collection report',
    subtitle: 'Collections grouped by payment mode.',
    columns: ['Payment mode', 'Amount'],
    align: ['l', 'r'], money: [false, true],
    summary: [
      { label: 'Collected today', value: fmtMoney(summary.collectedToday, cur) },
      { label: 'Collected (term)', value: fmtMoney(summary.collectedTerm, cur) },
    ],
    chartTitle: 'Collection by payment mode',
    chartKind: 'pie',
    chart: summary.byMode.map((m) => ({ label: m.label, value: m.value })),
    chartMoney: true,
    rows: summary.byMode.map((m) => [m.label, m.value]),
  } : null
  const payrollSpec: ReportSpec | null = payroll ? {
    title: 'Payroll register',
    subtitle: `Gross, deductions & net pay · ${periodLabel(payroll.period)}.`,
    columns: ['Name', 'Role', 'Department', 'Gross', 'Deductions', 'Net'],
    align: ['l', 'l', 'l', 'r', 'r', 'r'], money: [false, false, false, true, true, true],
    summary: [
      { label: 'People', value: String(payroll.staffCount) },
      { label: 'Gross', value: fmtMoney(payroll.gross, cur) },
      { label: 'Net payable', value: fmtMoney(payroll.net, cur) },
    ],
    chartTitle: 'Net pay by person',
    chart: payroll.lines.map((l) => ({ label: l.name, value: l.net })),
    chartMoney: true,
    rows: payroll.lines.map((l) => [
      l.name,
      l.role || (l.personType === 'leadership' ? 'Leadership' : l.personType),
      l.dept || '', l.gross, l.deductions, l.net,
    ]),
  } : null
  return [
    { name: 'Fee collection summary', desc: 'Collected, pending & outstanding by class.', spec: collectionSpec },
    { name: 'Outstanding dues register', desc: dueSpec.subtitle!, spec: dueSpec },
    { name: 'Daily collection report', desc: 'Receipts by mode (cash / online / cheque).', spec: modeSpec },
    { name: 'Payroll register', desc: 'Gross, deductions & net pay for all staff.', spec: payrollSpec },
  ]
}

function operationsReports(fleet: FleetBus[]): RptRow[] {
  const manifest: ReportSpec = {
    title: 'Transport route manifest',
    subtitle: 'Buses, routes, drivers, stops & students riding.',
    columns: ['Bus', 'Route', 'Driver', 'Stops', 'Riding', 'Status'],
    align: ['l', 'l', 'l', 'r', 'r', 'l'],
    summary: [
      { label: 'Vehicles', value: String(fleet.length) },
      { label: 'Students riding', value: String(fleet.reduce((n, b) => n + b.studentsRiding, 0)) },
    ],
    chartTitle: 'Students riding by bus',
    chart: fleet.map((b) => ({ label: b.busNo, value: b.studentsRiding })),
    rows: fleet.map((b) => [b.busNo, b.routeName || '—', b.driver || '—', b.stopCount, b.studentsRiding, FLEET_STATUS[b.status] || b.status]),
  }
  return [
    { name: 'Transport route manifest', desc: manifest.subtitle!, spec: manifest },
    { name: 'Library circulation report', desc: 'Issued, returned & overdue titles — no data source yet.', spec: null },
    { name: 'Inventory & assets', desc: 'Stock & asset allocation — no data source yet.', spec: null },
    { name: 'Visitor & gate log', desc: 'Visitor entry / exit — no data source yet.', spec: null },
  ]
}

function SchoolReports() {
  const app = useApp()
  const toast = useToast()
  const [cat, setCat] = useState('academic')
  const [period, setPeriod] = useState(PERIODS[0])
  const cur = app.school.currency

  const { data: students = [] } = useStudents()
  const { data: teacherRows = [] } = useTeachers()
  const { data: staffRows = [] } = useStaff()
  const { data: feeSummary } = useFeeReportSummary()
  const { data: invoices = [] } = useFeeInvoices()
  const payrollEnabled = tierIncludes(app.plan, 'hr_payroll')
  const { data: payroll } = usePayrollPreview(currentPeriod(), cat === 'finance' && payrollEnabled)
  const opsEnabled = tierIncludes(app.plan, 'operations')
  const { data: fleet = [] } = useTransportFleet(cat === 'operations' && opsEnabled)
  const { data: exams = [] } = useExams()
  const academicExam = useMemo(() => pickExam(exams), [exams])
  const examId = cat === 'academic' ? (academicExam?.id ?? null) : null
  const { data: papers = [] } = useExamPapers(examId)
  const { data: marksMap = {} } = useExamMarksMap(examId)

  const meta: ReportMeta = useMemo(() => ({
    schoolName: app.school.name,
    schoolCity: app.school.city,
    logoUrl: app.school.logoUrl,
    logoInitials: app.school.logo,
    brandColor: app.school.color,
    currency: cur,
    period,
  }), [app.school, cur, period])

  const categories: RptCat[] = useMemo(() => [
    { value: 'academic', label: 'Academic', icon: 'cap', reports: academicReports(students, academicExam, papers, marksMap) },
    { value: 'attendance', label: 'Attendance', icon: 'check', reports: attendanceReports(students, teacherRows, staffRows) },
    { value: 'finance', label: 'Finance', icon: 'rupee', reports: financeReports(feeSummary, invoices, payrollEnabled ? payroll : undefined, cur) },
    { value: 'operations', label: 'Operations', icon: 'box', reports: opsEnabled ? operationsReports(fleet) : operationsReports([]) },
  ], [students, academicExam, papers, marksMap, teacherRows, staffRows, feeSummary, invoices, payroll, payrollEnabled, fleet, opsEnabled, cur])

  const active = categories.find((c) => c.value === cat) ?? categories[0]

  const doExcel = async (r: RptRow) => {
    if (!r.spec) return
    try {
      await downloadReportXlsx(r.spec, meta)
      toast.success('Exported .xlsx', `${r.name} (${period}) downloaded with chart & logo.`)
    } catch {
      downloadReportXls(r.spec, meta)
      toast.success('Exported .xls', `${r.name} (${period}) downloaded — opens in Excel.`)
    }
  }
  const doPdf = (r: RptRow) => {
    if (r.spec) openReportPdf(r.spec, meta)
  }

  return (
    <div>
      <PageHead
        title="Reports"
        sub="Generate & export school reports across academics, attendance, finance and operations"
        actions={
          <Select
            options={PERIODS}
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
        }
      />
      <Tabs
        value={cat} onChange={setCat}
        tabs={categories.map((c) => ({ value: c.value, label: c.label, icon: c.icon, count: c.reports.filter((r) => r.spec).length }))}
      />
      <div style={{ marginTop: 16 }}>
        <Card pad={false}>
          <CardHead
            title={`${active.label} reports`}
            sub={`${active.reports.filter((r) => r.spec).length} of ${active.reports.length} ready · ${period}`}
            icon={active.icon}
          />
          <div className="col">
            {active.reports.map((r) => {
              const count = r.spec ? r.spec.rows.length : null
              return (
                <div key={r.name} className="row ai-center gap12 wrap" style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                  <span className="sm-card-ic"><Icon name="doc" size={16} /></span>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div className="fw6">{r.name}</div>
                    <div className="t-xs muted">{r.desc}</div>
                  </div>
                  {r.spec
                    ? <Badge tone="neutral" icon="doc">{count} record{count === 1 ? '' : 's'}</Badge>
                    : <Badge tone="warning" soft>No data source</Badge>}
                  <Btn variant="secondary" size="sm" icon="download" disabled={!r.spec} onClick={() => doExcel(r)}>Excel</Btn>
                  <Btn variant="secondary" size="sm" icon="doc" disabled={!r.spec} onClick={() => doPdf(r)}>PDF</Btn>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </div>
  )
}

/* ============================================================
   Settings
   ============================================================ */
const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी Hindi' },
  { value: 'ar', label: 'العربية Arabic (RTL)' },
  { value: 'ta', label: 'தமிழ் Tamil' },
]

/* Each visible plan feature maps to the gating key for its tier:
   silver -> 'sis', gold -> 'analytics.weak_students', platinum -> 'hr_payroll'. */
const FEATURE_GROUPS: { tier: Tier; key: string; features: string[] }[] = [
  { tier: 'silver', key: 'sis', features: ['SIS · Academics · Attendance', 'Examinations & report cards', 'Fees & online payments', 'Communication & complaints'] },
  { tier: 'gold', key: 'analytics.weak_students', features: ['Weak-student analytics', 'Advanced reporting'] },
  { tier: 'platinum', key: 'hr_payroll', features: ['Staff & Support', 'Operations (transport · hostel · sports)', 'HR & Payroll', 'Geo-fenced attendance', 'Live GPS bus tracking', 'Dedicated support'] },
]

function SettingsScreen() {
  const app = useApp()
  const qc = useQueryClient()
  const { theme, toggleTheme } = useTheme()
  const { data: clients = [] } = usePortfolioSchools(app.isPlatform)
  const [editOpen, setEditOpen] = useState(false)
  const client = clients.find((c) => c.id === app.school.id) ?? null

  const nextTier: Tier = app.plan === 'silver' ? 'gold' : 'platinum'
  const canEditProfile = app.role === 'owner' || app.role === 'admin' || app.isPlatform

  return (
    <div>
      <PageHead title="Settings" sub={app.school.name} />
      <EditSchoolProfileModal
        open={editOpen}
        school={app.school}
        client={client}
        isPlatform={app.isPlatform}
        onClose={() => setEditOpen(false)}
        onSaved={(s) => {
          app.rememberSchool(s)
          void qc.invalidateQueries({ queryKey: ['owner'] })
        }}
      />
      <div className="sm-grid-2" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'flex-start' }}>
        {/* Left column */}
        <div className="col gap16">
          <Card>
            <CardHead
              title="School profile & branding"
              sub="Name, address, logo and round school photo"
              icon="building"
              action={canEditProfile ? (
                <Btn size="sm" variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>Edit</Btn>
              ) : undefined}
            />
            <div className="row ai-center gap14" style={{ marginTop: 16 }}>
              <SchoolPhoto school={app.school} size={72} />
              <div className="flex1" style={{ flex: 1 }}>
                <div className="t-md fw7">{app.school.name}</div>
                <div className="t-sm muted">
                  {app.school.slug ? `${app.school.slug} · ` : ''}
                  {app.school.city}{app.school.tz ? ` · ${app.school.tz}` : ''}
                </div>
                {!canEditProfile && (
                  <div className="t-xs muted3" style={{ marginTop: 6 }}>Ask a school owner or admin to update branding.</div>
                )}
              </div>
            </div>
            {canEditProfile && (
              <div className="row gap8 jc-end" style={{ marginTop: 16 }}>
                <Btn variant="primary" icon="edit" onClick={() => setEditOpen(true)}>Edit school profile</Btn>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Localization" sub="Language · direction · theme" icon="globe" />
            <div style={{ marginTop: 16 }}>
              <Field label="Default language">
                <Select options={LANG_OPTIONS} value={app.lang} onChange={(e) => app.setLang(e.target.value)} />
              </Field>
            </div>
            <div className="row ai-center jc-between" style={{ marginTop: 14 }}>
              <div>
                <div className="fw6 t-md">Right-to-left layout</div>
                <div className="t-xs muted">Auto-enabled for Arabic & Urdu</div>
              </div>
              <Toggle checked={app.dir === 'rtl'} onChange={() => app.setLang(app.dir === 'rtl' ? 'en' : 'ar')} />
            </div>
            <div className="row ai-center jc-between" style={{ marginTop: 14 }}>
              <div>
                <div className="fw6 t-md">Dark mode</div>
                <div className="t-xs muted">Theme preference</div>
              </div>
              <Toggle checked={theme === 'dark'} onChange={toggleTheme} />
            </div>
          </Card>
        </div>

        {/* Right column */}
        <Card pad={false}>
          <CardHead
            title="Plan & feature visibility"
            sub={`Current plan: ${TIER_META[app.plan].label}`}
            icon="layers"
            action={<TierPill plan={app.plan} />}
          />
          <div className="col" style={{ padding: '4px 16px 12px' }}>
            {FEATURE_GROUPS.map((g) => {
              const unlocked = tierIncludes(app.plan, g.key)
              return (
                <div key={g.tier} style={{ marginTop: 12 }}>
                  <div className="row ai-center jc-between" style={{ marginBottom: 4 }}>
                    <TierPill plan={g.tier} />
                    {unlocked
                      ? <Badge tone="success" soft>Included</Badge>
                      : <Badge tone="neutral" icon="lock">Locked</Badge>}
                  </div>
                  {g.features.map((f) => (
                    <div key={f} className="row ai-center gap10" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      {unlocked
                        ? <Icon name="checkCircle" size={17} style={{ color: 'var(--success)' }} />
                        : <Icon name="lock" size={16} style={{ color: TIER_META[g.tier].color }} />}
                      <span className="t-md" style={{ color: unlocked ? 'var(--text)' : 'var(--text-2)', fontWeight: unlocked ? 500 : 400 }}>{f}</span>
                    </div>
                  ))}
                </div>
              )
            })}
            {app.plan !== 'platinum' && (
              <Btn
                variant={app.plan === 'silver' ? 'gold' : 'platinum'} icon="sparkle"
                style={{ width: '100%', marginTop: 16 }}
                onClick={() => app.upgrade(nextTier)}
              >
                Upgrade to {TIER_META[nextTier].label}
              </Btn>
            )}
          </div>
        </Card>
      </div>
      <div style={{ marginTop: 16 }} className="col gap16">
        {tierIncludes(app.plan, 'attendance.geofence') && (
          <TierGate feature="attendance.geofence" title="Campus geo-fence">
            <CampusGeofenceSettings
              schoolName={app.school.name}
              canConfigure={canConfigureGeofence(app.role)}
              compact
            />
          </TierGate>
        )}
        <IntegrationsCard canEdit={canEditProfile} />
      </div>
    </div>
  )
}

/* ============================================================
   Integrations — Email · SMS · Razorpay (school-level setup)
   ============================================================ */
const RZP_STATUS_TONE: Record<RazorpayStatus, BadgeTone> = {
  configured: 'success',
  invalid: 'danger',
  not_configured: 'neutral',
}
const RZP_STATUS_LABEL: Record<RazorpayStatus, string> = {
  configured: 'Connected',
  invalid: 'Invalid credentials',
  not_configured: 'Not configured',
}
const RZP_MODE_OPTIONS = [
  { value: 'test', label: 'Test mode' },
  { value: 'live', label: 'Live mode' },
]

function IntegrationsCard({ canEdit }: { canEdit: boolean }) {
  const toast = useToast()
  const { data, isLoading } = useSchoolIntegrations()
  const saveMut = useSaveSchoolIntegrations()
  const verifyMut = useVerifySchoolRazorpay()

  const [emailEnabled, setEmailEnabled] = useState(false)
  const [fromName, setFromName] = useState('')
  const [fromAddress, setFromAddress] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [emailReceiptTpl, setEmailReceiptTpl] = useState('')
  const [emailReminderTpl, setEmailReminderTpl] = useState('')

  const [smsEnabled, setSmsEnabled] = useState(false)
  const [senderId, setSenderId] = useState('')
  const [smsReceiptTpl, setSmsReceiptTpl] = useState('')
  const [smsReminderTpl, setSmsReminderTpl] = useState('')

  const [rzpEnabled, setRzpEnabled] = useState(false)
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [mode, setMode] = useState<'test' | 'live'>('test')
  const [keySecretSet, setKeySecretSet] = useState(false)
  const [webhookSecretSet, setWebhookSecretSet] = useState(false)
  const [status, setStatus] = useState<RazorpayStatus>('not_configured')

  useEffect(() => {
    if (!data) return
    setEmailEnabled(data.email.enabled)
    setFromName(data.email.fromName ?? '')
    setFromAddress(data.email.fromAddress ?? '')
    setReplyTo(data.email.replyTo ?? '')
    setEmailReceiptTpl(data.email.receiptTemplate ?? '')
    setEmailReminderTpl(data.email.reminderTemplate ?? '')

    setSmsEnabled(data.sms.enabled)
    setSenderId(data.sms.senderId ?? '')
    setSmsReceiptTpl(data.sms.receiptTemplate ?? '')
    setSmsReminderTpl(data.sms.reminderTemplate ?? '')

    setRzpEnabled(data.razorpay.enabled)
    setKeyId(data.razorpay.keyId ?? '')
    setKeySecret('')
    setWebhookSecret('')
    setMode(data.razorpay.mode ?? 'test')
    setKeySecretSet(!!data.razorpay.keySecretSet)
    setWebhookSecretSet(!!data.razorpay.webhookSecretSet)
    setStatus(data.razorpay.status ?? 'not_configured')
  }, [data])

  const disabled = !canEdit || saveMut.isPending

  const save = async () => {
    try {
      const updated = await saveMut.mutateAsync({
        email: {
          enabled: emailEnabled,
          fromName: fromName.trim(),
          fromAddress: fromAddress.trim(),
          replyTo: replyTo.trim() || undefined,
          receiptTemplate: emailReceiptTpl.trim() || undefined,
          reminderTemplate: emailReminderTpl.trim() || undefined,
        },
        sms: {
          enabled: smsEnabled,
          senderId: senderId.trim(),
          receiptTemplate: smsReceiptTpl.trim() || undefined,
          reminderTemplate: smsReminderTpl.trim() || undefined,
        },
        razorpay: {
          enabled: rzpEnabled,
          keyId: keyId.trim(),
          mode,
          /* Write-only secrets: only send when the admin actually typed a new value. */
          ...(keySecret.trim() ? { keySecret: keySecret.trim() } : {}),
          ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        },
      })
      setKeySecret('')
      setWebhookSecret('')
      setKeySecretSet(!!updated.razorpay.keySecretSet)
      setWebhookSecretSet(!!updated.razorpay.webhookSecretSet)
      setStatus(updated.razorpay.status)
      toast.success('Integrations saved', 'Email, SMS and Razorpay settings updated.')
    } catch (e) {
      toast.danger('Could not save', e instanceof ApiError ? e.message : 'Try again.')
    }
  }

  const verify = async () => {
    try {
      const res = await verifyMut.mutateAsync()
      setStatus(res.status)
      if (res.status === 'configured') toast.success('Razorpay connected', 'Credentials verified successfully.')
      else toast.danger('Verification failed', 'Check the key ID and secret, then try again.')
    } catch (e) {
      toast.danger('Could not verify', e instanceof ApiError ? e.message : 'Try again.')
    }
  }

  return (
    <Card pad={false}>
      <CardHead
        title="Integrations"
        sub="Email, SMS and Razorpay — used for receipts, reminders and online fee collection"
        icon="zap"
        action={isLoading ? <Spinner size={16} /> : undefined}
      />
      <div style={{ padding: '4px 16px 16px' }}>
        {!canEdit && (
          <div className="t-xs muted3" style={{ marginBottom: 12 }}>Ask a school owner or admin to update integrations.</div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
          {/* Email */}
          <div className="col gap10">
            <div className="row ai-center jc-between">
              <div className="row ai-center gap8">
                <Icon name="message" size={16} />
                <span className="fw7 t-md">Email</span>
              </div>
              <Toggle checked={emailEnabled} onChange={() => setEmailEnabled((v) => !v)} />
            </div>
            <fieldset disabled={disabled} className="col gap10" style={{ border: 'none', padding: 0, margin: 0 }}>
              <Field label="From name">
                <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="e.g. Riverdale School" />
              </Field>
              <Field label="From address">
                <Input icon="message" type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="fees@school.edu" />
              </Field>
              <Field label="Reply-to">
                <Input icon="message" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="Optional" />
              </Field>
              <Field label="Receipt template" hint="Sent when a fee payment is recorded.">
                <Textarea value={emailReceiptTpl} onChange={(e) => setEmailReceiptTpl(e.target.value)} placeholder="Optional custom template" />
              </Field>
              <Field label="Reminder template" hint="Sent for due/overdue fee reminders.">
                <Textarea value={emailReminderTpl} onChange={(e) => setEmailReminderTpl(e.target.value)} placeholder="Optional custom template" />
              </Field>
            </fieldset>
          </div>

          {/* SMS */}
          <div className="col gap10">
            <div className="row ai-center jc-between">
              <div className="row ai-center gap8">
                <Icon name="phone" size={16} />
                <span className="fw7 t-md">SMS</span>
              </div>
              <Toggle checked={smsEnabled} onChange={() => setSmsEnabled((v) => !v)} />
            </div>
            <fieldset disabled={disabled} className="col gap10" style={{ border: 'none', padding: 0, margin: 0 }}>
              <Field label="Sender ID" hint="6-character DLT-approved sender ID.">
                <Input icon="phone" value={senderId} onChange={(e) => setSenderId(e.target.value.toUpperCase())} placeholder="SCHMAT" maxLength={6} />
              </Field>
              <Field label="Receipt template">
                <Textarea value={smsReceiptTpl} onChange={(e) => setSmsReceiptTpl(e.target.value)} placeholder="Optional custom template" />
              </Field>
              <Field label="Reminder template">
                <Textarea value={smsReminderTpl} onChange={(e) => setSmsReminderTpl(e.target.value)} placeholder="Optional custom template" />
              </Field>
            </fieldset>
          </div>

          {/* Razorpay */}
          <div className="col gap10">
            <div className="row ai-center jc-between">
              <div className="row ai-center gap8">
                <Icon name="rupee" size={16} />
                <span className="fw7 t-md">Razorpay</span>
              </div>
              <Toggle checked={rzpEnabled} onChange={() => setRzpEnabled((v) => !v)} />
            </div>
            <div className="row ai-center gap8">
              <Badge tone={RZP_STATUS_TONE[status]} icon={status === 'configured' ? 'checkCircle' : status === 'invalid' ? 'alert' : 'lock'}>
                {RZP_STATUS_LABEL[status]}
              </Badge>
            </div>
            <fieldset disabled={disabled} className="col gap10" style={{ border: 'none', padding: 0, margin: 0 }}>
              <Field label="Key ID">
                <Input icon="key" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="rzp_test_xxxxxxxx" />
              </Field>
              <Field label="Key secret" hint={keySecretSet ? 'A secret is already saved — leave blank to keep it.' : 'Not set yet.'}>
                <Input
                  icon="lock" type="password" value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  placeholder={keySecretSet ? '•••• (set)' : 'Enter key secret'}
                />
              </Field>
              <Field label="Webhook secret" hint={webhookSecretSet ? 'A secret is already saved — leave blank to keep it.' : 'Optional.'}>
                <Input
                  icon="lock" type="password" value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder={webhookSecretSet ? '•••• (set)' : 'Enter webhook secret'}
                />
              </Field>
              <Field label="Mode">
                <Select options={RZP_MODE_OPTIONS} value={mode} onChange={(e) => setMode(e.target.value as 'test' | 'live')} />
              </Field>
            </fieldset>
            {canEdit && (
              <Btn
                variant="secondary" size="sm" icon="refresh"
                disabled={verifyMut.isPending || !keyId.trim()}
                onClick={() => { void verify() }}
              >
                {verifyMut.isPending ? <><Spinner size={14} /> Testing…</> : 'Test connection'}
              </Btn>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="row gap8 jc-end" style={{ marginTop: 18 }}>
            <Btn variant="primary" icon="check" disabled={saveMut.isPending} onClick={() => { void save() }}>
              {saveMut.isPending ? <><Spinner size={14} /> Saving…</> : 'Save integrations'}
            </Btn>
          </div>
        )}
      </div>
    </Card>
  )
}

/* ============================================================
   Identity & access (RBAC) — Admin only
   ============================================================ */
const CAPS: Cap[] = ['V', 'E', 'A']
const CAP_LABEL: Record<Cap, string> = { V: 'View', E: 'Edit', A: 'Approve' }
const CAP_TONE: Record<Cap, BadgeTone> = { V: 'info', E: 'warning', A: 'success' }
const CAP_COLOR: Record<Cap, string> = { V: 'var(--info)', E: 'var(--warning)', A: 'var(--success)' }

const MODULE_LABEL: Record<string, string> = {
  setup: 'School setup',
  dashboard: 'Dashboard',
  identity: 'Identity & Access',
  sis: 'Student information',
  academics: 'Academics',
  attendance: 'Attendance',
  exams: 'Exams & results',
  fees: 'Fees & finance',
  hr: 'HR & payroll',
  communication: 'Communication',
  operations: 'Operations',
  settings: 'Settings',
  issues: 'Issues & complaints',
  staffTasks: 'Staff tasks',
}

const roleTone = (r: Role): BadgeTone =>
  r === 'principal' ? 'success' : r === 'vice_principal' ? 'brand'
    : r === 'admin' || r === 'owner' ? 'info' : 'neutral'

/* ---------- Users ---------- */
interface SchoolUser {
  id: string
  name: string
  email: string
  role: Role
  hue: number
  status: 'active' | 'pending' | 'inactive'
  last: string
}

const userStatus: Record<SchoolUser['status'], { tone: BadgeTone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  pending: { tone: 'neutral', label: 'Pending' },
  inactive: { tone: 'warning', label: 'Inactive' },
}

/** Highest-privilege first — an Owner who also holds admin should read as Owner. */
const ROLE_RANK: Role[] = ['owner', 'admin', 'principal', 'vice_principal', 'teacher', 'staff']

function mapDto(u: SchoolUserDto, i: number): SchoolUser {
  const mapped = u.roles.map((r) => fromApiRole(r))
  const primary = ROLE_RANK.find((r) => mapped.includes(r)) ?? mapped[0] ?? 'teacher'
  const email = u.email ?? '—'
  return {
    id: u.id,
    name: email.includes('@') ? email.split('@')[0] : email,
    email,
    role: primary,
    hue: (i * 37) % 360,
    status: u.status === 'inactive' ? 'inactive' : u.status === 'pending' ? 'pending' : 'active',
    last: u.created_at ? new Date(u.created_at).toLocaleDateString() : '—',
  }
}

function InviteModalContent({ onDone }: { onDone: () => void }) {
  const app = useApp()
  const toast = useToast()
  const roleOptions = assignableSchoolRoles(app.role)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>(() =>
    roleOptions.includes('admin') ? 'admin' : roleOptions[0] ?? 'teacher',
  )
  const invite = useInviteUser()

  const submit = () => {
    if (!email.trim() || !email.includes('@')) {
      toast.danger('Valid email required', 'Enter the staff member’s work email address.')
      return
    }
    invite.mutate({ email: email.trim(), role }, {
      onSuccess: () => {
        toast.success(
          'Invite sent',
          `${email} got a 6-digit setup code by email (not a link). They open SchoolMate → set password with that code → then they can sign in as ${ROLE_META[role].label}.`,
        )
        onDone()
      },
      onError: (err) => {
        toast.danger('Could not send invite', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  return (
    <Card>
      <CardHead
        title="Send invite"
        sub="CRM access only: Admin · Principal · Vice-Principal. Teachers & staff use People → onboard form (name, address, documents)."
        icon="user"
      />
      <div className="col gap16" style={{ marginTop: 16 }}>
        <Field label="Work email" required>
          <Input icon="message" type="email" value={email} placeholder="admin@school.edu" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="CRM role" required hint={ROLE_META[role]?.desc}>
          <Select
            options={roleOptions.map((r) => ({
              value: r,
              label: `${ROLE_META[r].label} — CRM access`,
            }))}
            value={role} onChange={(e) => setRole(e.target.value as Role)}
          />
        </Field>
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onDone}>Cancel</Btn>
          <Btn variant="secondary" icon="cap" onClick={() => { onDone(); app.go('school.teachers.add') }}>Onboard teacher</Btn>
          {tierIncludes(app.plan, 'staff_support') && (
            <Btn variant="secondary" icon="briefcase" onClick={() => { onDone(); app.go('school.staff.add') }}>Onboard staff</Btn>
          )}
          <Btn variant="primary" icon="check" onClick={submit} disabled={roleOptions.length === 0}>Send invite</Btn>
        </div>
      </div>
    </Card>
  )
}

export function UsersTab() {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('all')
  const [inviting, setInviting] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, UserOverrides>>({})
  const [editing, setEditing] = useState<SchoolUser | null>(null)
  const [removing, setRemoving] = useState<SchoolUser | null>(null)
  const [removeStep, setRemoveStep] = useState<1 | 2>(1)
  const [removeConfirmText, setRemoveConfirmText] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)

  const closeRemove = () => {
    if (removeBusy) return
    setRemoving(null)
    setRemoveStep(1)
    setRemoveConfirmText('')
  }
  const [roleChange, setRoleChange] = useState<{ user: SchoolUser; role: Role } | null>(null)
  const [roleChangeBusy, setRoleChangeBusy] = useState(false)
  const [users, setUsers] = useState<SchoolUser[]>([])
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    setLoading(true)
    try {
      const rows = await listSchoolUsers()
      setUsers(rows.map(mapDto))
    } catch (e) {
      toast.danger('Could not load users', e instanceof ApiError ? e.message : 'Try again.')
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [app.schoolId])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return users.filter((u) => {
      if (needle && !(
        u.name.toLowerCase().includes(needle)
        || u.email.toLowerCase().includes(needle)
        || u.id.toLowerCase().includes(needle)
      )) return false
      if (roleF !== 'all' && u.role !== roleF) return false
      return true
    })
  }, [q, roleF, users])

  const openEditor = async (u: SchoolUser) => {
    try {
      const perms = await getUserPermissions(u.id)
      setOverrides((m) => ({ ...m, [u.id]: overridesFromApi(perms) }))
    } catch {
      setOverrides((m) => ({ ...m, [u.id]: m[u.id] ?? {} }))
    }
    setEditing(u)
  }

  const confirmRemove = async () => {
    if (!removing) return
    setRemoveBusy(true)
    try {
      await removeUserAccess(removing.id)
      setUsers((list) => list.filter((x) => x.id !== removing.id))
      toast.danger('Access removed', `${removing.name} can no longer sign in to this school.`)
      setRemoving(null)
      setRemoveStep(1)
      setRemoveConfirmText('')
    } catch (e) {
      toast.danger('Could not remove access', e instanceof ApiError ? e.message : 'Try again.')
    } finally {
      setRemoveBusy(false)
    }
  }

  const confirmRoleChange = async () => {
    if (!roleChange) return
    const { user, role } = roleChange
    setRoleChangeBusy(true)
    try {
      await setUserRoles(user.id, [role])
      setUsers((list) => list.map((x) => (x.id === user.id ? { ...x, role } : x)))
      toast.success('Role updated', `${ROLE_META[role].label} · ${user.name}`)
      setRoleChange(null)
    } catch (e) {
      toast.danger('Role update failed', e instanceof ApiError ? e.message : 'Try again.')
    } finally {
      setRoleChangeBusy(false)
    }
  }

  const columns: Column<SchoolUser>[] = [
    {
      key: 'name', label: 'User', sortValue: (u) => u.name,
      render: (u) => (
        <div className="row ai-center gap10">
          <Avatar name={u.name} hue={u.hue} size={34} />
          <div>
            <div className="fw6">{u.name}</div>
            <div className="t-xs muted">{u.email}</div>
            <div className="t-xs muted" title={u.id}>id · {u.id.slice(0, 8)}…</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role', label: 'Role', sortValue: (u) => u.role,
      render: (u) => {
        const n = overrideCount(overrides[u.id] ?? {})
        return (
          <div className="row ai-center gap6">
            <Badge tone={roleTone(u.role)}>{ROLE_META[u.role].label}</Badge>
            {n > 0 && <Badge tone="neutral">{n} custom</Badge>}
          </div>
        )
      },
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (u) => u.status,
      render: (u) => <Badge tone={userStatus[u.status].tone}>{userStatus[u.status].label}</Badge>,
    },
    {
      key: 'last', label: 'Joined', align: 'right', sortValue: (u) => u.last,
      render: (u) => <span className="t-sm muted">{u.last}</span>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (u) => (
        <div className="row gap6 jc-end wrap">
          <Btn variant="secondary" size="sm" icon="edit" onClick={() => { void openEditor(u) }}>Permissions</Btn>
          {/* An Owner's role is never editable from this dropdown — moving them to
              Admin/Principal here would silently demote the school's owner. */}
          {u.role === 'owner' ? (
            <Badge tone={roleTone(u.role)}>{ROLE_META[u.role].label}</Badge>
          ) : (
            <Select
              options={assignableSchoolRoles(app.role).map((r) => ({ value: r, label: ROLE_META[r].label }))}
              value={assignableSchoolRoles(app.role).includes(u.role) ? u.role : assignableSchoolRoles(app.role)[0]}
              onChange={(e) => {
                const role = e.target.value as Role
                if (role !== u.role) setRoleChange({ user: u, role })
              }}
              style={{ maxWidth: 130 }}
            />
          )}
          {/* An owner's access is never pausable/removable from here — not even by
              another owner — mirroring the backend guard in Deactivate/SetActiveAsync. */}
          {u.role !== 'owner' && (u.status === 'active' || u.status === 'inactive') && (
            <Btn
              variant="secondary" size="sm"
              icon={u.status === 'active' ? 'lock' : 'checkCircle'}
              onClick={() => {
                const nextActive = u.status !== 'active'
                void setUserActive(u.id, nextActive).then(
                  () => {
                    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, status: nextActive ? 'active' : 'inactive' } : x)))
                    toast.success(nextActive ? 'Access resumed' : 'Access paused', `${u.name} · ${nextActive ? 'can sign in again' : 'can no longer sign in'}.`)
                  },
                  (err) => toast.danger('Could not update status', err instanceof ApiError ? err.message : 'Try again.'),
                )
              }}
            >
              {u.status === 'active' ? 'Deactivate' : 'Activate'}
            </Btn>
          )}
          {u.role !== 'owner' && (
            <Btn variant="danger" size="sm" icon="trash" onClick={() => setRemoving(u)}>Remove</Btn>
          )}
        </div>
      ),
    },
  ]

  if (inviting) return <InviteModalContent onDone={() => { setInviting(false); void reload() }} />
  if (editing) {
    return (
      <UserAccessEditor
        user={editing}
        initial={overrides[editing.id] ?? {}}
        onSave={(ov) => {
          void (async () => {
            try {
              const saved = await setUserPermissions(editing.id, ov)
              setOverrides((m) => ({ ...m, [editing.id]: overridesFromApi(saved) }))
              setEditing(null)
              toast.success('Permissions saved', `Stored for user id ${editing.id.slice(0, 8)}…`)
            } catch (e) {
              toast.danger('Save failed', e instanceof ApiError ? e.message : 'Try again.')
            }
          })()
        }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <Search value={q} onChange={setQ} placeholder="Search name, email, or user id…" style={{ flex: 1, minWidth: 220 }} />
        <Select
          options={[{ value: 'all', label: 'All roles' }, ...assignableSchoolRoles('owner').map((r) => ({ value: r, label: ROLE_META[r].label }))]}
          value={roleF} onChange={(e) => setRoleF(e.target.value)}
        />
        <Btn variant="primary" icon="plus" onClick={() => setInviting(true)}>Send invite</Btn>
      </div>
      {loading
        ? <div className="pad t-sm muted">Loading users for this school…</div>
        : (
          <DataTable<SchoolUser>
            columns={columns}
            rows={rows}
            pageSize={10}
            rowKey={(u) => u.id}
            initialSort={{ key: 'name', dir: 'asc' }}
            empty={<Empty icon="users" title="No users in this school" body="Invite staff — roles & permissions are stored by user id for this school only." />}
          />
        )}
      {removing && (
        <Modal
          open icon="alert" title={removeStep === 1 ? 'Remove access' : 'Confirm removal'}
          sub={`${removing.name} · step ${removeStep} of 2`}
          onClose={closeRemove}
          footer={
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={closeRemove} disabled={removeBusy}>Cancel</Btn>
              {removeStep === 1 ? (
                <Btn variant="danger" icon="trash" onClick={() => setRemoveStep(2)}>Continue</Btn>
              ) : (
                <Btn
                  variant="danger" icon="trash" onClick={() => { void confirmRemove() }}
                  disabled={removeBusy || removeConfirmText.trim().toLowerCase() !== removing.name.trim().toLowerCase()}
                >
                  {removeBusy ? 'Removing…' : 'Remove access'}
                </Btn>
              )}
            </div>
          }
        >
          {removeStep === 1 ? (
            <div className="t-sm muted">
              {removing.name} ({removing.email}) will no longer be able to sign in to this school.
              This doesn't affect any of their other schools. Click Continue to confirm in the next step.
            </div>
          ) : (
            <div className="col gap12">
              <p className="t-sm muted">
                Type <span className="fw7" style={{ color: 'var(--text)' }}>{removing.name}</span> to confirm removing their access. This cannot be undone.
              </p>
              <Field label={`Type "${removing.name}" to confirm`} required>
                <Input
                  icon="trash"
                  value={removeConfirmText}
                  placeholder={removing.name}
                  autoFocus
                  onChange={(e) => setRemoveConfirmText(e.target.value)}
                />
              </Field>
            </div>
          )}
        </Modal>
      )}
      {roleChange && (
        <Modal
          open icon="shield" title="Change role"
          sub={`Change ${roleChange.user.name}'s role to ${ROLE_META[roleChange.role].label}? This updates their permissions in this school immediately.`}
          onClose={() => { if (!roleChangeBusy) setRoleChange(null) }}
          footer={
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={() => setRoleChange(null)} disabled={roleChangeBusy}>Cancel</Btn>
              <Btn variant="primary" icon="check" onClick={() => { void confirmRoleChange() }} disabled={roleChangeBusy}>
                {roleChangeBusy ? 'Saving…' : 'Save changes'}
              </Btn>
            </div>
          }
        >
          <div className="t-sm muted">{roleChange.user.email}</div>
        </Modal>
      )}
    </Card>
  )
}

/* ---------- Roles & permissions matrix ---------- */
type Matrix = Record<string, Record<GateRole, Cap[]>>

function clonePerms(): Matrix {
  const out: Matrix = {}
  for (const mod of Object.keys(PERMS)) {
    out[mod] = { admin: [], principal: [], vice_principal: [], teacher: [], staff: [] }
    for (const r of ROLES) out[mod][r] = [...PERMS[mod][r]]
  }
  return out
}

function applyTenantOverrides(base: Matrix, tenantOv: RoleTemplateOverride[]): Matrix {
  const out: Matrix = {}
  for (const mod of Object.keys(base)) {
    out[mod] = { admin: [...base[mod].admin], principal: [...base[mod].principal], vice_principal: [...base[mod].vice_principal], teacher: [...base[mod].teacher], staff: [...base[mod].staff] }
  }
  for (const t of tenantOv) {
    const row = out[t.module]?.[t.role]
    if (!row) continue
    if (t.effect === 'grant' && !row.includes(t.cap)) row.push(t.cap)
    if (t.effect === 'revoke') out[t.module][t.role] = row.filter((c) => c !== t.cap)
  }
  return out
}

function matrixToOverrides(matrix: Matrix): RoleTemplateOverride[] {
  const out: RoleTemplateOverride[] = []
  for (const mod of Object.keys(matrix)) {
    for (const role of ROLES) {
      for (const cap of matrix[mod][role]) out.push({ role, module: mod, cap, effect: 'grant' })
      for (const cap of PERMS[mod][role]) {
        if (!matrix[mod][role].includes(cap)) out.push({ role, module: mod, cap, effect: 'revoke' })
      }
    }
  }
  return out
}

function CapChip({ cap, active, locked, onClick }: { cap: Cap; active: boolean; locked?: boolean; onClick?: () => void }) {
  const color = CAP_COLOR[cap]
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      title={`${CAP_LABEL[cap]}${locked ? ' (locked)' : ''}`}
      style={{
        width: 30, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 700,
        cursor: locked ? 'default' : 'pointer',
        border: `1px solid ${active ? color : 'var(--border)'}`,
        background: active ? color : 'transparent',
        color: active ? '#fff' : 'var(--text-2)',
        opacity: locked ? 0.85 : 1,
        transition: 'all .12s ease',
      }}
    >
      {cap}
    </button>
  )
}

function OverrideChip({ cap, state, onClick }: { cap: Cap; state: CellState; onClick: () => void }) {
  const granted = state === 'grant'
  const revoked = state === 'revoke'
  const color = CAP_COLOR[cap]
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${CAP_LABEL[cap]} — ${state}`}
      aria-label={`${CAP_LABEL[cap]}: ${state}`}
      style={{
        width: 30, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        border: `1px solid ${granted ? color : revoked ? 'var(--danger)' : 'var(--border)'}`,
        background: granted ? color : 'transparent',
        color: granted ? '#fff' : revoked ? 'var(--danger)' : 'var(--text-2)',
        textDecoration: revoked ? 'line-through' : 'none',
        transition: 'all .12s ease',
      }}
    >
      {cap}
    </button>
  )
}

function UserAccessEditor({ user, initial, onSave, onCancel }: {
  user: SchoolUser
  initial: UserOverrides
  onSave: (ov: UserOverrides) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [ov, setOv] = useState<UserOverrides>(initial)
  const templateQ = useRoleTemplate()
  const tenantOverrides = templateQ.data ?? []

  const cycle = (mod: string, cap: Cap) => {
    setOv((prev) => {
      const next = NEXT_CELL_STATE[cellState(mod, cap, prev)]
      const modOv = { ...(prev[mod] ?? {}) }
      if (next === 'inherit') delete modOv[cap]
      else modOv[cap] = next
      const out = { ...prev }
      if (Object.keys(modOv).length === 0) delete out[mod]
      else out[mod] = modOv
      return out
    })
  }

  const count = overrideCount(ov)
  const reset = () => { setOv(initial); toast.info('Overrides reset', 'Reverted to the last saved overrides.') }
  const save = () => { onSave(ov) }

  return (
    <div className="col gap16">
      <Card>
        <div className="row ai-center gap12 wrap">
          <Avatar name={user.name} hue={user.hue} size={40} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="fw7">{user.name}</div>
            <div className="t-sm muted">{user.email}</div>
            <div className="t-xs muted" title={user.id}>User id · {user.id}</div>
          </div>
          <Badge tone={roleTone(user.role)}>{ROLE_META[user.role].label}</Badge>
          <Btn variant="ghost" size="sm" icon="arrowLeft" onClick={onCancel}>Back</Btn>
        </div>
      </Card>

      <Card pad={false}>
        <CardHead
          title="Per-user access (by id)"
          sub="Tap V / E / A to cycle inherit → grant → revoke — saved against this user id"
          icon="user"
          action={
            <div className="row ai-center gap8">
              <Badge tone="neutral">{count} override{count === 1 ? '' : 's'}</Badge>
              <Btn variant="ghost" size="sm" icon="refresh" onClick={reset}>Reset</Btn>
              <Btn variant="primary" size="sm" icon="check" onClick={save}>Save changes</Btn>
            </div>
          }
        />
        <div style={{ overflowX: 'auto' }}>
          <table className="sm-table">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Module</th>
                <th className="ta-center">Role default</th>
                <th className="ta-center">This user</th>
                <th className="ta-center">Effective</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(PERMS).map((mod) => {
                const roleCaps = caps(user.role, mod)
                const eff = effectiveCaps(user.role, mod, ov, tenantOverrides)
                return (
                  <tr key={mod}>
                    <td>
                      <div className="fw6">{MODULE_LABEL[mod] ?? mod}</div>
                      <div className="t-xs muted">{mod}</div>
                    </td>
                    <td className="ta-center">
                      <span className="t-xs muted">{roleCaps.length ? roleCaps.join(' · ') : '—'}</span>
                    </td>
                    <td className="ta-center">
                      <div className="row gap4" style={{ justifyContent: 'center' }}>
                        {CAPS.map((c) => (
                          <OverrideChip key={c} cap={c} state={cellState(mod, c, ov)} onClick={() => cycle(mod, c)} />
                        ))}
                      </div>
                    </td>
                    <td className="ta-center">
                      <div className="row gap4" style={{ justifyContent: 'center' }}>
                        {eff.length
                          ? eff.map((c) => <Badge key={c} tone={CAP_TONE[c]}>{c}</Badge>)
                          : <span className="t-xs muted">No access</span>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function RolesTab() {
  const toast = useToast()
  const templateQ = useRoleTemplate()
  const setTemplate = useSetRoleTemplate()
  const [matrix, setMatrix] = useState<Matrix>(clonePerms)
  const [loadedFromServer, setLoadedFromServer] = useState(false)

  useEffect(() => {
    if (templateQ.data && !loadedFromServer) {
      setMatrix(applyTenantOverrides(clonePerms(), templateQ.data))
      setLoadedFromServer(true)
    }
  }, [templateQ.data, loadedFromServer])

  const toggle = (mod: string, role: GateRole, cap: Cap) => {
    setMatrix((m) => {
      const cur = m[mod][role]
      const next = cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap]
      return { ...m, [mod]: { ...m[mod], [role]: next } }
    })
  }

  const reset = () => {
    setMatrix(applyTenantOverrides(clonePerms(), templateQ.data ?? []))
    toast.info('Matrix reset', 'Reverted to the saved permission set.')
  }

  const save = () => {
    setTemplate.mutate(matrixToOverrides(matrix), {
      onSuccess: () => toast.success('Permissions saved', 'Role access updated for this school.'),
      onError: (e) => toast.danger('Could not save', e instanceof ApiError ? e.message : 'Try again.'),
    })
  }

  if (templateQ.isLoading) {
    return <Card><Spinner /></Card>
  }
  if (templateQ.isError) {
    return (
      <Card>
        <Empty icon="alert" title="Could not load permissions" body="Try again." />
        <div className="row jc-center" style={{ marginTop: 12 }}>
          <Btn variant="secondary" onClick={() => templateQ.refetch()}>Retry</Btn>
        </div>
      </Card>
    )
  }

  return (
    <div className="col gap16">
      <Card>
        <div className="row ai-center gap12 wrap">
          <span className="sm-kpi-ic" style={{ color: 'var(--brand-600)' }}><Icon name="shield" size={18} /></span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="fw7">Owner is a super-role</div>
            <div className="t-sm muted">
              Owner sits above the school and has full access to every module. It grants the four
              school roles their access below and <strong>cannot itself be restricted</strong>.
            </div>
          </div>
          <div className="row gap6 wrap">
            {CAPS.map((c) => <Badge key={c} tone={CAP_TONE[c]}>{c} · {CAP_LABEL[c]}</Badge>)}
          </div>
        </div>
      </Card>

      <Card pad={false}>
        <CardHead
          title="Permission matrix"
          sub="Tap V / E / A to grant or revoke per module, per role"
          icon="lock"
          action={
            <div className="row gap8">
              <Btn variant="ghost" size="sm" icon="refresh" onClick={reset}>Reset</Btn>
              <Btn variant="primary" size="sm" icon="check" disabled={setTemplate.isPending} onClick={save}>
                {setTemplate.isPending ? 'Saving…' : 'Save changes'}
              </Btn>
            </div>
          }
        />
        <div style={{ overflowX: 'auto' }}>
          <table className="sm-table">
            <thead>
              <tr>
                <th style={{ minWidth: 180 }}>Module</th>
                <th className="ta-center">
                  <span className="row ai-center gap4" style={{ justifyContent: 'center' }}>
                    <Icon name="shield" size={13} /> Owner
                  </span>
                </th>
                {ROLES.map((r) => <th key={r} className="ta-center">{ROLE_META[r].label}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.keys(matrix).map((mod) => (
                <tr key={mod}>
                  <td>
                    <div className="fw6">{MODULE_LABEL[mod] ?? mod}</div>
                    <div className="t-xs muted">{mod}</div>
                  </td>
                  <td className="ta-center">
                    <div className="row gap4" style={{ justifyContent: 'center' }}>
                      {CAPS.map((c) => <CapChip key={c} cap={c} active locked />)}
                      <span style={{ color: 'var(--text-2)', alignSelf: 'center', marginLeft: 2 }}><Icon name="lock" size={13} /></span>
                    </div>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="ta-center">
                      <div className="row gap4" style={{ justifyContent: 'center' }}>
                        {CAPS.map((c) => (
                          <CapChip key={c} cap={c} active={matrix[mod][r].includes(c)} onClick={() => toggle(mod, r, c)} />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* ---------- Invitations ---------- */
export function InvitationsTab() {
  const toast = useToast()
  const [invites, setInvites] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()

  const reload = async () => {
    setLoading(true)
    setError(false)
    try {
      setInvites(await listInvitations())
    } catch (e) {
      toast.danger('Could not load invitations', e instanceof ApiError ? e.message : 'Try again.')
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  const statusTone = (s: Invitation['status']): 'neutral' | 'success' | 'danger' =>
    s === 'accepted' ? 'success' : s === 'revoked' || s === 'expired' ? 'danger' : 'neutral'

  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === 'expired').length

  const doResend = (inv: Invitation) => {
    resend.mutate(inv.id, {
      onSuccess: () => {
        toast.success('Invitation resent', `A fresh link was emailed to ${inv.email ?? inv.phone}.`)
        void reload()
      },
      onError: (e) => toast.danger('Could not resend', e instanceof ApiError ? e.message : 'Try again.'),
    })
  }

  const doRevoke = (inv: Invitation) => {
    revoke.mutate(inv.id, {
      onSuccess: () => {
        toast.danger('Invitation revoked', `${inv.email ?? inv.phone} can no longer join.`)
        void reload()
      },
      onError: (e) => toast.danger('Could not revoke', e instanceof ApiError ? e.message : 'Try again.'),
    })
  }

  return (
    <Card pad={false}>
      <CardHead title="Invitations" sub={`${pendingCount} awaiting acceptance`} icon="inbox" />
      {loading
        ? <div style={{ padding: 16 }} className="t-sm muted">Loading invitations…</div>
        : error
          ? (
            <div style={{ padding: 8 }}>
              <Empty icon="alert" title="Could not load invitations" body="Try again." />
              <div className="row jc-center" style={{ marginTop: 12 }}>
                <Btn variant="secondary" onClick={() => void reload()}>Retry</Btn>
              </div>
            </div>
          )
          : invites.length === 0
            ? <div style={{ padding: 8 }}><Empty icon="inbox" title="No invitations" body="Invite staff from the Users tab." /></div>
            : (
              <div className="col">
                {invites.map((inv) => (
                  <div key={inv.id} className="row ai-center gap12 wrap" style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
                    <Avatar name={inv.email ?? inv.phone ?? '?'} size={34} />
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div className="fw6">{inv.email ?? inv.phone}</div>
                      <div className="t-xs muted row ai-center gap6">
                        <Badge tone="neutral">{inv.roleLabel}</Badge>
                        <Badge tone={statusTone(inv.status)}>{inv.status}</Badge>
                      </div>
                    </div>
                    <div className="t-xs muted" style={{ minWidth: 160 }}>
                      Sent {new Date(inv.invitedAt).toLocaleDateString()} · expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                    <div className="row gap6">
                      {inv.status !== 'accepted' && inv.status !== 'revoked' && (
                        <Btn variant="secondary" size="sm" icon="refresh" onClick={() => doResend(inv)}>Resend</Btn>
                      )}
                      {inv.status === 'pending' && (
                        <Btn variant="ghost" size="sm" icon="trash" onClick={() => doRevoke(inv)}>Revoke</Btn>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
    </Card>
  )
}

/* ---------- Audit log ---------- */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.role_changed': 'Changed role',
  'user.permissions_changed': 'Changed permissions',
  'role_template.updated': 'Updated role template',
}

function AuditTab() {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<AuditEntry[]>([])
  const action = q.trim() || undefined
  const auditQ = useAuditLog({ action, cursor })

  useEffect(() => { setCursor(undefined); setRows([]) }, [action])
  useEffect(() => {
    if (!auditQ.data) return
    setRows((prev) => (cursor ? [...prev, ...auditQ.data.data] : auditQ.data.data))
  }, [auditQ.data, cursor])

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <Search value={q} onChange={setQ} placeholder="Filter by action, e.g. user.role_changed…" style={{ flex: 1, minWidth: 220 }} />
        <Badge tone="neutral" icon="clock">Recent activity</Badge>
      </div>
      {auditQ.isLoading && rows.length === 0 ? (
        <div style={{ padding: 24 }}><Spinner /></div>
      ) : auditQ.isError ? (
        <div style={{ padding: 8 }}>
          <Empty icon="alert" title="Could not load activity" body="Try again." />
          <div className="row jc-center" style={{ marginTop: 12 }}>
            <Btn variant="secondary" onClick={() => auditQ.refetch()}>Retry</Btn>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 8 }}><Empty icon="doc" title="No activity yet" body="Nothing matches that search." /></div>
      ) : (
        <div className="col">
          {rows.map((a) => (
            <div key={a.id} className="row ai-center gap12 wrap" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
              <Avatar name={a.actorName ?? 'System'} size={32} />
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="t-sm">
                  <span className="fw6">{a.actorName ?? 'System'}</span>{' '}
                  <span className="muted">{(AUDIT_ACTION_LABEL[a.action] ?? a.action).toLowerCase()}</span>{' '}
                  {a.target && <span className="fw6">{a.target}</span>}
                </div>
              </div>
              <Badge tone="info">{AUDIT_ACTION_LABEL[a.action] ?? a.action}</Badge>
              <div className="t-xs muted" style={{ minWidth: 140, textAlign: 'right' }}>{new Date(a.at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
      {auditQ.data?.nextCursor && (
        <div className="row jc-center" style={{ padding: 16 }}>
          <Btn variant="ghost" size="sm" disabled={auditQ.isFetching} onClick={() => setCursor(auditQ.data!.nextCursor!)}>
            {auditQ.isFetching ? 'Loading…' : 'Load more'}
          </Btn>
        </div>
      )}
    </Card>
  )
}

function IdentityScreen() {
  const [tab, setTab] = useState('users')
  const [inviteCount, setInviteCount] = useState(0)
  const [userCount, setUserCount] = useState(0)
  useEffect(() => { void listInvitations().then((rows) => setInviteCount(rows.filter((r) => r.status === 'pending' || r.status === 'expired').length)).catch(() => {}) }, [tab])
  useEffect(() => { void listSchoolUsers().then((rows) => setUserCount(rows.length)).catch(() => {}) }, [tab])
  return (
    <div>
      <PageHead
        title="Identity & Access"
        sub="Manage staff accounts, role permissions & access invitations"
      />
      <Tabs
        value={tab} onChange={setTab}
        tabs={[
          { value: 'users', label: 'Users', icon: 'users', count: userCount },
          { value: 'roles', label: 'Roles & Permissions', icon: 'lock' },
          { value: 'invites', label: 'Invitations', icon: 'inbox', count: inviteCount },
          { value: 'audit', label: 'Audit Log', icon: 'clock' },
        ]}
      />
      <div style={{ marginTop: 16 }}>
        {tab === 'users' && <UsersTab />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'invites' && <InvitationsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}

/* ---------- export contract ---------- */
export const adminScreens: Record<string, ComponentType> = {
  'school.reports': SchoolReports,
  'school.settings': SettingsScreen,
  'school.identity': IdentityScreen,
}
