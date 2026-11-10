import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { HBars } from '@/components/charts/Charts'
import {
  PageHead, Tabs, Card, CardHead, Btn, Badge, Search, Select, Field, Input, Textarea, DataTable,
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

const PRESETS: { id: ReportPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'lastMonth', label: 'Last Month' },
  { id: 'year', label: 'This Year' },
]

const FILTER_LABEL: Record<string, string> = {
  class: 'Class', section: 'Section', student: 'Student', teacher: 'Teacher', employee: 'Employee',
  department: 'Department', designation: 'Designation', role: 'Role', gender: 'Gender',
  feeHead: 'Fee head', paymentMode: 'Payment mode', paymentStatus: 'Payment status',
  attendanceStatus: 'Attendance', route: 'Route', vehicle: 'Vehicle',
}

const TEXT_FILTERS = new Set(['student', 'teacher', 'employee'])
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

function optionList(key: string, options: SchoolReportOptions): string[] {
  switch (key) {
    case 'class': return options.classes
    case 'section': return options.sections
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

function genderValue(label: string): string {
  if (label === 'Male') return 'M'
  if (label === 'Female') return 'F'
  if (label === 'Other') return 'O'
  return label
}

export function SchoolReportsScreen() {
  const toast = useToast()
  const initial = rangeForPreset('month')
  const [catalog, setCatalog] = useState<SchoolReportCatalogItem[]>([])
  const [options, setOptions] = useState<SchoolReportOptions>(emptyOptions)
  const [tab, setTab] = useState('student')
  const [reportKey, setReportKey] = useState('student')
  const [preset, setPreset] = useState<ReportPreset>('month')
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

  const report = catalog.find((c) => c.key === reportKey) ?? null
  const inTab = catalog.filter((c) => c.tab === tab)

  const loadSchedules = useCallback(async (key: string) => {
    try { setSchedules(await listReportSchedules(key)) }
    catch { setSchedules([]) }
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
        const [items, opts] = await Promise.all([listSchoolReportCatalog(), schoolReportOptions()])
        if (!live) return
        setCatalog(items)
        setOptions(opts)
        const first = items.find((i) => i.tab === 'student') ?? items[0]
        if (first) {
          setReportKey(first.key)
          const range = rangeForPreset('month')
          await generate({ reportKey: first.key, fromDate: range.from, toDate: range.to })
          await loadSchedules(first.key)
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

  const queryOf = (summary = false, columns?: string[]): SchoolReportQuery => {
    const q: SchoolReportQuery = { reportKey, fromDate, toDate, summary }
    if (fromTime) q.fromTime = fromTime
    if (toTime) q.toTime = toTime
    if (columns) q.columns = columns
    for (const key of report?.filters ?? []) {
      const raw = filters[key]?.trim()
      if (!raw) continue
      const value = key === 'gender' ? genderValue(raw) : raw
      if (key === 'class') q.className = value
      else if (key === 'feeHead') q.feeHead = value
      else if (key === 'paymentMode') q.paymentMode = value
      else if (key === 'paymentStatus') q.paymentStatus = value
      else if (key === 'attendanceStatus') q.attendanceStatus = value
      else (q as Record<string, string>)[key] = value
    }
    return q
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
    setTab(item.tab)
    setFilters({})
    setEditId(undefined)
    setMailStatus('')
    const range = rangeForPreset(preset === 'custom' ? 'month' : preset)
    if (preset !== 'custom') { setFromDate(range.from); setToDate(range.to) }
    void generate({ reportKey: item.key, fromDate: preset === 'custom' ? fromDate : range.from, toDate: preset === 'custom' ? toDate : range.to })
    void loadSchedules(item.key)
  }

  const applyPreset = (id: ReportPreset) => {
    setPreset(id)
    if (id === 'custom') return
    const range = rangeForPreset(id)
    setFromDate(range.from)
    setToDate(range.to)
  }

  const savedFilters = () => {
    const q = queryOf()
    return {
      className: q.className, section: q.section, student: q.student, teacher: q.teacher,
      employee: q.employee, department: q.department, designation: q.designation, role: q.role,
      gender: q.gender, feeHead: q.feeHead, paymentMode: q.paymentMode, paymentStatus: q.paymentStatus,
      attendanceStatus: q.attendanceStatus, route: q.route, vehicle: q.vehicle,
    }
  }

  const sendMail = async () => {
    try {
      const rows = await emailSchoolReport(queryOf(false, visibleColumns), emails.split(/[\s,;]+/), subject, message, format)
      const failed = rows.filter((r) => r.status !== 'sent')
      setMailStatus(rows.map((r) => `${r.email}: ${r.status}${r.detail ? ` (${r.detail})` : ''}`).join(' · '))
      if (failed.length) toast.danger('Some emails failed', failed.map((r) => r.email).join(', '))
      else toast.success('Report emailed', `${rows.length} sent`)
    } catch (e) { toast.danger('Email failed', errText(e)) }
  }

  const saveSchedule = async () => {
    try {
      await saveReportSchedule({
        id: editId,
        reportKey,
        frequency,
        sendTime,
        dayOfWeek: frequency === 'weekly' ? Number(dayOfWeek) : null,
        dayOfMonth: frequency === 'monthly' ? Number(dayOfMonth) : null,
        format,
        recipients: emails.split(/[\s,;]+/).filter(Boolean),
        subject, message,
        filters: savedFilters(),
      })
      setEditId(undefined)
      toast.success(editId ? 'Schedule updated' : 'Schedule saved', `${report?.title ?? 'Report'} · ${frequency} at ${sendTime}`)
      await loadSchedules(reportKey)
    } catch (e) { toast.danger('Could not save schedule', errText(e)) }
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
      <Tabs value={tab} onChange={(value) => {
        setTab(value)
        const first = catalog.find((c) => c.tab === value)
        if (first) pickReport(first)
      }} tabs={TABS.map((t) => ({ ...t, count: catalog.filter((c) => c.tab === t.value).length }))} />

      <div className="row gap8 wrap" style={{ marginTop: 14 }}>
        {inTab.map((item) => (
          <Btn key={item.key} size="sm" variant={item.key === reportKey ? 'primary' : 'secondary'} onClick={() => pickReport(item)}>
            {item.title}
          </Btn>
        ))}
      </div>

      <Card style={{ marginTop: 14 }}>
        <CardHead title={report?.title ?? 'Report'} sub={report?.note} icon="doc" />
        <div className="row gap8 wrap" style={{ marginTop: 12 }}>
          {PRESETS.map((p) => (
            <Btn key={p.id} size="sm" variant={preset === p.id ? 'primary' : 'secondary'} onClick={() => applyPreset(p.id)}>{p.label}</Btn>
          ))}
          <Btn size="sm" variant={preset === 'custom' ? 'primary' : 'secondary'} onClick={() => setPreset('custom')}>Custom</Btn>
        </div>
        <div className="sm-grid-4" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <Field label="From date"><Input type="date" value={fromDate} onChange={(e) => { setPreset('custom'); setFromDate(e.target.value) }} /></Field>
          <Field label="To date"><Input type="date" value={toDate} onChange={(e) => { setPreset('custom'); setToDate(e.target.value) }} /></Field>
          <Field label="From time"><Input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} /></Field>
          <Field label="To time"><Input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} /></Field>
          {(report?.filters ?? []).map((key) => (
            <Field key={key} label={FILTER_LABEL[key] ?? key}>
              {TEXT_FILTERS.has(key)
                ? <Input value={filters[key] ?? ''} placeholder="Search" onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))} />
                : <Select
                    value={filters[key] ?? ''}
                    onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
                    options={[{ value: '', label: 'All' }, ...optionList(key, options).map((v) => ({ value: v, label: v }))]}
                  />}
            </Field>
          ))}
        </div>
        <div className="row gap8 jc-end" style={{ marginTop: 12 }}>
          <Btn variant="secondary" onClick={() => {
            const range = rangeForPreset('month')
            setPreset('month'); setFromDate(range.from); setToDate(range.to); setFromTime(''); setToTime(''); setFilters({})
            void generate({ reportKey, fromDate: range.from, toDate: range.to })
          }}>Reset</Btn>
          <Btn icon="trend" disabled={loading} onClick={() => void generate(queryOf())}>{loading ? 'Generating…' : 'Generate report'}</Btn>
        </div>
      </Card>

      {result && (
        <>
          <div className="sm-grid-4" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            {result.cards.map((c) => (
              <Card key={c.label}>
                <div className="t-xs muted">{c.label}</div>
                <div className="t-lg fw7">{c.value}</div>
              </Card>
            ))}
          </div>
          {result.charts.length > 0 && (
            <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              {result.charts.map((chart) => (
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
                  <Btn size="sm" variant="secondary" icon="download" onClick={() => void downloadSchoolReport(queryOf(false, visibleColumns)).catch((e) => toast.danger('Excel failed', errText(e)))}>Excel detailed</Btn>
                  <Btn size="sm" variant="secondary" icon="download" onClick={() => void downloadSchoolReport({ ...queryOf(true, visibleColumns), summary: true }).catch((e) => toast.danger('Excel failed', errText(e)))}>Excel summary</Btn>
                  <Btn size="sm" variant="secondary" icon="doc" onClick={() => void downloadSchoolReport({ ...queryOf(false, visibleColumns), format: 'pdf' }).catch((e) => toast.danger('PDF failed', errText(e)))}>PDF</Btn>
                  <Btn size="sm" variant="secondary" icon="doc" onClick={() => void printSchoolReport(queryOf(false, visibleColumns)).catch((e) => toast.danger('Print failed', errText(e)))}>Print</Btn>
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
            <DataTable columns={columns} rows={tableRows} pageSize={20} rowKey={(_, i) => i} />
          </Card>
        </>
      )}

      <div className="sm-grid-2" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', alignItems: 'start' }}>
        <Card>
          <CardHead title="Email this report" sub="Sends the open report for the dates above" icon="message" />
          <div style={{ marginTop: 12 }} className="col gap12">
            <Field label="Emails"><Textarea value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="one or more, separated by commas" /></Field>
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="School name and report title" /></Field>
            <Field label="Message"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Optional note" /></Field>
            <Field label="File">
              <Select value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'pdf')} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'pdf', label: 'PDF' }]} />
            </Field>
            <div className="row jc-end"><Btn icon="message" onClick={() => void sendMail()}>Send now</Btn></div>
            {mailStatus && <div className="t-sm">{mailStatus}</div>}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Schedule email"
            sub="Daily sends yesterday. Weekly sends the previous 7 days. Monthly sends the previous month."
            icon="calendar"
          />
          <div style={{ marginTop: 12 }} className="col gap12">
            <Field label="How often">
              <Select value={frequency} onChange={(e) => setFrequency(e.target.value)} options={['daily', 'weekly', 'monthly'].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))} />
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
            <div className="t-xs muted">Uses the emails, subject, message, file type, and filters above. Dates roll forward each run.</div>
            <div className="row jc-end gap8">
              {editId && <Btn variant="secondary" onClick={() => setEditId(undefined)}>Cancel edit</Btn>}
              <Btn onClick={() => void saveSchedule()}>{editId ? 'Update schedule' : 'Create schedule'}</Btn>
            </div>
          </div>
        </Card>
      </div>

      <Card pad={false} style={{ marginTop: 14 }}>
        <CardHead title="Saved schedules" sub={report?.title} icon="clock" />
        {schedules.length === 0 && <div className="t-sm muted" style={{ padding: 16 }}>No schedule for this report yet.</div>}
        {schedules.map((s) => (
          <div key={s.id} style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <div className="row ai-center gap8 wrap">
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="fw6">{s.frequency} at {s.sendTime} · {s.format.toUpperCase()}</div>
                <div className="t-xs muted">{s.recipients}</div>
                <div className="t-xs muted">Next {s.status === 'paused' ? 'paused' : new Date(s.nextRunAt).toLocaleString()}</div>
              </div>
              <Badge tone={s.status === 'active' ? 'success' : 'warning'}>{s.status}</Badge>
              <Btn size="sm" variant="secondary" onClick={() => {
                setEditId(s.id); setFrequency(s.frequency); setSendTime(s.sendTime); setFormat(s.format === 'pdf' ? 'pdf' : 'xlsx')
                setEmails(s.recipients); setSubject(s.subject ?? ''); setMessage(s.message ?? '')
                if (s.dayOfWeek != null) setDayOfWeek(String(s.dayOfWeek))
                if (s.dayOfMonth != null) setDayOfMonth(String(s.dayOfMonth))
              }}>Edit</Btn>
              {s.status === 'active'
                ? <Btn size="sm" variant="secondary" onClick={() => void pauseReportSchedule(s.id).then(() => loadSchedules(reportKey))}>Pause</Btn>
                : <Btn size="sm" variant="secondary" onClick={() => void resumeReportSchedule(s.id).then(() => loadSchedules(reportKey))}>Resume</Btn>}
              <Btn size="sm" onClick={() => void runReportScheduleNow(s.id).then((rows) => {
                const failed = rows.filter((r) => r.status !== 'sent')
                if (failed.length) toast.danger('Run failed', failed.map((r) => `${r.email}: ${r.detail ?? r.status}`).join(', '))
                else toast.success('Report sent', rows.map((r) => r.email).join(', ') || 'No new recipients')
                void showRuns(s.id)
              }).catch((e) => toast.danger('Run failed', errText(e)))}>Run now</Btn>
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
      </Card>
    </div>
  )
}
