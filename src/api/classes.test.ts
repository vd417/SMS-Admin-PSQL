import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listClasses, createClass, deleteClass } from './classes'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('listClasses', () => {
  it('maps class_teacher_id / student_count to teacherId / students', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ id: 'c1', name: 'X-A', grade: 'X', section: 'A', class_teacher_id: 'T1', student_count: 40, room: 'R1' }],
      next_cursor: null,
    })))
    const rows = await listClasses()
    expect(rows[0]).toEqual({ id: 'c1', name: 'X-A', grade: 'X', section: 'A', teacherId: 'T1', students: 40, room: 'R1' })
  })

  it('returns an empty list when data is missing so class pickers stay usable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: null })))
    expect(await listClasses()).toEqual([])
  })

  it('maps subjects when the API returns them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: 'c1', name: 'VI-A', grade: 'VI', section: 'A', class_teacher_id: null,
        student_count: 30, room: 'R1', subjects: ['Math', 'English'],
      }],
      next_cursor: null,
    })))
    const rows = await listClasses()
    expect(rows[0].subjects).toEqual(['Math', 'English'])
  })
})

describe('createClass', () => {
  it('POSTs /classes with class_teacher_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'c2', name: 'X-B', grade: 'X', section: 'B', class_teacher_id: null, student_count: 0, room: 'R2' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await createClass({ name: 'X-B', grade: 'X', section: 'B', teacherId: '', students: 0, room: 'R2' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/classes')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.class_teacher_id).toBeNull()
    expect(body.teacher_id).toBeUndefined()
  })
})

describe('deleteClass', () => {
  it('DELETEs /classes/:id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteClass('c9')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/classes/c9')
    expect((init as RequestInit).method).toBe('DELETE')
  })
})
