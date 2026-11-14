import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PeriodAttendanceAdvancedFilters } from '@/api/periodAttendanceAdvanced'

const advancedFilters = vi.fn<(filters: PeriodAttendanceAdvancedFilters) => unknown>()
const refetch = vi.fn()

vi.mock('@/api/hooks/usePeriodAttendanceAdvanced', () => ({
  usePeriodAttendanceAdvanced: (filters: PeriodAttendanceAdvancedFilters) => {
    advancedFilters(filters)
    return {
      data: {
        items: [{
          id: 'mark-1',
          classId: 'class-1',
          grade: 'IX',
          section: 'A',
          classLabel: 'IX-A',
          studentId: 'student-1',
          studentName: 'Aarav Shah',
          admissionNo: 'ADM-001',
          date: '2026-08-13',
          period: 2,
          periodId: 'period-2',
          subject: 'Mathematics',
          subjectId: 'subject-1',
          startTime: '09:45',
          endTime: '10:30',
          status: 'present',
          assignedTeacherId: 'teacher-1',
          assignedTeacherName: 'Meera Krishnan',
          markedBy: 'user-1',
          markedByName: 'Admin User',
          markedByRole: 'admin',
          markedAt: '2026-08-13T10:00:00Z',
          geoFenceStatus: 'not_required',
        }],
        totalCount: 30,
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 25,
      },
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    }
  },
  usePeriodAttendanceClassDaySummary: () => ({
    data: {
      totalStudents: 30, present: 25, absent: 3, late: 1, leave: 1, notMarked: 0,
      attendancePercentage: 86.67, totalPeriods: 30, markedPeriods: 30, pendingPeriods: 0,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceSubjectSummaries: () => ({
    data: [{
      subject: 'Mathematics', teacherName: 'Meera Krishnan', periods: 20, marked: 18, pending: 2,
      present: 16, absent: 2, late: 0, attendancePercentage: 88.9,
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceTeacherSummaries: () => ({
    data: [{
      teacherId: 'teacher-1', teacherName: 'Meera Krishnan', classes: 3, sections: 4, subjects: 2,
      expectedPeriods: 40, markedPeriods: 38, pendingPeriods: 2,
      teacherMarked: 30, staffMarked: 5, principalMarked: 2, adminMarked: 1,
    }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceRangeSummary: () => ({
    data: {
      totalMarkedPeriods: 120, present: 100, absent: 10, late: 8, leave: 2, attendancePercentage: 90,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceAudit: () => ({
    data: [
      {
        id: 'a2', recordId: 'mark-1', classId: 'class-1', studentId: 'student-1', date: '2026-08-13',
        period: 2, subject: 'Mathematics', fromStatus: 'present', toStatus: 'absent',
        actorId: 'user-2', actorName: 'Principal Rao', actorRole: 'principal', at: '2026-08-13T11:00:00Z',
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDashboardAttendanceTrend: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  usePeriodAttendanceClassStudents: () => ({
    data: {
      students: [{
        studentId: 'student-1', studentName: 'Aarav Shah', present: 5, absent: 1, late: 0,
        attendancePercentage: 83,
        recentPeriods: [
          { status: 'present', subject: 'Mathematics', date: '2026-08-31', period: 1 },
          { status: 'present', subject: 'Science', date: '2026-09-01', period: 2 },
          { status: 'absent', subject: 'English', date: '2026-09-02', period: 3 },
          { status: 'present', subject: 'Hindi', date: '2026-09-03', period: 1 },
          { status: 'present', subject: 'Mathematics', date: '2026-09-04', period: 1 },
          { status: 'present', subject: 'Science', date: '2026-09-04', period: 2 },
        ],
        tier: 'watch',
      }],
      dailyTrend: [{ label: '1', value: 90 }, { label: '2', value: 95 }],
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/api/hooks/useTimetable', () => ({
  useTimetable: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/api/hooks/useClasses', () => ({
  useClasses: () => ({
    data: [
      { id: 'class-1', name: 'IX-A', grade: 'IX', section: 'A', subjects: ['Mathematics'] },
      { id: 'class-2', name: 'X-B', grade: 'X', section: 'B', subjects: ['Science'] },
    ],
    isLoading: false,
  }),
}))

vi.mock('@/api/hooks/useTeachers', () => ({
  useTeachers: () => ({
    data: [{ id: 'teacher-1', name: 'Meera Krishnan' }],
    isLoading: false,
  }),
}))

vi.mock('@/api/hooks/useStudents', () => ({ useStudents: () => ({ data: [] }) }))
vi.mock('@/api/hooks/useStaff', () => ({ useStaff: () => ({ data: [] }) }))
vi.mock('@/api/hooks/usePrincipalAttendance', () => ({
  usePrincipalAttendance: () => ({ data: undefined, isLoading: false, isSuccess: false }),
  useStaffCheckIns: () => ({
    staff: [],
    checkIn: new Map(),
    principalKnown: false,
    loading: false,
  }),
}))
vi.mock('@/lib/hooks', () => ({
  useApp: () => ({
    role: 'admin', plan: 'platinum',
    school: { name: 'Greenwood International', city: 'Mumbai', logoUrl: null, logo: 'GW', color: '#4f46e5', currency: 'INR' },
  }),
  useToast: () => ({ success: vi.fn(), danger: vi.fn() }),
}))
vi.mock('./attendanceClassWise', () => ({
  ClassWiseStudents: () => <div>Students mark path</div>,
}))

import { AttendanceAdvanced } from './attendanceAdvanced'
import { attendanceScreens } from './attendance'

afterEach(cleanup)

beforeEach(() => {
  advancedFilters.mockClear()
  refetch.mockClear()
})

describe('AttendanceAdvanced', () => {
  it('starts with today and 25-row pagination, then sends status changes to the query', async () => {
    render(<AttendanceAdvanced />)

    expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: 'today',
      page: 1,
      pageSize: 25,
    }))
    expect(screen.getByText('Aarav Shah')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Marked By' })).toBeInTheDocument()
    expect(screen.getByText('Admin User')).toBeInTheDocument()
    expect(screen.getAllByText('Not required').length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'absent' } })

    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'absent',
      page: 1,
    })))
  })

  it('uses live classes and teachers in filter dropdowns and pages server results', async () => {
    render(<AttendanceAdvanced />)

    expect(screen.getByRole('option', { name: 'IX-A' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Meera Krishnan' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })

  it('uses a supported week preset and clears custom bounds when leaving custom range', async () => {
    render(<AttendanceAdvanced />)

    expect(screen.getByRole('option', { name: 'This week' })).toHaveValue('this_week')
    expect(screen.queryByRole('option', { name: 'Last 7 days' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date preset'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-07' } })
    fireEvent.change(screen.getByLabelText('Date preset'), { target: { value: 'today' } })

    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith({
      preset: 'today',
      page: 1,
      pageSize: 25,
    }))
  })

  it('clears the selected section when the class grade changes', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'IX' } })
    fireEvent.change(screen.getByLabelText('Section'), { target: { value: 'class-1' } })
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'X' } })

    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      grade: 'X',
    })))
    expect(advancedFilters).toHaveBeenLastCalledWith(expect.not.objectContaining({
      classId: expect.anything(),
    }))
  })

  it('forwards Staff as a marked-by role filter', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.change(screen.getByLabelText('Marked by role'), { target: { value: 'staff' } })

    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      markedByRole: 'staff',
      page: 1,
    })))
  })

  it('forwards a geo-fence filter and opens the audit history drawer', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.change(screen.getByLabelText('Geo-fence'), { target: { value: 'outside' } })
    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      geoFenceStatus: 'outside',
      page: 1,
    })))

    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByText('Attendance history')).toBeInTheDocument()
    expect(screen.getByText('Principal Rao · Principal')).toBeInTheDocument()
  })
})

describe('AttendanceAdvanced subviews', () => {
  it('shows the Class KPI summary once a section is chosen', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Class' }))
    expect(screen.getByText('Choose a section to see its day summary.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Class for summary'), { target: { value: 'class-1' } })
    expect(screen.getByText('87%')).toBeInTheDocument()
  })

  it('shows a per-student attendance table once a section is chosen, and drills into Records on row click', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Class' }))
    fireEvent.change(screen.getByLabelText('Class for summary'), { target: { value: 'class-1' } })

    expect(screen.getByText('Aarav Shah')).toBeInTheDocument()
    expect(screen.getByText('Watch')).toBeInTheDocument()
    expect(screen.getByText('83%')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Aarav Shah'))
    await waitFor(() => expect(screen.getByText('Advanced period attendance')).toBeInTheDocument())
    expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      classId: 'class-1', q: 'Aarav Shah',
    }))
  })

  it('narrows the Class subview\'s Section options to the chosen Class (grade)', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Class' }))
    const sectionSelect = screen.getByLabelText('Class for summary')
    expect(within(sectionSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a section…', 'IX-A', 'X-B',
    ])

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'IX' } })
    expect(within(sectionSelect).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose a section…', 'IX-A',
    ])
  })

  it('shows Subject summary rows and drills into Records on click', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Subject' }))
    fireEvent.change(screen.getByLabelText('Class for subject summary'), { target: { value: 'class-1' } })
    expect(screen.getByText('Mathematics')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Mathematics'))
    await waitFor(() => expect(screen.getByText('Advanced period attendance')).toBeInTheDocument())
    expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      classId: 'class-1', subject: 'Mathematics',
    }))
  })

  it('shows Teacher summary rows', () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Teacher' }))
    expect(screen.getByText('Meera Krishnan')).toBeInTheDocument()
  })

  it('shows the Ranges rollup and can drill into Records', async () => {
    render(<AttendanceAdvanced />)

    fireEvent.click(screen.getByRole('button', { name: 'Ranges' }))
    expect(screen.getByText('90%')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View matching records' }))
    await waitFor(() => expect(advancedFilters).toHaveBeenLastCalledWith(expect.objectContaining({
      preset: 'last_30_days',
    })))
  })
})

describe('Attendance screen Advanced wiring', () => {
  it('keeps the Students mark path and mounts the Advanced list from its tab', () => {
    const AttendanceScreen = attendanceScreens['school.attendance']
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={queryClient}>
        <AttendanceScreen />
      </QueryClientProvider>,
    )

    expect(screen.getByText('Students mark path')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByText('Advanced period attendance')).toBeInTheDocument()
  })
})
