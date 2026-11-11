/* Attendance Overview and the daily P/A/L register. Uses the class attendance API. */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  Avatar, Badge, Btn, Card, Empty, Icon, Input, Modal, Search, Segmented, Select,
  type BadgeTone,
} from '@/components/ui'
import { useClasses } from '@/api/hooks/useClasses'
import { useStudents } from '@/api/hooks/useStudents'
import {
  listClassAttendanceRange, saveAttendance, attendanceCalendarDate,
  type AttendanceRecord, type AttendanceStatus,
} from '@/api/attendance'
import { studentMatchesClass } from '@/lib/classMatch'
import { useApp, useToast } from '@/lib/hooks'
import { downloadTextFile } from '@/lib/feeExport'
import { openReportPdf, type CellColor, type ReportMeta } from '@/lib/reportExport'
import {
  downloadSheet, overviewToCsv,
  type AttendanceSummaryStudent,
} from '@/lib/attendanceExport'
import type { Student } from '@/types'

type View = 'overview' | 'register'
type Perf = { label: string; tone: BadgeTone }

const PAGE = 8
const LETTER: Record<AttendanceStatus, { text: string; bg: string; color: string }> = {
  present: { text: 'P', bg: '#22C55E', color: '#fff' },
  absent: { text: 'A', bg: '#EF4444', color: '#fff' },
  late: { text: 'L', bg: '#F59E0B', color: '#fff' },
  half_day: { text: 'H', bg: '#3B82F6', color: '#fff' },
  pending: { text: 'N', bg: '#64748B', color: '#fff' },
}
const MARK_COLOR: Record<string, CellColor> = {
  P: { bg: '#22C55E', text: '#FFFFFF' },
  A: { bg: '#EF4444', text: '#FFFFFF' },
  L: { bg: '#F59E0B', text: '#FFFFFF' },
  H: { bg: '#3B82F6', text: '#FFFFFF' },
  N: { bg: '#64748B', text: '#FFFFFF' },
  '—': { bg: '#E5E7EB', text: '#6B7280' },
}
const GOOD_COLOR: CellColor = { bg: '#22C55E', text: '#FFFFFF' }
const WARNING_COLOR: CellColor = { bg: '#F59E0B', text: '#FFFFFF' }
const PRESENT_COLOR: CellColor = { bg: '#DCFCE7', text: '#166534' }
const ABSENT_COLOR: CellColor = { bg: '#FEE2E2', text: '#991B1B' }
const CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'half_day', 'pending']
const PENDING_COLOR: CellColor = { bg: '#F1F5F9', text: '#334155' }

function dmy(day: string): string {
  const [year, month, date] = day.split('-')
  return year && month && date ? `${date}-${month}-${year}` : day
}
function dayHead(day: string): string {
  const [, month, date] = day.split('-')
  return date && month ? `${date}/${month}` : day
}
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function shift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return iso(d)
}
function daysOf(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00`)
  const end = new Date(`${to}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [from]
  const out: string[] = []
  for (const d = new Date(start); d <= end && out.length < 31; d.setDate(d.getDate() + 1)) out.push(iso(d))
  return out
}
function performance(pct: number, total: number): Perf {
  if (total > 0 && pct >= 75) return { label: 'Good', tone: 'success' }
  return { label: 'Warning', tone: 'warning' }
}
function pctColor(pct: number): string {
  return pct >= 75 ? '#4F46E5' : '#D97706'
}

export function AttendanceRegister({ canMark, screen }: { canMark: boolean; screen?: View }) {
  const app = useApp()
  const toast = useToast()
  const classesQ = useClasses()
  const studentsQ = useStudents()
  const today = iso(new Date())
  const [picked, setPicked] = useState<View>(screen ?? 'overview')
  const view = screen ?? picked
  const [grade, setGrade] = useState('')
  const [classId, setClassId] = useState('')
  const [from, setFrom] = useState(shift(today, -13))
  const [to, setTo] = useState(today)
  const [markDate, setMarkDate] = useState(today)
  const [markAs, setMarkAs] = useState<AttendanceStatus>('present')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [format, setFormat] = useState<'xlsx' | 'csv' | 'pdf'>('xlsx')
  const [page, setPage] = useState(0)
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [detail, setDetail] = useState<Student | null>(null)

  const classes = classesQ.data ?? []
  const grades = useMemo(() => [...new Set(classes.map((c) => c.grade).filter(Boolean))], [classes])
  const sections = classes.filter((c) => c.id && (!grade || c.grade === grade))
  const scope = useMemo(
    () => (classId ? sections.filter((c) => c.id === classId) : sections),
    [sections, classId],
  )
  const scopeKey = scope.map((c) => c.id).join('|')
  const selected = scope.length === 1 ? scope[0] : undefined
  const roster = useMemo(() => {
    const students = studentsQ.data ?? []
    const seen = new Set<string>()
    const rows: Student[] = []
    for (const student of students) {
      if (seen.has(student.id) || !scope.some((item) => studentMatchesClass(student, item))) continue
      seen.add(student.id)
      rows.push(student)
    }
    return rows.sort((a, b) => (a.cls || '').localeCompare(b.cls || '') || a.roll - b.roll || a.name.localeCompare(b.name))
  }, [studentsQ.data, scope])
  const dates = useMemo(() => daysOf(from, to), [from, to])

  useEffect(() => {
    const ids = scopeKey ? scopeKey.split('|') : []
    if (!ids.length) { setRecords([]); setLoading(false); return }
    let live = true
    setLoading(true)
    setError('')
    void (async () => {
      try {
        const out: AttendanceRecord[] = []
        for (let i = 0; i < ids.length; i += 4) {
          const groups = await Promise.all(ids.slice(i, i + 4).map((id) => listClassAttendanceRange(id, from, to)))
          out.push(...groups.flat())
        }
        if (live) setRecords(out)
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load attendance')
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => { live = false }
  }, [scopeKey, from, to, saving])

  const byStudentDay = useMemo(() => {
    const map = new Map<string, AttendanceRecord>()
    for (const row of records) map.set(`${row.studentId}|${attendanceCalendarDate(row.date)}`, row)
    return map
  }, [records])

  const summaries = useMemo<AttendanceSummaryStudent[]>(() => roster.map((s) => {
    let present = 0
    let absent = 0
    let late = 0
    let half = 0
    let pending = 0
    for (const day of dates) {
      const mark = byStudentDay.get(`${s.id}|${day}`)
      if (!mark || mark.status === 'pending') { pending += 1; continue }
      if (mark.status === 'present') present += 1
      else if (mark.status === 'half_day') half += 1
      else if (mark.status === 'absent') absent += 1
      else if (mark.status === 'late') late += 1
    }
    const total = dates.length
    const pct = total ? Math.round(((present + half) / total) * 1000) / 10 : 0
    return {
      roll: s.roll ? String(s.roll) : '—',
      name: s.name,
      studentId: s.id,
      adm: s.adm,
      cls: s.cls || selected?.name || '',
      section: s.section,
      present, absent, late, leave: 0, half, pending, total, pct,
      status: performance(pct, total).label,
    }
  }), [roster, dates, byStudentDay, selected])

  const filtered = summaries.filter((s) => {
    const q = query.trim().toLowerCase()
    if (q && !`${s.name} ${s.adm} ${s.roll}`.toLowerCase().includes(q)) return false
    if (statusFilter === 'Pending' && s.pending === 0) return false
    if (statusFilter && statusFilter !== 'Pending' && s.status !== statusFilter) return false
    return true
  })
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE))
  const classAvg = filtered.length ? Math.round(filtered.reduce((n, s) => n + s.pct, 0) / filtered.length * 10) / 10 : 0
  const good = filtered.filter((s) => s.total > 0 && s.pct >= 75).length
  const low = filtered.filter((s) => s.total === 0 || s.pct < 75).length

  useEffect(() => { setPage(0) }, [query, statusFilter, scopeKey, from, to])

  const meta: ReportMeta = {
    schoolName: app.school.name,
    schoolCity: app.school.city,
    logoUrl: app.school.logoUrl,
    logoInitials: app.school.logo,
    brandColor: app.school.color,
    currency: app.school.currency,
    period: `${dmy(from)} to ${dmy(to)}`,
  }
  const classLabel = selected
    ? `${selected.name || selected.grade}${selected.section ? ` · Section ${selected.section}` : ''}`
    : grade ? `${grade} · All sections` : 'All classes'
  const classTag = (student: Student) => {
    const match = scope.find((item) => studentMatchesClass(student, item))
    if (match?.grade && match.section) return `${match.grade}-${match.section}`
    return match?.name || student.cls || '—'
  }
  const legend = 'P Present · A Absent · L Late · H Half day · N Pending · Good is 75% and above · Warning is below 75%'

  const reportSpec = () => {
    const overview = view === 'overview'
    const columns = overview
      ? ['Roll No', 'Admission No', 'Student Name', 'Present', 'Absent', 'Late', 'Half day', 'Pending', 'Total Days', 'Attendance %', 'Status']
      : ['Roll', 'Admission No', 'Student', ...(scope.length === 1 ? [] : ['Class']), ...dates.map(dayHead), 'P', 'A', 'L', 'H', 'N']
    const rows = overview
      ? filtered.map((s) => [s.roll, s.adm || '—', s.name, s.present, s.absent, s.late, s.half ?? 0, s.pending, s.total, `${s.pct.toFixed(1)}%`, s.status] as (string | number)[])
      : roster.map((s) => {
          const letters = dates.map((day) => {
            const mark = byStudentDay.get(`${s.id}|${day}`)
            return mark && mark.status !== 'pending' ? LETTER[mark.status].text : 'N'
          })
          const count = (letter: string) => letters.filter((item) => item === letter).length
          const classCell = scope.length === 1 ? [] : [classTag(s)]
          return [s.roll || '—', s.adm || '—', s.name, ...classCell, ...letters, count('P'), count('A'), count('L'), count('H'), count('N')] as (string | number)[]
        })
    const overviewColors: (CellColor | undefined)[][] = filtered.map((s) => [
      undefined, undefined, undefined, PRESENT_COLOR, ABSENT_COLOR, MARK_COLOR.L, MARK_COLOR.H, PENDING_COLOR, undefined,
      s.pct >= 75 ? { bg: '#EEF2FF', text: '#4F46E5' } : { bg: '#FFEDD5', text: '#C2410C' },
      s.status === 'Good' ? GOOD_COLOR : WARNING_COLOR,
    ])
    const registerColors: (CellColor | undefined)[][] = roster.map((s) => {
      const letters = dates.map((day) => {
        const mark = byStudentDay.get(`${s.id}|${day}`)
        return mark && mark.status !== 'pending' ? LETTER[mark.status].text : 'N'
      })
      return [undefined, undefined, undefined, ...(scope.length === 1 ? [] : [undefined]), ...letters.map((letter) => MARK_COLOR[letter]), MARK_COLOR.P, MARK_COLOR.A, MARK_COLOR.L, MARK_COLOR.H, MARK_COLOR.N]
    })
    return {
      title: overview ? 'Attendance Overview' : 'Attendance Register',
      subtitle: `${classLabel} · ${dmy(from)} to ${dmy(to)} · ${legend}`,
      columns,
      rows,
      cellColor: overview ? overviewColors : registerColors,
      summary: [
        { label: 'Students', value: String(overview ? filtered.length : roster.length) },
        { label: 'Class average', value: `${classAvg}%` },
        { label: 'Good', value: String(good) },
        { label: 'Warning', value: String(low) },
      ],
    }
  }

  const download = async () => {
    if (!roster.length) {
      toast.danger('Nothing to export', 'No students in this class.')
      return
    }
    if (format === 'csv') {
      downloadTextFile(`attendance-${from}.csv`, overviewToCsv(filtered))
      toast.success('CSV downloaded', `${filtered.length} students`)
      return
    }
    const spec = reportSpec()
    if (format === 'pdf') {
      openReportPdf(spec, meta)
      return
    }
    try {
      await downloadSheet(
        view === 'overview' ? `attendance-overview-${from}.xlsx` : `attendance-register-${from}.xlsx`,
        spec.title,
        spec.columns,
        spec.rows,
        spec.cellColor,
      )
      toast.success('Excel downloaded', `${spec.rows.length} students`)
    } catch (e) {
      toast.danger('Excel failed', e instanceof Error ? e.message : 'Could not build the workbook')
    }
  }

  const markAll = async () => {
    if (!canMark || !classId || !roster.length) return
    setSaving(true)
    try {
      await saveAttendance(classId, { date: markDate, records: roster.map((s) => ({ studentId: s.id, status: markAs })) })
      toast.success('Attendance marked', `${roster.length} students · ${markDate}`)
    } catch (e) {
      toast.danger('Could not mark attendance', e instanceof Error ? e.message : 'Try again')
    } finally {
      setSaving(false)
    }
  }

  const markOne = async (studentId: string, day: string) => {
    const student = roster.find((item) => item.id === studentId)
    const ownerId = classId || scope.find((item) => student && studentMatchesClass(student, item))?.id || ''
    if (!canMark || !ownerId) return
    const current = byStudentDay.get(`${studentId}|${day}`)?.status ?? 'absent'
    const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
    setSaving(true)
    try {
      await saveAttendance(ownerId, { date: day, records: [{ studentId, status: next }] })
    } catch (e) {
      toast.danger('Could not update', e instanceof Error ? e.message : 'Try again')
    } finally {
      setSaving(false)
    }
  }

  const detailSummary = detail ? summaries.find((s) => s.studentId === detail.id) : undefined
  const detailDays = detail ? dates.map((day) => byStudentDay.get(`${detail.id}|${day}`)) : []

  return (
    <div className="att-register">
      <style>{`
        @media print {
          .sm-sidebar, .sm-topbar, .att-no-print { display: none !important; }
          .att-register { background: #fff; }
          .att-register table { width: 100%; border-collapse: collapse; }
          .att-register th { position: static; }
          .att-register tr { break-inside: avoid; }
          .att-register thead { display: table-header-group; }
        }
      `}</style>
      <div className="row ai-center jc-between wrap gap12 att-no-print">
        <div>
          <div className="t-xl fw7">{view === 'overview' ? 'Attendance Overview' : 'Attendance'}</div>
          <div className="t-sm muted">{classesQ.isLoading ? 'Loading classes…' : `${classLabel} · ${roster.length} Students`}</div>
          <div className="row gap8 wrap" style={{ marginTop: 8 }}>
            {([
              ['P', 'Present', '#22C55E'],
              ['A', 'Absent', '#EF4444'],
              ['L', 'Late', '#F59E0B'],
              ['H', 'Half day', '#3B82F6'],
              ['N', 'Pending', '#64748B'],
              ['Good', '75% and above', '#22C55E'],
              ['Warning', 'Below 75%', '#F59E0B'],
            ] as const).map(([label, name, color]) => (
              <span key={label} className="row ai-center gap4 t-xs">
                <span style={{ background: color, color: '#fff', borderRadius: 6, minWidth: 28, textAlign: 'center', fontWeight: 700, padding: '2px 6px' }}>{label}</span>
                {name}
              </span>
            ))}
          </div>
        </div>
        <div className="row ai-center gap8 wrap">
          {!screen && <Segmented value={view} onChange={(v) => setPicked(v as View)} options={[{ value: 'overview', label: 'Overview' }, { value: 'register', label: 'Daily register' }]} />}
          <Select aria-label="Export format" value={format} onChange={(e) => setFormat(e.target.value as 'xlsx' | 'csv' | 'pdf')} options={[{ value: 'xlsx', label: 'Excel' }, { value: 'csv', label: 'CSV' }, { value: 'pdf', label: 'PDF' }]} />
          <Btn icon="download" onClick={() => void download()}>Download Report</Btn>
          <Btn variant="secondary" icon="doc" onClick={() => { if (!roster.length) { toast.danger('Nothing to print', 'No students in this class.'); return } openReportPdf(reportSpec(), meta) }}>Print</Btn>
        </div>
      </div>

      <Card style={{ marginTop: 14 }} className="att-no-print">
        <div className="row gap12 wrap" style={{ alignItems: 'flex-end' }}>
          <label className="col gap4"><span className="t-xs muted">Class</span>
            <Select aria-label="Class" value={grade} onChange={(e) => { setGrade(e.target.value); setClassId('') }} options={[{ value: '', label: 'All classes' }, ...grades.map((g) => ({ value: g, label: g }))]} />
          </label>
          <label className="col gap4"><span className="t-xs muted">Section</span>
            <Select aria-label="Section" value={classId} onChange={(e) => setClassId(e.target.value)} options={[{ value: '', label: 'All sections' }, ...sections.map((c) => ({ value: c.id ?? '', label: c.name || `${c.grade}-${c.section}` }))]} />
          </label>
          <label className="col gap4"><span className="t-xs muted">From</span>
            <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} />
          </label>
          <label className="col gap4"><span className="t-xs muted">To</span>
            <Input type="date" aria-label="To date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Btn variant="secondary" onClick={() => { setFrom(shift(today, -13)); setTo(today) }}>2 weeks</Btn>
          <Btn variant="secondary" onClick={() => { setFrom(shift(today, -6)); setTo(today) }}>This week</Btn>
          {view === 'overview' && (
            <label className="col gap4"><span className="t-xs muted">Show</span>
              <Select aria-label="Attendance status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'Good', label: 'Good' }, { value: 'Warning', label: 'Warning' }, { value: 'Pending', label: 'Pending' }]} />
            </label>
          )}
          {view === 'register' && canMark && (
            <>
              <label className="col gap4"><span className="t-xs muted">Mark for a date</span>
                <Input type="date" aria-label="Mark date" value={markDate} onChange={(e) => setMarkDate(e.target.value)} />
              </label>
              <label className="col gap4"><span className="t-xs muted">Mark as</span>
                <Select aria-label="Mark as" value={markAs} onChange={(e) => setMarkAs(e.target.value as AttendanceStatus)} options={[{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }, { value: 'late', label: 'Late' }, { value: 'half_day', label: 'Half day' }, { value: 'pending', label: 'Pending' }]} />
              </label>
              <Btn disabled={!classId || saving} onClick={() => void markAll()}>{saving ? 'Saving…' : 'Mark Attendance'}</Btn>
            </>
          )}
        </div>
      </Card>

      {classesQ.isLoading || studentsQ.isLoading || loading ? (
        <div style={{ marginTop: 14 }} className="t-sm muted">Loading attendance…</div>
      ) : error ? (
        <div style={{ marginTop: 14 }}><Empty icon="alert" title="Could not load attendance" body={error} /></div>
      ) : !roster.length ? (
        <div style={{ marginTop: 14 }}><Empty icon="users" title="No students" body="No students are saved for this class, so there is no attendance to show." /></div>
      ) : view === 'overview' ? (
        <>
          <div className="sm-grid-4" style={{ marginTop: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <SummaryCard label="Total Students" value={String(filtered.length)} icon="users" tint="#EEF2FF" color="#4F46E5" />
            <SummaryCard label="Class Average" value={`${classAvg}%`} icon="calendar" tint="#EFF6FF" color="#2563EB" />
            <SummaryCard label="Good Attendance" value={String(good)} icon="check" tint="#ECFDF5" color="#16A34A" />
            <SummaryCard label="Low Attendance" value={String(low)} icon="alert" tint="#FEF2F2" color="#DC2626" />
          </div>
          <Card pad={false} style={{ marginTop: 14 }}>
            <div style={{ padding: '16px 16px 0' }}>
              <div className="fw7">Student Attendance Summary</div>
              <div className="t-xs muted">Each day from From to To counts. No mark is Pending. Half day counts with Present for the percentage. Below 75% is Warning.</div>
              <div className="row gap8 wrap att-no-print" style={{ marginTop: 12 }}>
                <Search value={query} onChange={setQuery} placeholder="Search student" />
                <Select aria-label="Attendance status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} options={[{ value: '', label: 'All statuses' }, { value: 'Good', label: 'Good' }, { value: 'Warning', label: 'Warning' }, { value: 'Pending', label: 'Pending' }]} />
              </div>
            </div>
            {!filtered.length ? (
              <div style={{ padding: 16 }}><Empty icon="users" title="No students" body="No students in this section match the filters." /></div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#64748B' }}>
                      {['Roll No', 'Student Name', 'Present', 'Absent', 'Late', 'Half day', 'Pending', 'Total Days', 'Attendance %', 'Status'].map((h) => (
                        <th key={h} style={{ padding: '10px 12px', borderBottom: '1px solid #E2E8F0', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((s) => (
                        <tr key={s.studentId}>
                          <td style={cell}>{s.roll}</td>
                          <td style={cell}>{s.name}</td>
                          <td style={{ ...cell, color: '#16A34A', fontWeight: 700 }}>{s.present}</td>
                          <td style={{ ...cell, color: '#DC2626', fontWeight: 700 }}>{s.absent}</td>
                          <td style={{ ...cell, color: '#B45309', fontWeight: 700 }}>{s.late}</td>
                          <td style={{ ...cell, color: '#1D4ED8', fontWeight: 700 }}>{s.half ?? 0}</td>
                          <td style={{ ...cell, color: '#475569', fontWeight: 700 }}>{s.pending}</td>
                          <td style={cell}>{s.total}</td>
                          <td style={{ ...cell, color: pctColor(s.pct), fontWeight: 700 }}>{s.pct.toFixed(1)}%</td>
                          <td style={cell}><Badge tone={performance(s.pct, s.total).tone}>{s.status}</Badge></td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="row jc-end gap8 att-no-print" style={{ padding: 12 }}>
                <Btn size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                <span className="t-xs muted">{page + 1} / {pages}</span>
                <Btn size="sm" variant="secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
              </div>
            )}
          </Card>
        </>
      ) : (
        <Card pad={false} style={{ marginTop: 14 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', minWidth: 720, fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={sticky(0, 140)}>Admission No</th>
                  <th style={sticky(140, 180)}>Student</th>
                  <th style={head}>Abs</th>
                  <th style={head}>Lve</th>
                  {dates.map((day) => {
                    const d = new Date(`${day}T00:00:00`)
                    return <th key={day} style={head}>{d.toLocaleDateString(undefined, { weekday: 'narrow' })}<div>{d.getDate()}</div></th>
                  })}
                </tr>
                <SummaryLine label="Total Present" dates={dates} roster={roster} byStudentDay={byStudentDay} pick={(s) => s === 'present' || s === 'half_day'} />
                <SummaryLine label="Total Absent" dates={dates} roster={roster} byStudentDay={byStudentDay} pick={(s) => s === 'absent'} />
                <SummaryLine label="Total Leave" dates={dates} roster={roster} byStudentDay={byStudentDay} pick={() => false} />
                <SummaryLine label="Total Pending" dates={dates} roster={roster} byStudentDay={byStudentDay} pick={(s) => s === 'pending'} countMissing />
                <PercentLine dates={dates} roster={roster} byStudentDay={byStudentDay} />
              </thead>
              <tbody>
                {roster.map((s) => {
                  const abs = dates.filter((day) => byStudentDay.get(`${s.id}|${day}`)?.status === 'absent').length
                  return (
                    <tr key={s.id}>
                      <td style={sticky(0, 140)}>{s.adm || '—'}</td>
                      <td style={sticky(140, 180)}>{s.name}{scope.length !== 1 && <div className="t-xs muted">{classTag(s)}</div>}</td>
                      <td style={head}>{abs}</td>
                      <td style={head}>0</td>
                      {dates.map((day) => {
                        const mark = byStudentDay.get(`${s.id}|${day}`)
                        const letter = mark && mark.status !== 'pending' ? LETTER[mark.status] : LETTER.pending
                        return (
                          <td key={day} style={{ ...head, cursor: canMark ? 'pointer' : 'default' }}>
                            <button
                              type="button"
                              title={mark && mark.status !== 'pending' ? `${letter.text} · marked by ${mark.markedBy || 'unknown'}` : 'Pending'}
                              onClick={() => void markOne(s.id, day)}
                              style={{
                                border: 0, borderRadius: 6, minWidth: 26, height: 26, fontWeight: 700, cursor: canMark ? 'pointer' : 'default',
                                background: letter?.bg ?? '#E5E7EB', color: letter?.color ?? '#6B7280',
                              }}
                            >{letter?.text ?? '—'}</button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name ?? 'Student'} sub="Attendance details" size="lg">
        {detail && detailSummary && (
          <div className="col gap12">
            <div className="row ai-center gap12">
              <Avatar name={detail.name} hue={detail.avatarHue} size={56} />
              <div>
                <div className="fw7">{detail.name}</div>
                <div className="t-sm muted">{detail.adm} · {detail.id}</div>
                <div className="t-sm muted">{detail.cls || selected?.name} · Section {detail.section || '—'} · Roll {detail.roll || '—'}</div>
              </div>
            </div>
            <div className="row gap12 wrap">
              <Mini label="Working days" value={detailSummary.total} />
              <Mini label="Present" value={detailSummary.present} />
              <Mini label="Absent" value={detailSummary.absent} />
              <Mini label="Late" value={detailSummary.late} />
              <Mini label="Pending" value={detailSummary.pending} />
              <Mini label="Leave" value={detailSummary.leave} />
              <Mini label="Attendance" value={`${detailSummary.pct}%`} />
            </div>
            <div className="fw6">Daily history</div>
            <div className="row gap8 wrap">
              {dates.map((day, i) => {
                const mark = detailDays[i]
                const letter = mark && mark.status !== 'pending' ? LETTER[mark.status] : LETTER.pending
                return (
                  <div key={day} title={mark?.markedBy ? `Marked by ${mark.markedBy}` : 'Not marked'} style={{ textAlign: 'center' }}>
                    <div className="t-xs muted">{day.slice(8)}</div>
                    <div style={{ marginTop: 4, borderRadius: 6, minWidth: 28, padding: '4px 0', fontWeight: 700, background: letter?.bg ?? '#E5E7EB', color: letter?.color ?? '#6B7280' }}>{letter?.text ?? '—'}</div>
                  </div>
                )
              })}
            </div>
            <div className="t-xs muted">Subject, period, and correction history are stored on period marks. This calendar uses the class roll saved for these dates.</div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const cell: CSSProperties = { padding: '12px', borderBottom: '1px solid #F1F5F9' }
const head: CSSProperties = { padding: '8px', textAlign: 'center', background: '#fff', borderBottom: '1px solid #E2E8F0', fontWeight: 600, whiteSpace: 'nowrap' }
function sticky(left: number, width: number): CSSProperties {
  return { ...head, position: 'sticky', left, minWidth: width, textAlign: 'left', zIndex: 1, background: '#fff' }
}

function SummaryCard({ label, value, icon, tint, color }: { label: string; value: string; icon: string; tint: string; color: string }) {
  return (
    <Card>
      <div className="row ai-center jc-between">
        <div>
          <div className="t-xs muted">{label}</div>
          <div className="fw7" style={{ fontSize: 28, marginTop: 4 }}>{value}</div>
        </div>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: tint, color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} />
        </span>
      </div>
    </Card>
  )
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return <div style={{ minWidth: 90 }}><div className="t-xs muted">{label}</div><div className="fw7">{value}</div></div>
}

function SummaryLine({ label, dates, roster, byStudentDay, pick, countMissing = false }: {
  label: string
  dates: string[]
  roster: Student[]
  byStudentDay: Map<string, AttendanceRecord>
  pick: (status: AttendanceStatus) => boolean
  countMissing?: boolean
}) {
  return (
    <tr>
      <td style={sticky(0, 140)} />
      <td style={{ ...sticky(140, 180), fontWeight: 600 }}>{label}</td>
      <td style={head} /><td style={head} />
      {dates.map((day) => {
        const n = roster.filter((s) => {
          const mark = byStudentDay.get(`${s.id}|${day}`)
          if (!mark) return countMissing
          return pick(mark.status)
        }).length
        return <td key={day} style={head}>{n}</td>
      })}
    </tr>
  )
}

function PercentLine({ dates, roster, byStudentDay }: {
  dates: string[]
  roster: Student[]
  byStudentDay: Map<string, AttendanceRecord>
}) {
  return (
    <tr>
      <td style={sticky(0, 140)} />
      <td style={{ ...sticky(140, 180), fontWeight: 600 }}>Percentage %</td>
      <td style={head} /><td style={head} />
      {dates.map((day) => {
        let marked = 0
        let present = 0
        for (const s of roster) {
          const mark = byStudentDay.get(`${s.id}|${day}`)
          if (!mark || mark.status === 'pending') continue
          marked += 1
          if (mark.status === 'present' || mark.status === 'half_day') present += 1
        }
        return <td key={day} style={head}>{marked ? Math.round((present / marked) * 100) : 0}</td>
      })}
    </tr>
  )
}
