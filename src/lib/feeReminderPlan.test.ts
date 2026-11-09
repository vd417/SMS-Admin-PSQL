import { describe, it, expect } from 'vitest'
import { planUnpaidFeeNotices } from './feeReminderPlan'

const rahul = {
  id: 'rahul',
  name: 'Rahul',
  cls: 'Class 4',
  due: 8000,
  studentEmail: 'rahul@school.test',
  fatherEmail: 'father@school.test',
  fatherPhone: '9000000001',
  parentEmail: 'parent@school.test',
  parentPhone: '9000000002',
}

describe('planUnpaidFeeNotices', () => {
  it('gives Rahul, his father, and his parent only Rahul’s own amount', () => {
    const notices = planUnpaidFeeNotices({
      schoolName: 'Demo',
      students: [rahul, { ...rahul, id: 'other', name: 'Asha', cls: 'Class 5', due: 5000, studentEmail: 'asha@school.test', fatherEmail: 'asha.father@school.test', fatherPhone: '9000000003', parentEmail: 'asha.parent@school.test', parentPhone: '9000000004' }],
      classTeachers: [],
      principals: [],
    })
    const rahulNotices = notices.filter((n) => n.studentName === 'Rahul')
    expect(rahulNotices.map((n) => n.role)).toEqual(['student', 'father', 'parent'])
    for (const n of rahulNotices) {
      expect(n.amount).toBe(8000)
      expect(n.body).toContain('Rahul')
      expect(n.body).toContain('8,000')
      expect(n.body).not.toContain('Asha')
    }
    expect(rahulNotices.find((n) => n.role === 'father')?.emails).toEqual(['father@school.test'])
    expect(rahulNotices.find((n) => n.role === 'parent')?.phones).toEqual(['9000000002'])
  })

  it('sends one notice when the father and the parent are the same contact', () => {
    const notices = planUnpaidFeeNotices({
      schoolName: 'Demo',
      students: [{ ...rahul, parentEmail: 'father@school.test', parentPhone: '9000000001' }],
      classTeachers: [],
      principals: [],
    })
    expect(notices.filter((n) => n.role === 'father' || n.role === 'parent')).toHaveLength(1)
  })

  it('gives a logged-in class teacher only their class, and skips them when signed out', () => {
    const notices = planUnpaidFeeNotices({
      schoolName: 'Demo',
      students: [rahul, { ...rahul, id: 'a', name: 'Asha', cls: 'Class 5', due: 5000 }],
      classTeachers: [
        { name: 'Meera', classLabel: 'Class 4', userId: 'ct4', loggedIn: true },
        { name: 'Chem', classLabel: 'Class 5', userId: 'chem', loggedIn: false },
      ],
      principals: [],
    })
    const teacher = notices.filter((n) => n.role === 'class_teacher')
    expect(teacher).toHaveLength(1)
    expect(teacher[0].userId).toBe('ct4')
    expect(teacher[0].appOnly).toBe(true)
    expect(teacher[0].body).toContain('Rahul')
    expect(teacher[0].body).not.toContain('Asha')
    expect(notices.some((n) => n.userId === 'chem')).toBe(false)
  })

  it('gives a logged-in principal every class and skips a signed-out principal', () => {
    const notices = planUnpaidFeeNotices({
      schoolName: 'Demo',
      students: [rahul, { ...rahul, id: 'a', name: 'Asha', cls: 'Class 5', due: 5000 }],
      classTeachers: [],
      principals: [
        { name: 'Principal', userId: 'p1', loggedIn: true },
        { name: 'Away', userId: 'p2', loggedIn: false },
      ],
    })
    const principal = notices.filter((n) => n.role === 'principal')
    expect(principal).toHaveLength(1)
    expect(principal[0].userId).toBe('p1')
    expect(principal[0].body).toContain('Rahul')
    expect(principal[0].body).toContain('Asha')
  })
})
