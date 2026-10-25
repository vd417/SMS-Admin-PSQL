/* ============================================================
   SchoolMate — People hub: Teachers, Staff & support, Parents.
   Teachers/Staff/Parents from live APIs (Parents derived from /students).
   NOTE: per the design, calling/phone-call actions were removed —
   these screens only ever offer "Message", never a Call button.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can } from '@/lib/gating'
import { TierGate } from '@/components/shell/gates'
import {
  PageHead, Card, CardHead, Btn, Badge, Avatar, Search, Select,
  Drawer, Icon, Empty, Progress, DataTable, Spinner, Modal,
  type Column, type BadgeTone,
} from '@/components/ui'
import { depts } from '@/data/mockDb'
import { fmtMoney } from '@/lib/format'
import { normalizeStaffCategory, staffCategoryLabel } from '@/lib/staffCategory'
import type { Teacher, Staff, Role } from '@/types'
import { useTeachers } from '@/api/hooks/useTeachers'
import { normalizeSubjects } from '@/api/teachers'
import { useStaff } from '@/api/hooks/useStaff'
import { useTransportBuses } from '@/api/hooks/useOperations'
import { useStudents } from '@/api/hooks/useStudents'
import { studentParentLabel, parentMailFromStudent } from '@/api/students'
import {
  listPeopleDocs, resolvePeoplePhoto, openStoredDoc, downloadStoredDoc, isStoredImage,
} from '@/api/peopleExtras'
import { fetchTeacherExtras } from '@/api/teacherExtras'
import { fetchStaffExtras } from '@/api/staffExtras'
import { openMailCompose } from '@/lib/composeMail'
import { useLeadershipRoleByEmail, useSchoolUserByEmail, useAccountByEmail } from '@/api/hooks/useUsers'
import { fromApiRole, type SchoolUserDto } from '@/api/users'
import { useSetUserActive } from '@/api/hooks/useUserMutations'

/* ---------- shared helpers ---------- */
const attColor = (v: number): string => (v >= 90 ? 'var(--success)' : v >= 80 ? 'var(--brand-600)' : v >= 75 ? 'var(--warning)' : 'var(--danger)')
const statusTone = (s: string): BadgeTone => (s === 'active' ? 'success' : 'neutral')
const statusLabel = (s: string): string => (s === 'active' ? 'Active' : 'Inactive')

/* ============================================================
   Teacher profile drawer (read-only)
   ============================================================ */
function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="row ai-center jc-between"><span className="muted t-sm">{label}</span><span className="fw7">{value}</span></div>
  )
}

function SubjectChips({ subjects, max }: { subjects: unknown; max?: number }) {
  const list = normalizeSubjects(subjects)
  if (!list.length) return <span className="muted">—</span>
  const cap = max ?? list.length
  const shown = list.slice(0, cap)
  const extra = list.length - shown.length
  return (
    <div className="sm-subject-chips" title={list.join(', ')}>
      {shown.map((s) => <Badge key={s} tone="brand" soft>{s}</Badge>)}
      {extra > 0 && <Badge tone="neutral" soft>+{extra}</Badge>}
    </div>
  )
}

function PeopleDocsList({
  kind, personId, toast,
}: {
  kind: 'teacher' | 'staff'
  personId: string
  toast: ReturnType<typeof useToast>
}) {
  const [docs, setDocs] = useState(() => listPeopleDocs(kind, personId))
  useEffect(() => {
    let cancelled = false
    setDocs(listPeopleDocs(kind, personId))
    const load = kind === 'teacher' ? fetchTeacherExtras : fetchStaffExtras
    void load(personId)
      .then(() => { if (!cancelled) setDocs(listPeopleDocs(kind, personId)) })
      .catch(() => { /* keep cache/legacy */ })
    return () => { cancelled = true }
  }, [kind, personId])
  if (docs.length === 0) {
    return (
      <Empty
        icon="doc"
        title="No documents yet"
        body="Re-onboard or re-upload photo / Aadhaar / resume (under ~2.5 MB for PDFs) to view them here."
      />
    )
  }
  return (
    <div className="col gap8">
      {docs.map((d) => (
        <div key={d.key + d.fileName} className="row ai-center jc-between gap10" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="row ai-center gap12" style={{ minWidth: 0 }}>
            {d.dataUrl && isStoredImage(d) ? (
              <img src={d.dataUrl} alt={d.label} className="sm-upload-thumb is-photo" style={{ width: 48, height: 48, borderRadius: 10 }} />
            ) : (
              <span className="sm-card-ic"><Icon name="doc" size={16} /></span>
            )}
            <div style={{ minWidth: 0 }}>
              <div className="fw6">{d.label}</div>
              <div className="t-xs muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.fileName}</div>
            </div>
          </div>
          <div className="row ai-center gap6">
            <Badge tone={d.dataUrl ? 'success' : 'neutral'}>{d.dataUrl ? 'Ready' : 'Name only'}</Badge>
            <Btn
              variant="ghost" size="sm" icon="eye"
              onClick={() => {
                if (!openStoredDoc(d)) {
                  toast.info('Preview unavailable', d.dataUrl ? 'Allow popups, or use Download.' : 'Re-upload this file (PDF under ~2.5 MB).')
                }
              }}
            >
              View
            </Btn>
            <Btn
              variant="secondary" size="sm" icon="download"
              onClick={() => {
                if (!downloadStoredDoc(d)) toast.info('Download unavailable', 'Re-upload this file first.')
              }}
            >
              Download
            </Btn>
          </div>
        </div>
      ))}
    </div>
  )
}

const CAN_MANAGE_ACCESS: Role[] = ['owner', 'admin', 'principal', 'vice_principal']

/** True when the linked account itself holds CRM/leadership access (Owner, Admin or
 *  Principal — e.g. the same email was also separately invited via Identity & access).
 *  That access is a different, separately-managed thing from a Teacher/Staff row's app
 *  login, so Suspend from People never touches it — it stays out of scope here and is
 *  only ever paused/removed from Identity & access → Users. */
function hasCrmAccess(account: SchoolUserDto): boolean {
  return account.roles.some((r) => {
    const role = fromApiRole(r)
    return role === 'owner' || role === 'admin' || role === 'principal'
  })
}

/** Second step for Suspend — signing someone out of the app is disruptive enough that a
 *  stray click shouldn't do it, so Suspend always confirms first. Unsuspend restores
 *  access and stays a single click. */
function SuspendConfirmModal({ name, busy, onCancel, onConfirm }: { name: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      icon="lock"
      title="Suspend app access"
      sub={`${name} won't be able to sign in until you unsuspend them. This doesn't remove their profile.`}
      onClose={() => { if (!busy) onCancel() }}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Btn>
          <Btn variant="danger" icon="lock" onClick={onConfirm} disabled={busy}>{busy ? 'Suspending…' : 'Suspend'}</Btn>
        </div>
      }
    />
  )
}

function AccessCard({ email, name }: { email: string | undefined; name: string }) {
  const app = useApp()
  const toast = useToast()
  const account = useSchoolUserByEmail(email)
  const setActive = useSetUserActive()
  const [confirming, setConfirming] = useState(false)

  if (!CAN_MANAGE_ACCESS.includes(app.role)) return null

  if (!account) {
    return (
      <Card>
        <CardHead title="App access" icon="key" />
        <div className="t-sm muted" style={{ marginTop: 8 }}>Not yet invited to the app.</div>
      </Card>
    )
  }

  const pending = account.status !== 'active' && account.status !== 'inactive'
  const crmAccess = hasCrmAccess(account)
  const suspended = account.status === 'inactive'
  const apply = () => {
    setActive.mutate({ userId: account.id, active: suspended }, {
      onSuccess: () => {
        toast.success(
          suspended ? 'Access restored' : 'Account suspended',
          `${name} ${suspended ? 'can sign in again' : 'can no longer sign in'}.`,
        )
        setConfirming(false)
      },
      onError: (err) => toast.danger('Could not update access', err instanceof Error ? err.message : 'Try again.'),
    })
  }

  return (
    <Card>
      <CardHead title="App access" icon="key" />
      <div className="row ai-center jc-between" style={{ marginTop: 8 }}>
        {pending ? (
          <Badge tone="neutral">{account.status}</Badge>
        ) : (
          <Badge tone={suspended ? 'danger' : 'success'}>{suspended ? 'Suspended' : 'Active'}</Badge>
        )}
        {!pending && !crmAccess && (
          <Btn
            variant="secondary"
            size="sm"
            icon={suspended ? 'checkCircle' : 'lock'}
            onClick={() => (suspended ? apply() : setConfirming(true))}
            disabled={setActive.isPending}
          >
            {setActive.isPending ? 'Saving…' : suspended ? 'Unsuspend' : 'Suspend'}
          </Btn>
        )}
      </div>
      {!pending && crmAccess && (
        <div className="t-xs muted" style={{ marginTop: 8 }}>Also has CRM access — manage that in Identity & access → Users.</div>
      )}
      {confirming && (
        <SuspendConfirmModal name={name} busy={setActive.isPending} onCancel={() => setConfirming(false)} onConfirm={apply} />
      )}
    </Card>
  )
}

/** Suspend/Unsuspend action for a list row — mirrors AccessCard's logic but takes the
 *  account directly (looked up once per screen via useAccountByEmail) so DataTable rows
 *  don't each run their own useSchoolUserByEmail query. Suspend still confirms first. */
function SuspendAction({ account, name, canManage }: { account: SchoolUserDto | undefined; name: string; canManage: boolean }) {
  const toast = useToast()
  const setActive = useSetUserActive()
  const [confirming, setConfirming] = useState(false)
  if (!canManage || !account) return null
  const pending = account.status !== 'active' && account.status !== 'inactive'
  if (pending || hasCrmAccess(account)) return null
  const suspended = account.status === 'inactive'
  const apply = () => {
    setActive.mutate({ userId: account.id, active: suspended }, {
      onSuccess: () => {
        toast.success(
          suspended ? 'Access restored' : 'Account suspended',
          `${name} ${suspended ? 'can sign in again' : 'can no longer sign in'}.`,
        )
        setConfirming(false)
      },
      onError: (err) => toast.danger('Could not update access', err instanceof Error ? err.message : 'Try again.'),
    })
  }
  return (
    <>
      <Btn
        variant="secondary"
        size="sm"
        icon={suspended ? 'checkCircle' : 'lock'}
        disabled={setActive.isPending}
        onClick={(e) => {
          e.stopPropagation()
          if (suspended) apply()
          else setConfirming(true)
        }}
      >
        {setActive.isPending ? 'Saving…' : suspended ? 'Unsuspend' : 'Suspend'}
      </Btn>
      {confirming && (
        <SuspendConfirmModal name={name} busy={setActive.isPending} onCancel={() => setConfirming(false)} onConfirm={apply} />
      )}
    </>
  )
}

function TeacherProfile({ teacher, onClose, onMessage }: { teacher: Teacher | null; onClose: () => void; onMessage: (t: Teacher) => void }) {
  const app = useApp()
  const toast = useToast()
  if (!teacher) return null
  const photoUrl = resolvePeoplePhoto('teacher', teacher.id, teacher.photoUrl)
  return (
    <Drawer
      open={!!teacher} onClose={onClose} icon="user"
      title={teacher.name} sub={`${teacher.code || teacher.id} · ${teacher.desig}`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn variant="secondary" icon="edit" onClick={() => { app.go('school.teachers.edit', { focus: teacher.id }); onClose() }}>Edit</Btn>
          <Btn variant="primary" icon="message" onClick={() => onMessage(teacher)}>Message</Btn>
        </div>
      }
    >
      <div className="col gap16">
        <div className="row ai-center gap12">
          <Avatar name={teacher.name} hue={teacher.avatarHue} size={56} src={photoUrl} />
          <div>
            <div className="row ai-center gap8">
              <span className="fw7 t-lg">{teacher.name}</span>
              {teacher.top && <Badge tone="warning" icon="sparkle">Top performer</Badge>}
            </div>
            <div className="t-sm muted">{teacher.dept} · {teacher.gender === 'M' ? 'Male' : 'Female'}</div>
          </div>
        </div>

        <Card>
          <div className="col gap12">
            <StatRow label="Designation" value={teacher.desig} />
            <div className="sm-profile-field">
              <span className="muted t-sm">Subjects</span>
              <SubjectChips subjects={teacher.subjects} />
            </div>
            <StatRow
              label="Class teacher"
              value={teacher.classTeacher
                ? <Badge tone="brand" soft>{teacher.classTeacher}</Badge>
                : <span className="muted">—</span>}
            />
            <StatRow label="Experience" value={`${teacher.exp} yrs`} />
            <StatRow label="Email" value={teacher.email} />
            <StatRow label="Status" value={<Badge tone={statusTone(teacher.status)}>{statusLabel(teacher.status)}</Badge>} />
          </div>
        </Card>

        <Card>
          <div className="col gap14">
            <div className="row ai-center jc-between">
              <span className="muted t-sm">Rating</span>
              <span className="row ai-center gap6 fw7"><span style={{ color: 'var(--gold)' }}><Icon name="sparkle" size={14} /></span>{teacher.rating.toFixed(1)}</span>
            </div>
            <div>
              <div className="row ai-center jc-between" style={{ marginBottom: 4 }}><span className="muted t-sm">Result</span><span className="fw7">{teacher.result}%</span></div>
              <Progress value={teacher.result} color={attColor(teacher.result)} />
            </div>
            <div>
              <div className="row ai-center jc-between" style={{ marginBottom: 4 }}><span className="muted t-sm">Attendance</span><span className="fw7">{teacher.attendance}%</span></div>
              <Progress value={teacher.attendance} color={attColor(teacher.attendance)} />
            </div>
            <StatRow label="Teaching load" value={`${teacher.load} periods/wk`} />
          </div>
        </Card>

        <AccessCard email={teacher.email} name={teacher.name} />

        <Card>
          <CardHead title="Photo & documents" sub="Stored on this device" icon="doc" />
          <div style={{ marginTop: 8 }}>
            <PeopleDocsList kind="teacher" personId={teacher.id} toast={toast} />
          </div>
        </Card>
      </div>
    </Drawer>
  )
}

function licenseExpiryTone(expiry?: string): BadgeTone | null {
  if (!expiry) return null
  const days = (new Date(expiry).getTime() - Date.now()) / 86_400_000
  if (Number.isNaN(days)) return null
  if (days < 0) return 'danger'
  if (days <= 30) return 'warning'
  return null
}

function DriverSection({ staff }: { staff: Staff }) {
  const [transport, setTransport] = useState(staff.transport)
  const busesQ = useTransportBuses()

  useEffect(() => {
    let cancelled = false
    void fetchStaffExtras(staff.id)
      .then((ex) => { if (!cancelled && ex?.transport) setTransport(ex.transport) })
      .catch(() => { /* keep whatever roster already had */ })
    return () => { cancelled = true }
  }, [staff.id])

  const buses = busesQ.data ?? []
  const drivingBus = buses.find((b) => b.driverStaffId === staff.id)
  const conductingBus = buses.find((b) => b.conductorStaffId === staff.id)
  const expiryTone = licenseExpiryTone(transport?.licenseExpiry)

  if (!transport?.license && !drivingBus && !conductingBus) return null

  return (
    <Card>
      <CardHead title="Driver" icon="bus" />
      <div className="col gap12" style={{ marginTop: 4 }}>
        {transport?.license && <StatRow label="License number" value={transport.license} />}
        {transport?.licenseExpiry && (
          <StatRow
            label="License expiry"
            value={
              <span className="row ai-center gap6">
                {new Date(transport.licenseExpiry).toLocaleDateString('en-IN')}
                {expiryTone && <Badge tone={expiryTone} soft>{expiryTone === 'danger' ? 'Expired' : 'Expiring soon'}</Badge>}
              </span>
            }
          />
        )}
        <StatRow label="Assigned bus" value={drivingBus ? drivingBus.busNo : '—'} />
        <StatRow label="Assigned route" value={drivingBus?.routeName ?? '—'} />
        <StatRow label="Conductor on" value={conductingBus ? conductingBus.busNo : '—'} />
      </div>
    </Card>
  )
}

function StaffProfile({ staff, onClose, onMessage }: { staff: Staff | null; onClose: () => void; onMessage: (s: Staff) => void }) {
  const app = useApp()
  const toast = useToast()
  if (!staff) return null
  const photoUrl = resolvePeoplePhoto('staff', staff.id, staff.photoUrl)
  return (
    <Drawer
      open={!!staff} onClose={onClose} icon="briefcase"
      title={staff.name} sub={`${staff.code || staff.id} · ${staff.role}`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn variant="secondary" icon="edit" onClick={() => { app.go('school.staff.edit', { focus: staff.id }); onClose() }}>Edit</Btn>
          <Btn variant="primary" icon="message" onClick={() => onMessage(staff)}>Message</Btn>
        </div>
      }
    >
      <div className="col gap16">
        <div className="row ai-center gap12">
          <Avatar name={staff.name} hue={staff.avatarHue} size={56} src={photoUrl} />
          <div>
            <div className="fw7 t-lg">{staff.name}</div>
            <div className="t-sm muted">{staff.dept} · {staff.shift}</div>
          </div>
        </div>
        <Card>
          <div className="col gap12">
            <StatRow label="Role" value={staff.role} />
            <StatRow label="Category" value={staffCategoryLabel(staff.cat, staff.dept, staff.role)} />
            <StatRow label="Phone" value={staff.phone} />
            <StatRow label="Email" value={staff.email || '—'} />
            <StatRow label="Status" value={<Badge tone={statusTone(staff.status)}>{statusLabel(staff.status)}</Badge>} />
          </div>
        </Card>
        <DriverSection staff={staff} />
        <AccessCard email={staff.email} name={staff.name} />
        <Card>
          <CardHead title="Photo & documents" sub="Stored on this device" icon="doc" />
          <div style={{ marginTop: 8 }}>
            <PeopleDocsList kind="staff" personId={staff.id} toast={toast} />
          </div>
        </Card>
      </div>
    </Drawer>
  )
}

/* ============================================================
   TeachersScreen
   ============================================================ */
function TeachersScreen() {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [status, setStatus] = useState('all')
  const [profile, setProfile] = useState<Teacher | null>(null)

  const editable = can(app.role, 'sis', 'E')
  const teachersQ = useTeachers()
  const teachers = teachersQ.data ?? []
  const leadershipByEmail = useLeadershipRoleByEmail()
  const accountByEmail = useAccountByEmail()
  const canManageAccess = CAN_MANAGE_ACCESS.includes(app.role)

  const message = (t: Teacher) => {
    const email = (t.email || '').trim()
    if (!email) {
      toast.danger('No email on file', `Add an email for ${t.name} before messaging.`)
      return
    }
    try {
      openMailCompose({
        to: email,
        subject: `Message from ${app.school.name}`,
        body: `Dear ${t.name},\n\n`,
      })
      toast.success('Opening mail', `Compose email to ${t.name}.`)
    } catch (err) {
      toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
    }
  }

  const topPerformers = useMemo(
    () => teachers.slice().sort((a, b) => b.rating - a.rating).slice(0, 4),
    [teachers],
  )

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return teachers.filter((t) => {
      if (needle && !(
        t.name.toLowerCase().includes(needle)
        || t.dept.toLowerCase().includes(needle)
        || t.id.toLowerCase().includes(needle)
        || (t.code ?? '').toLowerCase().includes(needle)
      )) return false
      if (dept !== 'all' && t.dept !== dept) return false
      if (status !== 'all' && t.status !== status) return false
      return true
    })
  }, [teachers, q, dept, status])

  const columns: Column<Teacher>[] = [
    {
      key: 'name', label: 'Teacher', sortValue: (t) => t.name,
      render: (t) => {
        const leaderRole = leadershipByEmail.get(t.email.trim().toLowerCase())
        return (
          <div className="row ai-center gap10">
            <Avatar name={t.name} hue={t.avatarHue} size={34} src={resolvePeoplePhoto('teacher', t.id, t.photoUrl)} />
            <div>
              <div className="row ai-center gap6">
                <span className="fw6">{t.name}</span>
                {t.top && <span style={{ color: 'var(--gold)' }}><Icon name="sparkle" size={13} /></span>}
                {leaderRole && <Badge tone="brand" soft>{leaderRole}</Badge>}
              </div>
              <div className="t-xs muted">{t.code || t.id}</div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'dept', label: 'Department', sortValue: (t) => t.dept,
      render: (t) => (
        <div>
          <div className="fw6">{t.dept}</div>
          <div className="t-xs muted">{t.desig}</div>
        </div>
      ),
    },
    {
      key: 'subjects', label: 'Subjects',
      render: (t) => (
        <div className="sm-col-subjects">
          <SubjectChips subjects={t.subjects} max={3} />
        </div>
      ),
    },
    {
      key: 'classTeacher', label: 'Class teacher', align: 'center', sortValue: (t) => t.classTeacher ?? '',
      render: (t) => t.classTeacher ? <Badge tone="brand">{t.classTeacher}</Badge> : <span className="muted">—</span>,
    },
    {
      key: 'exp', label: 'Experience', align: 'right', sortValue: (t) => t.exp,
      render: (t) => <span>{t.exp} yrs</span>,
    },
    {
      key: 'rating', label: 'Rating', align: 'right', sortValue: (t) => t.rating,
      render: (t) => (
          <span className="row ai-center gap4 fw6" style={{ justifyContent: 'flex-end' }}>
          <span style={{ color: 'var(--gold)' }}><Icon name="sparkle" size={13} /></span>{(t.rating ?? 0).toFixed(1)}
        </span>
      ),
    },
    {
      key: 'result', label: 'Result', align: 'right', sortValue: (t) => t.result,
      render: (t) => <span className="fw6">{t.result}%</span>,
    },
    {
      key: 'load', label: 'Load', align: 'right', sortValue: (t) => t.load,
      render: (t) => <span>{t.load}/wk</span>,
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (t) => t.status,
      render: (t) => <Badge tone={statusTone(t.status)}>{statusLabel(t.status)}</Badge>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (t) => (
        <div className="row ai-center gap6 jc-end">
          <SuspendAction account={accountByEmail.get(t.email.trim().toLowerCase())} name={t.name} canManage={canManageAccess} />
          <Btn variant="secondary" size="sm" icon="message" onClick={(e) => { e.stopPropagation(); message(t) }}>Message</Btn>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHead
        title="Teachers"
        sub={`${teachers.length} teaching staff · ${app.school.name}`}
        actions={editable
          ? <Btn variant="primary" icon="plus" onClick={() => app.go('school.teachers.add')}>Add teacher</Btn>
          : <Badge tone="neutral" icon="eye">View only</Badge>}
      />

      {/* Top performers */}
      {teachersQ.isError && (
        <div className="t-sm" style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          Could not load teachers. <button type="button" className="sm-gate-link" onClick={() => teachersQ.refetch()}>Retry</button>
        </div>
      )}
      <div className="sm-card-sub" style={{ marginBottom: 10, fontWeight: 600 }}>Top performers</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
        {teachersQ.isLoading ? (
          <div className="t-sm muted" style={{ padding: 16 }}><Spinner /> Loading teachers…</div>
        ) : topPerformers.length === 0 ? (
          <div className="t-sm muted" style={{ padding: 16 }}>No teachers yet — add one from Add teacher.</div>
        ) : topPerformers.map((t) => (
          <Card key={t.id} hover>
            <div className="row ai-center gap12">
              <Avatar name={t.name} hue={t.avatarHue} size={44} src={resolvePeoplePhoto('teacher', t.id, t.photoUrl)} />
              <div style={{ minWidth: 0 }}>
                <div className="fw7" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                <div className="t-xs muted">{t.dept}</div>
              </div>
            </div>
            <div className="row ai-center jc-between" style={{ marginTop: 12 }}>
              <span className="row ai-center gap4 fw7"><span style={{ color: 'var(--gold)' }}><Icon name="sparkle" size={14} /></span>{(t.rating ?? 0).toFixed(1)}</span>
              <Badge tone="success">{t.result}% result</Badge>
            </div>
          </Card>
        ))}
      </div>

      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search name, department, employee ID…" style={{ flex: 1, minWidth: 220 }} />
          <Select options={['all', ...depts]} value={dept} onChange={(e) => setDept(e.target.value)} />
          <Select options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} value={status} onChange={(e) => setStatus(e.target.value)} />
        </div>

        {teachersQ.isLoading ? (
          <div className="row ai-center gap10" style={{ padding: 24 }}><Spinner /><span className="t-sm muted">Loading teachers…</span></div>
        ) : (
        <DataTable<Teacher>
          columns={columns}
          rows={rows}
          pageSize={10}
          rowKey={(t) => t.id}
          initialSort={{ key: 'rating', dir: 'desc' }}
          onRowClick={(t) => setProfile(t)}
          empty={<Empty icon="cap" title="No teachers match" body="Try adjusting the search or filters." />}
        />
        )}
      </Card>

      <TeacherProfile teacher={profile} onClose={() => setProfile(null)} onMessage={(t) => { message(t); setProfile(null) }} />
    </div>
  )
}

/* ============================================================
   StaffScreen — non-teaching staff & support
   ============================================================ */
const CATS: { value: string; label: string; icon: string; tone: BadgeTone }[] = [
  { value: 'transport', label: 'Transport', icon: 'bus', tone: 'info' },
  { value: 'security', label: 'Security', icon: 'shield', tone: 'warning' },
  { value: 'academic', label: 'Academic', icon: 'cap', tone: 'brand' },
  { value: 'admin', label: 'Admin', icon: 'briefcase', tone: 'neutral' },
  { value: 'support', label: 'Support', icon: 'users', tone: 'success' },
]

function StaffRoster() {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [profile, setProfile] = useState<Staff | null>(null)

  const editable = can(app.role, 'sis', 'E')
  const staffQ = useStaff()
  const roster = staffQ.data ?? []
  const leadershipByEmail = useLeadershipRoleByEmail()
  const accountByEmail = useAccountByEmail()
  const canManageAccess = CAN_MANAGE_ACCESS.includes(app.role)

  const message = (s: Staff) => {
    const email = (s.email || '').trim()
    if (!email) {
      toast.danger('No email on file', `Add an email for ${s.name} before messaging.`)
      return
    }
    try {
      openMailCompose({
        to: email,
        subject: `Message from ${app.school.name}`,
        body: `Dear ${s.name},\n\n`,
      })
      toast.success('Opening mail', `Compose email to ${s.name}.`)
    } catch (err) {
      toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
    }
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    roster.forEach((s) => {
      const key = normalizeStaffCategory(s.cat, s.dept, s.role)
      if (key) m[key] = (m[key] || 0) + 1
    })
    return m
  }, [roster])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return roster.filter((s) => {
      if (needle && !(
        s.name.toLowerCase().includes(needle)
        || s.role.toLowerCase().includes(needle)
        || s.id.toLowerCase().includes(needle)
        || (s.code ?? '').toLowerCase().includes(needle)
      )) return false
      if (cat !== 'all' && normalizeStaffCategory(s.cat, s.dept, s.role) !== cat) return false
      return true
    })
  }, [q, cat, roster])

  const columns: Column<Staff>[] = [
    {
      key: 'name', label: 'Staff', sortValue: (s) => s.name,
      render: (s) => {
        const leaderRole = leadershipByEmail.get((s.email ?? '').trim().toLowerCase())
        return (
          <div className="row ai-center gap10">
            <Avatar name={s.name} hue={s.avatarHue} size={34} src={resolvePeoplePhoto('staff', s.id, s.photoUrl)} />
            <div>
              <div className="row ai-center gap6">
                <span className="fw6">{s.name}</span>
                {leaderRole && <Badge tone="brand" soft>{leaderRole}</Badge>}
              </div>
              <div className="t-xs muted">{s.code || s.id} · {s.gender === 'M' ? 'Male' : 'Female'}</div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'role', label: 'Role', sortValue: (s) => s.role,
      render: (s) => (
        <div>
          <div className="fw6">{s.role}</div>
          <div className="t-xs muted">{staffCategoryLabel(s.cat, s.dept, s.role)} · {s.dept}</div>
        </div>
      ),
    },
    {
      key: 'shift', label: 'Shift', align: 'center', sortValue: (s) => s.shift,
      render: (s) => <Badge tone="neutral">{s.shift}</Badge>,
    },
    {
      key: 'route', label: 'Route', align: 'center', sortValue: (s) => s.route ?? '',
      render: (s) => s.route ? <Badge tone="info">{s.route}</Badge> : <span className="muted">—</span>,
    },
    {
      key: 'attendance', label: 'Attendance', sortValue: (s) => s.attendance,
      render: (s) => (
        <div className="row ai-center gap8" style={{ minWidth: 120 }}>
          <div style={{ flex: 1 }}><Progress value={s.attendance} color={attColor(s.attendance)} /></div>
          <span className="t-sm fw6" style={{ width: 34 }}>{s.attendance}%</span>
        </div>
      ),
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (s) => s.status,
      render: (s) => <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (s) => (
        <div className="row ai-center gap6 jc-end">
          <SuspendAction account={accountByEmail.get((s.email ?? '').trim().toLowerCase())} name={s.name} canManage={canManageAccess} />
          <Btn variant="secondary" size="sm" icon="message" onClick={(e) => { e.stopPropagation(); message(s) }}>Message</Btn>
        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHead
        title="Staff & Support"
        sub={`${roster.length} non-teaching staff · ${app.school.name}`}
        actions={editable
          ? <Btn variant="primary" icon="plus" onClick={() => app.go('school.staff.add')}>Add staff</Btn>
          : <Badge tone="neutral" icon="eye">View only</Badge>}
      />

      {staffQ.isError && (
        <div className="t-sm" style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
          Could not load staff. Staff & support requires Platinum. <button type="button" className="sm-gate-link" onClick={() => staffQ.refetch()}>Retry</button>
        </div>
      )}

      {/* Category summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 16 }}>
        {CATS.map((c) => (
          <Card key={c.value} hover onClick={() => setCat((prev) => (prev === c.value ? 'all' : c.value))} style={cat === c.value ? { borderColor: 'var(--brand-600)' } : undefined}>
            <div className="row ai-center gap10">
              <span className="sm-kpi-ic"><Icon name={c.icon} size={18} /></span>
              <div>
                <div className="fw7 t-lg">{counts[c.value] || 0}</div>
                <div className="t-xs muted">{c.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search name, role, staff ID…" style={{ flex: 1, minWidth: 220 }} />
          <Select options={[{ value: 'all', label: 'All categories' }, ...CATS.map((c) => ({ value: c.value, label: c.label }))]} value={cat} onChange={(e) => setCat(e.target.value)} />
        </div>

        {staffQ.isLoading ? (
          <div className="row ai-center gap10" style={{ padding: 24 }}><Spinner /><span className="t-sm muted">Loading staff…</span></div>
        ) : (
        <DataTable<Staff>
          columns={columns}
          rows={rows}
          pageSize={10}
          rowKey={(s) => s.id}
          initialSort={{ key: 'name', dir: 'asc' }}
          onRowClick={(s) => setProfile(s)}
          empty={<Empty icon="users" title="No staff match" body="Try adjusting the search or category." />}
        />
        )}
      </Card>

      <StaffProfile staff={profile} onClose={() => setProfile(null)} onMessage={(s) => { message(s); setProfile(null) }} />
    </div>
  )
}

function StaffScreen() {
  return (
    <TierGate feature="staff_support" title="Staff & Support"
      blurb="Manage non-teaching staff on the Platinum plan.">
      <StaffRoster />
    </TierGate>
  )
}

/* ============================================================
   ParentsScreen — derived from students (grouped by guardian)
   ============================================================ */
interface Ward { id: string; name: string; cls: string }
interface Parent {
  id: string
  name: string
  phone: string
  email: string
  hue: number
  wards: Ward[]
  due: number
}

function ParentsScreen() {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const studentsQ = useStudents()
  const students = studentsQ.data ?? []

  const openWard = (id: string) => app.go('school.student', { focus: id })
  const message = (p: Parent) => {
    const email = (p.email || '').trim()
    if (!email) {
      toast.danger('No email on file', `Add a guardian email for ${p.name}'s ward(s) before messaging.`)
      return
    }
    try {
      openMailCompose({
        to: email,
        subject: `Message from ${app.school.name}`,
        body: `Dear ${p.name},\n\n`,
      })
      toast.success('Opening mail', `Compose email to ${p.name}.`)
    } catch (err) {
      toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
    }
  }

  const parents = useMemo<Parent[]>(() => {
    const map = new Map<string, Parent>()
    students.forEach((s) => {
      const name = studentParentLabel(s)
      const phone = (s.phone || s.father?.phone || s.mother?.phone || '').trim()
      const email = parentMailFromStudent(s)
      const key = `${name.toLowerCase()}|${phone}`
      const ward: Ward = { id: s.id, name: s.name, cls: s.cls }
      const existing = map.get(key)
      if (existing) {
        existing.wards.push(ward)
        existing.due += s.feeDue
        if (!existing.email && email) existing.email = email
      } else {
        map.set(key, {
          id: 'PAR-' + s.id,
          name,
          phone,
          email,
          hue: s.avatarHue,
          wards: [ward],
          due: s.feeDue,
        })
      }
    })
    return Array.from(map.values())
  }, [students])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return parents
    return parents.filter((p) =>
      p.name.toLowerCase().includes(needle)
      || p.phone.includes(needle)
      || p.email.toLowerCase().includes(needle)
      || p.wards.some((w) => w.name.toLowerCase().includes(needle)),
    )
  }, [q, parents])

  const columns: Column<Parent>[] = [
    {
      key: 'name', label: 'Parent / guardian', sortValue: (p) => p.name,
      render: (p) => (
        <div className="row ai-center gap10">
          <Avatar name={p.name} hue={p.hue} size={34} />
          <div>
            <div className="fw6">{p.name}</div>
            <div className="t-xs muted">{p.wards.length} ward{p.wards.length > 1 ? 's' : ''}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'wards', label: 'Wards', sortValue: (p) => p.wards.length,
      render: (p) => (
        <div className="col gap4">
          {p.wards.map((w) => (
            <button
              key={w.id}
              type="button"
              className="row ai-center gap6 t-sm"
              style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
              onClick={(e) => { e.stopPropagation(); openWard(w.id) }}
              title="Open student profile"
            >
              <span className="fw6" style={{ color: 'var(--brand-600)', textDecoration: 'underline' }}>{w.name}</span>
              <Badge tone="neutral">{w.cls}</Badge>
            </button>
          ))}
        </div>
      ),
    },
    {
      key: 'phone', label: 'Phone', sortValue: (p) => p.phone,
      render: (p) => <span className="t-sm muted">{p.phone || '—'}</span>,
    },
    {
      key: 'email', label: 'Email', sortValue: (p) => p.email,
      render: (p) => <span className="t-sm muted">{p.email || '—'}</span>,
    },
    {
      key: 'due', label: 'Outstanding dues', align: 'right', sortValue: (p) => p.due,
      render: (p) => <Badge tone={p.due > 0 ? 'danger' : 'success'}>{p.due > 0 ? fmtMoney(p.due) : 'Cleared'}</Badge>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (p) => (
        <div className="row ai-center gap8 jc-end">
          <Btn variant="ghost" size="sm" icon="user" onClick={(e) => { e.stopPropagation(); openWard(p.wards[0].id) }}>Profile</Btn>
          <Btn variant="secondary" size="sm" icon="message" onClick={(e) => { e.stopPropagation(); message(p) }}>Message</Btn>
        </div>
      ),
    },
  ]

  if (studentsQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 240 }}><Spinner size={28} /><div className="t-sm muted">Loading parents…</div></div>
  }
  if (studentsQ.isError) {
    return <Empty icon="alert" title="Could not load parents" body="Parents are derived from live students. Check your connection and try again." />
  }

  return (
    <div>
      <PageHead title="Parents" sub={`${parents.length} guardians · ${app.school.name}`} />

      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search guardian, email, phone, or student…" style={{ flex: 1, minWidth: 220 }} />
        </div>

        <DataTable<Parent>
          columns={columns}
          rows={rows}
          pageSize={10}
          rowKey={(p) => p.id}
          initialSort={{ key: 'name', dir: 'asc' }}
          onRowClick={(p) => openWard(p.wards[0].id)}
          empty={<Empty icon="users" title="No parents yet" body="Add students to see parents here." />}
        />
      </Card>
    </div>
  )
}

/* ---------- export contract ---------- */
export const peopleScreens: Record<string, ComponentType> = {
  'school.teachers': TeachersScreen,
  'school.staff': StaffScreen,
  'school.parents': ParentsScreen,
}
