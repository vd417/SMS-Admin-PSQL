import { describe, expect, it } from 'vitest'
import type { AttendanceRecord } from '@/api/attendance'
import type { Student } from '@/types'
import { buildStudentRegisterRows, registerToCsv } from './attendanceExport'

function rec(studentId: string, date: string, status: AttendanceRecord['status']): AttendanceRecord {
  return { id: `${studentId}-${date}`, classId: 'c1', studentId, date, status }
}
function stu(id: string, name: string, adm: string, cls: string): Student {
  return { id, name, adm, cls } as Student
}

describe('buildStudentRegisterRows', () => {
  it('resolves names/adm/class and sorts by date then class then name', () => {
    const students = [stu('s1', 'Rahul Sharma', 'ADM1', 'IV-B'), stu('s2', 'Asha Rao', 'ADM2', 'IV-A')]
    const records = [
      rec('s1', '2026-07-16', 'present'),
      rec('s2', '2026-07-15', 'absent'),
    ]
    const rows = buildStudentRegisterRows(records, students)
    expect(rows[0]).toMatchObject({ name: 'Asha Rao', adm: 'ADM2', cls: 'IV-A', date: '2026-07-15', status: 'absent' })
    expect(rows[1]).toMatchObject({ name: 'Rahul Sharma', date: '2026-07-16' })
  })

  it('falls back to the student id when the student is unknown', () => {
    const rows = buildStudentRegisterRows([rec('ghost', '2026-07-16', 'present')], [])
    expect(rows[0].name).toBe('ghost')
    expect(rows[0].adm).toBe('')
  })
})

describe('registerToCsv', () => {
  it('emits a header and escapes commas/quotes', () => {
    const csv = registerToCsv([{ name: 'Doe, John', adm: 'A1', cls: 'IV-B', date: '2026-07-16', status: 'present' }])
    const [header, row] = csv.split('\n')
    expect(header).toBe('Name,Student ID,Class,Date,Status')
    expect(row).toBe('"Doe, John",A1,IV-B,2026-07-16,present')
  })
})
