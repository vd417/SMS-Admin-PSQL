import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider, useApp } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { teacherAddScreens, teacherToForm } from './teacherAdd'

const AddTeacherScreen = teacherAddScreens['school.teachers.add']

function Probe() {
  const app = useApp()
  return <div data-testid="probe">{app.teachers.length}|{app.view}</div>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <Probe />
          <AddTeacherScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

const probe = () => screen.getByTestId('probe').textContent ?? ''
const view = () => probe().split('|')[1]

const fieldOf = (label: string) => screen.getByText(label).closest('.sm-field') as HTMLElement
const setText = (label: string, value: string) =>
  fireEvent.change(within(fieldOf(label)).getByRole('textbox'), { target: { value } })
const setSelect = (label: string, value: string) =>
  fireEvent.change(within(fieldOf(label)).getByRole('combobox'), { target: { value } })
// password inputs expose no ARIA role, so target the raw <input>
const setInput = (label: string, value: string) =>
  fireEvent.change(fieldOf(label).querySelector('input') as HTMLInputElement, { target: { value } })

function fillRequired() {
  setText('First name', 'Rajesh')
  setText('Last name', 'Kumar')
  setText('Primary contact number', '9876543210')
  setText('Email address', 'rajesh.kumar@school.edu')
  setSelect('Department', 'Mathematics')
  setSelect('Designation', 'Teacher')
}

describe('Add Teacher form', () => {
  it('blocks save and shows errors when required fields are empty', () => {
    renderForm()
    const start = Number(probe().split('|')[0])
    fireEvent.click(screen.getByText('Save teacher'))
    expect(Number(probe().split('|')[0])).toBe(start)
    expect(view()).not.toBe('school.teachers')
    expect(screen.getAllByText('This field is required').length).toBeGreaterThan(0)
  })

  it('shows the auto-generated teacher ID as read-only', () => {
    renderForm()
    expect(fieldOf('Teacher ID').querySelector('input')).toHaveAttribute('readonly')
  })

  it('offers a Role field defaulting to Teacher, separate from Department/Designation', () => {
    renderForm()
    const combo = within(fieldOf('Role')).getByRole('combobox') as HTMLSelectElement
    expect(combo.value).toBe('Teacher')
    const values = Array.from(combo.options).map((o) => o.value)
    expect(values).toEqual(expect.arrayContaining(['Admin', 'Principal', 'Vice-Principal', 'Teacher', 'Staff']))
  })

  it('keeps role values out of the Department options', () => {
    renderForm()
    const combo = within(fieldOf('Department')).getByRole('combobox') as HTMLSelectElement
    const values = Array.from(combo.options).map((o) => o.value)
    expect(values).toContain('Mathematics')
    expect(values).not.toContain('Principal')
    expect(values).not.toContain('Admin')
    expect(values).not.toContain('Vice Principal')
  })

  it('auto-increments the teacher ID past the highest existing code for this school', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown) => {
      if (String(url).includes('/teachers')) {
        return Promise.resolve(jsonResponse({
          data: [{
            id: 't1', name: 'Existing One', gender: 'M', department: 'Science', designation: 'Teacher',
            attendance_pct: 0, employee_code: 'sch/TCH/26/0004',
          }],
          next_cursor: null,
        }))
      }
      return Promise.resolve(jsonResponse({ data: [], next_cursor: null }))
    }))
    renderForm()
    const input = fieldOf('Teacher ID').querySelector('input') as HTMLInputElement
    await waitFor(() => expect(input).toHaveValue('sch/TCH/26/0005'))
    vi.unstubAllGlobals()
  })

  it('blocks save when passwords do not match', () => {
    renderForm()
    fillRequired()
    setInput('Password', 'secret1')
    setInput('Confirm password', 'secret2')
    fireEvent.click(screen.getByText('Save teacher'))
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(view()).not.toBe('school.teachers')
  }, 15000)

  it('adds the teacher and navigates back when valid', async () => {
    // Return a fresh Response per call: the form mounts a roster query that reads
    // one body before the create POST, and a Response body can only be read once.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({
      data: {
        id: 'srv', name: 'Rajesh Kumar', gender: 'M',
        department: 'Mathematics', designation: 'Teacher', attendance_pct: 0,
      },
    }))))

    renderForm()
    fillRequired()
    fireEvent.click(screen.getByText('Save teacher'))

    await waitFor(() => expect(view()).toBe('school.teachers'))
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/teachers')

    vi.unstubAllGlobals()
  }, 15000)
})

describe('teacherToForm extras', () => {
  it('hydrates father name and PAN from extras fields on the teacher', () => {
    const f = teacherToForm({
      id: 't1', name: 'Amit Yadav', gender: 'M', dept: 'Music', desig: 'Teacher',
      subjects: ['Music'], classTeacher: null, phone: '900', email: 'a@s.edu',
      exp: 3, rating: 0, attendance: 0, result: 0, load: 0, status: 'active',
      avatarHue: 1, top: false,
      fatherName: 'Ramesh Yadav', pan: 'ABCDE1234F', aadhaar: '123412341234',
    })
    expect(f.fatherName).toBe('Ramesh Yadav')
    expect(f.pan).toBe('ABCDE1234F')
    expect(f.aadhaar).toBe('123412341234')
  })

  it('hydrates the access role from the teacher', () => {
    const f = teacherToForm({
      id: 't1', name: 'Amit Yadav', gender: 'M', dept: 'Music', desig: 'Teacher',
      subjects: ['Music'], classTeacher: null, phone: '900', email: 'a@s.edu',
      exp: 3, rating: 0, attendance: 0, result: 0, load: 0, status: 'active',
      avatarHue: 1, top: false, role: 'Principal',
    })
    expect(f.role).toBe('Principal')
  })
})
