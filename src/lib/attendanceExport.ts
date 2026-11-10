/* Attendance register export → CSV and the multi-sheet Excel workbook. */
import ExcelJS from 'exceljs'
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

export interface AttendanceSummaryStudent {
  roll: string
  name: string
  studentId: string
  adm: string
  cls: string
  section: string
  present: number
  absent: number
  late: number
  leave: number
  total: number
  pct: number
  status: string
}

export interface AttendanceDayRow {
  name: string
  studentId: string
  adm: string
  cls: string
  section: string
  date: string
  status: string
  markedBy: string
}

/** Overview table as CSV. Exports every filtered student, not one page. */
export function overviewToCsv(students: AttendanceSummaryStudent[]): string {
  const header = ['Roll No', 'Student Name', 'Present Days', 'Absent Days', 'Total Days', 'Attendance %', 'Status']
  const lines = students.map((s) => [s.roll, s.name, s.present, s.absent, s.total, s.pct, s.status].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\n')
}

function paintHeader(ws: ExcelJS.Worksheet, row: number, cols: number, color = 'FF4F46E5') {
  const header = ws.getRow(row)
  for (let i = 1; i <= cols; i++) {
    const cell = header.getCell(i)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }
    cell.alignment = { vertical: 'middle' }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }
  header.height = 22
}

function finishSheet(ws: ExcelJS.Worksheet, headerRow: number, cols: number, lastRow: number) {
  if (lastRow >= headerRow) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: cols } }
    for (let r = headerRow + 1; r <= lastRow; r++) {
      const fill = r % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF'
      for (let c = 1; c <= cols; c++) {
        const cell = ws.getRow(r).getCell(c)
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        }
      }
    }
  }
  ws.views = [{ state: 'frozen', ySplit: headerRow }]
  ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  ws.headerFooter = { oddHeader: '&L&BAttendance Report', oddFooter: '&LSchoolMate&RPage &P of &N' }
  for (let c = 1; c <= cols; c++) {
    let width = 14
    ws.getColumn(c).eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length + 2
      if (len > width) width = Math.min(len, 36)
    })
    ws.getColumn(c).width = width
  }
}

/** Six-sheet attendance workbook for the students and days currently filtered. */
export async function downloadAttendanceWorkbook(args: {
  schoolName: string
  classLabel: string
  section: string
  from: string
  to: string
  students: AttendanceSummaryStudent[]
  days: AttendanceDayRow[]
}): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = args.schoolName
  const present = args.students.reduce((n, s) => n + s.present, 0)
  const absent = args.students.reduce((n, s) => n + s.absent, 0)
  const late = args.students.reduce((n, s) => n + s.late, 0)
  const leave = args.students.reduce((n, s) => n + s.leave, 0)
  const marks = present + absent + late + leave
  const overall = marks ? present / marks : 0

  const dash = wb.addWorksheet('Attendance Dashboard')
  dash.getCell('A1').value = args.schoolName
  dash.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FF4F46E5' } }
  dash.getCell('A2').value = 'Attendance Report'
  dash.getCell('A2').font = { bold: true, size: 14 }
  const labels = ['Report range', 'Class', 'Section', 'Total students', 'Present', 'Absent', 'Late', 'Leave', 'Overall attendance']
  const values: (string | number)[] = [`${args.from} to ${args.to}`, args.classLabel, args.section || 'All', args.students.length, present, absent, late, leave, overall]
  labels.forEach((label, i) => {
    dash.getCell(4, i + 1).value = label
    dash.getCell(5, i + 1).value = values[i]
  })
  dash.getCell(5, 9).numFmt = '0.0%'
  paintHeader(dash, 4, labels.length)
  finishSheet(dash, 4, labels.length, 5)

  const dailyHeaders = ['Student Name', 'Student ID', 'Admission No', 'Class', 'Section', 'Date', 'Subject', 'Period', 'Period Time', 'Status', 'Marked By', 'Marked By Role', 'Assigned Teacher', 'Marked At', 'Geo-Fence', 'Remarks']
  const daily = wb.addWorksheet('Daily Attendance')
  daily.addRow(dailyHeaders)
  for (const d of args.days) daily.addRow([d.name, d.studentId, d.adm, d.cls, d.section, d.date, '', '', '', d.status, d.markedBy, '', '', '', '', ''])
  paintHeader(daily, 1, dailyHeaders.length)
  finishSheet(daily, 1, dailyHeaders.length, Math.max(1, args.days.length + 1))

  const monthHeaders = ['Roll No', 'Student Name', 'Student ID', 'Class', 'Section', 'Month', 'Working Days', 'Present Days', 'Absent Days', 'Late Days', 'Leave Days', 'Attendance Percentage', 'Performance Status']
  const month = wb.addWorksheet('Monthly Summary')
  month.addRow(monthHeaders)
  args.students.forEach((s, i) => {
    const row = i + 2
    month.addRow([s.roll, s.name, s.studentId, s.cls, s.section, args.from.slice(0, 7), s.total, s.present, s.absent, s.late, s.leave, s.total ? s.present / s.total : 0, s.status])
    month.getCell(row, 12).numFmt = '0.0%'
  })
  paintHeader(month, 1, monthHeaders.length)
  finishSheet(month, 1, monthHeaders.length, Math.max(1, args.students.length + 1))

  const histHeaders = ['Student Name', 'Student ID', 'Date', 'Day', 'Subject', 'Period', 'Period Time', 'Attendance Status', 'Marked By', 'Marked At', 'Remarks', 'Correction History']
  const hist = wb.addWorksheet('Student Attendance History')
  hist.addRow(histHeaders)
  for (const d of args.days) {
    const parsed = new Date(`${d.date}T00:00:00`)
    const dayName = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { weekday: 'short' })
    hist.addRow([d.name, d.studentId, d.date, dayName, '', '', '', d.status, d.markedBy, '', '', ''])
  }
  paintHeader(hist, 1, histHeaders.length)
  finishSheet(hist, 1, histHeaders.length, Math.max(1, args.days.length + 1))

  const classHeaders = ['Class', 'Section', 'Total Students', 'Present', 'Absent', 'Late', 'Leave', 'Attendance Percentage']
  const klass = wb.addWorksheet('Class-wise Report')
  klass.addRow(classHeaders)
  klass.addRow([args.classLabel, args.section || 'All', args.students.length, present, absent, late, leave, overall])
  klass.getCell(2, 8).numFmt = '0.0%'
  paintHeader(klass, 1, classHeaders.length)
  finishSheet(klass, 1, classHeaders.length, 2)

  const lowHeaders = ['Student Name', 'Student ID', 'Class', 'Section', 'Working Days', 'Present Days', 'Absent Days', 'Attendance Percentage', 'Risk Status']
  const low = wb.addWorksheet('Low Attendance Report')
  low.addRow(lowHeaders)
  const lows = args.students.filter((s) => s.pct < 75)
  lows.forEach((s) => low.addRow([s.name, s.studentId, s.cls, s.section, s.total, s.present, s.absent, s.pct / 100, s.pct < 60 ? 'Critical' : 'Warning']))
  lows.forEach((_, i) => { low.getCell(i + 2, 8).numFmt = '0.0%' })
  paintHeader(low, 1, lowHeaders.length, 'FFDC2626')
  finishSheet(low, 1, lowHeaders.length, Math.max(1, lows.length + 1))

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `attendance-${(args.classLabel || 'class').replace(/\s+/g, '-')}-${args.from}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** One worksheet whose columns match the on-screen report. `colors` paints cells the same way as the view. */
export async function downloadSheet(
  fileName: string,
  sheetName: string,
  columns: string[],
  rows: (string | number)[][],
  colors?: ({ bg: string; text: string } | undefined)[][],
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  ws.addRow(columns)
  for (const row of rows) ws.addRow(row)
  paintHeader(ws, 1, columns.length)
  finishSheet(ws, 1, columns.length, Math.max(1, rows.length + 1))
  const hex = (value: string) => 'FF' + value.replace('#', '').toUpperCase()
  colors?.forEach((row, r) => {
    row.forEach((color, c) => {
      if (!color) return
      const cell = ws.getRow(r + 2).getCell(c + 1)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hex(color.bg) } }
      cell.font = { bold: true, color: { argb: hex(color.text) } }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })
  })
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
