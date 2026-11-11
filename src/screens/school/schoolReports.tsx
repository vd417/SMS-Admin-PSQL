import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useToast } from '@/lib/hooks'
import { ApiError } from '@/api/client'
import {
  downloadSchoolReport, emailSchoolReport, listReportScheduleRuns, listReportSchedules,
  listSchoolReportCatalog, pauseReportSchedule, printSchoolReport, resumeReportSchedule,
  runReportScheduleNow, runSchoolReport, saveReportSchedule, schoolReportOptions,
  type SchoolReportCatalogItem, type SchoolReportOptions, type SchoolReportQuery,
  type SchoolReportResult, type SchoolReportRun, type SchoolReportSchedule,
} from '@/api/schoolReports'
import { rangeForPreset, type ReportPreset } from '@/lib/reportRange'
import { listClasses, type SchoolClass } from '@/api/classes'
import { AttendanceRegister } from './attendanceRegister'
import { HBars, Donut, Legend } from '@/components/charts/Charts'
import {
  PageHead, Card, CardHead, Btn, Badge, Search, Select, Field, Input, Textarea, DataTable, Icon, Skeleton,
  type Column,
} from '@/components/ui'

const TABS = [
  { value: 'student', label: 'Student Reports' },
  { value: 'staff', label: 'Staff & Teacher Reports' },
  { value: 'admin', label: 'Admin Reports' },
  { value: 'fee', label: 'Fee Reports' },
  { value: 'attendance', label: 'Attendance Reports' },
  { value: 'transport', label: 'Transport Reports' },
  { value: 'academic', label: 'Academic Reports' },
]

const FILTER_LABEL: Record<string, string> = {
  class: 'Class', section: 'Section', student: 'Student', teacher: 'Teacher', employee: 'Employee',
  department: 'Department', designation: 'Designation', role: 'Role', gender: 'Gender',
  feeHead: 'Fee head', paymentMode: 'Payment mode', paymentStatus: 'Payment status',
  attendanceStatus: 'Attendance', route: 'Route', vehicle: 'Vehicle',
  session: 'Academic session', subject: 'Subject', period: 'Period',
}

const TEXT_FILTERS = new Set(['student', 'teacher', 'employee', 'session', 'subject', 'period'])
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type FilterState = Record<string, string>

const emptyOptions: SchoolReportOptions = {
  classes: [], sections: [], departments: [], designations: [], roles: [], feeHeads: [],
  paymentModes: [], paymentStatuses: [], attendanceStatuses: [], routes: [], vehicles: [],
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return e instanceof Error ? e.message : 'Something went wrong'
}

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: '15days', label: '15 days' },
  { value: 'monthly', label: 'Monthly' },
]

function frequencyLabel(value: string): string {
  return FREQUENCIES.find((item) => item.value === value)?.label ?? value
}

function scheduleScope(filtersJson: string): string {
  const saved = readSaved(filtersJson)
  const className = (saved.className || saved.class_name || '').trim() || 'All'
  const section = (saved.section || '').trim() || 'All'
  return `Class: ${className} · Section: ${section}`
}

function readSaved(filtersJson: string): Record<string, string> {
  try {
    const saved = JSON.parse(filtersJson || '{}') as Record<string, string>
    return saved && typeof saved === 'object' ? saved : {}
  } catch {
    return {}
  }
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
}

function optionList(key: string, options: SchoolReportOptions, classes: SchoolClass[], selectedClass: string): string[] {
  switch (key) {
    case 'class':
      return uniqueSorted([...classes.map((item) => item.name), ...options.classes])
    case 'section': {
      const matched = selectedClass
        ? classes.filter((item) => item.name.trim().toLowerCase() === selectedClass.trim().toLowerCase())
        : []
      const fromClasses = (matched.length ? matched : classes).map((item) => item.section)
      const sections = uniqueSorted([...fromClasses, ...(matched.length ? [] : options.sections)])
      return sections.length ? sections : uniqueSorted(options.sections)
    }
    case 'department': return options.departments
    case 'designation': return options.designations
    case 'role': return options.roles
    case 'gender': return ['Male', 'Female', 'Other']
    case 'feeHead': return options.feeHeads
    case 'paymentMode': return options.paymentModes
    case 'paymentStatus': return options.paymentStatuses
    case 'attendanceStatus': return options.attendanceStatuses
    case 'route': return options.routes
    case 'vehicle': return options.vehicles
    default: return []
  }
}

function attendanceChoices(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of [...values, 'present', 'absent', 'late', 'leave', 'half_day', 'pending']) {
    const key = value.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value.trim())
  }
  return out
}

function attendanceEmptyMessage(reportKey: string, student: string): string {
  if (reportKey === 'student_attendance_history' && !student.trim())
    return 'Search a student by name or admission number, then generate the report.'
  if (reportKey === 'student_attendance_low')
    return 'No students are below 75% attendance for these filters.'
  if (reportKey === 'student_attendance_streak')
    return 'No student was absent for 3 or more consecutive working days in this range.'
  return 'No attendance for this session, date range, and filters.'
}

function genderValue(label: string): string {
  if (label === 'Male') return 'M'
  if (label === 'Female') return 'F'
  if (label === 'Other') return 'O'
  return label
}

const DATE_PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
]

const ATTENDANCE_GROUPS = ['Overview', 'Class', 'Student', 'Subject', 'Staff', 'Insights']

const ATTENDANCE_VIEWS: { id: string; group: string; label: string; key: string; preset?: ReportPreset }[] = [
  { id: 'school', group: 'Overview', label: 'School-wise', key: 'student_attendance_summary' },
  { id: 'daily', group: 'Overview', label: 'Daily', key: 'student_attendance_daily', preset: 'today' },
  { id: 'weekly', group: 'Overview', label: 'Weekly', key: 'student_attendance_summary', preset: 'week' },
  { id: 'monthly', group: 'Overview', label: 'Monthly', key: 'student_attendance_summary', preset: 'month' },
  { id: 'class', group: 'Class', label: 'Class-wise', key: 'student_attendance_class' },
  { id: 'section', group: 'Class', label: 'Section-wise', key: 'student_attendance_class' },
  { id: 'compare', group: 'Class', label: 'Class comparison', key: 'student_attendance_compare' },
  { id: 'lowest', group: 'Class', label: 'Lowest sections', key: 'student_attendance_lowest' },
  { id: 'student', group: 'Student', label: 'Student-wise', key: 'student_attendance_summary' },
  { id: 'history', group: 'Student', label: 'History', key: 'student_attendance_history' },
  { id: 'by-subject', group: 'Student', label: 'Subject-wise', key: 'student_attendance_by_subject' },
  { id: 'low', group: 'Student', label: 'Below 75%', key: 'student_attendance_low' },
  { id: 'streak', group: 'Student', label: 'Absent 3 days', key: 'student_attendance_streak' },
  { id: 'streak5', group: 'Student', label: 'Absent 5 days', key: 'student_attendance_streak5' },
  { id: 'streak7', group: 'Student', label: 'Absent 7 days', key: 'student_attendance_streak7' },
  { id: 'subject', group: 'Subject', label: 'Subject summary', key: 'student_attendance_subject' },
  { id: 'period', group: 'Subject', label: 'Period-wise', key: 'student_attendance_period' },
  { id: 'detail', group: 'Subject', label: 'Period detail', key: 'student_attendance' },
  { id: 'marking', group: 'Staff', label: 'Teacher marking', key: 'student_attendance_marking' },
  { id: 'pending', group: 'Staff', label: 'Pending', key: 'student_attendance_pending' },
  { id: 'corrections', group: 'Staff', label: 'Corrections', key: 'student_attendance_corrections' },
  { id: 'trend', group: 'Insights', label: 'Trends', key: 'student_attendance_trend' },
  { id: 'range', group: 'Insights', label: 'Range comparison', key: 'student_attendance_compare' },
  { id: 'decline', group: 'Insights', label: 'Decline', key: 'student_attendance_decline' },
  { id: 'improve', group: 'Insights', label: 'Improvement', key: 'student_attendance_improve' },
  { id: 'absence', group: 'Insights', label: 'Absence analysis', key: 'student_attendance_absence' },
]

function cellNumber(columns: string[], row: string[], header: string): number | null {
  const index = columns.findIndex((column) => column.toLowerCase() === header.toLowerCase())
  if (index < 0) return null
  const value = Number(String(row[index] ?? '').replace(/,/g, ''))
  return Number.isFinite(value) ? value : 0
}

function columnTotal(result: SchoolReportResult, header: string): number | null {
  if (columnIndex(result.columns, header) < 0) return null
  return result.rows.reduce((sum, row) => sum + (cellNumber(result.columns, row, header) ?? 0), 0)
}

function attendanceDashboard(result: SchoolReportResult) {
  const present = columnTotal(result, 'Present Days')
  const absent = columnTotal(result, 'Absent Days')
  const leave = columnTotal(result, 'Leave Days')
  const late = columnTotal(result, 'Late Days')
  const working = columnTotal(result, 'Total Working Days')
  if (present == null || absent == null || leave == null || late == null) return null
  const marked = present + absent + leave + late
  const perStudent = columnIndex(result.columns, 'Admission No.') >= 0 && columnIndex(result.columns, 'Present Days') >= 0
  const buckets = { present: 0, absent: 0, leave: 0, late: 0 }
  if (perStudent) {
    for (const row of result.rows) {
      const p = cellNumber(result.columns, row, 'Present Days') ?? 0
      const a = cellNumber(result.columns, row, 'Absent Days') ?? 0
      const lv = cellNumber(result.columns, row, 'Leave Days') ?? 0
      const lt = cellNumber(result.columns, row, 'Late Days') ?? 0
      const attended = p + lt
      const kind = (p + a + lv + lt) <= 0 ? ''
        : lv > attended && lv >= a ? 'leave'
        : a > attended && a >= lv ? 'absent'
        : lt > p && lt >= a && lt >= lv ? 'late'
        : 'present'
      if (kind) buckets[kind as keyof typeof buckets] += 1
    }
  }
  const students = columnIndex(result.columns, 'Students') >= 0
    ? columnTotal(result, 'Students') ?? 0
    : result.rows.length
  const pctIndex = columnIndex(result.columns, 'Attendance Percentage')
  const below = pctIndex < 0 ? 0 : result.rows.filter((row) => {
    const pct = cellNumber(result.columns, row, 'Attendance Percentage') ?? 0
    const days = cellNumber(result.columns, row, 'Total Working Days')
    return pct < 75 && (days == null || days > 0)
  }).length
  const pendingClasses = new Set<string>()
  if (columnIndex(result.columns, 'Admission No.') >= 0 && working != null) {
    for (const row of result.rows) {
      const days = cellNumber(result.columns, row, 'Total Working Days') ?? 0
      const done = (cellNumber(result.columns, row, 'Present Days') ?? 0)
        + (cellNumber(result.columns, row, 'Absent Days') ?? 0)
        + (cellNumber(result.columns, row, 'Leave Days') ?? 0)
        + (cellNumber(result.columns, row, 'Late Days') ?? 0)
      if (days > done) pendingClasses.add(`${row[columnIndex(result.columns, 'Class')]}|${row[columnIndex(result.columns, 'Section')]}`)
    }
  }
  return {
    students,
    present: perStudent ? buckets.present : present,
    absent: perStudent ? buckets.absent : absent,
    leave: perStudent ? buckets.leave : leave,
    late: perStudent ? buckets.late : late,
    studentCounts: perStudent,
    pct: marked ? Math.round(((present + late) / marked) * 1000) / 10 : 0,
    completion: working ? Math.round((Math.min(marked, working) / working) * 1000) / 10 : 0,
    below,
    pendingClasses: pendingClasses.size,
  }
}

const PIE_COLORS = ['var(--brand-600)', 'var(--success)', 'var(--warning)', 'var(--danger)', '#7c3aed', '#0891b2', '#ea580c', '#0f766e']

const PIE_FIELDS: Record<string, string[]> = {
  student: ['Gender', 'Class', 'Section', 'Student Status'],
  parent: ['Class', 'Section', 'Relationship', 'Account Status'],
  staff: ['Role', 'Department', 'Gender', 'Status'],
  admin: ['Role', 'Department', 'Account Status'],
  teacher: ['Department', 'Status'],
  fee_collection: ['Payment Mode', 'Class', 'Receipt Status'],
  fee_defaulters: ['Class', 'Defaulter Status'],
  student_attendance: ['Attendance Status', 'Class'],
  student_attendance_summary: ['Class', 'Section'],
  student_attendance_low: ['Class', 'Section'],
  student_attendance_streak: ['Class', 'Section'],
  student_attendance_class: ['Class', 'Section'],
  student_attendance_history: ['Attendance Status', 'Subject'],
  staff_attendance: ['Attendance Status', 'Department'],
  transport: ['Route Name', 'Class'],
  academic: ['Subject', 'Class'],
}

function columnIndex(columns: string[], header: string): number {
  return columns.findIndex((column) => column.toLowerCase() === header.toLowerCase())
}

function countSlices(columns: string[], rows: string[][], header: string): { title: string; total: number; segments: { label: string; value: number; color: string }[] } | null {
  const index = columnIndex(columns, header)
  if (index < 0) return null
  const counts = new Map<string, number>()
  for (const row of rows) {
    const label = (row[index] ?? '').trim() || 'Not set'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  if (!items.length) {
    return { title: header, total: 0, segments: [{ label: 'None', value: 1, color: 'var(--surface-3)' }] }
  }
  return {
    title: header,
    total: items.reduce((sum, [, value]) => sum + value, 0),
    segments: items.map(([label, value], i) => ({ label, value, color: PIE_COLORS[i % PIE_COLORS.length] })),
  }
}

function moneySlice(columns: string[], rows: string[][], header: string): number {
  const index = columnIndex(columns, header)
  if (index < 0) return 0
  return rows.reduce((sum, row) => sum + (Number(String(row[index] ?? '').replace(/,/g, '')) || 0), 0)
}

function reportPies(result: SchoolReportResult): { title: string; total: number; segments: { label: string; value: number; color: string }[] }[] {
  const fields = PIE_FIELDS[result.reportKey] ?? ['Class', 'Section', 'Gender', 'Status']
  const pies = fields
    .map((field) => countSlices(result.columns, result.rows, field))
    .filter((pie): pie is NonNullable<typeof pie> => pie !== null)
  const paid = moneySlice(result.columns, result.rows, 'Paid Fee')
    || moneySlice(result.columns, result.rows, 'Paid Amount')
    || moneySlice(result.columns, result.rows, 'Total Paid')
  const pending = moneySlice(result.columns, result.rows, 'Pending Fee')
    || moneySlice(result.columns, result.rows, 'Pending Amount')
    || moneySlice(result.columns, result.rows, 'Outstanding Amount')
  if (columnIndex(result.columns, 'Paid Fee') >= 0 || columnIndex(result.columns, 'Paid Amount') >= 0 || columnIndex(result.columns, 'Total Paid') >= 0) {
    const empty = paid + pending === 0
    pies.unshift({
      title: 'Paid and pending',
      total: paid + pending,
      segments: empty
        ? [{ label: 'None', value: 1, color: 'var(--surface-3)' }]
        : [
            { label: 'Paid', value: paid, color: 'var(--success)' },
            { label: 'Pending', value: pending, color: 'var(--warning)' },
          ].filter((slice) => slice.value > 0),
    })
  }
  return pies
}

function ReportTypeChecks({ catalog, pickedKeys, onToggle, onToggleAll, width = 280 }: {
  catalog: SchoolReportCatalogItem[]
  pickedKeys: string[]
  onToggle: (key: string) => void
  onToggleAll: () => void
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    searchRef.current?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const picked = catalog.filter((item) => pickedKeys.includes(item.key))
  const needle = query.trim().toLowerCase()
  const label = picked.length === 0
    ? 'Select reports'
    : picked.length === catalog.length
      ? 'All reports'
      : picked.length === 1
        ? picked[0].title
        : `${picked.length} reports`
  return (
    <div ref={box} style={{ position: 'relative', width }}>
      <button type="button" className="sm-input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen((current) => !current)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <Icon name="chevDown" size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, width: Math.max(width, 420),
          background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 8px 20px rgba(15, 23, 42, .12)', display: 'flex', flexDirection: 'column',
        }}>
          <input
            ref={searchRef}
            className="sm-input"
            value={query}
            placeholder="Search reports"
            aria-label="Search reports"
            onChange={(event) => setQuery(event.target.value)}
            style={{ margin: 8, width: 'calc(100% - 16px)' }}
          />
          <div style={{ maxHeight: 360, overflowY: 'auto', padding: '0 8px 8px' }}>
          <label className="t-sm row ai-center gap4" style={{ cursor: 'pointer', padding: '4px 2px' }}>
            <input type="checkbox" checked={catalog.length > 0 && pickedKeys.length === catalog.length} onChange={onToggleAll} />
            All reports
          </label>
          {TABS.map((group) => {
            const items = catalog.filter((item) => item.tab === group.value && (!needle || item.title.toLowerCase().includes(needle) || group.label.toLowerCase().includes(needle)))
            if (!items.length) return null
            return (
              <div key={group.value}>
                <div className="t-xs muted" style={{ marginTop: 6 }}>{group.label}</div>
                {items.map((item) => (
                  <label key={item.key} className="t-sm row ai-center gap4" style={{ cursor: 'pointer', padding: '3px 2px' }}>
                    <input type="checkbox" checked={pickedKeys.includes(item.key)} onChange={() => onToggle(item.key)} />
                    {item.title}
                  </label>
                ))}
              </div>
            )
          })}
          {needle && !TABS.some((group) => catalog.some((item) => item.tab === group.value && (item.title.toLowerCase().includes(needle) || group.label.toLowerCase().includes(needle)))) && (
            <div className="t-sm muted" style={{ padding: '8px 2px' }}>No matching reports</div>
          )}
          </div>
        </div>
      )}
    </div>
  )
}

function DateRangeFields({ fromDate, toDate, onFrom, onTo }: {
  fromDate: string
  toDate: string
  onFrom: (date: string) => void
  onTo: (date: string) => void
}) {
  return (
    <div className="report-filter-grid">
      <Field label="From date">
        <Input type="date" value={fromDate} onChange={(e) => onFrom(e.target.value)} />
      </Field>
      <Field label="To date">
        <Input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => onTo(e.target.value)} />
      </Field>
    </div>
  )
}

function CompactSelect({ value, onChange, options, width = 200, searchable = false, fill = false }: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; group?: string }[]
  width?: number
  searchable?: boolean
  fill?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    if (searchable) searchRef.current?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open, searchable])
  const label = options.find((option) => option.value === value)?.label ?? 'All'
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? options.filter((option) => `${option.group ?? ''} ${option.label}`.toLowerCase().includes(needle))
    : options
  const menu: ReactNode[] = []
  let lastGroup = ''
  for (const option of shown) {
    if (option.group && option.group !== lastGroup) {
      lastGroup = option.group
      menu.push(<div key={`g-${option.group}`} className="t-xs muted" style={{ padding: '8px 12px 2px', fontWeight: 700 }}>{option.group}</div>)
    }
    menu.push(
      <button
        key={option.value || 'all'}
        type="button"
        role="option"
        aria-selected={option.value === value}
        className="sm-menu-item"
        onClick={() => { onChange(option.value); setOpen(false) }}
      >
        {option.label}
      </button>,
    )
  }
  return (
    <div ref={box} style={{ position: 'relative', width: fill ? '100%' : width }}>
      <button type="button" className="sm-input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer', gap: 8 }} onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-haspopup="listbox">
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <Icon name="chevDown" size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, minWidth: '100%', width: searchable ? 420 : '100%',
          background: 'var(--surface)', border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 8px 20px rgba(15, 23, 42, .12)', display: 'flex', flexDirection: 'column',
        }}>
          {searchable && (
            <input
              ref={searchRef}
              className="sm-input"
              value={query}
              placeholder="Search reports"
              aria-label="Search reports"
              onChange={(event) => setQuery(event.target.value)}
              style={{ margin: 8, width: 'calc(100% - 16px)' }}
            />
          )}
          <div role="listbox" style={{ maxHeight: searchable ? 360 : 240, overflowY: 'auto' }}>
            {shown.length === 0 && <div className="t-sm muted" style={{ padding: 10 }}>{searchable ? 'No matching reports' : 'No matches'}</div>}
            {menu}
          </div>
        </div>
      )}
    </div>
  )
}

export function SchoolReportsScreen() {
  const toast = useToast()
  const initial = rangeForPreset('month')
  const [catalog, setCatalog] = useState<SchoolReportCatalogItem[]>([])
  const [options, setOptions] = useState<SchoolReportOptions>(emptyOptions)
  const [schoolClasses, setSchoolClasses] = useState<SchoolClass[]>([])
  const [reportKey, setReportKey] = useState('student')
  const [pickedKeys, setPickedKeys] = useState<string[]>([])
  const [fromDate, setFromDate] = useState(initial.from)
  const [toDate, setToDate] = useState(initial.to)
  const [fromTime, setFromTime] = useState('')
  const [toTime, setToTime] = useState('')
  const [filters, setFilters] = useState<FilterState>({})
  const [result, setResult] = useState<SchoolReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [hidden, setHidden] = useState<string[]>([])
  const [schedules, setSchedules] = useState<SchoolReportSchedule[]>([])
  const [runs, setRuns] = useState<SchoolReportRun[]>([])
  const [openRuns, setOpenRuns] = useState<string | null>(null)
  const [emails, setEmails] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [format, setFormat] = useState<'xlsx' | 'pdf'>('xlsx')
  const [frequency, setFrequency] = useState('daily')
  const [sendTime, setSendTime] = useState('08:00')
  const [dayOfWeek, setDayOfWeek] = useState(String(new Date().getDay()))
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [editId, setEditId] = useState<string | undefined>()
  const [mailStatus, setMailStatus] = useState<string>('')
  const [sendingMail, setSendingMail] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [attendanceView, setAttendanceView] = useState('school')
  const [todaySnap, setTodaySnap] = useState<SchoolReportResult | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  const report = catalog.find((c) => c.key === reportKey) ?? null
  const reportTypes = TABS.flatMap((group) => {
    const items = catalog
      .filter((item) => item.tab === group.value)
      .map((item) => ({ value: item.key, label: item.title, group: group.label }))
    if (group.value === 'attendance') {
      items.push(
        { value: 'attendance_overview', label: 'Attendance Overview', group: group.label },
        { value: 'attendance_register', label: 'Daily Attendance Register', group: group.label },
      )
    }
    return items
  })
  const attendanceScreen = reportKey === 'attendance_overview' ? 'overview' as const : reportKey === 'attendance_register' ? 'register' as const : null

  const loadSchedules = useCallback(async (keys: string[]) => {
    const unique = [...new Set(keys.filter(Boolean))]
    if (!unique.length) {
      setSchedules([])
      return
    }
    try {
      const lists = await Promise.all(unique.map((key) => listReportSchedules(key).catch(() => [] as SchoolReportSchedule[])))
      const seen = new Set<string>()
      setSchedules(lists.flat().filter((row) => {
        if (seen.has(row.id)) return false
        seen.add(row.id)
        return true
      }))
    } catch {
      setSchedules([])
    }
  }, [])

  const generate = useCallback(async (query: SchoolReportQuery) => {
    setLoading(true)
    try {
      const today = rangeForPreset('today')
      const [data, snap] = await Promise.all([
        runSchoolReport(query),
        query.reportKey.startsWith('student_attendance')
          ? runSchoolReport({
              ...query,
              reportKey: 'student_attendance_summary',
              fromDate: today.from,
              toDate: today.to,
              summary: false,
              columns: undefined,
            }).catch(() => null)
          : Promise.resolve(null),
      ])
      setResult(data)
      setTodaySnap(snap)
      setReportError(null)
      setHidden([])
      setSearch('')
    } catch (e) {
      const message = errText(e)
      setReportError(message)
      toast.danger('Report failed', message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [items, opts, classes] = await Promise.all([
          listSchoolReportCatalog(),
          schoolReportOptions(),
          listClasses().catch(() => [] as SchoolClass[]),
        ])
        if (!live) return
        setCatalog(items)
        setOptions(opts)
        setSchoolClasses(classes)
        const first = items.find((i) => i.tab === 'student') ?? items[0]
        if (first) {
          setReportKey(first.key)
          setPickedKeys([first.key])
        }
      } catch (e) {
        if (live) toast.danger('Reports unavailable', errText(e))
      }
    })()
    return () => { live = false }
    // Load once. generate/toast are stable enough for the first paint; including them
    // would refetch every time a toast is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadSchedules(pickedKeys)
  }, [pickedKeys, loadSchedules])

  const queryFor = (item: SchoolReportCatalogItem, summary = false, columns?: string[], source: FilterState = filters, from = fromDate, to = toDate): SchoolReportQuery => {
    const q: SchoolReportQuery = { reportKey: item.key, fromDate: from, toDate: to, summary }
    if (fromTime) q.fromTime = fromTime
    if (toTime) q.toTime = toTime
    if (columns) q.columns = columns
    for (const key of item.filters) {
      const raw = source[key]?.trim()
      if (!raw) continue
      const value = key === 'gender' ? genderValue(raw) : raw
      if (key === 'class') q.className = value
      else if (key === 'section') q.section = value
      else if (key === 'student') q.student = value
      else if (key === 'teacher') q.teacher = value
      else if (key === 'employee') q.employee = value
      else if (key === 'department') q.department = value
      else if (key === 'designation') q.designation = value
      else if (key === 'role') q.role = value
      else if (key === 'gender') q.gender = value
      else if (key === 'feeHead') q.feeHead = value
      else if (key === 'paymentMode') q.paymentMode = value
      else if (key === 'paymentStatus') q.paymentStatus = value
      else if (key === 'attendanceStatus') q.attendanceStatus = value
      else if (key === 'route') q.route = value
      else if (key === 'vehicle') q.vehicle = value
      else if (key === 'subject') q.subject = value
      else if (key === 'period') q.period = value
      else if (key === 'session') q.session = value
    }
    return q
  }

  const queryOf = (summary = false, columns?: string[]): SchoolReportQuery => {
    if (!report) {
      const q: SchoolReportQuery = { reportKey, fromDate, toDate, summary }
      if (fromTime) q.fromTime = fromTime
      if (toTime) q.toTime = toTime
      if (columns) q.columns = columns
      return q
    }
    return queryFor(report, summary, columns)
  }

  const openAttendance = (viewId: string, patch: FilterState = {}) => {
    const view = ATTENDANCE_VIEWS.find((item) => item.id === viewId)
    const key = view?.key ?? viewId
    const item = catalog.find((entry) => entry.key === key)
    if (!item) return
    const next = { ...filters, ...patch }
    let from = fromDate
    let to = toDate
    if (view?.preset) {
      const range = rangeForPreset(view.preset)
      from = range.from
      to = range.to
      setFromDate(from)
      setToDate(to)
      setFromTime('')
      setToTime('')
    }
    setFilters(next)
    setReportKey(key)
    setAttendanceView(view?.id ?? viewId)
    setPickedKeys((keys) => keys.includes(key) ? keys : [...keys, key])
    const query = queryFor(item, false, undefined, next, from, to)
    if (view?.preset) {
      delete query.fromTime
      delete query.toTime
    }
    void generate(query)
  }

  const attendanceBack = () => {
    if (filters.subject) {
      openAttendance(attendanceView, { subject: '' })
      return
    }
    if (filters.student) {
      openAttendance('student', { student: '' })
      return
    }
    if (filters.section) {
      openAttendance('class', { section: '' })
      return
    }
    if (filters.class) openAttendance('school', { class: '' })
  }

  const downloadAttendance = (key: string, format?: 'xlsx' | 'pdf') => {
    const item = catalog.find((entry) => entry.key === key)
    if (!item) return
    if (key === 'student_attendance_history' && !filters.student?.trim()) {
      toast.danger('Choose a student', 'Individual student PDF needs a student name or admission number.')
      return
    }
    void downloadSchoolReport({ ...queryFor(item, false), format, columns: undefined, summary: false })
      .catch((e) => toast.danger(format === 'pdf' ? 'PDF failed' : 'Excel failed', errText(e)))
  }

  const pickedReports = catalog.filter((item) => pickedKeys.includes(item.key))
  const togglePicked = (key: string) => {
    setPickedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])
  }

  const visibleColumns = (result?.columns ?? []).filter((c) => !hidden.includes(c))

  const tableRows = useMemo(() => {
    if (!result) return []
    const q = search.trim().toLowerCase()
    return result.rows
      .map((row) => {
        const rec: Record<string, string> = {}
        result.columns.forEach((c, i) => { rec[c] = row[i] ?? '' })
        return rec
      })
      .filter((row) => !q || visibleColumns.some((c) => (row[c] ?? '').toLowerCase().includes(q)))
  }, [result, search, visibleColumns])

  const columns: Column<Record<string, string>>[] = visibleColumns.map((c) => ({
    key: c,
    label: c,
    sortValue: (row) => {
      const n = Number(row[c])
      return row[c] !== '' && !Number.isNaN(n) ? n : row[c] ?? ''
    },
  }))

  const pickReport = (item: SchoolReportCatalogItem) => {
    setReportKey(item.key)
    setFilters({})
    setEditId(undefined)
    setMailStatus('')
    setResult(null)
    setPickedKeys((keys) => keys.includes(item.key) ? keys : [...keys, item.key])
  }

  const filterBody = (q: SchoolReportQuery) => ({
    className: q.className, section: q.section, student: q.student, teacher: q.teacher,
    employee: q.employee, department: q.department, designation: q.designation, role: q.role,
    gender: q.gender, feeHead: q.feeHead, paymentMode: q.paymentMode, paymentStatus: q.paymentStatus,
    attendanceStatus: q.attendanceStatus, route: q.route, vehicle: q.vehicle,
    subject: q.subject, period: q.period, session: q.session,
  })

  const sendMail = async () => {
    const items = pickedReports
    if (sendingMail) return
    if (!items.length) {
      toast.danger('Pick a report', 'Tick at least one report type.')
      return
    }
    if (!emails.split(/[\s,;]+/).some((item) => item.trim())) {
      toast.danger('Add an email', 'The mail box is used for Send now and for Schedule.')
      return
    }
    setSendingMail(true)
    const notes: string[] = []
    let failed = 0
    try {
      for (const item of items) {
        setMailStatus(`Mail sending… ${item.title}`)
        try {
          const columns = item.key === reportKey ? visibleColumns : undefined
          const rows = await emailSchoolReport(queryFor(item, false, columns), emails.split(/[\s,;]+/), subject, message, format)
          const bad = rows.filter((r) => r.status !== 'sent')
          failed += bad.length
          notes.push(`${item.title}: ${rows.map((r) => `${r.email} ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join(', ') || 'sent'}`)
        } catch (e) {
          failed += 1
          notes.push(`${item.title}: ${errText(e)}`)
        }
      }
      setMailStatus(notes.join(' · '))
      if (failed) toast.danger('Some emails failed', `${failed} not sent`)
      else toast.success('Reports emailed', `${items.length} sent`)
    } finally {
      setSendingMail(false)
    }
  }

  const runScheduleNow = async (id: string) => {
    if (runningId) return
    setRunningId(id)
    setMailStatus('Mail sending…')
    try {
      const rows = await runReportScheduleNow(id)
      const failed = rows.filter((r) => r.status !== 'sent')
      setMailStatus(rows.map((r) => `${r.email}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join(' · ') || 'Mail sent')
      if (failed.length) toast.danger('Run failed', failed.map((r) => `${r.email}: ${r.detail ?? r.status}`).join(', '))
      else toast.success('Report sent', rows.map((r) => r.email).join(', ') || 'No new recipients')
      await showRuns(id)
    } catch (e) {
      setMailStatus('Mail failed')
      toast.danger('Run failed', errText(e))
    } finally {
      setRunningId(null)
    }
  }

  const saveSchedule = async () => {
    const items = editId
      ? catalog.filter((item) => item.key === reportKey)
      : pickedReports
    if (savingSchedule) return
    if (!items.length) {
      toast.danger('Pick a report', 'Tick at least one report type.')
      return
    }
    if (!emails.split(/[\s,;]+/).some((item) => item.trim())) {
      toast.danger('Add an email', 'The mail box is used for Send now and for Schedule.')
      return
    }
    setSavingSchedule(true)
    try {
      const recipients = emails.split(/[\s,;]+/).filter(Boolean)
      for (const item of items) {
        await saveReportSchedule({
          id: editId && item.key === reportKey ? editId : undefined,
          reportKey: item.key,
          frequency,
          sendTime,
          dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
          dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
          format,
          recipients,
          subject, message,
          filters: filterBody(queryFor(item)),
        })
      }
      const count = items.length
      setEditId(undefined)
      toast.success(editId ? 'Schedule updated' : 'Schedules saved', `${count} report${count === 1 ? '' : 's'} · ${frequency} at ${sendTime}`)
      await loadSchedules(items.map((item) => item.key))
    } catch (e) { toast.danger('Could not save schedule', errText(e)) }
    finally { setSavingSchedule(false) }
  }

  const showRuns = async (id: string) => {
    setOpenRuns(id)
    try { setRuns(await listReportScheduleRuns(id)) }
    catch (e) { toast.danger('History unavailable', errText(e)) }
  }

  return (
    <div>
      <PageHead
        title="Reports"
        sub="Open a report, set the dates, then download or schedule it to email"
      />
      <Card style={{ marginTop: 14 }}>
        <CardHead title={attendanceScreen === 'overview' ? 'Attendance Overview' : attendanceScreen === 'register' ? 'Daily Attendance Register' : (report?.title ?? 'Report')} sub={attendanceScreen ? 'Same layout as the attendance screens, with an Excel file of these columns.' : report?.note} icon="doc" />
        <div className="report-filter-grid">
          <Field label="Report type">
            <CompactSelect
              fill
              searchable
              value={reportKey}
              onChange={(value) => {
                if (value === 'attendance_overview' || value === 'attendance_register') {
                  setReportKey(value)
                  setResult(null)
                  return
                }
                const item = catalog.find((reportItem) => reportItem.key === value)
                if (item) pickReport(item)
              }}
              options={reportTypes}
            />
          </Field>
          {!attendanceScreen && reportKey.startsWith('student_attendance') && (
          <div className="col gap8" style={{ gridColumn: '1 / -1' }}>
            <div className="row gap8 wrap">
              {ATTENDANCE_GROUPS.map((group) => (
                <div key={group} className="row gap4 wrap ai-center">
                  <span className="t-xs muted">{group}</span>
                  {ATTENDANCE_VIEWS.filter((view) => view.group === group).map((view) => (
                    <Btn key={view.id} size="sm" variant={attendanceView === view.id ? 'primary' : 'secondary'} onClick={() => openAttendance(view.id)}>
                      {view.label}
                    </Btn>
                  ))}
                </div>
              ))}
            </div>
            <div className="row gap8 wrap">
              {DATE_PRESETS.map((preset) => (
                <Btn key={preset.id} size="sm" variant="secondary" onClick={() => {
                  const range = rangeForPreset(preset.id)
                  setFromDate(range.from)
                  setToDate(range.to)
                  setFromTime('')
                  setToTime('')
                }}>{preset.label}</Btn>
              ))}
            </div>
            <div className="row gap8 wrap ai-center">
              <span className="t-xs muted">School</span>
              {filters.class && <Btn size="sm" variant="secondary" onClick={() => openAttendance('class', { section: '', student: '', subject: '' })}>{filters.class}</Btn>}
              {filters.section && <Btn size="sm" variant="secondary" onClick={() => openAttendance('section', { student: '', subject: '' })}>{filters.section}</Btn>}
              {filters.student && <Btn size="sm" variant="secondary" onClick={() => openAttendance('history')}>{filters.student}</Btn>}
              {filters.subject && <span className="t-xs">{filters.subject}</span>}
              {(filters.class || filters.section || filters.student || filters.subject) && (
                <Btn size="sm" variant="secondary" onClick={attendanceBack}>Back</Btn>
              )}
            </div>
          </div>
          )}
          {!attendanceScreen && (
          <>
            <Field label="From date">
              <Input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setFromTime('') }} />
            </Field>
            <Field label="To date">
              <Input type="date" value={toDate} min={fromDate || undefined} onChange={(e) => { setToDate(e.target.value); setToTime('') }} />
            </Field>
          {(report?.filters ?? []).map((key) => {
            const choices = optionList(key, options, schoolClasses, filters.class ?? '')
            const list = key === 'attendanceStatus' && (report?.key ?? '').startsWith('student_attendance')
              ? attendanceChoices(choices)
              : choices
            const placeholder = key === 'session' ? 'Session name' : key === 'subject' ? 'Subject' : key === 'period' ? 'Period number' : key === 'student' ? 'Name or admission no.' : 'Search'
            return (
            <Field key={key} label={FILTER_LABEL[key] ?? key}>
              {TEXT_FILTERS.has(key)
                ? <Input value={filters[key] ?? ''} placeholder={placeholder} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} />
                : <CompactSelect
                    fill
                    value={filters[key] ?? ''}
                    onChange={(value) => setFilters((current) => ({ ...current, [key]: value, ...(key === 'class' ? { section: '' } : {}) }))}
                    options={[{ value: '', label: 'All' }, ...list.map((item) => ({ value: item, label: item }))]}
                  />}
            </Field>
            )
          })}
          </>
          )}
        </div>
        {!attendanceScreen && (
        <div className="row gap8 jc-end" style={{ marginTop: 12 }}>
          <Btn variant="primary" icon="message" onClick={() => setMailOpen((open) => !open)}>
            {mailOpen ? 'Hide mail' : 'Mail / Schedule'}
          </Btn>
          <Btn variant="secondary" onClick={() => {
            const range = rangeForPreset('month')
            setFromDate(range.from); setToDate(range.to); setFromTime(''); setToTime(''); setFilters({})
            void generate({ reportKey, fromDate: range.from, toDate: range.to })
          }}>Reset</Btn>
          <Btn icon="trend" disabled={loading} onClick={() => void generate(queryOf())}>{loading ? 'Applying…' : reportKey.startsWith('student_attendance') ? 'Apply filters' : 'Generate report'}</Btn>
        </div>
        )}
      </Card>

      {attendanceScreen && (
        <div style={{ marginTop: 14 }}>
          <AttendanceRegister canMark={false} screen={attendanceScreen} />
        </div>
      )}

      {loading && reportKey.startsWith('student_attendance') && !attendanceScreen && (
        <div className="sm-grid-4" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          {Array.from({ length: 6 }, (_, i) => <Card key={i}><Skeleton height={28} /></Card>)}
        </div>
      )}
      {reportError && reportKey.startsWith('student_attendance') && !attendanceScreen && (
        <Card style={{ marginTop: 14 }}>
          <div className="t-sm">{reportError}</div>
          <div style={{ marginTop: 8 }}><Btn size="sm" onClick={() => void generate(queryOf())}>Retry</Btn></div>
        </Card>
      )}

      {result && !attendanceScreen && (
        <>
          {result.reportKey.startsWith('student_attendance') && (
            <div className="col gap12" style={{ marginTop: 14 }}>
              {[{ title: 'Today', data: todaySnap }, { title: `Selected range · ${result.fromDate} to ${result.toDate}`, data: result }].map((panel) => {
                const metrics = panel.data ? attendanceDashboard(panel.data) : null
                return (
                  <div key={panel.title}>
                    <div className="t-sm fw6" style={{ marginBottom: 8 }}>{panel.title}</div>
                    {metrics ? (
                      <div>
                      <div className="sm-grid-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                        {[
                          ['Students', String(metrics.students)],
                          [metrics.studentCounts ? 'Present students' : 'Present days', String(metrics.present)],
                          [metrics.studentCounts ? 'Absent students' : 'Absent days', String(metrics.absent)],
                          [metrics.studentCounts ? 'Students on leave' : 'Leave days', String(metrics.leave)],
                          [metrics.studentCounts ? 'Late students' : 'Late days', String(metrics.late)],
                          ['Attendance %', `${metrics.pct}%`],
                          ['Marking completion', `${metrics.completion}%`],
                          ['Below 75%', String(metrics.below)],
                          ['Classes pending', String(metrics.pendingClasses)],
                        ].map(([label, value]) => (
                          <Card key={label}>
                            <div className="t-xs muted">{label}</div>
                            <div className="t-lg fw7">{value}</div>
                          </Card>
                        ))}
                      </div>
                      <Card style={{ marginTop: 8 }}>
                        <HBars data={[
                          { label: metrics.studentCounts ? 'Present' : 'Present days', value: metrics.present },
                          { label: metrics.studentCounts ? 'Absent' : 'Absent days', value: metrics.absent },
                          { label: metrics.studentCounts ? 'Leave' : 'Leave days', value: metrics.leave },
                          { label: metrics.studentCounts ? 'Late' : 'Late days', value: metrics.late },
                        ]} />
                      </Card>
                      </div>
                    ) : (
                      <div className="t-sm muted">This view is the daily detail. The totals above use the monthly summary, where each student is counted once.</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="sm-grid-4" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {result.cards.map((c) => (
              <Card key={c.label}>
                <div className="t-xs muted">{c.label}</div>
                <div className="t-lg fw7">{c.value}</div>
              </Card>
            ))}
          </div>
          {reportPies(result).length > 0 && (
            <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {reportPies(result).map((pie) => (
                <Card key={pie.title}>
                  <CardHead title={pie.title} sub={pie.total ? `${pie.total} in this report` : 'No rows in this report'} />
                  <div className="row ai-center gap16 wrap" style={{ marginTop: 12 }}>
                    <Donut
                      segments={pie.segments}
                      size={148}
                      thickness={18}
                      center={<div style={{ textAlign: 'center' }}><div className="t-lg fw7">{pie.total}</div></div>}
                    />
                    <Legend items={pie.segments.map((slice) => ({ color: slice.color, label: pie.total ? `${slice.label} — ${slice.value}` : slice.label }))} />
                  </div>
                </Card>
              ))}
            </div>
          )}
          {result.charts.some((chart) => chart.kind === 'month') && (
            <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {result.charts.filter((chart) => chart.kind === 'month').map((chart) => (
                <Card key={chart.title}>
                  <CardHead title={chart.title} sub={`${result.fromDate} to ${result.toDate}`} />
                  <div style={{ marginTop: 12 }}>
                    <HBars data={chart.points.map((p) => ({ label: p.label, value: Number(p.value) || 0 }))} />
                  </div>
                </Card>
              ))}
            </div>
          )}
          <Card pad={false} style={{ marginTop: 14 }}>
            <CardHead
              title={result.title}
              sub={`${result.schoolName} · ${result.fromDate} to ${result.toDate} · ${result.filters}`}
              action={
                <div className="row gap8 wrap">
                  {result.reportKey.startsWith('student_attendance') ? (
                    <>
                      <Btn size="sm" variant="secondary" icon="download" onClick={() => downloadAttendance('student_attendance')}>Excel detailed</Btn>
                      <Btn size="sm" variant="secondary" icon="download" onClick={() => downloadAttendance('student_attendance_summary')}>Excel summary</Btn>
                      <Btn size="sm" variant="secondary" icon="doc" onClick={() => downloadAttendance('student_attendance', 'pdf')}>PDF detailed</Btn>
                      <Btn size="sm" variant="secondary" icon="doc" onClick={() => downloadAttendance('student_attendance_summary', 'pdf')}>PDF summary</Btn>
                      <Btn size="sm" variant="secondary" icon="doc" onClick={() => downloadAttendance('student_attendance_history', 'pdf')}>Individual student PDF</Btn>
                      <Btn size="sm" variant="secondary" icon="doc" onClick={() => downloadAttendance('student_attendance_class', 'pdf')}>Class-wise PDF</Btn>
                    </>
                  ) : (
                    <>
                      <Btn size="sm" variant="secondary" icon="download" onClick={() => void downloadSchoolReport(queryOf(false, visibleColumns)).catch((e) => toast.danger('Excel failed', errText(e)))}>Excel detailed</Btn>
                      <Btn size="sm" variant="secondary" icon="download" onClick={() => void downloadSchoolReport({ ...queryOf(true, visibleColumns), summary: true }).catch((e) => toast.danger('Excel failed', errText(e)))}>Excel summary</Btn>
                      <Btn size="sm" variant="secondary" icon="doc" onClick={() => void downloadSchoolReport({ ...queryOf(false, visibleColumns), format: 'pdf' }).catch((e) => toast.danger('PDF failed', errText(e)))}>PDF</Btn>
                    </>
                  )}
                  <Btn size="sm" variant="secondary" icon="doc" onClick={() => void printSchoolReport(queryOf(false, visibleColumns)).catch((e) => toast.danger('Print failed', errText(e)))}>Print</Btn>
                  <Btn size="sm" variant="primary" icon="message" onClick={() => setMailOpen((open) => !open)}>{mailOpen ? 'Hide mail' : 'Mail / Schedule'}</Btn>
                </div>
              }
            />
            <div className="row ai-center gap12 wrap" style={{ padding: '12px 16px' }}>
              <Search value={search} onChange={setSearch} placeholder="Search this report" />
              <details>
                <summary className="t-sm" style={{ cursor: 'pointer' }}>Columns</summary>
                <div className="row gap8 wrap" style={{ marginTop: 8 }}>
                  {result.columns.map((c) => (
                    <label key={c} className="t-xs row ai-center gap4">
                      <input type="checkbox" checked={!hidden.includes(c)} onChange={() => setHidden((h) => h.includes(c) ? h.filter((x) => x !== c) : [...h, c])} />
                      {c}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            {result.reportKey.startsWith('student_attendance') && result.rows.length === 0 ? (
              <div className="t-sm muted" style={{ padding: 16 }}>{attendanceEmptyMessage(result.reportKey, filters.student ?? '')}</div>
            ) : (
              <DataTable
                columns={columns}
                rows={tableRows}
                pageSize={20}
                rowKey={(_, i) => i}
                onRowClick={result.reportKey.startsWith('student_attendance') && result.reportKey !== 'student_attendance_marking' && result.reportKey !== 'student_attendance_pending' ? (row) => {
                  const student = row['Admission No.'] || row['Student Name'] || ''
                  const subject = row.Subject ?? ''
                  if (result.reportKey === 'student_attendance_class' || result.reportKey === 'student_attendance_lowest' || result.reportKey === 'student_attendance_compare') {
                    openAttendance('student', { class: row.Class ?? '', section: row.Section ?? '' })
                    return
                  }
                  if (result.reportKey === 'student_attendance_subject' || result.reportKey === 'student_attendance_period') {
                    openAttendance('by-subject', { class: row.Class ?? '', section: row.Section ?? '', subject })
                    return
                  }
                  if (result.reportKey === 'student_attendance_by_subject' || result.reportKey === 'student_attendance' || result.reportKey === 'student_attendance_history') {
                    if (student) openAttendance(result.reportKey === 'student_attendance_by_subject' ? 'detail' : 'by-subject', { student, subject })
                    return
                  }
                  if (student) openAttendance('history', { student })
                } : undefined}
              />
            )}
          </Card>
        </>
      )}

      {mailOpen && <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <Card>
          <CardHead title="Email these reports" sub="Sends every ticked report for the dates above to this mail id. Schedule uses the same mail id." icon="message" />
          <div style={{ marginTop: 12 }} className="col gap12">
            <Field label="Mail id">
              <Textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@school.com, another@school.com" />
            </Field>
            <Field label="Report type">
              <ReportTypeChecks
                catalog={catalog}
                pickedKeys={pickedKeys}
                onToggle={togglePicked}
                onToggleAll={() => setPickedKeys(pickedKeys.length === catalog.length ? [] : catalog.map((item) => item.key))}
              />
            </Field>
            <DateRangeFields
              fromDate={fromDate}
              toDate={toDate}
              onFrom={(date) => { setFromDate(date); setFromTime('') }}
              onTo={(date) => { setToDate(date); setToTime('') }}
            />
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="School name and report title" /></Field>
            <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional note" /></Field>
            <Field label="File">
              <Select value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'pdf', label: 'PDF' }]} />
            </Field>
            <div className="t-xs muted">
              To: {emails.trim() || 'Enter a mail id above'} · Reports: {pickedReports.length ? pickedReports.map((item) => item.title).join(', ') : 'Tick the reports to send'} · From {fromDate || '—'} to {toDate || '—'} · Class: {filters.class?.trim() || 'All'} · Section: {filters.section?.trim() || 'All'}
            </div>
            <div className="row jc-end">
              <Btn icon="message" disabled={sendingMail} onClick={() => void sendMail()}>
                {sendingMail ? 'Mail sending…' : pickedReports.length > 1 ? `Send ${pickedReports.length} reports` : 'Send now'}
              </Btn>
            </div>
            {mailStatus && <div className="t-sm">{mailStatus}</div>}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Schedule email"
            sub="Uses the mail id in Email these reports. Daily sends yesterday, weekly the last 7 days, 15 days the last 15 days, and monthly the previous month."
            icon="calendar"
          />
          <div style={{ marginTop: 12 }} className="col gap12">
            <Field label="Mail id">
              <Textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@school.com, another@school.com" />
            </Field>
            <Field label="Report type">
              <ReportTypeChecks
                catalog={catalog}
                pickedKeys={pickedKeys}
                onToggle={togglePicked}
                onToggleAll={() => setPickedKeys(pickedKeys.length === catalog.length ? [] : catalog.map((item) => item.key))}
              />
            </Field>
            <Field label="How often">
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)} options={FREQUENCIES} />
            </Field>
            <Field label="Send time"><Input type="time" value={sendTime} onChange={(e) => setSendTime(e.target.value)} /></Field>
            {frequency === 'weekly' && (
              <Field label="Weekday">
                <Select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} options={WEEKDAYS.map((label, i) => ({ value: String(i), label }))} />
              </Field>
            )}
            {frequency === 'monthly' && (
              <Field label="Day of month"><Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} /></Field>
            )}
            <div className="t-xs muted">
              To: {emails.trim() || 'Enter a mail id above'} · Reports: {pickedReports.length ? pickedReports.map((item) => item.title).join(', ') : 'Tick the reports to schedule'} · {frequencyLabel(frequency)} · Class: {filters.class?.trim() || 'All'} · Section: {filters.section?.trim() || 'All'}. Each ticked report gets its own schedule.
            </div>
            <div className="row jc-end gap8">
              {editId && <Btn variant="secondary" onClick={() => setEditId(undefined)}>Cancel edit</Btn>}
              <Btn disabled={savingSchedule} onClick={() => void saveSchedule()}>
                {savingSchedule ? 'Saving…' : editId ? 'Update schedule' : pickedReports.length > 1 ? `Schedule ${pickedReports.length} reports` : 'Create schedule'}
              </Btn>
            </div>
          </div>
        </Card>
      </div>}

      {mailOpen && <Card pad={false} style={{ marginTop: 14 }}>
        <CardHead title="Saved schedules" sub={pickedReports.map((item) => item.title).join(', ') || report?.title} icon="clock" />
        {schedules.length === 0 && <div className="t-sm muted" style={{ padding: 16 }}>No schedule for the ticked reports yet.</div>}
        {schedules.map((s) => (
          <div key={s.id} style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div className="row ai-center gap8 wrap">
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="fw6">{s.title || report?.title} · {frequencyLabel(s.frequency)} at {s.sendTime} · {s.format.toUpperCase()}</div>
                <div className="t-xs muted">{scheduleScope(s.filtersJson)} · {s.recipients}</div>
                <div className="t-xs muted">Next {s.status === 'paused' ? 'paused' : new Date(s.nextRunAt).toLocaleString()}</div>
              </div>
              <Badge tone={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Badge>
              <Btn size="sm" variant="secondary" onClick={() => {
                setEditId(s.id); setReportKey(s.reportKey); setFrequency(s.frequency); setSendTime(s.sendTime); setFormat(s.format === 'pdf' ? 'pdf' : 'xlsx')
                setEmails(s.recipients); setSubject(s.subject ?? ''); setMessage(s.message ?? '')
                setPickedKeys((keys) => keys.includes(s.reportKey) ? keys : [...keys, s.reportKey])
                if (s.dayOfWeek != null) setDayOfWeek(String(s.dayOfWeek))
                if (s.dayOfMonth != null) setDayOfMonth(String(s.dayOfMonth))
              }}>Edit</Btn>
              {s.status === 'active'
                ? <Btn size="sm" variant="secondary" onClick={() => void pauseReportSchedule(s.id).then(() => loadSchedules(pickedKeys.length ? pickedKeys : [s.reportKey]))}>Pause</Btn>
                : <Btn size="sm" variant="secondary" onClick={() => void resumeReportSchedule(s.id).then(() => loadSchedules(pickedKeys.length ? pickedKeys : [s.reportKey]))}>Resume</Btn>}
              <Btn size="sm" disabled={runningId === s.id} onClick={() => void runScheduleNow(s.id)}>{runningId === s.id ? 'Mail sending…' : 'Run now'}</Btn>
              <Btn size="sm" variant="secondary" onClick={() => void showRuns(s.id)}>History</Btn>
            </div>
            {openRuns === s.id && (
              <div className="col gap4" style={{ marginTop: 8 }}>
                {runs.length === 0 && <div className="t-xs muted">No runs yet.</div>}
                {runs.map((r) => (
                  <div key={r.id} className="t-xs">
                    {new Date(r.startedAt).toLocaleString()} · {r.status}
                    {r.fromDate ? ` · ${String(r.fromDate).slice(0, 10)} to ${String(r.toDate ?? '').slice(0, 10)}` : ''}
                    {r.detail ? ` · ${r.detail}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>}
    </div>
  )
}
