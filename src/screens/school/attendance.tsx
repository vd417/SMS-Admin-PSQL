/* ============================================================
   SchoolMate — Attendance
   Students: class-wise (day/month) — marks from CRM + teacher app.
   Teachers: app check-in/out when they have a phone; admin can mark Present / Half day
   for staff without Android. Half day is stored as a CRM mark, not a punch.
   Staff: photos + present/absent. Geo-fence: Platinum campus setup + live punches.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can, tierIncludes } from '@/lib/gating'
import {
  PageHead, Card, CardHead, Btn, Badge, Avatar, Search, Select, Segmented, Input,
  Icon, Empty, DataTable, Kpi, LineChart, type Column, type BadgeTone,
} from '@/components/ui'
import { RestrictedScreen } from '@/components/shell/gates'
import { useStudents } from '@/api/hooks/useStudents'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { useStaffCheckIns } from '@/api/hooks/usePrincipalAttendance'
import { usePeriodAttendanceRangeSummary, useDashboardAttendanceTrend } from '@/api/hooks/usePeriodAttendanceAdvanced'
import { fmtNum } from '@/lib/format'
import { resolvePeoplePhoto } from '@/api/peopleExtras'
import {
  explicitPeopleStatus,
  fetchRemotePeopleAttendance, savePeopleAttendanceRemote,
          listPeopleAttendanceRange, collectPeopleMarksToSave, isPeopleHalfDay,
} from '@/api/peopleAttendance'
import { ClassWiseStudents } from './attendanceClassWise'
import { listClassAttendanceRange, type AttendanceStatus } from '@/api/attendance'
import { listAllPeriodAttendanceRecords } from '@/api/periodAttendanceAdvanced'
import { useClasses } from '@/api/hooks/useClasses'
import { buildStudentRegisterRows, registerToCsv, type RegisterRow } from '@/lib/attendanceExport'
import { downloadTextFile } from '@/lib/feeExport'
import {
  resolveGeoAttendancePeople,
} from '@/lib/geoAttendanceDemo'
import type { Teacher, Staff, Role } from '@/types'
import { GeoFencePanel } from './geoFencePanel'
import { AttendanceAdvanced } from './attendanceAdvanced'
import { ClassAttendanceOverview } from './classAttendanceOverview'
import { AttendanceRegister } from './attendanceRegister'

type Group = 'students' | 'teachers' | 'staff' | 'geo' | 'advanced' | 'classAttendance' | 'register'
type AttStatus = AttendanceStatus

/** Owner / Admin / Principal / VP — full school roll (students + teachers + staff). */
function seesAllPeople(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'principal' || role === 'vice_principal'
}

/** Leadership can always mark anyone present/absent; teachers keep class Edit from the matrix. */
function canMarkAttendance(role: Role): boolean {
  if (seesAllPeople(role)) return true
  return can(role, 'attendance', 'E')
}

const GROUP_OPTS_ALL_BASE = [
  { value: 'students', label: 'Students' },
  { value: 'teachers', label: 'Teachers' },
  { value: 'staff', label: 'Staff' },
  { value: 'classAttendance', label: 'Class Attendance' },
  { value: 'register', label: 'Overview' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'geo', label: 'Geo-fence' },
] as const

const GROUP_OPTS_TEACHER = [
  { value: 'students', label: 'Students' },
  { value: 'classAttendance', label: 'Class Attendance' },
  { value: 'register', label: 'Overview' },
  { value: 'advanced', label: 'Advanced' },
]

const STATUS_TONE: Record<AttStatus, BadgeTone> = { present: 'success', late: 'warning', absent: 'danger', half_day: 'warning' }
const STATUS_LABEL: Record<AttStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', half_day: 'Half day' }
const PEOPLE_STATUS_OPTS = [
  { value: 'present', label: 'Present' },
  { value: 'half_day', label: 'Half day' },
  { value: 'absent', label: 'Absent' },
]

const SUB_LABEL = { students: 'Class', teachers: 'Department', staff: 'Role' } as const
const GROUP_NAME = { students: 'Students', teachers: 'Teachers', staff: 'Support staff' } as const
const GROUP_ICON = { students: 'users', teachers: 'cap', staff: 'briefcase' } as const

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Wall-clock punch time from the teacher app (e.g. "10:16 AM"). */
function formatCheckInTime(at: string | null | undefined): string {
  if (!at) return '—'
  const s = at.trim()
  const d = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
    ? new Date(`${s}Z`)
    : new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function PunchTimeCell({ at }: { at?: string | null }) {
  if (!at) return <span className="t-sm muted3">—</span>
  return (
    <span className="t-sm fw6" style={{ color: 'var(--brand-600)' }}>
      <Icon name="clock" size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
      {formatCheckInTime(at)}
    </span>
  )
}

function useGeoAttendance(date: string) {
  const app = useApp()
  const geoFence = tierIncludes(app.plan, 'attendance.geofence')
  const teachersQ = useTeachers()
  const staffQ = useStaff()
  const punches = useStaffCheckIns(date, true)

  return useMemo(() => {
    const people = resolveGeoAttendancePeople(
      teachersQ.data ?? [],
      staffQ.data ?? [],
      punches.staff,
      punches.principalKnown,
      geoFence,
    )
    return {
      geoFence,
      people,
      checkIn: punches.checkIn,
      principalKnown: punches.principalKnown,
      loading: teachersQ.isLoading || staffQ.isLoading || punches.loading,
    }
  }, [
    geoFence, teachersQ.data, staffQ.data, staffQ.isLoading, teachersQ.isLoading,
    punches.staff, punches.checkIn, punches.principalKnown, punches.loading,
  ])
}

/* ============================================================
   Teachers / Staff roster — photos + present/absent (owner/admin/principal)
   ============================================================ */
interface PersonRow {
  id: string
  name: string
  hue: number
  sub: string
  ytd: number
  photo?: string
  status: AttStatus | null
  appCheckIn?: boolean
  checkInAt?: string | null
  checkOutAt?: string | null
}

function StaffRoster({ group, editable }: { group: 'teachers' | 'staff'; editable: boolean }) {
  const toast = useToast()
  const teachersQ = useTeachers()
  const staffQ = useStaff()
  const [date, setDate] = useState(todayIso)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | AttStatus>('all')
  const [draft, setDraft] = useState<Record<string, AttStatus>>({})
  const [saved, setSaved] = useState<Record<string, AttStatus>>({})
  const geo = useGeoAttendance(date)

  useEffect(() => {
    setSaved({})
    setDraft({})
    let cancelled = false
    void fetchRemotePeopleAttendance(group, date)
      .then((remote) => { if (!cancelled) setSaved(remote) })
      .catch(() => { if (!cancelled) setSaved({}) })
    return () => { cancelled = true }
  }, [group, date])

  const appCheckIn = geo.checkIn

  /** `null` means nobody — CRM, teacher app, or geo-fence — has marked this person yet. */
  const statusOf = (id: string, name: string): AttStatus | null => {
    if (draft[id]) return draft[id]
    return explicitPeopleStatus(
      { id, name },
      saved,
      { checkIn: appCheckIn, principalKnown: geo.principalKnown },
    )
  }

  const all = useMemo((): PersonRow[] => {
    if (group === 'teachers') {
      return (teachersQ.data ?? []).map((t: Teacher) => {
        const hit = appCheckIn.get(t.id.toLowerCase()) ?? appCheckIn.get(t.id) ?? appCheckIn.get(t.name.trim().toLowerCase())
        return {
          id: t.id,
          name: t.name,
          hue: t.avatarHue,
          sub: `${t.dept} · ${t.desig}`,
          ytd: Number(t.attendance) || 0,
          photo: resolvePeoplePhoto('teacher', t.id, t.photoUrl),
          status: statusOf(t.id, t.name),
          appCheckIn: Boolean(hit?.checkedIn || hit?.at || hit?.checkOutAt),
          checkInAt: hit?.at,
          checkOutAt: hit?.checkOutAt,
        }
      })
    }
    return (staffQ.data ?? []).map((s: Staff) => {
      const hit = appCheckIn.get(s.id.toLowerCase()) ?? appCheckIn.get(s.id) ?? appCheckIn.get(s.name.trim().toLowerCase())
      return {
        id: s.id,
        name: s.name,
        hue: s.avatarHue,
        sub: `${s.role} · ${s.dept}`,
        ytd: Number(s.attendance) || 0,
        photo: resolvePeoplePhoto('staff', s.id, s.photoUrl),
        status: statusOf(s.id, s.name),
        appCheckIn: Boolean(hit?.checkedIn || hit?.at || hit?.checkOutAt),
        checkInAt: hit?.at,
        checkOutAt: hit?.checkOutAt,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, teachersQ.data, staffQ.data, draft, saved, appCheckIn, geo.principalKnown])

  const searched = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return all
    return all.filter((p) => p.name.toLowerCase().includes(term) || p.id.toLowerCase().includes(term))
  }, [all, q])

  const rows = useMemo(
    () => (filter === 'all' ? searched : searched.filter((p) => p.status === filter)),
    [searched, filter],
  )

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0, half_day: 0, unmarked: 0 }
    searched.forEach((p) => { c[p.status ?? 'unmarked']++ })
    return c
  }, [searched])

  const presentTotal = counts.present + counts.late
  const halfDayTotal = counts.half_day
  const onRoll = all.length
  const absentOrUnmarked = Math.max(0, onRoll - presentTotal - halfDayTotal)
  const attendancePct = onRoll
    ? Math.round(((presentTotal + halfDayTotal * 0.5) / onRoll) * 100)
    : 0

  const filterOpts = [
    { value: 'all', label: `All (${searched.length})` },
    { value: 'present', label: `Present (${counts.present})` },
    { value: 'half_day', label: `Half day (${counts.half_day})` },
    { value: 'late', label: `Late (${counts.late})` },
    { value: 'absent', label: `Absent (${counts.absent})` },
  ]

  const setStatus = (id: string, st: AttStatus) => setDraft((d) => ({ ...d, [id]: st }))

  const markAll = (st: AttStatus) =>
    setDraft((d) => ({ ...d, ...Object.fromEntries(all.map((p) => [p.id, st])) }))

  const submit = async () => {
    const marks = collectPeopleMarksToSave(all, saved, draft)
    if (!Object.keys(marks).length) {
      toast.danger('Nothing to save', 'Mark Present, Half day, or Absent for at least one person.')
      return
    }
    try {
      const fresh = await savePeopleAttendanceRemote(group, date, marks)
      setSaved(fresh)
      setDraft({})
      const half = Object.values(marks).filter((s) => isPeopleHalfDay(s)).length
      toast.success(
        'Attendance saved',
        half
          ? `${GROUP_NAME[group]} · ${date} · ${half} half day`
          : `${GROUP_NAME[group]} · ${date} · ${presentTotal}/${onRoll} present`,
      )
    } catch (err) {
      toast.danger('Could not save attendance', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const cols: Column<PersonRow>[] = [
    {
      key: 'name', label: 'Name', sortValue: (r) => r.name,
      render: (r) => (
        <div className="row ai-center gap12">
          <Avatar name={r.name} hue={r.hue} size={44} src={r.photo} />
          <div>
            <div className="t-md fw6">{r.name}</div>
            <div className="t-xs muted3">{r.sub}</div>
          </div>
        </div>
      ),
    },
    { key: 'sub', label: SUB_LABEL[group], sortValue: (r) => r.sub, render: (r) => <span className="t-sm muted">{r.sub}</span> },
    ...(true ? [
      {
        key: 'source', label: 'Source',
        render: (r: PersonRow) => r.status === 'half_day'
          ? <Badge tone="warning">Admin · Half day</Badge>
          : r.appCheckIn && !saved[r.id] && !draft[r.id]
            ? <Badge tone="info" icon="phone">App check-in</Badge>
            : r.status
              ? <Badge tone="neutral">Admin</Badge>
              : <Badge tone="neutral">Not marked</Badge>,
      } satisfies Column<PersonRow>,
      {
        key: 'checkInAt',
        label: 'Check in',
        sortValue: (r: PersonRow) => (r.checkInAt ? new Date(r.checkInAt).getTime() : 0),
        render: (r: PersonRow) => <PunchTimeCell at={r.checkInAt} />,
      } satisfies Column<PersonRow>,
      {
        key: 'checkOutAt',
        label: 'Check out',
        sortValue: (r: PersonRow) => (r.checkOutAt ? new Date(r.checkOutAt).getTime() : 0),
        render: (r: PersonRow) => <PunchTimeCell at={r.checkOutAt} />,
      } satisfies Column<PersonRow>,
    ] : []),
    {
      key: 'ytd', label: 'YTD %', sortValue: (r) => r.ytd,
      render: (r) => <Badge tone={r.ytd >= 90 ? 'success' : r.ytd >= 75 ? 'warning' : 'danger'} dot>{r.ytd}%</Badge>,
    },
    {
      key: 'status', label: 'Today',
      render: (r) => editable
        ? <Segmented
            value={r.status ?? ''}
            onChange={(v) => setStatus(r.id, v as AttStatus)}
            options={r.status === 'late' ? [...PEOPLE_STATUS_OPTS, { value: 'late', label: 'Late' }] : PEOPLE_STATUS_OPTS}
          />
        : r.status
          ? <Badge tone={STATUS_TONE[r.status]} dot>{STATUS_LABEL[r.status]}</Badge>
          : <Badge tone="neutral">Not marked</Badge>,
    },
  ]

  const loading = group === 'teachers'
    ? teachersQ.isLoading || geo.loading
    : staffQ.isLoading || geo.loading

  return (
    <Card pad={false}>
      <CardHead
        title={`${GROUP_NAME[group]} roster`}
        sub={`${date} · app check-in if they have a phone · admin can mark Present / Half day · ${presentTotal}/${all.length} present`}
        icon={GROUP_ICON[group]}
        action={
          <div className="row ai-center gap8 wrap">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            <Search value={q} onChange={setQ} placeholder={`Find ${group}…`} style={{ width: 180 }} />
            <Select options={filterOpts} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | AttStatus)} />
          </div>
        }
      />
      {loading ? (
        <div style={{ padding: 24 }}><span className="t-sm muted">Loading…</span></div>
      ) : (
        <>
          <div className="sm-att-hero">
            <div className="sm-att-hero-kpis">
              <div>
                <div className="sm-att-hero-val">{attendancePct}%</div>
                <div className="t-sm muted">{GROUP_NAME[group]} · today</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{presentTotal}</div>
                <div className="t-xs muted3">Present</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{halfDayTotal}</div>
                <div className="t-xs muted3">Half day</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{absentOrUnmarked}</div>
                <div className="t-xs muted3">Absent / unmarked</div>
              </div>
              <div className="sm-att-hero-stat">
                <div className="t-lg fw7">{onRoll}</div>
                <div className="t-xs muted3">On roll</div>
              </div>
            </div>
            <div className="row ai-center gap8 wrap">
              {group === 'teachers' || group === 'staff'
                ? <Badge tone="info" icon="phone">App punches + admin marks</Badge>
                : <Badge tone="neutral">Staff roll-call</Badge>}
              <span className="t-xs muted3">{date}</span>
            </div>
            <div className="sm-meter" style={{ width: '100%', height: 8, marginTop: 4 }}>
              <span style={{ width: `${attendancePct}%`, background: 'var(--success)' }} />
            </div>
          </div>
          <DataTable
            columns={cols}
            rows={rows}
            pageSize={8}
            rowKey={(r) => r.id}
            initialSort={{ key: 'name', dir: 'asc' }}
            empty={<Empty icon="users" title="No one yet" body={`No ${group} found for this school.`} />}
          />
        </>
      )}
      <div className="row ai-center jc-between" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
        <span className="t-sm muted">
          {group === 'teachers' || group === 'staff'
            ? 'Phones check in/out in the teacher app. Owner / Admin / Principal can mark Present or Half day here for anyone without a phone.'
            : editable
              ? 'Owner / Admin / Principal can mark any staff present or absent.'
              : 'View only.'}
        </span>
        <div className="row ai-center gap8 wrap">
          {editable && (
            <>
              <Btn size="sm" variant="secondary" icon="check" disabled={!all.length} onClick={() => markAll('present')}>All present</Btn>
              <Btn size="sm" variant="ghost" disabled={!all.length} onClick={() => markAll('absent')}>All absent</Btn>
            </>
          )}
          <Btn
            variant="primary"
            icon="check"
            disabled={!editable || !all.length}
            onClick={submit}
          >
            Submit attendance
          </Btn>
        </div>
      </div>
    </Card>
  )
}

/* ============================================================
   Class Attendance — simple Class + Section pick, then trend/subjects/table
   (no other filters — a lighter-weight sibling to Advanced > Class subview)
   ============================================================ */
function ClassAttendanceView() {
  const classesQ = useClasses()
  const classes = classesQ.data ?? []
  const grades = useMemo(
    () => [...new Set(classes.map((item) => item.grade).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [classes],
  )
  const [grade, setGrade] = useState('')
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState(todayIso)
  const [to, setTo] = useState(todayIso)

  return (
    <div>
      <div className="sm-att-adv-filters" style={{ marginBottom: 16 }}>
        <label className="sm-att-adv-field">
          <span>Class</span>
          <Select
            aria-label="Class"
            value={grade}
            options={[{ value: '', label: 'All classes' }, ...grades.map((g) => ({ value: g, label: g }))]}
            onChange={(event) => { setGrade(event.target.value); setClassId('') }}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Section</span>
          <Select
            aria-label="Section"
            value={classId}
            options={[
              { value: '', label: 'Choose a section…' },
              ...classes.filter((item) => !grade || item.grade === grade).map((item) => ({
                value: item.id ?? '', label: item.name || `${item.grade}-${item.section}`,
              })),
            ]}
            onChange={(event) => setClassId(event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>From</span>
          <Input
            aria-label="Class attendance from date" type="date" value={from}
            onChange={(event) => {
              const next = event.target.value
              setFrom(next)
              if (to < next) setTo(next)
            }}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>To</span>
          <Input
            aria-label="Class attendance to date" type="date" value={to} min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      {!classId ? (
        <Empty icon="calendar" title="Choose a section to see its attendance overview." />
      ) : (
        <ClassAttendanceOverview
          classId={classId}
          from={from}
          to={to}
          classLabel={classes.find((c) => c.id === classId)?.name}
          fullRoster
        />
      )}
    </div>
  )
}

/* ============================================================
   Screen
   ============================================================ */
function AttendanceScreen() {
  const app = useApp()
  const toast = useToast()
  const studentsQ = useStudents()
  const teachersQ = useTeachers()
  const staffQ = useStaff()
  const classesQ = useClasses()
  const allPeople = seesAllPeople(app.role)
  const canView = allPeople || can(app.role, 'attendance', 'V') || can(app.role, 'attendance', 'E')
  const editable = canMarkAttendance(app.role)
  const geoFence = tierIncludes(app.plan, 'attendance.geofence')
  const groupOpts = useMemo(() => {
    const base = allPeople ? GROUP_OPTS_ALL_BASE : GROUP_OPTS_TEACHER
    return geoFence ? [...base] : base.filter((o) => o.value !== 'geo')
  }, [allPeople, geoFence])
  const [group, setGroup] = useState<Group>('students')

  const today = todayIso()
  const overviewQ = usePeriodAttendanceRangeSummary({ preset: 'custom', from: today, to: today }, allPeople)
  const trendQ = useDashboardAttendanceTrend(allPeople)
  const attTrend = useMemo(() => (trendQ.data ?? []).filter((p) => !p.empty), [trendQ.data])

  useEffect(() => {
    if (!groupOpts.some((o) => o.value === group)) setGroup('students')
  }, [groupOpts, group])

  const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const exportRegister = async () => {
    let rows: RegisterRow[] = []
    const to = new Date()
    const from = new Date(to)
    from.setDate(from.getDate() - 120)
    const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`
    const toIso = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`
    try {
      if (group === 'teachers' || group === 'staff') {
        const roster = (group === 'teachers' ? teachersQ.data : staffQ.data) ?? []
        const byId = new Map(roster.map((p) => [p.id, p.name]))
        const records = await listPeopleAttendanceRange(group, fromIso, toIso)
        rows = records
          .map((r) => ({
            name: byId.get(r.studentId) ?? r.studentId,
            adm: r.studentId,
            cls: group,
            date: r.date,
            status: r.status,
          }))
          .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
      } else {
        const periodRows = await listAllPeriodAttendanceRecords({
          from: fromIso,
          to: toIso,
          preset: 'custom',
        })
        if (periodRows.length) {
          rows = periodRows
            .map((r) => ({
              name: r.studentName,
              adm: r.admissionNo,
              cls: r.classLabel || `${r.grade}-${r.section}`,
              date: r.date,
              status: `P${r.period} ${r.subject} ${r.status}`,
            }))
            .sort((a, b) => a.date.localeCompare(b.date) || a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name))
        } else {
          const classIds = (classesQ.data ?? []).map((c) => c.id).filter(Boolean) as string[]
          const batches = await Promise.all(
            classIds.map((id) => listClassAttendanceRange(id, fromIso, toIso)),
          )
          rows = buildStudentRegisterRows(batches.flat(), studentsQ.data ?? [])
        }
      }
    } catch {
      toast.danger('Export unavailable', 'Could not load attendance from the server.')
      return
    }
    if (!rows.length) {
      toast.danger('Nothing to export', 'No attendance has been marked yet for this group.')
      return
    }
    downloadTextFile(`attendance-${group}-${todayIso()}.csv`, registerToCsv(rows))
    toast.success('Register exported', `${rows.length} mark${rows.length === 1 ? '' : 's'} · ${group}`)
  }

  if (!canView) {
    return <RestrictedScreen title="Attendance" note="Your role does not include attendance access." />
  }

  return (
    <div>
      <PageHead
        title="Attendance"
        sub={allPeople
          ? `${dateStr} · Owner / Admin / Principal can mark present / absent for any student, teacher or staff`
          : dateStr}
        actions={<Btn variant="secondary" icon="download" disabled={group === 'geo'} onClick={exportRegister}>Export register</Btn>}
      />

      {allPeople && (
        <>
          <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
            <Kpi
              icon="check" iconBg="color-mix(in srgb, #22C55E 12%, white)" iconColor="#22C55E"
              label="Overall attendance"
              value={overviewQ.data?.attendancePercentage == null ? '—' : `${overviewQ.data.attendancePercentage}%`}
              foot="Today · students"
            />
            <Kpi
              icon="users" iconBg="color-mix(in srgb, #4F46E5 12%, white)" iconColor="#4F46E5"
              label="Present"
              value={overviewQ.isLoading ? '—' : fmtNum(overviewQ.data?.present ?? 0)}
              foot="Today · students"
            />
            <Kpi
              icon="close" iconBg="color-mix(in srgb, #DC2626 12%, white)" iconColor="#DC2626"
              label="Absent"
              value={overviewQ.isLoading ? '—' : fmtNum(overviewQ.data?.absent ?? 0)}
              foot="Today · students"
            />
            <Kpi
              icon="clock" iconBg="color-mix(in srgb, #D97706 12%, white)" iconColor="#D97706"
              label="Late"
              value={overviewQ.isLoading ? '—' : fmtNum(overviewQ.data?.late ?? 0)}
              foot="Today · students"
            />
          </div>

          <Card style={{ marginBottom: 16 }}>
            <CardHead title="Attendance trend" sub={
              trendQ.isLoading
                ? 'Loading last 8 weeks…'
                : (attTrend.length ? 'Weekly average · last 8 weeks' : 'No period marks in the last 8 weeks')
            } icon="trend" />
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
        </>
      )}

      <div style={{ marginBottom: 16 }}>
        <Segmented value={group} onChange={(v) => setGroup(v as Group)} options={groupOpts} />
      </div>

      {group === 'students' && <ClassWiseStudents editable={editable} leadership={allPeople} />}
      {group === 'classAttendance' && <ClassAttendanceView />}
      {group === 'register' && <AttendanceRegister canMark={editable} />}
      {group === 'advanced' && <AttendanceAdvanced />}
      {allPeople && (group === 'teachers' || group === 'staff') && <StaffRoster group={group} editable={editable} />}
      {allPeople && group === 'geo' && <GeoFencePanel />}
    </div>
  )
}

export const attendanceScreens: Record<string, ComponentType> = {
  'school.attendance': AttendanceScreen,
}
