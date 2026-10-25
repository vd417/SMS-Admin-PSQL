import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { students as seed } from '@/data/mockDb'
import { sisScreens } from './sis'
import type { Student } from '@/types'

const StudentsScreen = sisScreens['school.sis']

function toWire(s: Student) {
  return {
    id: s.id, admission_no: s.adm, name: s.name, gender: s.gender, grade: s.grade,
    section: s.section, class_label: s.cls, roll: s.roll, guardian: s.guardian, phone: s.phone,
    attendance: s.attendance, fee_status: s.feeStatus, fee_due: s.feeDue, status: s.status,
    house: s.house, avatar_hue: s.avatarHue,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
  // StudentsScreen fires several concurrent queries on mount (students, classes, exams,
  // exam marks, exam papers). mockResolvedValue would hand every one of them the SAME
  // Response instance, whose body can only be read once — every query after the first
  // would fail with "body already read" and silently resolve to {} (readJson swallows
  // that TypeError). Build a fresh Response per call instead.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    Promise.resolve(jsonResponse({ data: seed.map(toWire), next_cursor: null }))))
})

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <StudentsScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

describe('Students Toppers view', () => {
  it('defaults to the All students list', () => {
    renderScreen()
    expect(screen.getByPlaceholderText(/Search name/i)).toBeInTheDocument()
  })

  it('switches to the Toppers tab (live exam marks or empty)', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Toppers'))
    expect(await screen.findByText(/Exam toppers|Overall toppers|No live exam marks/i)).toBeInTheDocument()
  }, 15000)

  // Does two rounds of async waiting (Toppers tab, then Attendance toppers) — under CI/parallel
  // test-run CPU contention this can miss the default 5s test timeout despite the app itself
  // responding correctly (confirmed: passes reliably in isolation). Give it real headroom rather
  // than let it flake, same as the heavier cases in studentAdd.test.tsx.
  it('switches the category to Attendance toppers', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Toppers'))
    await screen.findByText(/Exam toppers|Overall toppers|No live exam marks/i)
    fireEvent.click(screen.getByText('Attendance Toppers'))
    // Attendance toppers now rank on real day marks only. With no live marks in
    // the test env, the empty state shows; otherwise the leaderboard renders.
    expect((await screen.findAllByText(/Attendance %|Overall toppers|No live attendance/i)).length).toBeGreaterThan(0)
  }, 15000)

  it('returns to the list when All students is reselected', async () => {
    renderScreen()
    fireEvent.click(screen.getByText('Toppers'))
    await screen.findByText(/Exam toppers|Overall toppers|No live exam marks/i)
    fireEvent.click(screen.getByText('All Students'))
    expect(screen.getByPlaceholderText(/Search name/i)).toBeInTheDocument()
  }, 15000)

  it('renders students from the live API, not the mock seed', async () => {
    const liveStudent = {
      id: 'live-api-student-001',
      admission_no: 'LIVE-API-0001',
      name: 'ZZ Live-API Only',
      gender: 'M' as const,
      grade: '10',
      section: 'Z',
      class_label: '10-Z',
      roll: 99,
      guardian: 'Live Guardian',
      phone: '9999999999',
      attendance: 85,
      fee_status: 'paid' as const,
      fee_due: 0,
      status: 'active' as const,
      house: 'Red',
      avatar_hue: 200,
    }
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: [liveStudent], next_cursor: null }))))
    renderScreen()
    expect(await screen.findByText('ZZ Live-API Only')).toBeInTheDocument()
  }, 15000)
})
