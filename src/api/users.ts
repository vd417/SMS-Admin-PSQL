import { request } from './client'
import { ApiError } from './ApiError'
import type { Cap, Role, UserOverrides } from '@/types'

/** CRM login invite roles only — Teacher/Staff use the onboard form (People), not Send invite. */
export const CRM_INVITE_ROLES: Role[] = ['admin', 'principal', 'vice_principal']

/** Roles an actor may assign via Send invite (CRM access). */
export function assignableSchoolRoles(actorRole: Role | string | undefined): Role[] {
  const r = (actorRole ?? '').toLowerCase().replace(/^school\./, '')
  if (r === 'owner') return [...CRM_INVITE_ROLES, 'owner']
  if (r === 'admin') return [...CRM_INVITE_ROLES]
  if (r === 'principal') return ['vice_principal']
  return []
}

/** @deprecated use CRM_INVITE_ROLES — kept for tests that import SCHOOL_BASE_ROLES */
export const SCHOOL_BASE_ROLES = CRM_INVITE_ROLES

/** Map UI role keys to API policy names (`school.teacher`, etc.). */
export function toApiRole(role: string): string {
  const r = role.trim().toLowerCase()
  const map: Record<string, string> = {
    owner: 'school.owner',
    'school.owner': 'school.owner',
    admin: 'school.admin',
    'school.admin': 'school.admin',
    principal: 'school.principal',
    'school.principal': 'school.principal',
    vice_principal: 'school.principal',
    teacher: 'school.teacher',
    'school.teacher': 'school.teacher',
    staff: 'staff',
    parent: 'student.parent',
    'student.parent': 'student.parent',
  }
  return map[r] ?? (r.includes('.') ? r : `school.${r}`)
}

export function fromApiRole(role: string): Role {
  const r = role.trim().toLowerCase().replace(/^school\./, '')
  if (r === 'owner') return 'owner'
  if (r === 'admin') return 'admin'
  if (r === 'principal') return 'principal'
  if (r === 'teacher') return 'teacher'
  if (r === 'staff') return 'staff'
  return 'teacher'
}

/** Friendly label for a CRM leadership role. NOTE: `toApiRole` maps both 'principal' and
 *  'vice_principal' to the same 'school.principal' backend role — there's no separate policy
 *  for vice principal, so once invited, which of the two someone actually is can't be told
 *  apart from the API. Label as plain "Principal" rather than guessing/hedging with both. */
export function leadershipRoleLabel(role: ReturnType<typeof fromApiRole>): string {
  if (role === 'owner') return 'Owner'
  if (role === 'admin') return 'Admin'
  if (role === 'principal') return 'Principal'
  return 'Admin'
}

export interface SchoolUserDto {
  id: string
  email: string | null
  phone: string | null
  status: string
  created_at: string
  roles: string[]
}

export interface PermissionOverrideDto {
  module: string
  cap: Cap
  effect: 'grant' | 'revoke'
}

export async function listSchoolUsers(): Promise<SchoolUserDto[]> {
  const data = await request<SchoolUserDto[]>('/users')
  return data ?? []
}

/** Parent app logins. Older APIs omit this route — then the parent list has no suspend button. */
export async function listParentLogins(): Promise<SchoolUserDto[]> {
  try {
    const data = await request<SchoolUserDto[]>('/users/parents')
    return data ?? []
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return []
    throw err
  }
}

export interface InviteUserOptions {
  phone?: string
  /** Which identifier receives the welcome message when both email and phone are set. */
  channel?: 'email' | 'phone'
  /** "code" (default): 6-digit OTP. "link": one-click magic login link, no code shown. */
  method?: 'code' | 'link'
  /** False suppresses the welcome email/SMS for this call — used when inviting the
   *  same person into several schools in one batch, so only one message goes out. */
  sendWelcome?: boolean
  /** All school names in the batch — shown (comma-joined) in that one welcome message. */
  schoolNames?: string[]
  /** Optional personal note from the inviter, shown in the welcome email above the link/code. */
  message?: string
}

export async function inviteUser(email: string, role: string, opts: InviteUserOptions = {}): Promise<{ id: string }> {
  return request<{ id: string }>('/users', {
    method: 'POST',
    body: {
      email,
      phone: opts.phone || undefined,
      roles: [toApiRole(role)],
      sendWelcome: opts.sendWelcome ?? true,
      method: opts.method ?? 'code',
      channel: opts.channel,
      schoolNames: opts.schoolNames,
      message: opts.message || undefined,
    },
  })
}

/** Replace roles for a user id within the current school (JWT tenant). */
export async function setUserRoles(userId: string, roles: string[]): Promise<SchoolUserDto> {
  return request<SchoolUserDto>(`/users/${userId}/roles`, {
    method: 'PUT',
    body: { roles: roles.map(toApiRole) },
  })
}

/** Removes a person's access to the current school (JWT tenant) only — any other
 *  school they belong to is untouched (each school membership is its own row). */
export async function removeUserAccess(userId: string): Promise<void> {
  await request<void>(`/users/${userId}`, { method: 'DELETE' })
}

/** Reversible pause/resume for an already-accepted member — unlike removeUserAccess,
 *  this can be flipped back later without re-inviting them. */
export async function setUserActive(userId: string, active: boolean): Promise<SchoolUserDto> {
  return request<SchoolUserDto>(`/users/${userId}/status`, {
    method: 'PUT',
    body: { active },
  })
}

export async function getUserPermissions(userId: string): Promise<PermissionOverrideDto[]> {
  return (await request<PermissionOverrideDto[]>(`/users/${userId}/permissions`)) ?? []
}

export async function setUserPermissions(userId: string, overrides: UserOverrides): Promise<PermissionOverrideDto[]> {
  const payload: PermissionOverrideDto[] = []
  for (const [module, caps] of Object.entries(overrides)) {
    if (!caps) continue
    for (const [cap, effect] of Object.entries(caps)) {
      if (effect === 'grant' || effect === 'revoke') {
        payload.push({ module, cap: cap as Cap, effect })
      }
    }
  }
  return (await request<PermissionOverrideDto[]>(`/users/${userId}/permissions`, {
    method: 'PUT',
    body: { overrides: payload },
  })) ?? []
}

export function overridesFromApi(rows: PermissionOverrideDto[]): UserOverrides {
  const out: UserOverrides = {}
  for (const r of rows) {
    if (!out[r.module]) out[r.module] = {}
    out[r.module]![r.cap] = r.effect
  }
  return out
}
