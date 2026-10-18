import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider, useApp } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { clearPersonExtrasMemory } from '@/api/personExtrasApi'
import { tokenStore } from '@/api/auth/tokenStore'
import { studentAddScreens, studentToForm } from './studentAdd'
import type { Student } from '@/types'

const AddStudentScreen = studentAddScreens['school.sis.add']
const EditStudentScreen = studentAddScreens['school.sis.edit']

/* Surfaces roster size + current view so assertions can observe the
   effect of a save without reaching into provider internals. */
function Probe() {
  const app = useApp()
  return <div data-testid="probe">{app.students.length}|{app.view}</div>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const STUDENT_ROW = {
  id: 'srv', admission_no: 'A1', class_label: 'VIII-A', name: 'X',
  gender: 'M', grade: 'VIII', section: 'A', roll: 1, guardian_name: 'Test Father',
  guardian_phone: '9876543210', attendance_pct: 0, fee_status: 'due', fee_due: 0,
  status: 'active', house: 'Ruby', avatar_hue: 1,
}

/* Endpoint/method-aware fetch stub. Returns a *fresh* Response per call (a Response
   body can only be read once). List GETs return array envelopes so roster queries
   don't crash; the create POST returns the single created row. */
function makeFetch() {
  return vi.fn().mockImplementation((url: unknown, init?: { method?: string }) => {
    const u = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (u.includes('/classes')) {
      return Promise.resolve(jsonResponse({
        data: [{ id: 'c1', name: 'VIII-A', grade: 'VIII', section: 'A', room: null, class_teacher_id: null, student_count: 0 }],
        next_cursor: null,
      }))
    }
    if (u.includes('/students') && method === 'GET') {
      return Promise.resolve(jsonResponse({ data: [STUDENT_ROW], next_cursor: null }))
    }
    return Promise.resolve(jsonResponse({ data: STUDENT_ROW }))
  })
}

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <Probe />
          <AddStudentScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

const probe = () => screen.getByTestId('probe').textContent ?? ''

/* Fill everything except Class (a live-data picker selected separately once its
   options have loaded). Class + Section are now one combined "Class" selector. */
function fillRequired() {
  // Admission number is auto-generated and read-only — not set here (see the dedicated test below).
  fireEvent.change(within(screen.getByText('First name').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: 'Test' } })
  fireEvent.change(within(screen.getByText('Last name').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: 'Student' } })
  // Deliberately different from STUDENT_ROW's guardian_phone (an existing roster row in these
  // tests) — phone numbers must now be unique across students, so reusing it would be rejected.
  fireEvent.change(within(screen.getByText('Primary contact number').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: '9998887770' } })
  fireEvent.change(within(screen.getByText('Email address').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: 'test.student@school.edu' } })
  fireEvent.change(within(screen.getByText('Father name').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: 'Test Father' } })
  fireEvent.change(within(screen.getByText('Gender').closest('.sm-field') as HTMLElement).getByRole('combobox'), { target: { value: 'M' } })
  const dob = (screen.getByText('Date of birth').closest('.sm-field') as HTMLElement).querySelector('input') as HTMLInputElement
  fireEvent.change(dob, { target: { value: '2014-05-01' } })
}

const classCombo = () => within(screen.getByText('Class').closest('.sm-field') as HTMLElement).getByRole('combobox')

describe('Add Student form', () => {
  // Prior test files can leave a session/UI in localStorage; AppProvider's mount
  // restore effect would then reload it and clobber our navigation. Start clean.
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('blocks save and shows errors when required fields are empty', () => {
    renderForm()
    const start = Number(probe().split('|')[0])
    fireEvent.click(screen.getByText('Save student'))
    // roster unchanged, still on the add page
    expect(Number(probe().split('|')[0])).toBe(start)
    expect(probe().split('|')[1]).not.toBe('school.sis')
    // at least one required-field error is shown
    expect(screen.getAllByText('This field is required').length).toBeGreaterThan(0)
  })

  it('shows the auto-generated admission number as read-only', () => {
    renderForm()
    const input = within(screen.getByText('Student ID').closest('.sm-field') as HTMLElement).getByRole('textbox')
    expect(input).toHaveAttribute('readonly')
  })

  it('rejects a malformed Aadhaar number', () => {
    vi.stubGlobal('fetch', makeFetch())
    renderForm()
    fillRequired()
    fireEvent.change(within(screen.getByText('Aadhaar number').closest('.sm-field') as HTMLElement).getByRole('textbox'), { target: { value: '123' } })
    fireEvent.click(screen.getByText('Save student'))
    expect(screen.getByText('Aadhaar must be exactly 12 digits')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('auto-increments the admission number past the highest existing code for this school', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: unknown, init?: { method?: string }) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (u.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c1', name: 'VIII-A', grade: 'VIII', section: 'A', room: null, class_teacher_id: null, student_count: 0 }],
          next_cursor: null,
        }))
      }
      if (u.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({
          data: [{ ...STUDENT_ROW, admission_no: 'sch/STU/26/0006' }],
          next_cursor: null,
        }))
      }
      return Promise.resolve(jsonResponse({ data: STUDENT_ROW }))
    }))
    renderForm()
    const input = within(screen.getByText('Student ID').closest('.sm-field') as HTMLElement).getByRole('textbox')
    await waitFor(() => expect(input).toHaveValue('sch/STU/26/0007'))
    vi.unstubAllGlobals()
  })

  it('adds the student and opens the profile when valid', async () => {
    vi.stubGlobal('fetch', makeFetch())

    renderForm()
    // The Class picker is populated from the live class list; wait for it to load.
    await waitFor(() =>
      expect(Array.from(classCombo().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'VIII-A',
      )).toBe(true),
    )
    expect(screen.getByLabelText('Roll number preview')).toHaveValue('Select class first')
    fillRequired()
    fireEvent.change(classCombo(), { target: { value: 'VIII-A' } })
    expect(screen.getByLabelText('Roll number preview')).toHaveValue('1')
    fireEvent.click(screen.getByText('Save student'))

    await waitFor(() => expect(probe().split('|')[1]).toBe('school.student'), { timeout: 10000 })
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
      (c) => String(c[0]).includes('/students'),
    )).toBe(true)

    vi.unstubAllGlobals()
  }, 20000)
})

describe('studentToForm parent email', () => {
  it('hydrates father email from guardianEmail when extras father is missing', () => {
    const f = studentToForm({
      id: 'rahul-1', adm: 'sccrdtb/STU/26/0001', name: 'Rahul Sharma', gender: 'M',
      grade: 'IV', section: 'B', cls: 'IV-B', roll: 0, guardian: 'Vaibhav Dubey',
      phone: '7080080089', guardianEmail: 'Vaibhavv@yopmail.com', attendance: 60,
      feeStatus: 'due', feeDue: 0, status: 'active', house: 'Ruby', avatarHue: 1,
      address: 'Vill- Harpur',
    } as Student)
    expect(f.fatherEmail).toBe('Vaibhavv@yopmail.com')
    expect(f.fatherPhone).toBe('7080080089')
    expect(f.address).toBe('Vill- Harpur')
  })
})

describe('Edit student form', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearPersonExtrasMemory()
  })

  const RAHUL = {
    id: 'rahul-1', admission_no: 'sccrdtb/STU/26/0001', class_label: 'IV-B',
    name: 'Rahul Sharma', gender: 'M', grade: 'IV', section: 'B', roll: 0,
    guardian_name: 'Vaibhav Dubey', guardian_phone: '7080080089', guardian_email: null,
    email: 'rahul@yopmail.com', dob: '2014-05-01',
    attendance_pct: 60, fee_status: 'due', fee_due: 0,
    status: 'active', house: 'Ruby', avatar_hue: 1,
  }

  function FocusEdit({ id }: { id: string }) {
    const app = useApp()
    useEffect(() => { app.go('school.sis.edit', { focus: id }) }, [id])
    if (app.focus !== id) return null
    return <EditStudentScreen />
  }

  function makeEditFetch() {
    return vi.fn().mockImplementation((url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (u.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (u.includes('/extras') && method === 'GET') {
        return Promise.resolve(jsonResponse({
          data: { extras_json: JSON.stringify({ father: { name: 'Vaibhav Dubey', email: 'Vaibhavv@yopmail.com' } }) },
        }))
      }
      if (u.includes('/students/') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: RAHUL }))
      }
      if (u.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [RAHUL], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: { ...RAHUL, guardian_email: 'Vaibhavv@yopmail.com' } }))
    })
  }

  function renderEdit() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEdit id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )
  }

  it('loads father email from extras and PATCHes it as guardian_email', async () => {
    const fetchMock = makeEditFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderEdit()

    const fatherEmail = await waitFor(() => {
      const field = screen.getByText('Father email').closest('.sm-field') as HTMLElement
      return within(field).getByRole('textbox') as HTMLInputElement
    })
    expect(fatherEmail.value).toBe('Vaibhavv@yopmail.com')

    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find((c) => {
        const url = String(c[0])
        const method = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
        return url.includes('/students/rahul-1') && method === 'PATCH'
      })
      expect(patch).toBeTruthy()
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.guardian_email).toBe('Vaibhavv@yopmail.com')
    })

    vi.unstubAllGlobals()
  })

  it('keeps the saved Route/Stop/Fee head visible even when student extras load after transport (race regression)', async () => {
    const fetchMock = vi.fn().mockImplementation((url: unknown, init?: { method?: string; body?: string }) => {
      const u = String(url)
      const method = (init?.method ?? 'GET').toUpperCase()
      // Transport is Platinum-gated (useOperationsTier) — without a resolved Platinum
      // session the Transport Card never renders and "Route" would never appear.
      if (u.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      }
      if (u.includes('/auth/me')) {
        return Promise.resolve(jsonResponse({ data: { id: 'u1', tenant_id: 'school-rahul', roles: ['school.admin'], is_platform: false } }))
      }
      if (u.includes('/me/schools') && method === 'GET') {
        return Promise.resolve(jsonResponse({
          data: [{
            id: 'school-rahul', name: 'Rahul School', slug: 'rahul-school', country: 'IN', status: 'active',
            plan_id: null, plan_name: 'Platinum', tier: 'platinum', mrr: 0, students_count: 0,
            staff_count: 0, storage_gb: 0, created: '2026-01-01', contact_name: null,
            contact_email: null, contact_phone: null, address: null, health_score: 100,
          }],
          next_cursor: null,
        }))
      }
      if (u.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (u.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      if (u.includes('/extras') && method === 'GET') {
        return new Promise((resolve) => {
          setTimeout(() => resolve(jsonResponse({ data: { extras_json: JSON.stringify({}) } })), 20)
        })
      }
      // Once Platinum resolves, useStudentTransport's query goes from disabled to enabled
      // and actually fetches — must match the same seeded cache shape below, or a real
      // request landing after the seed would silently reset the just-verified fields.
      if (u.includes('/students/') && u.includes('/transport') && method === 'GET') {
        return Promise.resolve(jsonResponse({
          data: {
            opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1',
            route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null,
          },
        }))
      }
      // Same reasoning for the route/stop lists that got seeded above.
      if (u.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (u.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (u.includes('/students/') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: RAHUL }))
      }
      if (u.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [RAHUL], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: RAHUL }))
    })
    vi.stubGlobal('fetch', fetchMock)
    // A resumable session is what makes AppProvider actually call /auth/refresh (and thus
    // resolve Platinum) on mount — without it, the mocked auth/school responses above are
    // never requested and the plan stays at the 'gold' placeholder.
    tokenStore.set({ access_token: 'a', refresh_token: 'r' })
    tokenStore.setEmail('admin@rahul-school.edu')

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    qc.setQueryData(['operations', 'transport', 'routes'], [{ id: 'r1', name: 'Route 5', stops: 3 }])
    qc.setQueryData(['operations', 'transport', 'routeStops', 'r1'], [{ id: 'st1', routeId: 'r1', name: 'Shastri Nagar', sequence: 1 }])
    // studentTransport is also gated behind the "operations" tier (gold in tests) — seed the
    // cache directly, same as routes/routeStops above, since the query itself stays disabled.
    qc.setQueryData(
      ['operations', 'transport', 'studentTransport', 'rahul-1'],
      { optedIn: true, assigned: true, status: 'assigned', busId: 'b1', routeId: 'r1', stopId: 'st1', feeHeadId: 'fh1', pendingReason: null },
    )
    render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEdit id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Route')).toBeInTheDocument())
    const routeSelect = () => within(screen.getByText('Route').closest('.sm-field') as HTMLElement).getByRole('combobox') as HTMLSelectElement
    await waitFor(() => expect(routeSelect().value).toBe('r1'))

    // Give the delayed /extras response time to resolve and re-run the base-form-reset effect.
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(routeSelect().value).toBe('r1')
    const stopSelect = within(screen.getByText('Pickup Stop').closest('.sm-field') as HTMLElement).getByRole('combobox') as HTMLSelectElement
    expect(stopSelect.value).toBe('st1')

    tokenStore.clear()
    vi.unstubAllGlobals()
  })
})

/* The new Transport section's route/stop pickers only load once the school's plan
   resolves to Platinum (useTransportRoutes/useRouteStops/useStudentTransport are all
   gated behind the 'operations' tier, which requires Platinum — see useOperationsTier
   in useOperations.ts). AppProvider resolves `plan` from the live tenant fetched via
   /me/schools on session restore (real production code path, mirroring staffAdd's own
   Platinum-gated test setup) — seed a resumable session and answer
   /auth/refresh + /auth/me + /me/schools with a Platinum-tier school so those hooks
   actually fetch, then let each test's own handler cover the rest. */
/* C2: Transport is Platinum-only. `renderForm`'s default session (no /me/schools live tenant
 * seeded) resolves to AppProvider's 'gold' placeholder plan — the same "no Platinum session"
 * shape every other test in the "Add Student form" describe above already runs under. That
 * confirms the Transport section/save-call gating below is exercised by ordinary (non-seeded)
 * test setup, not a special case. */
describe('Transport section — non-Platinum tenant', () => {
  it('hides the Transport section and never calls the transport endpoint on save', async () => {
    const fetchMock = makeFetch()
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    await waitFor(() =>
      expect(Array.from(classCombo().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'VIII-A',
      )).toBe(true),
    )
    expect(screen.queryByText('Uses School Transport')).not.toBeInTheDocument()
    expect(screen.queryByText('Transport')).not.toBeInTheDocument()

    fillRequired()
    fireEvent.change(classCombo(), { target: { value: 'VIII-A' } })
    fireEvent.click(screen.getByText('Save student'))

    await waitFor(() => expect(probe().split('|')[1]).toBe('school.student'), { timeout: 10000 })
    const transportCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('/transport'))
    expect(transportCall).toBeUndefined()

    vi.unstubAllGlobals()
  }, 20000)
})

describe('Transport section', () => {
  const TENANT_ID = 'school-1'

  function authAndSchoolResponse(url: string, method: string): Response | null {
    if (url.includes('/auth/refresh')) {
      return jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } })
    }
    if (url.includes('/auth/me')) {
      return jsonResponse({ data: { id: 'u1', tenant_id: TENANT_ID, roles: ['school.admin'], is_platform: false } })
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

  function makeFetchWithTransport(opts: { assigned?: boolean } = {}) {
    return vi.fn().mockImplementation((input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      const auth = authAndSchoolResponse(url, method)
      if (auth) return Promise.resolve(auth)
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c1', name: 'VIII-A', grade: 'VIII', section: 'A', room: null, class_teacher_id: null, student_count: 0 }],
          next_cursor: null,
        }))
      }
      if (url.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      // Note: `request()` (used by listTransportRoutes/listRouteStops) unwraps a `.data`
      // envelope like every other endpoint — these are NOT bare arrays.
      if (url.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (url.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (url.includes('/students/srv/transport') && method === 'PUT') {
        return Promise.resolve(jsonResponse({
          data: opts.assigned === false
            ? { opted_in: true, assigned: false, status: 'pending', bus_id: null, route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: { code: 'no_capacity', message: 'No bus currently has available capacity on this route.' } }
            : { opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1', route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null },
        }))
      }
      if (url.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [STUDENT_ROW], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: STUDENT_ROW }))
    })
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

  const transportField = (label: string) => screen.getByText(label).closest('.sm-field') as HTMLElement
  const usesTransportCheckbox = () => screen.getByRole('checkbox', { name: 'Uses School Transport' })
  const routeSelect = () => within(transportField('Route')).getByRole('combobox')
  const stopSelect = () => within(transportField('Pickup Stop')).getByRole('combobox')

  it('hides Route/Stop until "Uses School Transport" is Yes', async () => {
    vi.stubGlobal('fetch', makeFetchWithTransport())
    renderForm()
    await waitFor(() => expect(screen.getByText('Uses School Transport')).toBeInTheDocument())
    expect(screen.queryByText('Route')).not.toBeInTheDocument()
    fireEvent.click(usesTransportCheckbox())
    await waitFor(() => expect(screen.getByText('Route')).toBeInTheDocument())
  })

  it('blocks save with a validation error when opted in without choosing a Route (I1)', async () => {
    // Covers both new-input (admin forgets Route) and legacy-row (routeId: null from
    // BusRidersModal) cases: either way, an opted-in student with no route must be blocked
    // by a clear inline error rather than reaching the backend and 400ing.
    const fetchMock = makeFetchWithTransport()
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    await waitFor(() =>
      expect(Array.from(classCombo().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'VIII-A',
      )).toBe(true),
    )
    fillRequired()
    fireEvent.change(classCombo(), { target: { value: 'VIII-A' } })
    fireEvent.click(usesTransportCheckbox())
    await waitFor(() => expect(routeSelect()).toBeInTheDocument())
    // Deliberately leave Route unselected.
    fireEvent.click(screen.getByText('Save student'))

    expect(screen.getByText('Select a route before saving')).toBeInTheDocument()
    expect(fetchMock.mock.calls.some((c) => {
      const url = String(c[0])
      const method = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
      return url.includes('/students/srv/transport') && method === 'PUT'
    })).toBe(false)
  })

  it('saves student then calls transport endpoint and shows pending toast when no capacity', async () => {
    vi.stubGlobal('fetch', makeFetchWithTransport({ assigned: false }))
    renderForm()
    await waitFor(() =>
      expect(Array.from(classCombo().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'VIII-A',
      )).toBe(true),
    )
    fillRequired()
    fireEvent.change(classCombo(), { target: { value: 'VIII-A' } })
    fireEvent.click(usesTransportCheckbox())
    await waitFor(() => expect(routeSelect()).toBeInTheDocument())
    await waitFor(() =>
      expect(Array.from(routeSelect().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'r1',
      )).toBe(true),
    )
    fireEvent.change(routeSelect(), { target: { value: 'r1' } })
    await waitFor(() =>
      expect(Array.from(stopSelect().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'st1',
      )).toBe(true),
    )
    fireEvent.change(stopSelect(), { target: { value: 'st1' } })
    fireEvent.click(screen.getByText('Save student'))
    await waitFor(() => expect(screen.getByText(/bus assignment is pending/i)).toBeInTheDocument(), { timeout: 10000 })
  }, 20000)

  it('saves with optedIn:false and does not block the save flow when "Uses School Transport" stays No', async () => {
    const fetchMock = makeFetchWithTransport()
    vi.stubGlobal('fetch', fetchMock)
    renderForm()
    await waitFor(() =>
      expect(Array.from(classCombo().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'VIII-A',
      )).toBe(true),
    )
    fillRequired()
    fireEvent.change(classCombo(), { target: { value: 'VIII-A' } })
    fireEvent.click(screen.getByText('Save student'))

    await waitFor(() => expect(probe().split('|')[1]).toBe('school.student'), { timeout: 10000 })
    // Best-effort transport call still fires (matching persistExtras' pattern) but
    // reports optedIn:false with no route/stop/fee-head — it must never block the save.
    const transportCall = fetchMock.mock.calls.find((c) => {
      const url = String(c[0])
      const method = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
      return url.includes('/transport') && method === 'PUT'
    })
    expect(transportCall).toBeTruthy()
    const body = JSON.parse((transportCall![1] as RequestInit).body as string)
    expect(body.opted_in).toBe(false)
    expect(body.route_id).toBeNull()
    expect(body.stop_id).toBeNull()
    expect(body.fee_head_id).toBeNull()
  }, 20000)

  it('loads existing transport mapping on edit and populates Uses School Transport/Route/Stop', async () => {
    function FocusEditTransport({ id }: { id: string }) {
      const app = useApp()
      useEffect(() => { app.go('school.sis.edit', { focus: id }) }, [id])
      if (app.focus !== id) return null
      return <EditStudentScreen />
    }

    const EDIT_STUDENT = {
      id: 'rahul-1', admission_no: 'sccrdtb/STU/26/0001', class_label: 'IV-B',
      name: 'Rahul Sharma', gender: 'M', grade: 'IV', section: 'B', roll: 0,
      guardian_name: 'Vaibhav Dubey', guardian_phone: '7080080089', guardian_email: null,
      email: 'rahul@yopmail.com', dob: '2014-05-01',
      attendance_pct: 60, fee_status: 'due', fee_due: 0,
      status: 'active', house: 'Ruby', avatar_hue: 1,
    }

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: { method?: string }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      const auth = authAndSchoolResponse(url, method)
      if (auth) return Promise.resolve(auth)
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (url.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      if (url.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (url.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (url.includes('/students/rahul-1/transport')) {
        return Promise.resolve(jsonResponse({
          data: {
            opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1',
            route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null,
          },
        }))
      }
      if (url.includes('/extras') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: { extras_json: '{}' } }))
      }
      if (url.includes('/students/rahul-1') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
      }
      if (url.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [EDIT_STUDENT], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEditTransport id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(usesTransportCheckbox()).toBeChecked(), { timeout: 10000 })
    await waitFor(() => expect(routeSelect()).toHaveValue('r1'), { timeout: 10000 })
    await waitFor(() => expect(stopSelect()).toHaveValue('st1'), { timeout: 10000 })
  }, 20000)

  it('edit: unchecking Uses School Transport (Yes -> No) opts the student out', async () => {
    function FocusEditTransport({ id }: { id: string }) {
      const app = useApp()
      useEffect(() => { app.go('school.sis.edit', { focus: id }) }, [id])
      if (app.focus !== id) return null
      return <EditStudentScreen />
    }

    const EDIT_STUDENT = {
      id: 'rahul-1', admission_no: 'sccrdtb/STU/26/0001', class_label: 'IV-B',
      name: 'Rahul Sharma', gender: 'M', grade: 'IV', section: 'B', roll: 0,
      guardian_name: 'Vaibhav Dubey', guardian_phone: '7080080089', guardian_email: null,
      email: 'rahul@yopmail.com', dob: '2014-05-01',
      attendance_pct: 60, fee_status: 'due', fee_due: 0,
      status: 'active', house: 'Ruby', avatar_hue: 1,
    }

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      const auth = authAndSchoolResponse(url, method)
      if (auth) return Promise.resolve(auth)
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (url.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      if (url.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (url.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (url.includes('/students/rahul-1/transport') && method === 'PUT') {
        return Promise.resolve(jsonResponse({
          data: { opted_in: false, assigned: false, status: 'opted_out', bus_id: null, route_id: null, stop_id: null, fee_head_id: null, pending_reason: null },
        }))
      }
      if (url.includes('/students/rahul-1/transport')) {
        return Promise.resolve(jsonResponse({
          data: {
            opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1',
            route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null,
          },
        }))
      }
      if (url.includes('/extras') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: { extras_json: '{}' } }))
      }
      if (url.includes('/students/rahul-1') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
      }
      if (url.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [EDIT_STUDENT], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEditTransport id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(usesTransportCheckbox()).toBeChecked(), { timeout: 10000 })
    fireEvent.click(usesTransportCheckbox())
    expect(usesTransportCheckbox()).not.toBeChecked()
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => {
        const u = String(c[0])
        const m = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
        return u.includes('/students/rahul-1/transport') && m === 'PUT'
      })
      expect(call).toBeTruthy()
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.opted_in).toBe(false)
      expect(body.route_id).toBeNull()
      expect(body.stop_id).toBeNull()
      expect(body.fee_head_id).toBeNull()
    }, { timeout: 10000 })
  }, 20000)

  it('edit: checking Uses School Transport (No -> Yes) opts the student in with the chosen route/stop', async () => {
    function FocusEditTransport({ id }: { id: string }) {
      const app = useApp()
      useEffect(() => { app.go('school.sis.edit', { focus: id }) }, [id])
      if (app.focus !== id) return null
      return <EditStudentScreen />
    }

    const EDIT_STUDENT = {
      id: 'rahul-1', admission_no: 'sccrdtb/STU/26/0001', class_label: 'IV-B',
      name: 'Rahul Sharma', gender: 'M', grade: 'IV', section: 'B', roll: 0,
      guardian_name: 'Vaibhav Dubey', guardian_phone: '7080080089', guardian_email: null,
      email: 'rahul@yopmail.com', dob: '2014-05-01',
      attendance_pct: 60, fee_status: 'due', fee_due: 0,
      status: 'active', house: 'Ruby', avatar_hue: 1,
    }

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      const auth = authAndSchoolResponse(url, method)
      if (auth) return Promise.resolve(auth)
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (url.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      if (url.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (url.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (url.includes('/students/rahul-1/transport') && method === 'PUT') {
        return Promise.resolve(jsonResponse({
          data: { opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1', route_id: 'r1', stop_id: 'st1', fee_head_id: null, pending_reason: null },
        }))
      }
      if (url.includes('/students/rahul-1/transport')) {
        return Promise.resolve(jsonResponse({
          data: { opted_in: false, assigned: false, status: 'not_mapped', bus_id: null, route_id: null, stop_id: null, fee_head_id: null, pending_reason: null },
        }))
      }
      if (url.includes('/extras') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: { extras_json: '{}' } }))
      }
      if (url.includes('/students/rahul-1') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
      }
      if (url.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [EDIT_STUDENT], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEditTransport id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(usesTransportCheckbox()).not.toBeChecked(), { timeout: 10000 })
    fireEvent.click(usesTransportCheckbox())
    await waitFor(() =>
      expect(Array.from(routeSelect().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'r1',
      )).toBe(true), { timeout: 10000 },
    )
    fireEvent.change(routeSelect(), { target: { value: 'r1' } })
    await waitFor(() =>
      expect(Array.from(stopSelect().querySelectorAll('option')).some(
        (o) => (o as HTMLOptionElement).value === 'st1',
      )).toBe(true), { timeout: 10000 },
    )
    fireEvent.change(stopSelect(), { target: { value: 'st1' } })
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => {
        const u = String(c[0])
        const m = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
        return u.includes('/students/rahul-1/transport') && m === 'PUT'
      })
      expect(call).toBeTruthy()
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.opted_in).toBe(true)
      expect(body.route_id).toBe('r1')
      expect(body.stop_id).toBe('st1')
    }, { timeout: 10000 })
  }, 20000)

  it('C1: disables Save until an existing transport-assigned student\'s status has resolved, and never sends a stale opted-out value', async () => {
    function FocusEditTransport({ id }: { id: string }) {
      const app = useApp()
      useEffect(() => { app.go('school.sis.edit', { focus: id }) }, [id])
      if (app.focus !== id) return null
      return <EditStudentScreen />
    }

    const EDIT_STUDENT = {
      id: 'rahul-1', admission_no: 'sccrdtb/STU/26/0001', class_label: 'IV-B',
      name: 'Rahul Sharma', gender: 'M', grade: 'IV', section: 'B', roll: 0,
      guardian_name: 'Vaibhav Dubey', guardian_phone: '7080080089', guardian_email: null,
      email: 'rahul@yopmail.com', dob: '2014-05-01',
      attendance_pct: 60, fee_status: 'due', fee_due: 0,
      status: 'active', house: 'Ruby', avatar_hue: 1,
    }

    // The real prior state: this student IS transport-assigned. We deliberately delay the
    // GET /students/rahul-1/transport response with a manually-resolved promise to create a
    // deterministic race window — Save must be inert until it resolves.
    let resolveTransportGet: (r: Response) => void = () => {}
    const transportGetPromise = new Promise<Response>((resolve) => { resolveTransportGet = resolve })

    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: { method?: string; body?: string }) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      const method = (init?.method ?? 'GET').toUpperCase()
      const auth = authAndSchoolResponse(url, method)
      if (auth) return Promise.resolve(auth)
      if (url.includes('/classes')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'c-ivb', name: 'IV-B', grade: 'IV', section: 'B', room: null, class_teacher_id: null, student_count: 2 }],
          next_cursor: null,
        }))
      }
      if (url.includes('/fees/heads')) {
        return Promise.resolve(jsonResponse({
          data: [{ id: 'fh1', name: 'Transport', code: null, active: true, is_system: false, is_transport_fee_head: true }],
          next_cursor: null,
        }))
      }
      if (url.includes('/transport/routes/r1/stops')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'st1', route_id: 'r1', name: 'Shastri Nagar', sequence: 1 }] }))
      }
      if (url.includes('/transport/routes')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'r1', name: 'Route 5', stops: 3 }] }))
      }
      if (url.includes('/students/rahul-1/transport') && method === 'GET') {
        return transportGetPromise
      }
      if (url.includes('/students/rahul-1/transport') && method === 'PUT') {
        return Promise.resolve(jsonResponse({
          data: { opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1', route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null },
        }))
      }
      if (url.includes('/extras') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: { extras_json: '{}' } }))
      }
      if (url.includes('/students/rahul-1') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
      }
      if (url.includes('/students') && method === 'GET') {
        return Promise.resolve(jsonResponse({ data: [EDIT_STUDENT], next_cursor: null }))
      }
      return Promise.resolve(jsonResponse({ data: EDIT_STUDENT }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <AppProvider>
          <ToastProvider>
            <FocusEditTransport id="rahul-1" />
          </ToastProvider>
        </AppProvider>
      </QueryClientProvider>,
    )

    // Save is disabled while the transport GET is still in flight — the whole point of the
    // fix is that this race window can never reach the backend with a wrong value.
    const disabledSaveBtn = await waitFor(() => screen.getByText('Loading transport status…').closest('button') as HTMLButtonElement)
    expect(disabledSaveBtn).toBeDisabled()
    fireEvent.click(disabledSaveBtn)
    expect(fetchMock.mock.calls.some((c) => {
      const u = String(c[0])
      const m = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
      return u.includes('/students/rahul-1/transport') && m === 'PUT'
    })).toBe(false)

    // Now let the real prior state (opted_in: true, assigned to b1/r1/st1) arrive.
    resolveTransportGet(jsonResponse({
      data: { opted_in: true, assigned: true, status: 'assigned', bus_id: 'b1', route_id: 'r1', stop_id: 'st1', fee_head_id: 'fh1', pending_reason: null },
    }))

    await waitFor(() => expect(screen.getByText('Save changes')).not.toBeDisabled(), { timeout: 10000 })
    fireEvent.click(screen.getByText('Save changes'))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => {
        const u = String(c[0])
        const m = ((c[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
        return u.includes('/students/rahul-1/transport') && m === 'PUT'
      })
      expect(call).toBeTruthy()
      // The real prior state (opted in) must be sent — never a stale/false value from before
      // the GET resolved.
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.opted_in).toBe(true)
      expect(body.route_id).toBe('r1')
    }, { timeout: 10000 })
  }, 20000)
})
