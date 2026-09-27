import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listPtm, createPtm, deletePtm, type CreatePtmInput } from './ptm'
import { tokenStore } from './auth/tokenStore'

function jsonOk(data: unknown, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    text: async () => JSON.stringify({ data }),
    json: async () => ({ data }),
  } as Response)
}

describe('ptm (API)', () => {
  beforeEach(() => {
    tokenStore.set({ access_token: 'ptm-token', refresh_token: 'ptm-refresh' })
    tokenStore.setTenantId('school-a')
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists from GET /ptm with bearer auth and no filters', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonOk([
      {
        id: '11111111-1111-1111-1111-111111111111',
        date: '2026-10-10',
        time: '10:30',
        teacher: 'Meera Krishnan',
        subject: 'Maths',
        child: '22222222-2222-2222-2222-222222222222',
        mode: 'Video call',
        status: 'pending',
        student_name: 'Aarav Shah',
        teacher_id: '33333333-3333-3333-3333-333333333333',
      },
    ]))
    const rows = await listPtm()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      date: '2026-10-10',
      time: '10:30',
      teacher: 'Meera Krishnan',
      subject: 'Maths',
      studentId: '22222222-2222-2222-2222-222222222222',
      mode: 'Video call',
      status: 'pending',
      studentName: 'Aarav Shah',
      teacherId: '33333333-3333-3333-3333-333333333333',
    })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ptm')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ptm-token')
    expect(headers['X-Tenant-Id']).toBe('school-a')
  })

  it('sends status/from/to/teacher_id/student_id as query params', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce(jsonOk([]))
    await listPtm({
      status: 'pending',
      from: '2026-10-01',
      to: '2026-10-31',
      teacherId: '33333333-3333-3333-3333-333333333333',
      studentId: '22222222-2222-2222-2222-222222222222',
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('status=pending')
    expect(url).toContain('from=2026-10-01')
    expect(url).toContain('to=2026-10-31')
    expect(url).toContain('teacher_id=33333333-3333-3333-3333-333333333333')
    expect(url).toContain('student_id=22222222-2222-2222-2222-222222222222')
  })

  it('POSTs a new meeting with snake_case body', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const input: CreatePtmInput = {
      studentId: '22222222-2222-2222-2222-222222222222',
      teacherId: '33333333-3333-3333-3333-333333333333',
      subject: 'Maths',
      date: '2026-10-10',
      time: '10:30',
      mode: 'Video call',
    }
    fetchMock.mockResolvedValueOnce(jsonOk({
      id: '44444444-4444-4444-4444-444444444444',
      date: '2026-10-10',
      time: '10:30',
      teacher: 'Meera Krishnan',
      subject: 'Maths',
      child: '22222222-2222-2222-2222-222222222222',
      mode: 'Video call',
      status: 'pending',
      student_name: 'Aarav Shah',
      teacher_id: '33333333-3333-3333-3333-333333333333',
    }, 201))
    const created = await createPtm(input)
    expect(created.id).toBe('44444444-4444-4444-4444-444444444444')
    expect(created.status).toBe('pending')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ptm')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(body).toEqual({
      student_id: '22222222-2222-2222-2222-222222222222',
      teacher_id: '33333333-3333-3333-3333-333333333333',
      subject: 'Maths',
      date: '2026-10-10',
      time: '10:30',
      mode: 'Video call',
    })
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ptm-token')
    expect(headers['X-Tenant-Id']).toBe('school-a')
  })

  it('DELETEs by id', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      text: async () => '',
      json: async () => ({}),
    } as Response)
    await deletePtm('44444444-4444-4444-4444-444444444444')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ptm/44444444-4444-4444-4444-444444444444')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer ptm-token')
    expect(headers['X-Tenant-Id']).toBe('school-a')
  })

  it('rejects create without student_id or teacher_id before calling API', async () => {
    await expect(createPtm({
      studentId: '', teacherId: '33333333-3333-3333-3333-333333333333', date: '2026-10-10', time: '10:30', mode: 'Video call',
    })).rejects.toThrow(/student/i)
    await expect(createPtm({
      studentId: '22222222-2222-2222-2222-222222222222', teacherId: '', date: '2026-10-10', time: '10:30', mode: 'Video call',
    })).rejects.toThrow(/teacher/i)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
