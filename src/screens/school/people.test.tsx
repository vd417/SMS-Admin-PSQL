import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { tokenStore } from '@/api/auth/tokenStore'
import { peopleScreens } from './people'

const TeachersScreen = peopleScreens['school.teachers']
const StaffScreen = peopleScreens['school.staff']
const TENANT_ID = 'school-1'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const TEACHER = {
  id: 'T1', name: 'Meera Rao', department: 'Science', designation: 'HOD', attendance_pct: 97,
  avatar_hue: 1, subjects: [], class_teacher: null, phone: '', email: 'meera@greenwood.edu',
  exp: 5, rating: 4.5, result: 80, load: 10, status: 'active', gender: 'F', top: false,
}

const STAFF = {
  id: 'S1', name: 'Suresh Raina', role: 'Driver', category: 'transport', department: 'Transport',
  phone: '', shift: 'Day', route: null, attendance_pct: 90, avatar_hue: 1, status: 'active',
  gender: 'M', email: 'suresh@greenwood.edu',
}

type UserRow = { id: string; email: string; status: string; roles: string[] }

function authAndSchoolResponse(url: string, method: string, role: string): Response | null {
  if (url.includes('/auth/refresh')) {
    return jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } })
  }
  if (url.includes('/auth/me')) {
    return jsonResponse({ data: { id: 'u1', tenant_id: TENANT_ID, roles: [role], is_platform: false } })
  }
  if (url.includes('/me/schools') && method === 'GET') {
    return jsonResponse({
      data: [{
        id: TENANT_ID, name: 'Greenwood High', slug: 'greenwood', country: 'IN', status: 'active',
        plan_id: null, plan_name: 'Platinum', tier: 'platinum', mrr: 0, students_count: 0,
        staff_count: 0, storage_gb: 0, created: '2026-01-01', contact_name: null,
        contact_email: null, contact_phone: null, address: null, health_score: 100,
      }],
      next_cursor: null,
    })
  }
  return null
}

function stubFetch(role: string, usersRows: UserRow[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? 'GET').toUpperCase()
    const auth = authAndSchoolResponse(url, method, role)
    if (auth) return Promise.resolve(auth)
    if (url.includes('/staff-attendance') && method === 'GET') {
      return Promise.resolve(jsonResponse({
        data: [
          { person_id: 'S1', date: '2026-11-01', status: 'present' },
          { person_id: 'S1', date: '2026-11-02', status: 'absent' },
        ],
      }))
    }
    if (url.includes('/transport/buses') && method === 'GET') {
      return Promise.resolve(jsonResponse({
        data: [{
          bus_id: 'b1', bus_no: 'BUS-1', route_name: 'North Loop',
          driver_staff_id: 'S1', stop_count: 0, students_assigned: 0,
        }],
      }))
    }
    if (url.includes('/teachers') && method === 'GET') {
      return Promise.resolve(jsonResponse({ data: [TEACHER], next_cursor: null }))
    }
    if (url.includes('/staff') && method === 'GET') {
      return Promise.resolve(jsonResponse({ data: [STAFF], next_cursor: null }))
    }
    if (url.includes('/users') && method === 'GET') {
      return Promise.resolve(jsonResponse({
        data: usersRows.map((r) => ({ id: r.id, email: r.email, phone: null, status: r.status, created_at: '2026-01-01', roles: r.roles })),
      }))
    }
    if (url.includes('/status') && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      const userId = url.match(/\/users\/([^/]+)\/status/)?.[1]
      const row = usersRows.find((r) => r.id === userId)
      if (row) row.status = body.active ? 'active' : 'inactive'
      return Promise.resolve(jsonResponse({
        data: { id: 'U1', email: TEACHER.email, phone: null, status: body.active ? 'active' : 'inactive', created_at: '2026-01-01', roles: ['school.teacher'] },
      }))
    }
    return Promise.resolve(jsonResponse({ data: [], next_cursor: null }))
  }))
}

function renderTeachers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <TeachersScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

function renderStaff() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <StaffScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  tokenStore.set({ access_token: 'a', refresh_token: 'r' })
  tokenStore.setEmail('admin@greenwood.edu')
})

afterEach(() => {
  tokenStore.clear()
  vi.unstubAllGlobals()
})

/** With one teacher, "Meera Rao" renders twice — once in the Top performers card
 *  (not clickable) and once in the roster table row (clickable, opens the drawer).
 *  The table row is the second match in document order. */
async function openTeacherProfile() {
  await waitFor(() => expect(screen.getAllByText('Meera Rao').length).toBeGreaterThan(0))
  fireEvent.click(screen.getAllByText('Meera Rao')[1])
  await waitFor(() => expect(screen.getByText('Photo & documents')).toBeInTheDocument())
}

/** The drawer's "Active"/"Suspend" text can collide with the person's own Status field
 *  and with the roster table's status badge for the same teacher, all rendered at once.
 *  Scope assertions to the "App access" card itself to avoid that ambiguity. */
function accessCard(): HTMLElement {
  const heading = screen.getByText('App access')
  const card = heading.closest('.sm-card')
  if (!card) throw new Error('App access card not found')
  return card as HTMLElement
}

describe('Teacher profile — App access card', () => {
  it('shows Suspend for an active linked account (admin viewer)', async () => {
    stubFetch('school.admin', [{ id: 'U1', email: TEACHER.email, status: 'active', roles: ['school.teacher'] }])
    renderTeachers()
    await openTeacherProfile()
    expect(within(accessCard()).getByText('Active')).toBeInTheDocument()
    expect(within(accessCard()).getByText('Suspend')).toBeInTheDocument()
  })

  it('suspends the account and flips the button to Unsuspend', async () => {
    stubFetch('school.admin', [{ id: 'U1', email: TEACHER.email, status: 'active', roles: ['school.teacher'] }])
    renderTeachers()
    await openTeacherProfile()
    fireEvent.click(within(accessCard()).getByText('Suspend'))
    // Suspend confirms in a modal before it takes effect — the modal is nested inside
    // the drawer's own dialog, so scope to its title rather than role="dialog".
    const modalTitle = await screen.findByText('Suspend app access')
    const modal = modalTitle.closest('.sm-modal')
    if (!modal) throw new Error('confirm modal not found')
    fireEvent.click(within(modal as HTMLElement).getByText('Suspend'))
    await waitFor(() => expect(within(accessCard()).getByText('Unsuspend')).toBeInTheDocument())
    expect(within(accessCard()).getByText('Suspended')).toBeInTheDocument()
  })

  it('shows "Not yet invited to the app" when no linked account matches', async () => {
    stubFetch('school.admin', [])
    renderTeachers()
    await openTeacherProfile()
    expect(screen.getByText('Not yet invited to the app.')).toBeInTheDocument()
  })

  it('hides the Access card for a teacher viewer', async () => {
    stubFetch('school.teacher', [{ id: 'U1', email: TEACHER.email, status: 'active', roles: ['school.teacher'] }])
    renderTeachers()
    await openTeacherProfile()
    expect(screen.queryByText('App access')).not.toBeInTheDocument()
  })

  it('does not offer Suspend for a pending invite', async () => {
    stubFetch('school.admin', [{ id: 'U1', email: TEACHER.email, status: 'pending', roles: ['school.teacher'] }])
    renderTeachers()
    await openTeacherProfile()
    expect(within(accessCard()).getByText('pending')).toBeInTheDocument()
    expect(within(accessCard()).queryByText('Suspend')).not.toBeInTheDocument()
  })

  it('shows the Access card for a principal viewer too', async () => {
    stubFetch('school.principal', [{ id: 'U1', email: TEACHER.email, status: 'active', roles: ['school.teacher'] }])
    renderTeachers()
    await openTeacherProfile()
    expect(within(accessCard()).getByText('Suspend')).toBeInTheDocument()
  })
})

describe('Teacher roster row — Suspend action', () => {
  it('shows Suspend directly in the roster row for an active linked account', async () => {
    stubFetch('school.admin', [{ id: 'U1', email: TEACHER.email, status: 'active', roles: ['school.teacher'] }])
    renderTeachers()
    await waitFor(() => expect(screen.getAllByText('Meera Rao').length).toBeGreaterThan(0))
    const row = screen.getAllByText('Meera Rao')[1].closest('tr')
    if (!row) throw new Error('roster row not found')
    expect(within(row).getByText('Suspend')).toBeInTheDocument()
    expect(within(row).getByText('Overall 97%')).toBeInTheDocument()
  })

  it('does not show Suspend in the roster row when there is no linked account', async () => {
    stubFetch('school.admin', [])
    renderTeachers()
    await waitFor(() => expect(screen.getAllByText('Meera Rao').length).toBeGreaterThan(0))
    const row = screen.getAllByText('Meera Rao')[1].closest('tr')
    if (!row) throw new Error('roster row not found')
    expect(within(row).queryByText('Suspend')).not.toBeInTheDocument()
  })
})

describe('Staff roster row — Suspend action', () => {
  it('shows Suspend for a non-leadership role like "driver" (matches real prod data)', async () => {
    stubFetch('school.admin', [{ id: 'U1', email: STAFF.email, status: 'active', roles: ['driver'] }])
    renderStaff()
    await waitFor(() => expect(screen.getAllByText('Suresh Raina').length).toBeGreaterThan(0))
    const row = screen.getAllByText('Suresh Raina')[0].closest('tr')
    if (!row) throw new Error('roster row not found')
    expect(within(row).getByText('Suspend')).toBeInTheDocument()
    expect(within(row).getByText('North Loop')).toBeInTheDocument()
    await waitFor(() => expect(within(row).getByText('50%')).toBeInTheDocument())
  })
})
