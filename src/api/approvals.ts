import { listRequest, request } from './client'
import { snakeToCamel } from './mapper'
import type { Approval, ApprovalStatus, Cap, Role } from '@/types'

export type ApprovalFilter = ApprovalStatus | 'all'

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

const LEAVE_FOR_ROLES: Role[] = ['admin', 'principal', 'vice_principal']
const PRIORITIES = new Set<Approval['priority']>(['high', 'medium', 'low'])

function relAge(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function fmtDay(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function normalizePriority(raw: unknown): Approval['priority'] {
  const p = String(raw ?? 'medium').toLowerCase()
  return PRIORITIES.has(p as Approval['priority']) ? (p as Approval['priority']) : 'medium'
}

function normalizeStatus(raw: unknown): ApprovalStatus {
  const s = String(raw ?? 'pending').toLowerCase()
  if (s === 'approved' || s === 'rejected') return s
  return 'pending'
}

function normalizeForRoles(raw: unknown): Role[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is Role => typeof r === 'string')
}

function parseAttachmentUrls(raw: unknown): string[] | undefined {
  if (Array.isArray(raw))
    return raw.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed))
        return parsed.filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    } catch {
      /* wire may be a plain URL string */
      return [raw.trim()]
    }
  }
  return undefined
}

function approvalExtras(a: Record<string, unknown>) {
  const appliedOn = typeof a.appliedOn === 'string' ? a.appliedOn : null
  const decidedNote = typeof a.decidedNote === 'string' && a.decidedNote.trim()
    ? a.decidedNote.trim()
    : null
  const decidedBy = typeof a.decidedByName === 'string' && a.decidedByName.trim()
    ? a.decidedByName.trim()
    : null
  const attachmentUrls = parseAttachmentUrls(a.attachmentUrls)
  return {
    status: normalizeStatus(a.status),
    decidedNote,
    decidedBy,
    appliedOn,
    age: String(a.age ?? relAge(appliedOn) ?? ''),
    ...(attachmentUrls && attachmentUrls.length > 0 ? { attachmentUrls } : {}),
  }
}

function buildStudent(a: Record<string, unknown>): Approval['student'] | undefined {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const id = str(a.childId)
  const name = str(a.studentName)
  const cls = str(a.studentClass)
  const section = str(a.studentSection)
  const adm = str(a.admissionNo)
  const roll = typeof a.studentRoll === 'number' ? a.studentRoll : undefined
  const s: NonNullable<Approval['student']> = {}
  if (id) s.id = id
  if (name) s.name = name
  if (cls) s.cls = cls
  if (section) s.section = section
  if (roll != null) s.roll = roll
  if (adm) s.adm = adm
  return Object.keys(s).length > 0 ? s : undefined
}

/** Map a wire row from GET /v1/approvals to the inbox Approval model. */
export function mapWireToApproval(raw: Record<string, unknown>): Approval {
  const a = snakeToCamel<Record<string, unknown>>(raw)
  const forRoles = normalizeForRoles(a.forRoles)
  const requester = String(a.requester ?? a.requesterName ?? 'Staff')
  const priority = normalizePriority(a.priority)
  const extras = approvalExtras(a)

  // Canonical approval inbox row (exams, fees, payroll, etc.)
  if (typeof a.title === 'string' && forRoles.length > 0) {
    return {
      id: String(a.id),
      type: String(a.type ?? 'Approval'),
      module: String(a.module ?? 'hr'),
      cap: (String(a.cap ?? 'A') as Cap),
      title: a.title,
      detail: String(a.detail ?? ''),
      requester,
      role: String(a.role ?? ''),
      amount: typeof a.amount === 'number' ? a.amount : null,
      priority,
      forRoles,
      ...extras,
    }
  }

  // Leave request row (current backend shape)
  const leaveType = String(a.type ?? 'leave')
  const from = fmtDay(a.fromDate)
  const to = fmtDay(a.toDate)
  const reason = String(a.reason ?? '').trim()
  const substitute = String(a.substitute ?? '').trim()
  const range = from && to ? `${from} – ${to}` : from || to
  const detailParts = [reason, range, substitute ? `Substitute: ${substitute}` : ''].filter(Boolean)

  return {
    id: String(a.id),
    type: 'Leave Request',
    module: 'hr',
    cap: 'A',
    title: `Leave — ${requester} (${leaveType})`,
    detail: detailParts.join('. ') || 'Leave request pending review.',
    requester,
    role: String(a.requesterRole ?? ''),
    amount: null,
    priority,
    forRoles: forRoles.length > 0 ? forRoles : LEAVE_FOR_ROLES,
    ...extras,
    ...(buildStudent(a) ? { student: buildStudent(a) } : {}),
  }
}

/** Approvals a role may action. Owner is a super-role and sees every pending item. */
export function approvalsForRole(list: Approval[], role: Role): Approval[] {
  if (role === 'owner') return list
  return list.filter((a) => (a.forRoles ?? []).includes(role))
}

/** Pending tab may hide ids just acted on; Approved/Rejected/All keep SQL history. */
export function inboxApprovals(
  list: Approval[],
  role: Role,
  tab: ApprovalFilter,
  hideOnPending: ReadonlySet<string> = new Set(),
): Approval[] {
  const scoped = approvalsForRole(list, role)
  if (tab !== 'pending') return scoped
  return scoped.filter((a) => !hideOnPending.has(a.id))
}

export async function listApprovals(status: ApprovalFilter = 'pending'): Promise<Approval[]> {
  const env = await listRequest<ListEnvelope>('/approvals', { query: { status } })
  return env.data.map((a) => mapWireToApproval(a))
}

export async function actOnApproval(
  id: string,
  status: 'approved' | 'rejected',
  decidedNote?: string,
): Promise<void> {
  const body: { status: string; decided_note?: string } = { status }
  const note = decidedNote?.trim()
  if (note) body.decided_note = note
  await request<unknown>(`/approvals/${id}`, { method: 'PATCH', body })
}
