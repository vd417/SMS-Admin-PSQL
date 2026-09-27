import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ptmScreens } from './ptm'

const PtmScreen = ptmScreens['school.ptm']

const ROWS = [
  {
    id: 'ptm-1', date: '2026-10-10', time: '10:30', teacher: 'Meera Krishnan',
    subject: 'Maths', studentId: 'student-1', mode: 'Video call', status: 'pending',
    studentName: 'Aarav Shah', teacherId: 'teacher-1',
  },
  {
    id: 'ptm-2', date: '2026-10-12', time: '11:00', teacher: 'Ravi Rao',
    subject: null, studentId: 'student-2', mode: 'In person', status: 'confirmed',
    studentName: 'Priya Nair', teacherId: 'teacher-2',
  },
]

const createMutate = vi.fn()
const deleteMutate = vi.fn()
const usePtmMock = vi.fn()

vi.mock('@/api/hooks/usePtm', () => ({
  usePtm: (...args: unknown[]) => usePtmMock(...args),
  useCreatePtm: () => ({ mutate: createMutate, isPending: false }),
  useDeletePtm: () => ({ mutate: deleteMutate, isPending: false }),
}))

vi.mock('@/api/hooks/useTeachers', () => ({
  useTeachers: () => ({ data: [
    { id: 'teacher-1', name: 'Meera Krishnan' },
    { id: 'teacher-2', name: 'Ravi Rao' },
  ] }),
}))

vi.mock('@/api/hooks/useStudents', () => ({
  useStudents: () => ({ data: [
    { id: 'student-1', name: 'Aarav Shah' },
    { id: 'student-2', name: 'Priya Nair' },
  ] }),
}))

vi.mock('@/lib/hooks', () => ({
  useApp: () => ({ role: 'admin', school: { name: 'Greenwood', city: 'Mumbai' } }),
  useToast: () => ({ success: vi.fn(), danger: vi.fn(), info: vi.fn() }),
}))

const dialog = () => screen.getByRole('dialog')
const fieldOf = (label: string) => within(dialog()).getByText(label).closest('.sm-field') as HTMLElement
const setSelect = (label: string, value: string) =>
  fireEvent.change(within(fieldOf(label)).getByRole('combobox'), { target: { value } })
const setDate = (label: string, value: string) =>
  fireEvent.change(fieldOf(label).querySelector('input[type="date"]') as HTMLInputElement, { target: { value } })
const setTime = (label: string, value: string) =>
  fireEvent.change(fieldOf(label).querySelector('input[type="time"]') as HTMLInputElement, { target: { value } })
const setText = (label: string, value: string) =>
  fireEvent.change(within(fieldOf(label)).getByRole('textbox'), { target: { value } })

beforeEach(() => {
  usePtmMock.mockReturnValue({ data: ROWS, isLoading: false, isError: false, error: null })
})

afterEach(() => {
  cleanup()
  createMutate.mockClear()
  deleteMutate.mockClear()
  usePtmMock.mockReset()
})

describe('PtmScreen', () => {
  it('renders rows from the mocked hook', () => {
    render(<PtmScreen />)
    const table = screen.getByRole('table')
    expect(within(table).getByText('Aarav Shah')).toBeInTheDocument()
    expect(within(table).getByText('Priya Nair')).toBeInTheDocument()
    expect(within(table).getByText('Meera Krishnan')).toBeInTheDocument()
    expect(within(table).getByText('Pending')).toBeInTheDocument()
    expect(within(table).getByText('Confirmed')).toBeInTheDocument()
  })

  it('submits the schedule modal with the entered values, calling create', () => {
    render(<PtmScreen />)
    fireEvent.click(screen.getByText('Schedule meeting'))

    setSelect('Student', 'student-1')
    setSelect('Teacher', 'teacher-2')
    setText('Subject', 'Science')
    setDate('Date', '2026-11-01')
    setTime('Time', '09:15')
    setSelect('Mode', 'Video call')

    fireEvent.click(screen.getByRole('button', { name: /^schedule$/i }))

    expect(createMutate).toHaveBeenCalledTimes(1)
    const [input] = createMutate.mock.calls[0]
    expect(input).toEqual({
      studentId: 'student-1',
      teacherId: 'teacher-2',
      subject: 'Science',
      date: '2026-11-01',
      time: '09:15',
      mode: 'Video call',
    })
  })

  it('cancels a meeting via the delete confirmation', () => {
    render(<PtmScreen />)
    const trashButtons = screen.getAllByLabelText('Cancel meeting')
    fireEvent.click(trashButtons[0])
    expect(screen.getByText('Cancel this meeting?')).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: /^cancel meeting$/i }))
    expect(deleteMutate).toHaveBeenCalledWith('ptm-1', expect.anything())
  })

  it('shows an error state with the failure message instead of "No meetings"', () => {
    usePtmMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Could not reach the server'),
    })
    render(<PtmScreen />)
    expect(screen.getByText('Could not load meetings')).toBeInTheDocument()
    expect(screen.getByText('Could not reach the server')).toBeInTheDocument()
    expect(screen.queryByText('No meetings')).not.toBeInTheDocument()
  })
})
