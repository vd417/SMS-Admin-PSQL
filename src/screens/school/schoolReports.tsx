import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { ApiError } from '@/api/client'
import {
  downloadSchoolReport, emailSchoolReport, listReportScheduleRuns, listReportSchedules,
  listSchoolReportCatalog, pauseReportSchedule, printSchoolReport, resumeReportSchedule,
  runReportScheduleNow, runSchoolReport, saveReportSchedule, schoolReportOptions,
  type SchoolReportCatalogItem, type SchoolReportOptions, type SchoolReportQuery,
  type SchoolReportResult, type SchoolReportRun, type SchoolReportSchedule,
} from '@/api/schoolReports'
import { rangeForPreset } from '@/lib/reportRange'
import { listClasses, type SchoolClass } from '@/api/classes'
import { can } from '@/lib/gating'
import { AttendanceRegister } from './attendanceRegister'
import { HBars, Donut, Legend } from '@/components/charts/Charts'
import {
  PageHead, Card, CardHead, Btn, Badge, Search, Select, Field, Input, Textarea, DataTable, Icon,
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
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const picked = catalog.filter((item) => pickedKeys.includes(item.key))
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
          position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, width,
          maxHeight: 280, overflowY: 'auto', background: 'var(--surface)',
          border: '1px solid var(--border-2)', borderRadius: 8, boxShadow: '0 8px 20px rgba(15, 23, 42, .12)',
          padding: '6px 8px',
        }}>
          <label className="t-sm row ai-center gap4" style={{ cursor: 'pointer', padding: '4px 2px' }}>
            <input type="checkbox" checked={catalog.length > 0 && pickedKeys.length === catalog.length} onChange={() => { onToggleAll(); setOpen(false) }} />
            All reports
          </label>
          {TABS.map((group) => {
            const items = catalog.filter((item) => item.tab === group.value)
            if (!items.length) return null
            return (
              <div key={group.value}>
                <div className="t-xs muted" style={{ marginTop: 6 }}>{group.label}</div>
                {items.map((item) => (
                  <label key={item.key} className="t-sm row ai-center gap4" style={{ cursor: 'pointer', padding: '3px 2px' }}>
                    <input type="checkbox" checked={pickedKeys.includes(item.key)} onChange={() => { onToggle(item.key); setOpen(false) }} />
                    {item.title}
                  </label>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function DateRangeFields({ fromDate, fromTime, toDate, toTime, onFrom, onTo }: {
  fromDate: string
  fromTime: string
  toDate: string
  toTime: string
  onFrom: (date: string, time: string) => void
  onTo: (date: string, time: string) => void
}) {
  return (
    <div className="row gap12 wrap">
      <div style={{ width: 220 }}>
        <Field label="From date">
          <Input
            type="datetime-local"
            value={fromDate ? `${fromDate}T${fromTime || '00:00'}` : ''}
            onChange={(e) => {
              const [date, time] = e.target.value.split('T')
              onFrom(date ?? '', (time ?? '').slice(0, 5))
            }}
          />
        </Field>
      </div>
      <div style={{ width: 220 }}>
        <Field label="To date">
          <Input
            type="datetime-local"
            value={toDate ? `${toDate}T${toTime || '00:00'}` : ''}
            onChange={(e) => {
              const [date, time] = e.target.value.split('T')
              onTo(date ?? '', (time ?? '').slice(0, 5))
            }}
          />
        </Field>
      </div>
    </div>
  )
}

function CompactSelect({ value, onChange, options, width = 200 }: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const label = options.find((option) => option.value === value)?.label ?? 'All'
  return (
    <div ref={box} style={{ position: 'relative', width }}>
      <button type="button" className="sm-input" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen((current) => !current)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <Icon name="chevDown" size={16} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', zIndex: 40, top: 'calc(100% + 4px)', left: 0, width,
          maxHeight: 240, overflowY: 'auto', background: 'var(--surface)',
          border: '1px solid var(--border-2)', borderRadius: 8, boxShadow: '0 8px 20px rgba(15, 23, 42, .12)',
        }}>
          {options.map((option) => (
            <button
              key={option.value || 'all'}
              type="button"
              className="sm-menu-item"
              onClick={() => { onChange(option.value); setOpen(false) }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function SchoolReportsScreen() {
  const toast = useToast()
  const app = useApp()
  const canMarkAttendance = app.role === 'owner' || app.role === 'admin' || app.role === 'principal' || app.role === 'vice_principal' || can(app.role, 'attendance', 'E')
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

  const report = catalog.find((c) => c.key === reportKey) ?? null
  const reportTypes = TABS.flatMap((group) => {
    const items = catalog
      .filter((item) => item.tab === group.value)
      .map((item) => ({ value: item.key, label: `${group.label} · ${item.title}` }))
    if (group.value === 'attendance') {
      items.push(
        { value: 'attendance_overview', label: 'Attendance Reports · Attendance Overview' },
        { value: 'attendance_register', label: 'Attendance Reports · Daily Attendance Register' },
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
      const data = await runSchoolReport(query)
      setResult(data)
      setHidden([])
      setSearch('')
    } catch (e) {
      toast.danger('Report failed', errText(e))
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

  const queryFor = (item: SchoolReportCatalogItem, summary = false, columns?: string[]): SchoolReportQuery => {
    const q: SchoolReportQuery = { reportKey: item.key, fromDate, toDate, summary }
    if (fromTime) q.fromTime = fromTime
    if (toTime) q.toTime = toTime
    if (columns) q.columns = columns
    for (const key of item.filters) {
      const raw = filters[key]?.trim()
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
        <div className="row gap12 wrap" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          <Field label="Report type">
            <CompactSelect
              width={280}
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
          {!attendanceScreen && (
          <>
          <div style={{ width: 220 }}>
            <Field label="From date">
              <Input
                type="datetime-local"
                value={fromDate ? `${fromDate}T${fromTime || '00:00'}` : ''}
                onChange={(e) => {
                  const [date, time] = e.target.value.split('T')
                  setFromDate(date ?? '')
                  setFromTime((time ?? '').slice(0, 5))
                }}
              />
            </Field>
          </div>
          <div style={{ width: 220 }}>
            <Field label="To date">
              <Input
                type="datetime-local"
                value={toDate ? `${toDate}T${toTime || '00:00'}` : ''}
                onChange={(e) => {
                  const [date, time] = e.target.value.split('T')
                  setToDate(date ?? '')
                  setToTime((time ?? '').slice(0, 5))
                }}
              />
            </Field>
          </div>
          {(report?.filters ?? []).map((key) => {
            const choices = optionList(key, options, schoolClasses, filters.class ?? '')
            const list = key === 'attendanceStatus' && (report?.key ?? '').startsWith('student_attendance')
              ? attendanceChoices(choices)
              : choices
            const placeholder = key === 'session' ? 'Session name' : key === 'subject' ? 'Subject' : key === 'period' ? 'Period number' : key === 'student' ? 'Name or admission no.' : 'Search'
            return (
            <Field key={key} label={FILTER_LABEL[key] ?? key}>
              {TEXT_FILTERS.has(key)
                ? <Input value={filters[key] ?? ''} placeholder={placeholder} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} style={{ width: 200 }} />
                : <CompactSelect
                    value={filters[key] ?? ''}
                    onChange={(value) => setFilters((current) => ({ ...current, [key]: value }))}
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
          <Btn icon="trend" disabled={loading} onClick={() => void generate(queryOf())}>{loading ? 'Generating…' : 'Generate report'}</Btn>
        </div>
        )}
      </Card>

      {attendanceScreen && (
        <div style={{ marginTop: 14 }}>
          <AttendanceRegister canMark={canMarkAttendance} screen={attendanceScreen} />
        </div>
      )}

      {result && !attendanceScreen && (
        <>
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
              <DataTable columns={columns} rows={tableRows} pageSize={20} rowKey={(_, i) => i} />
            )}
          </Card>
        </>
      )}

      {mailOpen && <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <Card>
          <CardHead title="Email these reports" sub="Sends every ticked report for the dates above to the email in Schedule" icon="message" />
          <div style={{ marginTop: 12 }} className="col gap12">
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
              fromTime={fromTime}
              toDate={toDate}
              toTime={toTime}
              onFrom={(date, time) => { setFromDate(date); setFromTime(time) }}
              onTo={(date, time) => { setToDate(date); setToTime(time) }}
            />
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="School name and report title" /></Field>
            <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional note" /></Field>
            <Field label="File">
              <Select value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'pdf', label: 'PDF' }]} />
            </Field>
            <div className="t-xs muted">
              To: {emails.trim() || 'Add an email in the mail box'} · Reports: {pickedReports.length ? pickedReports.map((item) => item.title).join(', ') : 'Tick the reports to send'} · From {fromDate || '—'} to {toDate || '—'} · Class: {filters.class?.trim() || 'All'} · Section: {filters.section?.trim() || 'All'}
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
            sub="One mail box for Send now and for Schedule. Daily sends yesterday, weekly the last 7 days, 15 days the last 15 days, and monthly the previous month."
            icon="calendar"
          />
          <div style={{ marginTop: 12 }} className="col gap12">
            <Field label="Email">
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
              To: {emails.trim() || 'Add an email in the mail box'} · Reports: {pickedReports.length ? pickedReports.map((item) => item.title).join(', ') : 'Tick the reports to schedule'} · {frequencyLabel(frequency)} · Class: {filters.class?.trim() || 'All'} · Section: {filters.section?.trim() || 'All'}. Each ticked report gets its own schedule.
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
