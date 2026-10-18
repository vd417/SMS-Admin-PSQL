import { useMemo, useState } from 'react'
import { Badge, Btn, Card, Drawer, Empty, Input, Kpi, Search, Segmented, Select, type BadgeTone } from '@/components/ui'
import { useClasses } from '@/api/hooks/useClasses'
import { useTeachers } from '@/api/hooks/useTeachers'
import {
  usePeriodAttendanceAdvanced,
  usePeriodAttendanceClassDaySummary,
  usePeriodAttendanceSubjectSummaries,
  usePeriodAttendanceTeacherSummaries,
  usePeriodAttendanceRangeSummary,
  usePeriodAttendanceAudit,
} from '@/api/hooks/usePeriodAttendanceAdvanced'
import type {
  PeriodAttendanceAdvancedFilters,
  PeriodAttendanceAdvancedRow,
} from '@/api/periodAttendanceAdvanced'
import { formatMarkedAt } from '@/lib/dateInput'
import { ClassAttendanceOverview } from './classAttendanceOverview'

const DEFAULT_FILTERS: PeriodAttendanceAdvancedFilters = {
  preset: 'today',
  page: 1,
  pageSize: 25,
}

const PRESET_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'custom', label: 'Custom range' },
]

const SUBVIEW_OPTIONS = [
  { value: 'records', label: 'Records' },
  { value: 'class', label: 'Class' },
  { value: 'subject', label: 'Subject' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'ranges', label: 'Ranges' },
]

const RANGE_PRESET_OPTIONS = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_60_days', label: 'Last 60 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
]

function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value)}%`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function daysBack(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00`)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

const CLASS_STUDENT_LOOKBACK_DAYS = 30

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'present', label: 'Present' },
  { value: 'late', label: 'Late' },
  { value: 'absent', label: 'Absent' },
  { value: 'leave', label: 'Leave' },
]

const ROLE_OPTIONS = [
  { value: '', label: 'All marker roles' },
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
  { value: 'principal', label: 'Principal' },
  { value: 'vice_principal', label: 'Vice Principal' },
  { value: 'teacher', label: 'Teacher' },
  { value: 'staff', label: 'Staff' },
]

const GEO_OPTIONS = [
  { value: '', label: 'All geo statuses' },
  { value: 'not_required', label: 'Not required' },
  { value: 'valid', label: 'Valid' },
  { value: 'outside', label: 'Outside fence' },
  { value: 'unavailable', label: 'Unavailable' },
]

function compactFilters(filters: PeriodAttendanceAdvancedFilters): PeriodAttendanceAdvancedFilters {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value != null),
  ) as PeriodAttendanceAdvancedFilters
}

function statusTone(status: string): BadgeTone {
  if (status === 'present') return 'success'
  if (status === 'late' || status === 'leave') return 'warning'
  if (status === 'absent') return 'danger'
  return 'neutral'
}

function titleCase(value?: string | null): string {
  if (!value) return '—'
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function periodTime(row: PeriodAttendanceAdvancedRow): string {
  if (!row.startTime && !row.endTime) return '—'
  return `${row.startTime || '—'} – ${row.endTime || '—'}`
}

function markedAt(value?: string | null): string {
  return formatMarkedAt(value)
}

function geoDisplay(row: PeriodAttendanceAdvancedRow): string {
  if (row.geoFenceStatus === 'not_required') return 'Not required'
  const label = titleCase(row.geoFenceStatus)
  return row.geoDistanceMeters != null ? `${label} · ${row.geoDistanceMeters}m` : label
}

export function AttendanceAdvanced() {
  const [filters, setFilters] = useState<PeriodAttendanceAdvancedFilters>(DEFAULT_FILTERS)
  const [subview, setSubview] = useState<'records' | 'class' | 'subject' | 'teacher' | 'ranges'>('records')
  const [summaryClassId, setSummaryClassId] = useState('')
  const [summaryGrade, setSummaryGrade] = useState('')
  const [summaryDate, setSummaryDate] = useState(today())
  const [summaryPreset, setSummaryPreset] = useState('last_30_days')
  const [rangeSubject, setRangeSubject] = useState('')
  const [rangeTeacherId, setRangeTeacherId] = useState('')
  const [auditRecordId, setAuditRecordId] = useState<string | null>(null)
  const classesQ = useClasses()
  const teachersQ = useTeachers()
  const queryFilters = compactFilters(filters)
  const attendanceQ = usePeriodAttendanceAdvanced(queryFilters, subview === 'records')
  const classDaySummaryQ = usePeriodAttendanceClassDaySummary(summaryClassId, summaryDate, subview === 'class')
  const subjectSummariesQ = usePeriodAttendanceSubjectSummaries(
    summaryClassId, { preset: summaryPreset }, subview === 'subject' && Boolean(summaryClassId),
  )
  const teacherSummariesQ = usePeriodAttendanceTeacherSummaries({ preset: summaryPreset }, subview === 'teacher')
  const rangeSummaryQ = usePeriodAttendanceRangeSummary(
    {
      preset: summaryPreset,
      classId: summaryClassId || undefined,
      subject: rangeSubject || undefined,
      teacherId: rangeTeacherId || undefined,
    },
    subview === 'ranges',
  )
  const auditQ = usePeriodAttendanceAudit(auditRecordId ?? '', Boolean(auditRecordId))

  const classes = classesQ.data ?? []
  const teachers = teachersQ.data ?? []
  const grades = useMemo(
    () => [...new Set(classes.map((item) => item.grade).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [classes],
  )
  const subjects = useMemo(
    () => [...new Set(classes.flatMap((item) => item.subjects ?? []).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [classes],
  )
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 25
  const totalCount = attendanceQ.data?.totalCount ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const update = <K extends keyof PeriodAttendanceAdvancedFilters>(
    key: K,
    value: PeriodAttendanceAdvancedFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }))
  }

  const updatePreset = (preset: string) => {
    setFilters((current) => ({
      ...current,
      preset,
      page: 1,
      ...(preset === 'custom' ? {} : { from: undefined, to: undefined }),
    }))
  }

  const updateGrade = (grade: string) => {
    setFilters((current) => ({ ...current, grade, classId: undefined, page: 1 }))
  }

  /** Class/Subject/Ranges subviews share one Class(grade) → Section cascade, mirroring Records above. */
  const updateSummaryGrade = (grade: string) => {
    setSummaryGrade(grade)
    setSummaryClassId('')
  }
  const summarySectionOptions = (placeholder: string) => [
    { value: '', label: placeholder },
    ...classes.filter((item) => !summaryGrade || item.grade === summaryGrade).map((item) => ({
      value: item.id ?? '',
      label: item.name || `${item.grade}-${item.section}`,
    })),
  ]

  const viewRecordsFor = (extra: Partial<PeriodAttendanceAdvancedFilters>) => {
    setFilters({ ...DEFAULT_FILTERS, preset: summaryPreset, ...extra })
    setSubview('records')
  }

  return (
    <>
    <Card pad={false}>
      <div className="sm-att-adv-head">
        <div>
          <div className="t-lg fw7">Advanced period attendance</div>
          <div className="t-sm muted">Server-filtered period marks across classes and teachers</div>
        </div>
        <span className="t-sm muted">{totalCount} record{totalCount === 1 ? '' : 's'}</span>
      </div>

      <div className="sm-att-adv-subnav">
        <Segmented value={subview} onChange={(v) => setSubview(v as typeof subview)} options={SUBVIEW_OPTIONS} />
      </div>

      {subview === 'records' && (
      <>
      <div className="sm-att-adv-filters">
        <label className="sm-att-adv-field">
          <span>Date preset</span>
          <Select
            aria-label="Date preset"
            value={filters.preset}
            options={PRESET_OPTIONS}
            onChange={(event) => updatePreset(event.target.value)}
          />
        </label>
        {filters.preset === 'custom' && (
          <>
            <label className="sm-att-adv-field">
              <span>From</span>
              <Input aria-label="From" type="date" value={filters.from ?? ''} onChange={(event) => update('from', event.target.value)} />
            </label>
            <label className="sm-att-adv-field">
              <span>To</span>
              <Input aria-label="To" type="date" value={filters.to ?? ''} onChange={(event) => update('to', event.target.value)} />
            </label>
          </>
        )}
        <label className="sm-att-adv-field">
          <span>Class</span>
          <Select
            aria-label="Class"
            value={filters.grade ?? ''}
            options={[{ value: '', label: 'All classes' }, ...grades.map((grade) => ({ value: grade, label: grade }))]}
            onChange={(event) => updateGrade(event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Section</span>
          <Select
            aria-label="Section"
            value={filters.classId ?? ''}
            options={[
              { value: '', label: 'All sections' },
              ...classes.filter((item) => !filters.grade || item.grade === filters.grade).map((item) => ({
                value: item.id ?? '',
                label: item.name || `${item.grade}-${item.section}`,
              })),
            ]}
            onChange={(event) => update('classId', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Subject</span>
          <Select
            aria-label="Subject"
            value={filters.subject ?? ''}
            options={[{ value: '', label: 'All subjects' }, ...subjects.map((subject) => ({ value: subject, label: subject }))]}
            onChange={(event) => update('subject', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Period</span>
          <Select
            aria-label="Period"
            value={filters.period?.toString() ?? ''}
            options={[
              { value: '', label: 'All periods' },
              ...Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: `Period ${index + 1}` })),
            ]}
            onChange={(event) => update('period', event.target.value ? Number(event.target.value) : undefined)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Teacher</span>
          <Select
            aria-label="Teacher"
            value={filters.assignedTeacherId ?? ''}
            options={[
              { value: '', label: 'All teachers' },
              ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
            ]}
            onChange={(event) => update('assignedTeacherId', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Marked by role</span>
          <Select
            aria-label="Marked by role"
            value={filters.markedByRole ?? ''}
            options={ROLE_OPTIONS}
            onChange={(event) => update('markedByRole', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Status</span>
          <Select
            aria-label="Status"
            value={filters.status ?? ''}
            options={STATUS_OPTIONS}
            onChange={(event) => update('status', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field">
          <span>Geo-fence</span>
          <Select
            aria-label="Geo-fence"
            value={filters.geoFenceStatus ?? ''}
            options={GEO_OPTIONS}
            onChange={(event) => update('geoFenceStatus', event.target.value)}
          />
        </label>
        <label className="sm-att-adv-field sm-att-adv-search">
          <span>Student</span>
          <Search
            value={filters.q ?? ''}
            onChange={(value) => update('q', value)}
            placeholder="Name or admission no."
          />
        </label>
      </div>

      {attendanceQ.isLoading ? (
        <div className="sm-att-adv-state t-sm muted">Loading period attendance…</div>
      ) : attendanceQ.isError ? (
        <div className="sm-att-adv-state">
          <div>
            <div className="fw6">Could not load period attendance.</div>
            <div className="t-sm muted">{attendanceQ.error instanceof Error ? attendanceQ.error.message : 'Please try again.'}</div>
          </div>
          <Btn variant="secondary" size="sm" onClick={() => attendanceQ.refetch()}>Retry</Btn>
        </div>
      ) : (
        <div className="sm-att-adv-table-wrap">
          <table className="sm-table sm-att-adv-table">
            <thead>
              <tr>
                <th>Student Name</th>
                <th>Student ID</th>
                <th>Class</th>
                <th>Section</th>
                <th>Status</th>
                <th>Marked By</th>
                <th>Marked By Role</th>
                <th>Assigned Teacher</th>
                <th>Subject</th>
                <th>Period</th>
                <th>Period Time</th>
                <th>Marked At</th>
                <th>Geo-Fence</th>
                <th>History</th>
              </tr>
            </thead>
            <tbody>
              {attendanceQ.data?.items.length ? attendanceQ.data.items.map((row) => (
                <tr key={row.id}>
                  <td><span className="fw6">{row.studentName || '—'}</span></td>
                  <td>{row.admissionNo || '—'}</td>
                  <td>{row.grade || row.classLabel || '—'}</td>
                  <td>{row.section || '—'}</td>
                  <td><Badge tone={statusTone(row.status)} dot>{titleCase(row.status)}</Badge></td>
                  <td className="fw6">{row.markedByName || '—'}</td>
                  <td>{titleCase(row.markedByRole)}</td>
                  <td>{row.assignedTeacherName || '—'}</td>
                  <td>{row.subject || '—'}</td>
                  <td>{row.period || '—'}</td>
                  <td>{periodTime(row)}</td>
                  <td>{markedAt(row.markedAt)}</td>
                  <td>{geoDisplay(row)}</td>
                  <td>
                    <Btn variant="secondary" size="sm" onClick={() => setAuditRecordId(row.id)}>History</Btn>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={14}>
                    <Empty icon="calendar" title="No period attendance for these filters." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="sm-att-adv-pagination">
        <span className="t-sm muted">Page {page} of {totalPages} · {totalCount} records</span>
        <div className="row gap8">
          <Btn
            variant="secondary"
            size="sm"
            disabled={page <= 1 || attendanceQ.isLoading}
            onClick={() => setFilters((current) => ({ ...current, page: page - 1 }))}
          >
            Previous
          </Btn>
          <Btn
            variant="secondary"
            size="sm"
            aria-label="Next page"
            disabled={page >= totalPages || attendanceQ.isLoading}
            onClick={() => setFilters((current) => ({ ...current, page: page + 1 }))}
          >
            Next
          </Btn>
        </div>
      </div>
      </>
      )}

      {subview === 'class' && (
        <div className="sm-att-adv-panel">
          <div className="sm-att-adv-filters">
            <label className="sm-att-adv-field">
              <span>Class</span>
              <Select
                aria-label="Class"
                value={summaryGrade}
                options={[{ value: '', label: 'All classes' }, ...grades.map((grade) => ({ value: grade, label: grade }))]}
                onChange={(event) => updateSummaryGrade(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Section</span>
              <Select
                aria-label="Class for summary"
                value={summaryClassId}
                options={summarySectionOptions('Choose a section…')}
                onChange={(event) => setSummaryClassId(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Date</span>
              <Input aria-label="Summary date" type="date" value={summaryDate} onChange={(event) => setSummaryDate(event.target.value)} />
            </label>
          </div>
          {!summaryClassId ? (
            <Empty icon="calendar" title="Choose a section to see its day summary." />
          ) : classDaySummaryQ.isLoading ? (
            <div className="sm-att-adv-state t-sm muted">Loading class summary…</div>
          ) : classDaySummaryQ.isError ? (
            <div className="sm-att-adv-state">
              <div>
                <div className="fw6">Could not load class summary.</div>
                <div className="t-sm muted">{classDaySummaryQ.error instanceof Error ? classDaySummaryQ.error.message : 'Please try again.'}</div>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => classDaySummaryQ.refetch()}>Retry</Btn>
            </div>
          ) : classDaySummaryQ.data && (
            <div className="sm-kpi-grid">
              <Kpi icon="checkCircle" label="Attendance %" value={pct(classDaySummaryQ.data.attendancePercentage)} />
              <Kpi icon="users" label="Total students" value={classDaySummaryQ.data.totalStudents} />
              <Kpi icon="check" label="Present" value={classDaySummaryQ.data.present} />
              <Kpi icon="x" label="Absent" value={classDaySummaryQ.data.absent} />
              <Kpi icon="clock" label="Late" value={classDaySummaryQ.data.late} />
              <Kpi icon="calendar" label="Leave" value={classDaySummaryQ.data.leave} />
              <Kpi
                icon="list"
                label="Periods marked / pending"
                value={`${classDaySummaryQ.data.markedPeriods} / ${classDaySummaryQ.data.pendingPeriods}`}
                foot={`${classDaySummaryQ.data.totalPeriods} expected · ${classDaySummaryQ.data.notMarked} not marked`}
              />
            </div>
          )}
          {summaryClassId && (
            <div style={{ marginTop: 16 }}>
              <ClassAttendanceOverview
                classId={summaryClassId}
                from={daysBack(summaryDate, CLASS_STUDENT_LOOKBACK_DAYS)}
                to={summaryDate}
                classLabel={classes.find((c) => c.id === summaryClassId)?.name}
                onStudentClick={(r) => viewRecordsFor({
                  classId: summaryClassId, q: r.studentName,
                  from: daysBack(summaryDate, CLASS_STUDENT_LOOKBACK_DAYS), to: summaryDate, preset: 'custom',
                })}
              />
            </div>
          )}
          {summaryClassId && (
            <Btn variant="secondary" size="sm" style={{ marginTop: 12 }} onClick={() => viewRecordsFor({ classId: summaryClassId, from: summaryDate, to: summaryDate, preset: 'custom' })}>
              View records
            </Btn>
          )}
        </div>
      )}

      {subview === 'subject' && (
        <div className="sm-att-adv-panel">
          <div className="sm-att-adv-filters">
            <label className="sm-att-adv-field">
              <span>Class</span>
              <Select
                aria-label="Class"
                value={summaryGrade}
                options={[{ value: '', label: 'All classes' }, ...grades.map((grade) => ({ value: grade, label: grade }))]}
                onChange={(event) => updateSummaryGrade(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Section</span>
              <Select
                aria-label="Class for subject summary"
                value={summaryClassId}
                options={summarySectionOptions('Choose a section…')}
                onChange={(event) => setSummaryClassId(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Range</span>
              <Select
                aria-label="Subject summary range"
                value={summaryPreset}
                options={RANGE_PRESET_OPTIONS}
                onChange={(event) => setSummaryPreset(event.target.value)}
              />
            </label>
          </div>
          {!summaryClassId ? (
            <Empty icon="book" title="Choose a section to see its subject breakdown." />
          ) : subjectSummariesQ.isLoading ? (
            <div className="sm-att-adv-state t-sm muted">Loading subject summary…</div>
          ) : subjectSummariesQ.isError ? (
            <div className="sm-att-adv-state">
              <div>
                <div className="fw6">Could not load subject summary.</div>
                <div className="t-sm muted">{subjectSummariesQ.error instanceof Error ? subjectSummariesQ.error.message : 'Please try again.'}</div>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => subjectSummariesQ.refetch()}>Retry</Btn>
            </div>
          ) : (
            <div className="sm-att-adv-table-wrap">
              <table className="sm-table sm-att-adv-table">
                <thead>
                  <tr>
                    <th>Subject</th><th>Teacher</th><th>Periods</th><th>Marked</th><th>Pending</th>
                    <th>Present</th><th>Absent</th><th>Late</th><th>Attendance %</th>
                  </tr>
                </thead>
                <tbody>
                  {subjectSummariesQ.data?.length ? subjectSummariesQ.data.map((row) => (
                    <tr
                      key={row.subject}
                      className="sm-att-adv-row-click"
                      onClick={() => viewRecordsFor({ classId: summaryClassId, subject: row.subject, preset: summaryPreset })}
                    >
                      <td><span className="fw6">{row.subject}</span></td>
                      <td>{row.teacherName || '—'}</td>
                      <td>{row.periods}</td>
                      <td>{row.marked}</td>
                      <td>{row.pending}</td>
                      <td>{row.present}</td>
                      <td>{row.absent}</td>
                      <td>{row.late}</td>
                      <td>{pct(row.attendancePercentage)}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={9}><Empty icon="book" title="No subject records for this range." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subview === 'teacher' && (
        <div className="sm-att-adv-panel">
          <div className="sm-att-adv-filters">
            <label className="sm-att-adv-field">
              <span>Range</span>
              <Select
                aria-label="Teacher summary range"
                value={summaryPreset}
                options={RANGE_PRESET_OPTIONS}
                onChange={(event) => setSummaryPreset(event.target.value)}
              />
            </label>
          </div>
          {teacherSummariesQ.isLoading ? (
            <div className="sm-att-adv-state t-sm muted">Loading teacher summary…</div>
          ) : teacherSummariesQ.isError ? (
            <div className="sm-att-adv-state">
              <div>
                <div className="fw6">Could not load teacher summary.</div>
                <div className="t-sm muted">{teacherSummariesQ.error instanceof Error ? teacherSummariesQ.error.message : 'Please try again.'}</div>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => teacherSummariesQ.refetch()}>Retry</Btn>
            </div>
          ) : (
            <div className="sm-att-adv-table-wrap">
              <table className="sm-table sm-att-adv-table">
                <thead>
                  <tr>
                    <th>Teacher</th><th>Classes</th><th>Sections</th><th>Subjects</th>
                    <th>Expected</th><th>Marked</th><th>Pending</th>
                    <th>Teacher</th><th>Staff</th><th>Principal</th><th>Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {teacherSummariesQ.data?.length ? teacherSummariesQ.data.map((row) => (
                    <tr
                      key={row.teacherId}
                      className="sm-att-adv-row-click"
                      onClick={() => viewRecordsFor({ assignedTeacherId: row.teacherId, preset: summaryPreset })}
                    >
                      <td><span className="fw6">{row.teacherName}</span></td>
                      <td>{row.classes}</td>
                      <td>{row.sections}</td>
                      <td>{row.subjects}</td>
                      <td>{row.expectedPeriods}</td>
                      <td>{row.markedPeriods}</td>
                      <td>{row.pendingPeriods}</td>
                      <td>{row.teacherMarked}</td>
                      <td>{row.staffMarked}</td>
                      <td>{row.principalMarked}</td>
                      <td>{row.adminMarked}</td>
                    </tr>
                  )) : (
                    <tr><td colSpan={11}><Empty icon="users" title="No teacher records for this range." /></td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subview === 'ranges' && (
        <div className="sm-att-adv-panel">
          <div className="sm-att-adv-filters">
            <label className="sm-att-adv-field">
              <span>Range</span>
              <Select
                aria-label="Range preset"
                value={summaryPreset}
                options={RANGE_PRESET_OPTIONS}
                onChange={(event) => setSummaryPreset(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Class</span>
              <Select
                aria-label="Range class filter"
                value={summaryGrade}
                options={[{ value: '', label: 'All classes' }, ...grades.map((grade) => ({ value: grade, label: grade }))]}
                onChange={(event) => updateSummaryGrade(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Section</span>
              <Select
                aria-label="Range section filter"
                value={summaryClassId}
                options={summarySectionOptions('All sections')}
                onChange={(event) => setSummaryClassId(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Subject</span>
              <Select
                aria-label="Range subject filter"
                value={rangeSubject}
                options={[{ value: '', label: 'All subjects' }, ...subjects.map((subject) => ({ value: subject, label: subject }))]}
                onChange={(event) => setRangeSubject(event.target.value)}
              />
            </label>
            <label className="sm-att-adv-field">
              <span>Teacher</span>
              <Select
                aria-label="Range teacher filter"
                value={rangeTeacherId}
                options={[{ value: '', label: 'All teachers' }, ...teachers.map((teacher) => ({ value: teacher.id, label: teacher.name }))]}
                onChange={(event) => setRangeTeacherId(event.target.value)}
              />
            </label>
          </div>
          {rangeSummaryQ.isLoading ? (
            <div className="sm-att-adv-state t-sm muted">Loading range rollup…</div>
          ) : rangeSummaryQ.isError ? (
            <div className="sm-att-adv-state">
              <div>
                <div className="fw6">Could not load range rollup.</div>
                <div className="t-sm muted">{rangeSummaryQ.error instanceof Error ? rangeSummaryQ.error.message : 'Please try again.'}</div>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => rangeSummaryQ.refetch()}>Retry</Btn>
            </div>
          ) : rangeSummaryQ.data && (
            <div className="sm-kpi-grid">
              <Kpi icon="checkCircle" label="Attendance %" value={pct(rangeSummaryQ.data.attendancePercentage)} />
              <Kpi icon="list" label="Marked periods" value={rangeSummaryQ.data.totalMarkedPeriods} />
              <Kpi icon="check" label="Present" value={rangeSummaryQ.data.present} />
              <Kpi icon="x" label="Absent" value={rangeSummaryQ.data.absent} />
              <Kpi icon="clock" label="Late" value={rangeSummaryQ.data.late} />
              <Kpi icon="calendar" label="Leave" value={rangeSummaryQ.data.leave} />
            </div>
          )}
          <Btn
            variant="secondary"
            size="sm"
            onClick={() => viewRecordsFor({
              preset: summaryPreset,
              classId: summaryClassId || undefined,
              subject: rangeSubject || undefined,
              assignedTeacherId: rangeTeacherId || undefined,
            })}
          >
            View matching records
          </Btn>
        </div>
      )}
    </Card>

    <Drawer
      open={!!auditRecordId}
      onClose={() => setAuditRecordId(null)}
      icon="clock"
      title="Attendance history"
      sub={auditRecordId ? `Record ${auditRecordId}` : undefined}
      width={420}
    >
      {auditQ.isLoading ? (
        <div className="t-sm muted">Loading history…</div>
      ) : auditQ.isError ? (
        <div className="col gap8">
          <div className="t-sm">Could not load history.</div>
          <Btn variant="secondary" size="sm" onClick={() => auditQ.refetch()}>Retry</Btn>
        </div>
      ) : auditQ.data?.length ? (
        <div className="col gap12">
          {auditQ.data.map((entry) => (
            <div key={entry.id} className="sm-att-adv-audit-row">
              <div className="row ai-center gap8">
                {entry.fromStatus ? (
                  <>
                    <Badge tone={statusTone(entry.fromStatus)}>{titleCase(entry.fromStatus)}</Badge>
                    <span className="t-sm muted">→</span>
                  </>
                ) : null}
                <Badge tone={statusTone(entry.toStatus)}>{titleCase(entry.toStatus)}</Badge>
              </div>
              <div className="t-sm">
                {entry.actorName || entry.actorId || 'Unknown'}
                {entry.actorRole ? ` · ${titleCase(entry.actorRole)}` : ''}
              </div>
              <div className="t-xs muted">{markedAt(entry.at)}</div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon="clock" title="No edit history for this record." />
      )}
    </Drawer>
    </>
  )
}
