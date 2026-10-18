/* Attendance register export → CSV (student marks). */
import type { AttendanceRecord } from '@/api/attendance'
import type { Student } from '@/types'

export interface RegisterRow {
  name: string
  adm: string
  cls: string
  date: string
  status: string
}

function csvCell(v: string | number): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** Build register rows from raw marks, resolving student name/adm/class where known. */
export function buildStudentRegisterRows(records: AttendanceRecord[], students: Student[]): RegisterRow[] {
  const byId = new Map(students.map((s) => [s.id, s]))
  return records
    .filter((r) => r.studentId)
    .map((r) => {
      const s = byId.get(r.studentId)
      return {
        name: s?.name ?? r.studentId,
        adm: s?.adm ?? '',
        cls: s?.cls ?? '',
        date: r.date,
        status: r.status,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.cls.localeCompare(b.cls) || a.name.localeCompare(b.name))
}

/** Serialize register rows to CSV text. */
export function registerToCsv(rows: RegisterRow[]): string {
  const header = ['Name', 'Student ID', 'Class', 'Date', 'Status']
  const lines = rows.map((r) => [r.name, r.adm, r.cls, r.date, r.status].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\n')
}
