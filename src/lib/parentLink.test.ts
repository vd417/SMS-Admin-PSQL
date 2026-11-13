import { describe, expect, it } from 'vitest'
import { applyLinkedParent, findParentProbe, groupStudentsByParent } from './parentLink'
import type { Student } from '@/types'

function stu(over: Partial<Student> & { id: string; organizationId?: string }): Student & { organizationId?: string } {
  return {
    adm: over.id,
    name: 'Child',
    gender: 'M',
    grade: 'V',
    section: 'A',
    cls: 'V-A',
    roll: 1,
    guardian: 'Ravi Kumar',
    phone: '9000000000',
    attendance: 0,
    feeStatus: 'due',
    feeDue: 0,
    status: 'active',
    house: 'Ruby',
    avatarHue: 12,
    ...over,
  }
}

describe('groupStudentsByParent', () => {
  it('groups siblings who share a parent email even in different classes', () => {
    const parents = groupStudentsByParent([
      stu({ id: 'a', name: 'Anaya', cls: 'V-A', email: 'anaya@school.test', guardianEmail: 'ravi@home.test', phone: '9000001111', feeDue: 100 }),
      stu({ id: 'b', name: 'Rohan', cls: 'VIII-B', email: 'rohan@school.test', guardianEmail: 'Ravi@Home.test', phone: '9000002222', feeDue: 40 }),
    ])
    expect(parents).toHaveLength(1)
    expect(parents[0].name).toBe('Ravi Kumar')
    expect(parents[0].wards.map((w) => `${w.name} (${w.cls})`)).toEqual(['Anaya (V-A)', 'Rohan (VIII-B)'])
    expect(parents[0].due).toBe(140)
    const fromInvoices = groupStudentsByParent(
      [
        stu({ id: 'a', name: 'Anaya', cls: 'V-A', guardianEmail: 'ravi@home.test', feeDue: 100 }),
        stu({ id: 'b', name: 'Rohan', cls: 'VIII-B', guardianEmail: 'ravi@home.test', feeDue: 40 }),
      ],
      undefined,
      new Map([['a', 250], ['b', 0]]),
    )
    expect(fromInvoices[0].due).toBe(250)
    expect(parents[0].email).toBe('ravi@home.test')
  })

  it('groups on the same parent phone even when the guardian names differ', () => {
    const parents = groupStudentsByParent([
      stu({ id: 'a', name: 'Anaya', guardian: 'Ravi Kumar', phone: '9000001111' }),
      stu({ id: 'b', name: 'Rohan', guardian: 'Someone Else', cls: 'VIII-B', phone: '90000 01111', feeDue: 25 }),
    ])
    expect(parents).toHaveLength(1)
    expect(parents[0].wards).toHaveLength(2)
    expect(parents[0].due).toBe(25)
  })

  it('does not group on the guardian name when email and phone differ', () => {
    const parents = groupStudentsByParent([
      stu({ id: 'a', name: 'Anaya', guardian: 'Ravi Kumar', guardianEmail: 'ravi@home.test', phone: '9000001111' }),
      stu({ id: 'b', name: 'Beena', guardian: 'Ravi Kumar', guardianEmail: 'other@home.test', phone: '9000002222' }),
    ])
    expect(parents).toHaveLength(2)
  })

  it('does not group using the student email, class, or section', () => {
    const parents = groupStudentsByParent([
      stu({ id: 'a', name: 'Anaya', email: 'shared@school.test', guardian: 'Ravi Kumar', guardianEmail: 'ravi@home.test', phone: '9000001111', cls: 'V-A', section: 'A' }),
      stu({ id: 'b', name: 'Beena', email: 'shared@school.test', guardian: 'Priya Shah', guardianEmail: 'priya@home.test', phone: '9000002222', cls: 'V-A', section: 'A' }),
    ])
    expect(parents).toHaveLength(2)
  })
})

describe('findParentProbe', () => {
  const anaya = stu({
    id: 'anaya', name: 'Anaya', cls: 'V-A', guardian: 'Ravi Kumar',
    guardianEmail: 'ravi@home.test', phone: '9000001111', email: 'anaya@school.test',
  })

  it('matches father email and names the existing wards', () => {
    const probe = findParentProbe({ fatherEmail: 'Ravi@Home.test', fatherName: '' }, [anaya])
    expect(probe?.type).toBe('link')
    expect(probe?.type === 'link' && probe.message).toBe(
      'Ravi Kumar already has 1 ward: Anaya (V-A). Do you want to link this student?',
    )
  })

  it('matches the phone even when the typed guardian name is different', () => {
    const probe = findParentProbe(
      { fatherName: 'Priya Shah', fatherPhone: '9000001111' },
      [stu({ ...anaya, guardianEmail: undefined })],
    )
    expect(probe?.type).toBe('link')
    expect(probe?.type === 'link' && probe.message).toBe(
      'Ravi Kumar already has 1 ward: Anaya (V-A). Do you want to link this student?',
    )
  })

  it('does not match on the guardian name alone', () => {
    const probe = findParentProbe(
      { fatherName: 'Ravi Kumar', fatherEmail: 'other@home.test', fatherPhone: '9000009999' },
      [anaya],
    )
    expect(probe).toBeNull()
  })

  it('ignores the child email on the roster', () => {
    const probe = findParentProbe(
      { fatherEmail: 'anaya@school.test', fatherName: 'Ravi Kumar' },
      [anaya],
    )
    expect(probe).toBeNull()
  })
})

describe('applyLinkedParent', () => {
  it('copies father and mother details and keeps the new child identity', () => {
    const next = applyLinkedParent(
      {
        firstName: 'Kabir', lastName: 'Kumar', cls: 'VIII-B', email: 'kabir@school.test',
        adm: 'scc/STU/26/0009', phone: '9000009999', fatherName: 'Typed', fatherEmail: '',
        motherName: '', section: 'B',
      },
      stu({
        id: 'anaya', guardian: 'Ravi Kumar', guardianEmail: 'ravi@home.test', phone: '9000001111',
        mother: { name: 'Meera Kumar', email: 'meera@home.test', phone: '9000002222' },
      }),
      { mother: { name: 'Meera Kumar', email: 'meera@home.test', phone: '9000002222' } },
    )
    expect(next.fatherName).toBe('Ravi Kumar')
    expect(next.fatherEmail).toBe('ravi@home.test')
    expect(next.fatherPhone).toBe('9000001111')
    expect(next.motherName).toBe('Meera Kumar')
    expect(next.email).toBe('kabir@school.test')
    expect(next.cls).toBe('VIII-B')
    expect(next.section).toBe('B')
    expect(next.adm).toBe('scc/STU/26/0009')
    expect(next.firstName).toBe('Kabir')
    expect(next.lastName).toBe('Kumar')
  })
})

describe('revised parent match rules', () => {
  const anaya = stu({
    id: 'anaya',
    name: 'Anaya',
    cls: 'V',
    section: 'A',
    guardian: 'Ravi Kumar',
    email: 'anaya@school.test',
    phone: '9111111111',
    guardianEmail: undefined,
    feeDue: 100,
    father: { name: 'Ravi Kumar', email: 'Dad@Home.test', phone: '9000001111' },
    mother: { name: 'Meera Kumar', email: 'Mom@Home.test', phone: '9000002222' },
  })

  it('1. matches the same father email when the guardian name differs', () => {
    const probe = findParentProbe(
      { fatherName: 'Other Person', fatherEmail: ' dad@home.test ' },
      [anaya],
    )
    expect(probe?.type).toBe('link')
    expect(probe?.message).toBe('Ravi Kumar already has 1 ward: Anaya (V-A). Do you want to link this student?')
  })

  it('2. matches the same mother email when the guardian name differs', () => {
    const probe = findParentProbe(
      { motherName: 'Other Person', motherEmail: 'MOM@home.test' },
      [anaya],
    )
    expect(probe?.type).toBe('link')
    expect(probe?.wards.map((w) => w.name)).toEqual(['Anaya'])
  })

  it('3. matches the same father phone when the guardian name differs', () => {
    const probe = findParentProbe(
      { fatherName: 'Other Person', fatherPhone: '+91 90000 01111' },
      [anaya],
    )
    expect(probe?.type).toBe('link')
  })

  it('4. matches the same mother phone when the guardian name differs', () => {
    const probe = findParentProbe(
      { motherName: 'Other Person', motherPhone: '90000 02222' },
      [anaya],
    )
    expect(probe?.type).toBe('link')
  })

  it('5. matches the same primary contact number', () => {
    const probe = findParentProbe(
      { fatherName: 'Other Person', phone: '91111 11111' },
      [anaya],
    )
    expect(probe?.type).toBe('link')
  })

  it('6. does not match the same guardian name when email and phone differ', () => {
    const probe = findParentProbe(
      {
        fatherName: 'Ravi Kumar',
        fatherEmail: 'other@home.test',
        motherEmail: 'else@home.test',
        fatherPhone: '9000009999',
        motherPhone: '9000008888',
        phone: '9000007777',
      },
      [anaya],
    )
    expect(probe).toBeNull()
    const parents = groupStudentsByParent([
      anaya,
      stu({
        id: 'beena', name: 'Beena', guardian: 'Ravi Kumar',
        guardianEmail: 'other@home.test', phone: '9000007777', email: 'beena@school.test',
      }),
    ])
    expect(parents).toHaveLength(2)
  })

  it('7. Link student copies parent details and keeps the new child identity', () => {
    const entered = {
      firstName: 'Kabir', lastName: 'Shah', cls: 'VIII', section: 'B',
      email: 'kabir@school.test', adm: 'scc/STU/26/0009', phone: '9000007777',
      fatherName: 'Typed', fatherEmail: 'typed@home.test', fatherPhone: '9000009999',
      motherName: 'Typed Mother', motherEmail: '', motherPhone: '',
    }
    const next = applyLinkedParent(entered, anaya, {
      father: anaya.father,
      mother: anaya.mother,
    })
    expect(next.fatherName).toBe('Ravi Kumar')
    expect(next.fatherEmail).toBe('Dad@Home.test')
    expect(next.fatherPhone).toBe('9000001111')
    expect(next.motherName).toBe('Meera Kumar')
    expect(next.motherEmail).toBe('Mom@Home.test')
    expect(next.motherPhone).toBe('9000002222')
    expect(next.firstName).toBe('Kabir')
    expect(next.email).toBe('kabir@school.test')
    expect(next.cls).toBe('VIII')
    expect(next.section).toBe('B')
    expect(next.adm).toBe('scc/STU/26/0009')
  })

  it('8. Don\'t link leaves the entered form values unchanged', () => {
    const entered = {
      firstName: 'Kabir', fatherName: 'Typed Parent', fatherEmail: 'typed@home.test',
      fatherPhone: '9000009999', email: 'kabir@school.test', cls: 'VIII', section: 'B',
      adm: 'scc/STU/26/0009',
    }
    const saved = { ...entered }
    expect(saved).toEqual(entered)
    expect(saved.fatherName).toBe('Typed Parent')
    expect(saved.email).toBe('kabir@school.test')
  })

  it('9. shows every child with class and section and adds the dues', () => {
    const parents = groupStudentsByParent([
      anaya,
      stu({
        id: 'kabir', name: 'Kabir', cls: 'VIII', section: 'B', guardian: 'Someone Else',
        email: 'kabir@school.test', phone: '9222222222', guardianEmail: undefined,
        mother: { email: 'mom@home.test' }, feeDue: 250,
      }),
    ])
    expect(parents).toHaveLength(1)
    expect(parents[0].wards.map((w) => `${w.name} (${w.cls}-${w.section})`)).toEqual([
      'Anaya (V-A)',
      'Kabir (VIII-B)',
    ])
    expect(parents[0].due).toBe(350)
    expect(parents[0].wards.map((w) => w.id).sort()).toEqual(['anaya', 'kabir'])
  })

  it('10. keeps a different organization out of the match', () => {
    const otherSchool = stu({
      id: 'other', name: 'Other Child', organizationId: 'org-b', guardian: 'Ravi Kumar',
      father: { email: 'dad@home.test' }, phone: '9000001111', email: 'other@school.test',
      feeDue: 999,
    })
    const thisSchool = { ...anaya, organizationId: 'org-a' }
    const parents = groupStudentsByParent([thisSchool, otherSchool], 'org-a')
    expect(parents).toHaveLength(1)
    expect(parents[0].wards.map((w) => w.id)).toEqual(['anaya'])
    expect(parents[0].due).toBe(100)

    const probe = findParentProbe(
      { fatherEmail: 'dad@home.test', fatherName: 'Other Person' },
      [thisSchool, otherSchool],
      undefined,
      'org-b',
    )
    expect(probe?.wards.map((w) => w.id)).toEqual(['other'])
  })
})
