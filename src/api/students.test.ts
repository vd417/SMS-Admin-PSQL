import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listStudents, listStudentsPage, getStudent, createStudent, updateStudent, toStudent, studentGuardianName, actualParentName, studentParentLabel, parentMailFromStudent, fromStudent, fromStudentUpdate } from './students'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const wireStudent = {
  id: 's1', admission_no: 'A-100', name: 'Asha', gender: 'F', grade: '10', section: 'A',
  class_label: '10-A', roll: 3, guardian_name: 'Ravi Kumar', guardian_phone: '99', attendance_pct: 92,
  fee_status: 'paid', fee_due: 0, status: 'active', house: 'Blue', avatar_hue: 210,
}

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('listStudents', () => {
  it('maps the snake_case wire to the camelCase Student shape (adm/cls renamed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [wireStudent], next_cursor: null })))
    const rows = await listStudents()
    expect(rows[0]).toMatchObject({
      id: 's1', adm: 'A-100', cls: '10-A', name: 'Asha',
      guardian: 'Ravi Kumar', phone: '99', attendance: 92,
      feeStatus: 'paid', feeDue: 0, avatarHue: 210,
    })
    expect((rows[0] as unknown as Record<string, unknown>).admission_no).toBeUndefined()
    expect((rows[0] as unknown as Record<string, unknown>).class_label).toBeUndefined()
    expect((rows[0] as unknown as Record<string, unknown>).guardianName).toBeUndefined()
  })

  it('maps guardian_name into guardian for display', () => {
    const s = toStudent({
      id: 'x', admission_no: 'A-1', name: 'Kid', gender: 'M', grade: '1', section: 'A',
      class_label: '1-A', roll: 1, guardian_name: 'Meera Rao', guardian_phone: '98100',
      attendance_pct: 88, fee_status: 'due', fee_due: 0, status: 'active', house: 'Ruby', avatar_hue: 10,
    })
    expect(s.guardian).toBe('Meera Rao')
    expect(studentGuardianName(s)).toBe('Meera Rao')
  })

  it('uses the father name when the guardian field is the student or the word Parent', () => {
    expect(actualParentName({
      name: 'Arav Sharma',
      guardian: 'Parent',
      father: { name: 'Suresh Sharma' },
    })).toBe('Suresh Sharma')
    expect(actualParentName({
      name: 'Arav Sharma',
      guardian: 'Arav Sharma',
      mother: { name: 'Anita Sharma' },
    })).toBe('Anita Sharma')
    expect(actualParentName({ name: 'Arav Sharma', guardian: 'Parent' })).toBe('')
  })

  it('forwards q/grade/status/fee as query params and drops "all"', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [], next_cursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    await listStudents({ q: 'asha', grade: '10', status: 'active', fee: 'paid' })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('q=asha')
    expect(url).toContain('grade=10')
    expect(url).toContain('status=active')
    expect(url).toContain('fee=paid')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ data: [], next_cursor: null }))
    await listStudents({ grade: 'all', status: 'all', fee: 'all' })
    const url2 = fetchMock.mock.calls[0][0] as string
    expect(url2).not.toContain('grade=')
    expect(url2).not.toContain('status=')
    expect(url2).not.toContain('fee=')

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(jsonResponse({ data: [], next_cursor: 'abc' }))
    const page = await listStudentsPage({ q: 'asha', limit: 25, cursor: 'c1' })
    const url3 = fetchMock.mock.calls[0][0] as string
    expect(url3).toContain('limit=25')
    expect(url3).toContain('cursor=c1')
    expect(page.nextCursor).toBe('abc')
  })
})

describe('getStudent', () => {
  it('maps a single record', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ...wireStudent, id: 's2', admission_no: 'A-200', class_label: '9-B', fee_status: 'due', fee_due: 1200 } })))
    const s = await getStudent('s2')
    expect(s).toMatchObject({ id: 's2', adm: 'A-200', cls: '9-B', feeStatus: 'due', feeDue: 1200 })
  })
})

describe('createStudent', () => {
  it('POSTs a snake_case body (adm->admission_no, cls->class_label) and maps the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        id: 'srv1', admission_no: 'A-9', class_label: '8-C', name: 'New Kid', gender: 'M', grade: '8', section: 'C',
        roll: 5, guardian_name: 'G', guardian_phone: '7', attendance_pct: 0, fee_status: 'due', fee_due: 0,
        status: 'active', house: 'Ruby', avatar_hue: 50,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const created = await createStudent({ id: 'tmp', adm: 'A-9', cls: '8-C', name: 'New Kid', gender: 'M', grade: '8', section: 'C', roll: 5, guardian: 'G', phone: '7', attendance: 0, feeStatus: 'due', feeDue: 0, status: 'active', house: 'Ruby', avatarHue: 50 } as Parameters<typeof createStudent>[0])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/students')
    expect((init as RequestInit).method).toBe('POST')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.admission_no).toBe('A-9')
    expect(body.grade).toBe('8')
    expect(body.section).toBe('C')
    expect(body.guardian_name).toBe('G')
    expect(body.guardian_phone).toBe('7')
    expect(body.fee_status).toBeUndefined()
    expect(body.adm).toBeUndefined()
    expect(body.cls).toBeUndefined()
    expect(created).toMatchObject({ id: 'srv1', adm: 'A-9', cls: '8-C', guardian: 'G', phone: '7' })
  })

  it('fromStudent prefers father name when guardian blank', () => {
    const body = fromStudent({
      id: 't', adm: 'A-1', cls: '1-A', name: 'Kid', gender: 'M', grade: '1', section: 'A', roll: 1,
      guardian: '', phone: '', attendance: 0, feeStatus: 'due', feeDue: 0, status: 'active', house: 'Ruby', avatarHue: 1,
      father: { name: 'Amit Shah', phone: '90000', email: 'dad@home.test' },
    } as Parameters<typeof fromStudent>[0])
    expect(body.guardian_name).toBe('Amit Shah')
    expect(body.guardian_phone).toBe('90000')
    expect(body.guardian_email).toBe('dad@home.test')
  })

  it('toStudent maps guardian_email for the Parents list (never student email)', () => {
    const s = toStudent({
      id: 'x', admission_no: 'A-1', name: 'Kid', gender: 'M', grade: '1', section: 'A',
      class_label: '1-A', roll: 1, guardian_name: 'Meera', guardian_phone: '98100',
      guardian_email: 'meera@home.test', email: 'kid@school.test',
      attendance_pct: 88, fee_status: 'due', fee_due: 0, status: 'active', house: 'Ruby', avatar_hue: 10,
    })
    expect(s.guardianEmail).toBe('meera@home.test')
    expect(s.email).toBe('kid@school.test')
    expect(parentMailFromStudent(s)).toBe('meera@home.test')
  })

  it('parent label falls back when guardian missing', () => {
    const s = toStudent({
      id: 'x', admission_no: 'A-1', name: 'Kid', gender: 'M', grade: '1', section: 'A',
      class_label: '1-A', roll: 1, guardian_name: null, guardian_phone: '98100',
      attendance_pct: 88, fee_status: 'due', fee_due: 0, status: 'active', house: 'Ruby', avatar_hue: 10,
    })
    expect(studentGuardianName(s)).toBe('')
    expect(studentParentLabel(s)).toBe('Guardian · 98100')
  })
})

describe('updateStudent', () => {
  const editedStudent = {
    id: 's1', adm: 'A-100', cls: '10-A', name: 'Asha', gender: 'F' as const, grade: '10', section: 'A',
    roll: 3, guardian: 'Ravi Kumar', phone: '99', attendance: 92, feeStatus: 'paid' as const, feeDue: 0,
    status: 'active' as const, house: 'Blue', avatarHue: 210,
    dob: '2015-04-12', email: 'asha@example.com', address: '221B Baker Street',
  } as unknown as Parameters<typeof updateStudent>[1]

  it('fromStudentUpdate includes dob/email/address/gender — not just the original subset', () => {
    const body = fromStudentUpdate(editedStudent)
    expect(body.dob).toBe('2015-04-12')
    expect(body.email).toBe('asha@example.com')
    expect(body.address).toBe('221B Baker Street')
    expect(body.gender).toBe('F')
  })

  it('fromStudentUpdate omits roll so edit-save does not overwrite A–Z class roll with 0', () => {
    const body = fromStudentUpdate({ ...editedStudent, roll: 0 })
    expect(body.roll).toBeUndefined()
    expect(fromStudent(editedStudent).roll).toBe(3)
  })

  it('fromStudentUpdate writes father email onto guardian_email for Students.GuardianEmail', () => {
    const body = fromStudentUpdate({
      ...editedStudent,
      guardianEmail: undefined,
      father: { name: 'Vaibhav Dubey', email: 'Vaibhavv@yopmail.com' },
    })
    expect(body.guardian_email).toBe('Vaibhavv@yopmail.com')
  })

  it('PATCHes /students/{id} with the full field set, not a hardcoded subset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ...wireStudent, email: 'asha@example.com', dob: '2015-04-12' } }))
    vi.stubGlobal('fetch', fetchMock)
    await updateStudent('s1', editedStudent)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/students/s1')
    expect((init as RequestInit).method).toBe('PATCH')
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body.email).toBe('asha@example.com')
    expect(body.dob).toBe('2015-04-12')
    expect(body.address).toBe('221B Baker Street')
  })

})
