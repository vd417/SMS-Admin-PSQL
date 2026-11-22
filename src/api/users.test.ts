import { describe, it, expect, beforeEach, vi } from 'vitest'
import { inviteUser, toApiRole } from './users'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('toApiRole', () => {
  it('maps UI roles to school.* / staff policies', () => {
    expect(toApiRole('owner')).toBe('school.owner')
    expect(toApiRole('teacher')).toBe('school.teacher')
    expect(toApiRole('admin')).toBe('school.admin')
    expect(toApiRole('principal')).toBe('school.principal')
    expect(toApiRole('staff')).toBe('staff')
    expect(toApiRole('school.teacher')).toBe('school.teacher')
  })
})

describe('assignableSchoolRoles', () => {
  it('Send invite is CRM-only: Admin / Principal / Vice-Principal (not teacher/staff)', async () => {
    const { assignableSchoolRoles } = await import('./users')
    expect(assignableSchoolRoles('owner')).toEqual(['admin', 'principal', 'vice_principal', 'receptionist', 'owner'])
    expect(assignableSchoolRoles('admin')).toEqual(['admin', 'principal', 'vice_principal', 'receptionist'])
    expect(assignableSchoolRoles('principal')).toEqual(['vice_principal', 'receptionist'])
  })
})

describe('inviteUser', () => {
  it('POSTs /users with email + roles array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'u1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await inviteUser('a@b.edu', 'teacher')
    expect(res).toEqual({ id: 'u1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/users')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'a@b.edu',
      roles: ['school.teacher'],
      sendWelcome: true,
      method: 'code',
    })
  })
})
