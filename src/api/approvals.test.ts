import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listApprovals, actOnApproval, mapWireToApproval, approvalsForRole, inboxApprovals } from './approvals'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('listApprovals', () => {
  it('maps for_roles -> forRoles and returns the list', async () => {
    const wire = { data: [{ id: 'A1', type: 'leave', module: 'hr', cap: 'hr.approve', title: 'Leave', detail: '2 days', requester: 'Asha', role: 'teacher', amount: null, age: '3h', priority: 'high', status: 'pending', for_roles: ['principal', 'admin'] }], next_cursor: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(wire)))
    const rows = await listApprovals()
    expect(rows[0]).toMatchObject({ id: 'A1', priority: 'high', forRoles: ['principal', 'admin'], amount: null })
    expect((rows[0] as unknown as Record<string, unknown>).for_roles).toBeUndefined()
  })

  it('requests /approvals with status filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    await listApprovals('approved')
    expect(fetchMock.mock.calls[0][0]).toContain('/approvals')
    expect(fetchMock.mock.calls[0][0]).toContain('status=approved')
  })
})

describe('mapWireToApproval', () => {
  it('maps leave rows without for_roles to principal inbox items', () => {
    const row = mapWireToApproval({
      id: 'b1f2c3d4-e5f6-7890-abcd-ef1234567890',
      type: 'casual',
      from_date: '2026-05-20',
      to_date: '2026-05-21',
      reason: 'Personal work',
      substitute: 'Cover arranged',
      priority: 'high',
      status: 'pending',
      applied_on: '2026-05-18T10:00:00Z',
      requester_name: 'Rajesh Kumar',
    })
    expect(row).toMatchObject({
      id: 'b1f2c3d4-e5f6-7890-abcd-ef1234567890',
      type: 'Leave Request',
      requester: 'Rajesh Kumar',
      priority: 'high',
      status: 'pending',
      forRoles: ['principal', 'vice_principal'],
    })
    expect(row.detail).toContain('Personal work')
    expect(approvalsForRole([row], 'principal')).toHaveLength(1)
  })

  it('maps attachment_urls JSON on leave rows', () => {
    const row = mapWireToApproval({
      id: 'x',
      type: 'casual',
      status: 'pending',
      requester_name: 'Asha',
      applied_on: '2026-05-18T10:00:00Z',
      attachment_urls: '["https://example.com/a.jpg","https://example.com/b.jpg"]',
    })
    expect(row.attachmentUrls).toEqual(['https://example.com/a.jpg', 'https://example.com/b.jpg'])
  })

  it('maps decided_note on rejected leave rows', () => {
    const row = mapWireToApproval({
      id: 'x', type: 'casual', status: 'rejected', decided_note: 'No cover arranged',
      requester_name: 'Asha', applied_on: '2026-05-18T10:00:00Z',
    })
    expect(row.status).toBe('rejected')
    expect(row.decidedNote).toBe('No cover arranged')
  })

  it('maps decided_by_name so CRM can show who approved or rejected', () => {
    const row = mapWireToApproval({
      id: 'x', type: 'casual', status: 'approved', decided_note: 'Covered',
      requester_name: 'Asha', decided_by_name: 'Priya Principal',
      applied_on: '2026-05-18T10:00:00Z',
    })
    expect(row.decidedBy).toBe('Priya Principal')
  })

  it('populates student details on a parent/student leave row', () => {
    const row = mapWireToApproval({
      id: 'L1', type: 'sick', status: 'pending',
      requester_name: 'Asha (parent)', requester_role: 'parent',
      applied_on: '2026-10-01T10:00:00Z',
      child_id: 'stu-123', student_name: 'Rahul Sharma',
      student_class: 'Grade 5', student_section: 'A', student_roll: 12,
      admission_no: 'ADM-2024-012',
    })
    expect(row.student).toEqual({
      id: 'stu-123', name: 'Rahul Sharma', cls: 'Grade 5',
      section: 'A', roll: 12, adm: 'ADM-2024-012',
    })
  })

  it('leaves student undefined for a staff self-leave row', () => {
    const row = mapWireToApproval({
      id: 'L2', type: 'casual', status: 'pending',
      requester_name: 'Rajesh Kumar', applied_on: '2026-10-01T10:00:00Z',
    })
    expect(row.student).toBeUndefined()
  })

  it('includes only the student fields that are present (deleted/partial student)', () => {
    const row = mapWireToApproval({
      id: 'L3', type: 'sick', status: 'pending',
      requester_name: 'Asha (parent)', applied_on: '2026-10-01T10:00:00Z',
      child_id: 'stu-999',
    })
    expect(row.student).toEqual({ id: 'stu-999' })
  })
})

describe('inboxApprovals', () => {
  const approved: ReturnType<typeof mapWireToApproval> = mapWireToApproval({
    id: 'leave-1', type: 'casual', status: 'approved', requester_name: 'Asha',
    decided_by_name: 'Priya Principal', applied_on: '2026-05-18T10:00:00Z',
  })

  it('still shows a just-acted request on the Approved tab (SQL history, not a local hide)', () => {
    const hidden = new Set(['leave-1'])
    expect(inboxApprovals([approved], 'principal', 'approved', hidden)).toEqual([approved])
    expect(inboxApprovals([approved], 'principal', 'pending', hidden)).toEqual([])
  })
})

describe('actOnApproval', () => {
  it('PATCHes /approvals/{id} with the status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    await actOnApproval('A1', 'approved')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/approvals/A1')
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ status: 'approved' })
  })

  it('PATCHes decided_note when rejecting with a note', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    await actOnApproval('A1', 'rejected', 'Not enough cover arranged')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      status: 'rejected',
      decided_note: 'Not enough cover arranged',
    })
  })
})
