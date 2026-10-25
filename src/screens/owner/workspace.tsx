/* ============================================================
   SchoolMate — Owner console workspace
   Users & roles (RBAC) + Owner settings.

   SaaS: school scope is ONLY the owner's mapped tenants from
   /me/schools (or all clients for platform). Never demo schools
   from other clients.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApp, useToast } from '@/lib/hooks'
import {
  PageHead, Tabs, Card, CardHead, Btn, Badge, Avatar, Search, Select, Field, Input, Textarea,
  Modal, Toggle, Icon, Empty, DataTable, Spinner,
  type Column, type BadgeTone,
} from '@/components/ui'
import { SchoolPhoto } from '@/components/SchoolMark'
import { EditSchoolProfileModal } from '@/components/EditSchoolProfileModal'
import { ROLE_META, PERMS } from '@/data/mockDb'
import type { Role, GateRole, Cap, School } from '@/types'
import { usePortfolioSchools, useSwitchSchool } from '@/api/hooks/useOwner'
import { clientToSchool } from '@/api/ownerMap'
import {
  inviteUser, assignableSchoolRoles,
  listSchoolUsers, setUserRoles, getUserPermissions, setUserPermissions, removeUserAccess, setUserActive,
  overridesFromApi, fromApiRole, type SchoolUserDto,
} from '@/api/users'
import { useRoleTemplate, useSetRoleTemplate } from '@/api/hooks/useRoleTemplates'
import type { RoleTemplateOverride } from '@/api/roleTemplates'
import { listInvitations, type Invitation } from '@/api/invitations'
import { useResendInvitation, useRevokeInvitation } from '@/api/hooks/useInvitationMutations'
import { caps, effectiveCaps, cellState, overrideCount, NEXT_CELL_STATE } from '@/lib/gating'
import type { UserOverrides, CellState } from '@/types'
import { switchSchool } from '@/api/mySchools'
import { ApiError } from '@/api/client'
import { useAuditLog } from '@/api/hooks/useAudit'
import type { AuditEntry } from '@/api/audit'
import { tokenStore } from '@/api/auth/tokenStore'

/* ---------- shared helpers ---------- */
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
  r === 'principal' ? 'success' : r === 'vice_principal' ? 'brand' : r === 'admin' ? 'info' : 'neutral'

/* ---------- scope (owner's mapped schools only) ---------- */
export const ALL_SCHOOLS = 'All my schools'

/** Sentinel schoolId for the "All schools" option in the Users & roles school picker. */
export const ALL_SCHOOLS_ID = '__all_schools__'

/** True when the scope grants every school in this owner's portfolio. */
export function isAllSchools(scope: string[]): boolean {
  return scope.includes(ALL_SCHOOLS)
}

/** Compact label for the table: "All my schools" | "<name>" | "N schools". */
export function scopeLabel(scope: string[]): string {
  if (isAllSchools(scope)) return ALL_SCHOOLS
  if (scope.length === 0) return 'No school'
  if (scope.length === 1) return scope[0]
  return `${scope.length} schools`
}

/** Toggle a school in the working scope, enforcing All-vs-specific + non-empty. */
export function toggleScope(scope: string[], school: string): string[] {
  if (school === ALL_SCHOOLS) return [ALL_SCHOOLS]
  const specifics = scope.filter((s) => s !== ALL_SCHOOLS)
  const next = specifics.includes(school)
    ? specifics.filter((s) => s !== school)
    : [...specifics, school]
  return next.length === 0 ? [ALL_SCHOOLS] : next
}

/** Scope stores school ids (or ALL_SCHOOLS). Resolve to tenant ids for invites. */
function resolveScopeIds(scope: string[], schools: School[]): string[] {
  if (isAllSchools(scope) || scope.length === 0) return schools.map((s) => s.id)
  const ids = new Set(schools.map((s) => s.id))
  return scope.filter((s) => ids.has(s))
}

export function scopeLabelForSchools(scope: string[], schools: School[]): string {
  if (isAllSchools(scope)) return ALL_SCHOOLS
  const names = schools.filter((s) => scope.includes(s.id)).map((s) => s.name)
  if (names.length === 0) return scopeLabel(scope)
  if (names.length === 1) return names[0]
  return `${names.length} schools`
}

/* ============================================================
   Team
   ============================================================ */
/* Multi-school scope: only schools returned for this login (mapped tenants). */
function ScopePicker({
  scope, onChange, schools,
}: {
  scope: string[]
  onChange: (next: string[]) => void
  schools: School[]
}) {
  const all = isAllSchools(scope)
  if (schools.length === 0) {
    return (
      <Field label="Scope" hint="Create a school first — access is limited to your mapped schools.">
        <div className="t-sm muted">No schools mapped to this login.</div>
      </Field>
    )
  }
  return (
    <Field label="Scope (school id)" required hint="Pick by school id — only your mapped tenants.">
      <div className="col gap8" style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
        <label className="row ai-center gap8" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={all} onChange={() => onChange(toggleScope(scope, ALL_SCHOOLS))} />
          <span className="fw6">{ALL_SCHOOLS}</span>
          <span className="t-xs muted">({schools.length})</span>
        </label>
        {schools.map((s) => (
          <label key={s.id} className="row ai-center gap8" style={{ cursor: 'pointer', opacity: all ? 0.6 : 1 }}>
            <input
              type="checkbox"
              checked={!all && scope.includes(s.id)}
              onChange={() => onChange(toggleScope(scope, s.id))}
            />
            <span>
              {s.name}
              <span className="t-xs muted" style={{ marginLeft: 6 }} title={s.id}>{s.id.slice(0, 8)}…</span>
            </span>
          </label>
        ))}
      </div>
    </Field>
  )
}

function InviteModal({
  open, onClose, schools, onInvited, actorRole, schoolId,
}: {
  open: boolean
  onClose: () => void
  schools: School[]
  onInvited: () => void
  actorRole: Role
  /** Currently-selected school in the Owner Console — restored as the ambient tenant after inviting. */
  schoolId: string
}) {
  const toast = useToast()
  const roleOptions = assignableSchoolRoles(actorRole)
  const defaultRole: Role = roleOptions.includes('admin') ? 'admin' : roleOptions[0] ?? 'teacher'
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [role, setRole] = useState<Role>(defaultRole)
  const [scope, setScope] = useState<string[]>([ALL_SCHOOLS])
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setEmail('')
    setMessage('')
    setRole(defaultRole)
    setScope([ALL_SCHOOLS])
    setBusy(false)
  }

  const submit = async () => {
    if (!email.trim() || !email.includes('@')) {
      toast.danger('Valid email required', 'Enter the teammate’s work email address.')
      return
    }
    const tenantIds = resolveScopeIds(scope, schools)
    if (tenantIds.length === 0) {
      toast.danger('No school selected', 'Pick at least one of your schools.')
      return
    }
    const schoolNames = tenantIds
      .map((id) => schools.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n)

    setBusy(true)
    try {
      for (let i = 0; i < tenantIds.length; i++) {
        await switchSchool(tenantIds[i])
        await inviteUser(email.trim(), role, {
          channel: 'email',
          method: 'link',
          // Only the LAST call in the batch actually sends — one welcome message
          // for the whole person, listing every school, not one email per school.
          sendWelcome: i === tenantIds.length - 1,
          schoolNames,
          message: message.trim() || undefined,
        })
      }
      // Restore the ambient tenant to the school currently selected in the picker —
      // otherwise it's left pointed at the last-invited school, desyncing every
      // subsequent ambient-tenant fetch (Team/Roles/Audit) from the visible schoolId.
      const lastInvited = tenantIds[tenantIds.length - 1]
      if (schoolId && schoolId !== lastInvited) {
        await switchSchool(schoolId)
      }
      const where = scopeLabelForSchools(scope, schools)
      onInvited()
      toast.success(
        'Invite sent',
        `${ROLE_META[role].label} · ${where}. ${email} got a one-click login link by email (one message, covers ${schoolNames.length > 1 ? `all ${schoolNames.length} schools` : where}). They open the link → create their password → then they can sign in.`,
      )
      reset()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'conflict') {
        toast.danger('This email already has access', 'They\'re already a member of that school — use Resend from the Invitations tab instead of inviting again.')
      } else {
        toast.danger('Send invite failed', e instanceof ApiError ? e.message : 'Could not invite for that school.')
      }
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} icon="user"
      title="Send invite"
      sub="CRM login access only: Admin · Principal · Vice-Principal. Teachers & staff use the Onboard form (name, address, documents)."
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon="check" onClick={() => { void submit() }} disabled={busy || schools.length === 0 || roleOptions.length === 0}>
            {busy ? 'Sending…' : 'Send invite'}
          </Btn>
        </div>
      }
    >
      <div className="col gap16">
        <Field label="Work email" required hint="Sends one onboard/welcome email with a one-click login link — covers every school picked below.">
          <Input icon="message" type="email" value={email} placeholder="admin@school.edu" onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Personal note" hint="Optional — shown in the welcome email above the login link.">
          <Textarea rows={3} value={message} placeholder="e.g. Welcome aboard! Reach out if you need anything setting up." onChange={(e) => setMessage(e.target.value)} />
        </Field>
        <Field
          label="CRM role"
          required
          hint={ROLE_META[role]?.desc ?? 'Choose a CRM access role.'}
        >
          <Select
            options={roleOptions.map((r) => ({
              value: r,
              label: `${ROLE_META[r].label} — CRM access`,
            }))}
            value={role} onChange={(e) => setRole(e.target.value as Role)}
          />
        </Field>
        <ScopePicker scope={scope} onChange={setScope} schools={schools} />
      </div>
    </Modal>
  )
}

/** Open People onboard form (teacher/staff) — name, address, documents — not CRM Send invite. */
function OnboardPeopleModal({
  open, onClose, schools, kind,
}: {
  open: boolean
  onClose: () => void
  schools: School[]
  kind: 'teacher' | 'staff'
}) {
  const app = useApp()
  const toast = useToast()
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && schools[0]) setSchoolId(schools[0].id)
  }, [open, schools])

  const submit = async () => {
    const school = schools.find((s) => s.id === schoolId)
    if (!school) {
      toast.danger('Pick a school', 'Choose which school to onboard into.')
      return
    }
    setBusy(true)
    try {
      const ok = await app.enterSchool(school.id, school)
      if (!ok) {
        toast.danger('School not active', 'Catre must activate the school before onboarding teachers or staff.')
        return
      }
      onClose()
      app.go(kind === 'teacher' ? 'school.teachers.add' : 'school.staff.add')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open} onClose={onClose} icon="user"
      title={kind === 'teacher' ? 'Onboard Teacher' : 'Onboard Staff'}
      sub="Opens the full form (name, address, documents). CRM roles use Send invite."
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon="arrowRight" onClick={() => { void submit() }} disabled={busy || !schoolId}>
            {busy ? 'Opening…' : 'Open onboard form'}
          </Btn>
        </div>
      }
    >
      <Field label="School" required hint="Teacher/staff records belong to one school id.">
        <Select
          options={schools.map((s) => ({ value: s.id, label: `${s.name} · ${s.id.slice(0, 8)}…` }))}
          value={schoolId}
          onChange={(e) => setSchoolId(e.target.value)}
        />
      </Field>
    </Modal>
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
      }}
    >
      {cap}
    </button>
  )
}

interface TeamSchoolMembership { school: string; role: Role; status: string }
interface TeamRow { id: string; name: string; email: string; role: Role; status: string; last: string; school?: string; schools?: TeamSchoolMembership[] }

function mapTeamRow(u: SchoolUserDto, school?: string): TeamRow {
  const email = u.email ?? '—'
  return {
    id: u.id,
    name: email.includes('@') ? email.split('@')[0] : email,
    email,
    role: fromApiRole(u.roles[0] ?? 'teacher'),
    status: u.status,
    last: u.created_at,
    school,
  }
}

/** "All schools" mode: fold one row per (person, school) into one row per person,
 *  listing every school they belong to — so the same person doesn't read as N
 *  visually-identical duplicate rows. */
function groupByPerson(rows: TeamRow[]): TeamRow[] {
  const byEmail = new Map<string, TeamRow>()
  for (const r of rows) {
    const membership: TeamSchoolMembership = { school: r.school ?? '—', role: r.role, status: r.status }
    const existing = byEmail.get(r.email)
    if (existing) existing.schools!.push(membership)
    else byEmail.set(r.email, { ...r, schools: [membership] })
  }
  return [...byEmail.values()]
}

function UserAccessEditor({ user, initial, onSave, onCancel }: {
  user: TeamRow
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
          <Avatar name={user.name} size={40} />
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

function TeamTab({ schoolId, schools }: { schoolId: string; schools: School[] }) {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [roleF, setRoleF] = useState('all')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [onboardKind, setOnboardKind] = useState<'teacher' | 'staff' | null>(null)
  const [rows, setRows] = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, UserOverrides>>({})
  const [editing, setEditing] = useState<TeamRow | null>(null)
  const [removing, setRemoving] = useState<TeamRow | null>(null)
  const [removeStep, setRemoveStep] = useState<1 | 2>(1)
  const [removeConfirmText, setRemoveConfirmText] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)

  const closeRemove = () => {
    if (removeBusy) return
    setRemoving(null)
    setRemoveStep(1)
    setRemoveConfirmText('')
  }
  const [roleChange, setRoleChange] = useState<{ user: TeamRow; role: Role } | null>(null)
  const [roleChangeBusy, setRoleChangeBusy] = useState(false)

  const isAll = schoolId === ALL_SCHOOLS_ID

  const reload = async () => {
    if (!schoolId) return
    setLoading(true); setError(false)
    try {
      if (isAll) {
        const restoreTenant = tokenStore.getTenantId()
        const collected: TeamRow[] = []
        for (const s of schools) {
          await switchSchool(s.id)
          collected.push(...(await listSchoolUsers()).map((u) => mapTeamRow(u, s.name)))
        }
        if (restoreTenant) await switchSchool(restoreTenant)
        setRows(groupByPerson(collected))
      } else {
        setRows((await listSchoolUsers()).map((u) => mapTeamRow(u)))
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [schoolId])

  if (!schoolId) return <SelectSchoolPrompt />

  const filtered = rows.filter((u) => {
    const needle = q.trim().toLowerCase()
    if (needle && !(u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))) return false
    if (roleF !== 'all') {
      const hasRole = isAll ? (u.schools ?? []).some((s) => s.role === roleF) : u.role === roleF
      if (!hasRole) return false
    }
    return true
  })

  const openEditor = async (u: TeamRow) => {
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
      setRows((list) => list.filter((x) => x.id !== removing.id))
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
      setRows((list) => list.map((x) => (x.id === user.id ? { ...x, role } : x)))
      toast.success('Role updated', `${ROLE_META[role].label} · ${user.name}`)
      setRoleChange(null)
    } catch (e) {
      toast.danger('Role update failed', e instanceof ApiError ? e.message : 'Try again.')
    } finally {
      setRoleChangeBusy(false)
    }
  }

  if (editing) {
    return (
      <UserAccessEditor
        user={editing}
        initial={overrides[editing.id] ?? {}}
        onCancel={() => setEditing(null)}
        onSave={(ov) => {
          void setUserPermissions(editing.id, ov).then(
            () => { setOverrides((m) => ({ ...m, [editing.id]: ov })); toast.success('Access saved', `Updated overrides for ${editing.name}.`); setEditing(null) },
            (e) => toast.danger('Could not save', e instanceof ApiError ? e.message : 'Try again.'),
          )
        }}
      />
    )
  }

  const columns: Column<TeamRow>[] = [
    {
      key: 'name', label: 'User', sortValue: (u) => u.name,
      render: (u) => (
        <div className="row ai-center gap10">
          <Avatar name={u.name} size={34} />
          <div>
            <div className="fw6">{u.name}</div>
            <div className="t-xs muted">{u.email}</div>
          </div>
        </div>
      ),
    },
    ...(isAll
      ? [{
          key: 'schools', label: 'Schools',
          sortValue: (u: TeamRow) => u.schools?.length ?? 0,
          render: (u: TeamRow) => (
            <div className="row gap6 wrap" style={{ maxWidth: 420 }}>
              {(u.schools ?? []).map((m, i) => (
                <span
                  key={i}
                  className="row ai-center gap6"
                  title={`${m.school} — ${ROLE_META[m.role].label} · ${m.status}`}
                  style={{
                    padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                    background: 'var(--surface-3)', fontSize: 11.5, lineHeight: 1.5,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6, height: 6, borderRadius: '50%', flex: '0 0 auto',
                      background: m.status === 'active' ? 'var(--success)' : 'var(--text-3)',
                    }}
                  />
                  <span className="fw6">{m.school}</span>
                  <span className="muted">{ROLE_META[m.role].label}</span>
                </span>
              ))}
            </div>
          ),
        } as Column<TeamRow>]
      : [
          { key: 'role', label: 'Role', sortValue: (u: TeamRow) => u.role, render: (u: TeamRow) => <Badge tone={roleTone(u.role)}>{ROLE_META[u.role].label}</Badge> } as Column<TeamRow>,
          {
            key: 'status', label: 'Status', align: 'center', sortValue: (u: TeamRow) => u.status,
            render: (u: TeamRow) => (
              <Badge tone={u.status === 'active' ? 'success' : u.status === 'inactive' ? 'warning' : 'neutral'}>{u.status}</Badge>
            ),
          } as Column<TeamRow>,
        ]),
    {
      key: 'actions', label: '', align: 'right',
      render: (u) => {
        if (isAll) {
          const count = u.schools?.length ?? 0
          return <Badge tone="neutral">{count} school{count === 1 ? '' : 's'}</Badge>
        }
        const crmRoles = assignableSchoolRoles(app.role)
        // An Owner's role is never editable from this dropdown — moving them to
        // Admin/Principal here would silently demote the school's owner.
        const isCrmRole = crmRoles.includes(u.role) && u.role !== 'owner'
        return (
          <div className="row gap6 jc-end">
            <Btn variant="secondary" size="sm" icon="edit" onClick={() => { void openEditor(u) }}>Permissions</Btn>
            {isCrmRole ? (
              <Select
                options={crmRoles.map((r) => ({ value: r, label: ROLE_META[r].label }))}
                value={u.role}
                onChange={(e) => {
                  const role = e.target.value as Role
                  if (role !== u.role) setRoleChange({ user: u, role })
                }}
              />
            ) : (
              <Badge tone={roleTone(u.role)}>{ROLE_META[u.role].label}</Badge>
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
                      setRows((list) => list.map((x) => (x.id === u.id ? { ...x, status: nextActive ? 'active' : 'inactive' } : x)))
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
        )
      },
    },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
        <Kard icon="users" label={isAll ? 'People' : 'Workspace users'} value={rows.length} tone="brand" />
        <Kard
          icon="checkCircle" label="Active"
          value={rows.filter((u) => (isAll ? (u.schools ?? []).some((s) => s.status === 'active') : u.status === 'active')).length}
          tone="success"
        />
      </div>

      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search name, email…" style={{ flex: 1, minWidth: 220 }} />
          <Select
            options={[{ value: 'all', label: 'All roles' }, ...assignableSchoolRoles('owner').map((r) => ({ value: r, label: ROLE_META[r].label }))]}
            value={roleF} onChange={(e) => setRoleF(e.target.value)}
          />
          <Btn variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>Send invite</Btn>
          <Btn variant="secondary" icon="cap" onClick={() => setOnboardKind('teacher')}>Onboard teacher</Btn>
          <Btn variant="secondary" icon="briefcase" onClick={() => setOnboardKind('staff')}>Onboard staff</Btn>
        </div>
        <div className="t-xs muted" style={{ padding: '0 16px 12px' }}>
          {isAll
            ? 'This list is read-only here — but Send invite / Onboard work across any of your schools (pick them inside). Roles & permissions and Audit still need one school selected above.'
            : 'Send invite = CRM users (Admin / Principal / Vice-Principal). Teachers & staff = onboard form with name, address & documents.'}
        </div>

        {loading ? (
          <div style={{ padding: 24 }}><Spinner /></div>
        ) : error ? (
          <div style={{ padding: 8 }}>
            <Empty icon="alert" title="Could not load users" body="Try again." />
            <div className="row jc-center" style={{ marginTop: 12 }}>
              <Btn variant="secondary" onClick={() => void reload()}>Retry</Btn>
            </div>
          </div>
        ) : (
          <DataTable<TeamRow>
            columns={columns}
            rows={filtered}
            pageSize={10}
            rowKey={(u) => u.id}
            initialSort={{ key: 'name', dir: 'asc' }}
            empty={<Empty icon="users" title="No users match" body="Try a different search or role filter." />}
          />
        )}
      </Card>

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        schools={schools}
        schoolId={schoolId}
        actorRole={app.role}
        onInvited={() => void reload()}
      />
      {onboardKind && (
        <OnboardPeopleModal open kind={onboardKind} schools={schools} onClose={() => setOnboardKind(null)} />
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
    </div>
  )
}

/* small KPI card local to this file (avoids spark dependency) */
function Kard({ icon, label, value, tone }: { icon: string; label: string; value: ReactNode; tone: BadgeTone }) {
  return (
    <Card>
      <div className="row ai-center gap12">
        <span className="sm-kpi-ic"><Icon name={icon} size={18} /></span>
        <div>
          <div className="fw7 t-xl">{value}</div>
          <div className="t-xs muted">{label}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}><Badge tone={tone} dot>{label.split(' ')[0]}</Badge></div>
      </div>
    </Card>
  )
}

/* ============================================================
   Roles & permissions — interactive matrix
   ============================================================ */
type Matrix = Record<string, Record<GateRole, Cap[]>>

const OWNER_CONSOLE_ROLES: GateRole[] = ['admin', 'principal', 'vice_principal', 'teacher']

function clonePerms(): Matrix {
  const out: Matrix = {}
  for (const mod of Object.keys(PERMS)) {
    out[mod] = { admin: [], principal: [], vice_principal: [], teacher: [], staff: [] }
    for (const r of OWNER_CONSOLE_ROLES) out[mod][r] = [...PERMS[mod][r]]
  }
  return out
}

function applyTenantOverrides(base: Matrix, tenantOv: RoleTemplateOverride[]): Matrix {
  const out: Matrix = {}
  for (const mod of Object.keys(base)) {
    out[mod] = { admin: [...base[mod].admin], principal: [...base[mod].principal], vice_principal: [...base[mod].vice_principal], teacher: [...base[mod].teacher], staff: [] }
  }
  for (const t of tenantOv) {
    if (t.role === 'staff') continue
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
    for (const role of OWNER_CONSOLE_ROLES) {
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

function RolesTab({ schoolId, schools, onPickSchool }: { schoolId: string; schools: School[]; onPickSchool: (id: string) => void }) {
  const toast = useToast()
  const templateQ = useRoleTemplate()
  const setTemplate = useSetRoleTemplate()
  const [matrix, setMatrix] = useState<Matrix>(clonePerms)
  const [loadedFromServer, setLoadedFromServer] = useState(false)

  useEffect(() => { setLoadedFromServer(false) }, [schoolId])
  useEffect(() => {
    // Wait for the query to settle on this schoolId before hydrating — while a
    // switch-school invalidation refetch is in flight, templateQ.data still
    // holds the PREVIOUS school's cached value, and hydrating from it here
    // would lock in the wrong tenant's permission matrix (and let it be saved).
    if (schoolId && schoolId !== ALL_SCHOOLS_ID && templateQ.data && !templateQ.isFetching && !loadedFromServer) {
      setMatrix(applyTenantOverrides(clonePerms(), templateQ.data))
      setLoadedFromServer(true)
    }
  }, [schoolId, templateQ.data, templateQ.isFetching, loadedFromServer])

  if (!schoolId || schoolId === ALL_SCHOOLS_ID) {
    return <SelectSchoolPrompt allSchools={schoolId === ALL_SCHOOLS_ID} schools={schools} onPick={onPickSchool} />
  }

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

  if (templateQ.isLoading) return <Card><Spinner /></Card>
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
              Owner sits above every school and has full access to all modules. It grants CRM
              roles their access below and <strong>cannot itself be restricted</strong>.
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
                {OWNER_CONSOLE_ROLES.map((r) => <th key={r} className="ta-center">{ROLE_META[r].label}</th>)}
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
                  {OWNER_CONSOLE_ROLES.map((r) => (
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

/* ============================================================
   Invitations
   ============================================================ */
function InvitationsTab({ schoolId, schools, onPickSchool }: { schoolId: string; schools: School[]; onPickSchool: (id: string) => void }) {
  const toast = useToast()
  const [invites, setInvites] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const resend = useResendInvitation()
  const revoke = useRevokeInvitation()

  const reload = async () => {
    if (!schoolId || schoolId === ALL_SCHOOLS_ID) return
    setLoading(true); setError(false)
    try {
      setInvites(await listInvitations())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [schoolId])

  if (!schoolId || schoolId === ALL_SCHOOLS_ID) {
    return <SelectSchoolPrompt allSchools={schoolId === ALL_SCHOOLS_ID} schools={schools} onPick={onPickSchool} />
  }

  const statusTone = (s: Invitation['status']): 'neutral' | 'success' | 'danger' =>
    s === 'accepted' ? 'success' : s === 'revoked' || s === 'expired' ? 'danger' : 'neutral'

  const pendingCount = invites.filter((i) => i.status === 'pending' || i.status === 'expired').length

  const doResend = (inv: Invitation) => {
    resend.mutate(inv.id, {
      onSuccess: () => { toast.success('Invitation resent', `A fresh link was emailed to ${inv.email ?? inv.phone}.`); void reload() },
      onError: (e) => toast.danger('Could not resend', e instanceof ApiError ? e.message : 'Try again.'),
    })
  }

  const doRevoke = (inv: Invitation) => {
    revoke.mutate(inv.id, {
      onSuccess: () => { toast.danger('Invitation revoked', `${inv.email ?? inv.phone} can no longer join.`); void reload() },
      onError: (e) => toast.danger('Could not revoke', e instanceof ApiError ? e.message : 'Try again.'),
    })
  }

  return (
    <Card pad={false}>
      <CardHead title="Invitations" sub={`${pendingCount} awaiting acceptance`} icon="inbox" />
      {loading ? (
        <div style={{ padding: 16 }} className="t-sm muted">Loading invitations…</div>
      ) : error ? (
        <div style={{ padding: 8 }}>
          <Empty icon="alert" title="Could not load invitations" body="Try again." />
          <div className="row jc-center" style={{ marginTop: 12 }}>
            <Btn variant="secondary" onClick={() => void reload()}>Retry</Btn>
          </div>
        </div>
      ) : invites.length === 0 ? (
        <div style={{ padding: 8 }}><Empty icon="inbox" title="No invitations" body="Invite teammates from the Team tab." /></div>
      ) : (
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

/* ============================================================
   Audit log
   ============================================================ */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  'user.role_changed': 'Changed role',
  'user.permissions_changed': 'Changed permissions',
  'role_template.updated': 'Updated role template',
}

function AuditTab({ schoolId, schools, onPickSchool }: { schoolId: string; schools: School[]; onPickSchool: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [rows, setRows] = useState<AuditEntry[]>([])
  const action = q.trim() || undefined
  const auditQ = useAuditLog({ action, cursor })

  useEffect(() => { setCursor(undefined); setRows([]) }, [action, schoolId])
  useEffect(() => {
    if (!schoolId || schoolId === ALL_SCHOOLS_ID || !auditQ.data) return
    setRows((prev) => (cursor ? [...prev, ...auditQ.data.data] : auditQ.data.data))
  }, [schoolId, auditQ.data, cursor])

  if (!schoolId || schoolId === ALL_SCHOOLS_ID) {
    return <SelectSchoolPrompt allSchools={schoolId === ALL_SCHOOLS_ID} schools={schools} onPick={onPickSchool} />
  }

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

/* ============================================================
   OwnerUsers — shell
   ============================================================ */
function SelectSchoolPrompt({ allSchools, schools, onPick }: {
  allSchools?: boolean
  /** Lets the empty state jump straight to a school instead of being a dead end. */
  schools?: School[]
  onPick?: (id: string) => void
} = {}) {
  return (
    <Card>
      <Empty
        icon={allSchools ? 'layers' : 'building'}
        title={allSchools ? 'This tab edits one school at a time' : 'Select a school'}
        body={
          allSchools
            ? 'Permissions, invitations and audit history belong to a single school — pick one below to open it here. Team stays available across all schools.'
            : 'Pick one of your mapped schools above to manage its team, roles, invitations and activity.'
        }
        action={
          allSchools && schools && schools.length > 0 && onPick ? (
            <div className="row gap8 wrap jc-center">
              {schools.map((s) => (
                <Btn key={s.id} variant="secondary" size="sm" icon="building" onClick={() => onPick(s.id)}>{s.name}</Btn>
              ))}
            </div>
          ) : undefined
        }
      />
    </Card>
  )
}

function OwnerUsers() {
  const toast = useToast()
  const qc = useQueryClient()
  const app = useApp()
  const { data: clients = [] } = usePortfolioSchools(app.isPlatform)
  const schools = useMemo(() => clients.map((c, i) => clientToSchool(c, i)), [clients])
  const [tab, setTab] = useState('team')
  const [schoolId, setSchoolId] = useState('')
  const [switching, setSwitching] = useState(false)
  const switchSchoolMut = useSwitchSchool()
  // With exactly one mapped school there's nothing to choose — auto-select it and skip the picker.
  const single = schools.length === 1

  const selectSchool = (id: string) => {
    if (!id || id === schoolId || id === ALL_SCHOOLS_ID) { setSchoolId(id); return }
    setSwitching(true)
    switchSchoolMut.mutate(id, {
      onSuccess: () => {
        setSchoolId(id)
        void qc.invalidateQueries({ queryKey: ['roleTemplate'] })
        void qc.invalidateQueries({ queryKey: ['audit'] })
      },
      onError: () => toast.danger('Could not switch school', 'Try again.'),
      onSettled: () => setSwitching(false),
    })
  }

  // One school → open straight into it (no dropdown). Runs once; re-selecting is a no-op.
  useEffect(() => {
    if (single && !schoolId) selectSchool(schools[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, schoolId, schools])

  return (
    <div>
      <PageHead
        title="Users & Roles"
        sub="Workspace team for your mapped schools only — other clients never appear"
      />
      <div className="row ai-center gap12 wrap" style={{ marginBottom: 16 }}>
        {single ? (
          <Field label="School" hint="Managing your only mapped school.">
            <Input icon="building" value={schools[0].name} readOnly aria-label="Selected school" />
          </Field>
        ) : (
          <Field label="School" hint="Pick a mapped school to manage its team, roles, invitations and audit log.">
            <Select
              aria-label="Select school"
              options={[
                { value: '', label: schools.length ? 'Select a school…' : 'No schools mapped' },
                ...(schools.length ? [{ value: ALL_SCHOOLS_ID, label: 'All schools' }] : []),
                ...schools.map((s) => ({ value: s.id, label: s.name })),
              ]}
              value={schoolId}
              onChange={(e) => selectSchool(e.target.value)}
              disabled={switching}
            />
          </Field>
        )}
        {switching && <Spinner size={18} />}
      </div>
      <Tabs
        value={tab} onChange={setTab}
        tabs={[
          { value: 'team', label: 'Team', icon: 'users' },
          { value: 'roles', label: 'Roles & Permissions', icon: 'lock' },
          { value: 'invites', label: 'Invitations', icon: 'inbox' },
          { value: 'audit', label: 'Audit Log', icon: 'clock' },
        ]}
      />
      <div style={{ marginTop: 16 }}>
        {tab === 'team' && <TeamTab schoolId={schoolId} schools={schools} />}
        {tab === 'roles' && <RolesTab schoolId={schoolId} schools={schools} onPickSchool={selectSchool} />}
        {tab === 'invites' && <InvitationsTab schoolId={schoolId} schools={schools} onPickSchool={selectSchool} />}
        {tab === 'audit' && <AuditTab schoolId={schoolId} schools={schools} onPickSchool={selectSchool} />}
      </div>
    </div>
  )
}

/* ============================================================
   Owner settings
   ============================================================ */
function FormGrid({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>{children}</div>
}

function SaveBar({ onSave }: { onSave: () => void }) {
  return (
    <div className="row gap8 jc-end" style={{ marginTop: 16 }}>
      <Btn variant="primary" icon="check" onClick={onSave}>Save changes</Btn>
    </div>
  )
}

/* ---------- Company ---------- */
function CompanyTab() {
  const app = useApp()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: clients = [], isLoading, isError } = usePortfolioSchools(app.isPlatform)
  const schools = useMemo(() => clients.map(clientToSchool), [clients])
  const [editId, setEditId] = useState<string | null>(null)
  const editSchool = schools.find((s) => s.id === editId) ?? null
  const editClient = clients.find((c) => c.id === editId) ?? null

  if (isLoading) {
    return (
      <Card>
        <CardHead title="Company profile" sub="Edit school name, address, logo and photo" icon="building" />
        <div className="row ai-center jc-center" style={{ padding: 48 }}><Spinner /></div>
      </Card>
    )
  }

  if (isError || schools.length === 0) {
    return (
      <Card>
        <CardHead title="Company profile" sub="Edit school name, address, logo and photo" icon="building" />
        <Empty
          icon="building"
          title="No schools yet"
          body="Create a school first, then edit its profile, logo and round dashboard photo here."
        />
      </Card>
    )
  }

  return (
    <div className="col gap16">
      <EditSchoolProfileModal
        open={!!editSchool}
        school={editSchool}
        client={editClient}
        isPlatform={app.isPlatform}
        onClose={() => setEditId(null)}
        onSaved={(s) => {
          app.rememberSchool(s)
          void qc.invalidateQueries({ queryKey: ['owner'] })
        }}
      />
      <Card>
        <CardHead
          title="School profiles"
          sub="Owner / admin can edit name, address, contact, logo and school image for each school"
          icon="building"
        />
        <div className="col gap10" style={{ marginTop: 16 }}>
          {schools.map((s) => (
            <div
              key={s.id}
              className="row ai-center gap12"
              style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}
            >
              <SchoolPhoto school={s} size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-md fw6">{s.name}</div>
                <div className="t-xs muted3">{s.city} · {s.status}</div>
              </div>
              <Btn size="sm" icon="edit" onClick={() => setEditId(s.id)}>Edit</Btn>
              <Btn
                size="sm"
                variant="secondary"
                icon="arrowRight"
                onClick={() => {
                  void app.enterSchool(s.id, s).then((ok) => {
                    if (!ok) {
                      toast.info(
                        'School not active',
                        `${s.name} opens only after Catre approves payment. You can still Edit profile and images.`,
                      )
                    }
                  })
                }}
              >
                Open
              </Btn>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

/* ---------- Owner settings ---------- */
function OwnerSettings() {
  return (
    <div>
      <PageHead title="Owner Settings" sub="Organisation-wide configuration for your SchoolMate account" />
      <div style={{ marginTop: 16 }}>
        <CompanyTab />
      </div>
    </div>
  )
}

/* ---------- export contract ---------- */
export const workspaceScreens: Record<string, ComponentType> = {
  'owner.users': OwnerUsers,
  'owner.settings': OwnerSettings,
}
