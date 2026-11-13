import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ClassAttendanceOverview } from './classAttendanceOverview'

const dailyTrend = [
  { label: '1', value: 90 },
  { label: '2', value: 80 },
]

vi.mock('@/api/hooks/usePeriodAttendanceAdvanced', () => ({
  usePeriodAttendanceClassStudents: () => ({
    data: {
      students: [{
        studentId: 'student-1', studentName: 'Aarav Shah', present: 5, absent: 1, late: 0,
        attendancePercentage: 83,
        periods: [
          // Monday period 2 is present in the full list, but omitted from recentPeriods
          // (the last-6 cap). The day columns must still show it.
          { status: 'present', subject: 'Art', date: '2026-08-31', period: 2 },
          { status: 'present', subject: 'Mathematics', date: '2026-08-31', period: 1 },
          { status: 'present', subject: 'Science', date: '2026-09-04', period: 2 },
          { status: 'absent', subject: 'English', date: '2026-09-01', period: 3 },
          { status: 'present', subject: 'Hindi', date: '2026-09-02', period: 1 },
          { status: 'present', subject: 'Mathematics', date: '2026-09-03T00:00:00.000', period: 1 },
          { status: 'present', subject: 'Social Science', date: '2026-09-03', period: 2 },
        ],
        recentPeriods: [
          // 2026-08-31 = Mon, 2026-09-04 = Fri. The timetable mock below publishes
          // Mon period 1 = Computer (overrides the historically-recorded Mathematics)
          // and Fri period 2 = Science (matches what was recorded).
          { status: 'present', subject: 'Mathematics', date: '2026-08-31', period: 1 },
          { status: 'present', subject: 'Science', date: '2026-09-04', period: 2 },
          { status: 'absent', subject: 'English', date: '2026-09-01', period: 3 },
          { status: 'present', subject: 'Hindi', date: '2026-09-02', period: 1 },
          // Deliberately a full datetime (not a bare date) — reproduces a real backend shape and
          // is covered by the "matches a mark whose date is a full UTC datetime" regression test below.
          { status: 'present', subject: 'Mathematics', date: '2026-09-03T00:00:00.000', period: 1 },
          { status: 'present', subject: 'Social Science', date: '2026-09-03', period: 2 },
        ],
        tier: 'watch',
      }],
      dailyTrend,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceSubjectSummaries: () => ({
    data: [
      {
        subject: 'Mathematics', teacherName: 'Meera Krishnan', periods: 10, marked: 9, pending: 1,
        present: 8, absent: 1, late: 0, attendancePercentage: 89,
      },
      {
        subject: 'Mathematics', teacherName: 'Ravi Rao', periods: 10, marked: 9, pending: 1,
        present: 8, absent: 1, late: 0, attendancePercentage: 89,
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/api/hooks/useTimetable', () => ({
  useTimetable: () => ({
    data: [
      {
        id: 't1', day: 'Mon', period: 1, subject: 'Computer', classId: 'class-1', className: 'IV-B',
        room: null, startTime: null, endTime: null, teacherName: null, teacherId: null,
      },
      {
        id: 't2', day: 'Fri', period: 2, subject: 'Science', classId: 'class-1', className: 'IV-B',
        room: null, startTime: '09:00', endTime: '09:45', teacherName: null, teacherId: null,
      },
      {
        id: 't3', day: 'Mon', period: 2, subject: 'Art', classId: 'class-1', className: 'IV-B',
        room: null, startTime: null, endTime: null, teacherName: null, teacherId: null,
      },
      {
        id: 't4', day: 'Thu', period: 1, subject: 'History', classId: 'class-1', className: 'IV-B',
        room: null, startTime: null, endTime: null, teacherName: null, teacherId: null,
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/api/hooks/useClasses', () => ({
  useClasses: () => ({
    data: [{ id: 'class-1', name: 'IV-B', grade: 'IV', section: 'B' }],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
}))

vi.mock('@/api/hooks/useStudents', () => ({
  useStudents: () => ({
    data: [
      { id: 'student-1', name: 'Aarav Shah', cls: 'IV-B', grade: 'IV', section: 'B' },
      { id: 'student-2', name: 'Priya Nair', cls: 'IV-B', grade: 'IV', section: 'B' },
    ],
    isLoading: false, isError: false, error: null, refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks', () => ({
  useApp: () => ({
    school: { name: 'Greenwood International', city: 'Mumbai', logoUrl: null, logo: 'GW', color: '#4f46e5', currency: 'INR' },
  }),
  useToast: () => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }),
}))

const openReportPdf = vi.fn()
const downloadReportXls = vi.fn()
vi.mock('@/lib/reportExport', () => ({
  openReportPdf: (...args: unknown[]) => openReportPdf(...args),
  downloadReportXls: (...args: unknown[]) => downloadReportXls(...args),
}))

const downloadReportXlsx = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/reportXlsx', () => ({
  downloadReportXlsx: (...args: unknown[]) => downloadReportXlsx(...args),
}))

afterEach(() => cleanup())

describe('ClassAttendanceOverview', () => {
  it('shows the trend chart, subject breakdown, and student table for the given class', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" classLabel="Class 8-A" />)

    expect(screen.getByText('Attendance trend')).toBeInTheDocument()
    expect(screen.getByText('Subject attendance')).toBeInTheDocument()
    expect(screen.getByText('Class 8-A')).toBeInTheDocument()
    expect(screen.getByText('Aarav Shah')).toBeInTheDocument()
    expect(screen.getByText('Watch')).toBeInTheDocument()
    expect(screen.getByText('83%')).toBeInTheDocument()
  })

  it('collapses multiple per-teacher rows for the same subject into a single row', () => {
    const { container } = render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" classLabel="Class 8-A" />)
    const subjectCard = within(container).getByText('Subject attendance').closest<HTMLElement>('.sm-card')!

    // getByText throws if there's more than one match within this card — proves the two
    // Mathematics/teacher rows merged into one (the Recent Periods dots also say "Mathematics"
    // elsewhere on the page, so this assertion is deliberately scoped to the subject card).
    expect(within(subjectCard).getByText('Mathematics')).toBeInTheDocument()
    expect(within(subjectCard).getByText('89%')).toBeInTheDocument()
  })

  it('shows a status letter and the subject name together on each Recent Periods dot', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)

    // Live timetable subject wins where a slot matches (Mon period 1 -> "Computer", overriding the
    // historically-recorded "Mathematics"); falls back to the recorded subject with no timetable slot.
    expect(screen.getByText('P Computer')).toBeInTheDocument()
    expect(screen.getByText('A English')).toBeInTheDocument()
    expect(screen.getByText('P Hindi')).toBeInTheDocument()

    // Full detail (date/period/time/status) still available on hover.
    expect(screen.getByTitle('2026-08-31 · Period 1 · Computer · Present')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-01 · Period 3 · English · Absent')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-02 · Period 1 · Hindi · Present')).toBeInTheDocument()
  })

  it('includes the timetable slot\'s clock time in the tooltip when the matched slot has one', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)
    // Fri period 2 matches the timetable mock's Science slot, which has startTime/endTime set.
    expect(screen.getByTitle('2026-09-04 · Period 2 (09:00–09:45) · Science · Present')).toBeInTheDocument()
    expect(screen.getByText('P Science')).toBeInTheDocument()
  })

  it('fills in a blank dot (subject shown, no status letter) for a timetabled period the student was never marked for', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)
    // 2026-08-31 (Mon) period 1 was marked; the timetable also publishes period 2 (Art) that day,
    // but the student has no mark for it — must show a blank dot with the subject, not omit it.
    expect(screen.getByTitle('2026-08-31 · Period 2 · Art · Not marked')).toBeInTheDocument()
    expect(screen.getAllByText('Art').length).toBeGreaterThan(0)
  })

  it('shows a blank row for a timetable subject with no marks yet', () => {
    const { container } = render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)
    const subjectCard = within(container).getByText('Subject attendance').closest<HTMLElement>('.sm-card')!

    // The timetable mock publishes "Computer" for class-1, but no subject summary row exists for it.
    expect(within(subjectCard).getByText('Computer')).toBeInTheDocument()
    expect(within(subjectCard).getAllByText('—').length).toBeGreaterThan(0)
  })

  it('fullRoster: one column per subject scheduled that day, cell shows only the status letter', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster />)
    const table = screen.getByRole('table')

    // Column header comes from the live timetable (Fri period 2 = Science), not printed per-cell.
    expect(within(table).getByText('Science')).toBeInTheDocument()

    const aaravRow = screen.getByText('Aarav Shah').closest('tr')!
    expect(within(aaravRow).getByText('P')).toBeInTheDocument()
    expect(within(aaravRow).getByTitle('2026-09-04 · Period 2 (09:00–09:45) · Science · Present')).toBeInTheDocument()

    // Priya has no attendance rows at all in range — must still appear in the roster, blank cell.
    const priyaRow = screen.getByText('Priya Nair').closest('tr')!
    expect(within(priyaRow).queryByText('P')).not.toBeInTheDocument()
    expect(within(priyaRow).getByTitle('2026-09-04 · Period 2 (09:00–09:45) · Science · Not marked')).toBeInTheDocument()
    expect(within(priyaRow).getByText('—')).toBeInTheDocument()
  })

  it('regression: matches a mark whose date is a full UTC datetime, not just a bare date', () => {
    // 2026-09-03 (Thu) period 1 is marked with a datetime-shaped date, not a bare "2026-09-03" —
    // a real backend response shape. daySubjectColumns must still find and show it, not blank it out.
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-03" to="2026-09-03" fullRoster />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('History')).toBeInTheDocument()
    const aaravRow = screen.getByText('Aarav Shah').closest('tr')!
    expect(within(aaravRow).getByText('P')).toBeInTheDocument()
  })

  it('fullRoster + multi-day range: subject columns change per day, stepping with Next/Prev', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-08-31" to="2026-09-04" fullRoster />)

    // Day 1 (Mon 2026-08-31): timetable publishes Computer (P1) and Art (P2). Art is only on
    // the full period list, not the last-6 recentPeriods slice, and must still show Present.
    expect(within(screen.getByRole('table')).getByText('Computer')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Art')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('Science')).not.toBeInTheDocument()
    const aaravDay1 = screen.getByText('Aarav Shah').closest('tr')!
    expect(within(aaravDay1).getAllByText('P')).toHaveLength(2)
    expect(within(aaravDay1).getByTitle('2026-08-31 · Period 2 · Art · Present')).toBeInTheDocument()
    expect(screen.getByText(/1 of 5/)).toBeInTheDocument()

    const next = screen.getByText('Next →')
    fireEvent.click(next)
    fireEvent.click(next)
    fireEvent.click(next)
    fireEvent.click(next)

    // Day 5 (Fri 2026-09-04): timetable publishes only Science (P2, marked) — Monday's columns are gone.
    expect(screen.getByText(/5 of 5/)).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Science')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).queryByText('Computer')).not.toBeInTheDocument()
    const aaravDay5 = screen.getByText('Aarav Shah').closest('tr')!
    expect(within(aaravDay5).getByText('P')).toBeInTheDocument()
    expect(screen.getByText('Next →').closest('button')).toBeDisabled()
  })

  it('does not show the day stepper for a single-day range', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster />)
    expect(screen.queryByText('Next →')).not.toBeInTheDocument()
  })

  it('does not expand to the full roster or full-range blanks when fullRoster is omitted', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)
    // Default (Advanced tab) behavior: only students with marks in range appear.
    expect(screen.queryByText('Priya Nair')).not.toBeInTheDocument()
  })

  it('filters the student table by name via the search box', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster />)
    expect(screen.getByText('Aarav Shah')).toBeInTheDocument()
    expect(screen.getByText('Priya Nair')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search student…'), { target: { value: 'priya' } })
    expect(screen.queryByText('Aarav Shah')).not.toBeInTheDocument()
    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
  })

  it('shows a "no matches" empty state when the search filters out every student', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster />)
    fireEvent.change(screen.getByPlaceholderText('Search student…'), { target: { value: 'zzz-no-such-student' } })
    expect(screen.getByText('No students match your search')).toBeInTheDocument()
  })

  it('exports a PDF report matching the currently filtered rows', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster classLabel="IV-B" />)
    fireEvent.change(screen.getByPlaceholderText('Search student…'), { target: { value: 'aarav' } })
    fireEvent.click(screen.getByText('Export PDF'))

    expect(openReportPdf).toHaveBeenCalledTimes(1)
    const [spec, meta] = openReportPdf.mock.calls[0]
    expect(spec.rows).toHaveLength(1)
    expect(spec.rows[0][0]).toBe('Aarav Shah')
    expect(spec.columns).toContain('Science')
    expect(meta.schoolName).toBe('Greenwood International')

    // Science is column index 5 (Student, Present, Absent, Late, Attendance %, Science, Status) —
    // Aarav was marked present that period, so the exported cell should carry the green color.
    const scienceColIdx = spec.columns.indexOf('Science')
    expect(spec.cellColor[0][scienceColIdx]).toEqual({ bg: '#DCFCE7', text: '#166534' })
  })

  it('exports an Excel report, falling back to .xls if .xlsx generation throws', async () => {
    downloadReportXlsx.mockRejectedValueOnce(new Error('xlsx lib unavailable'))
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" fullRoster />)
    fireEvent.click(screen.getByText('Export Excel'))

    await new Promise((r) => setTimeout(r, 0))
    expect(downloadReportXlsx).toHaveBeenCalledTimes(1)
    expect(downloadReportXls).toHaveBeenCalledTimes(1)
  })

  it('does not show the drill-in hint or wire row clicks when onStudentClick is omitted', () => {
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" />)
    expect(screen.queryByText(/Click a student's row/)).not.toBeInTheDocument()
  })

  it('calls onStudentClick with the clicked row when provided', () => {
    const onStudentClick = vi.fn()
    render(<ClassAttendanceOverview classId="class-1" from="2026-09-04" to="2026-09-04" onStudentClick={onStudentClick} />)

    expect(screen.getByText(/Click a student's row/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Aarav Shah'))
    expect(onStudentClick).toHaveBeenCalledWith(expect.objectContaining({ studentId: 'student-1', studentName: 'Aarav Shah' }))
  })
})
