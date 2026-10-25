import { useEffect, type ReactNode } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { useApp } from '@/lib/hooks'
import { ToastProvider } from '@/context/ToastProvider'
import { financeScreens } from './finance'
import { notifyFeeAudience } from '@/lib/feeNotify'

vi.mock('@/lib/feeNotify', () => ({ notifyFeeAudience: vi.fn().mockResolvedValue({ channels: [] }) }))

const FeesScreen = financeScreens['school.fees']

/* Logs in as a given demo role so role-gated actions (e.g. Principal-only
   waiver approval) can be exercised in tests. */
function LoginAs({ role, children }: { role: string; children: ReactNode }) {
  const app = useApp()
  useEffect(() => { void app.loginWithPassword(`${role}@greenwood.edu`, 'demo1234') }, [app, role])
  return <>{children}</>
}

afterEach(cleanup)
afterEach(() => { vi.mocked(notifyFeeAudience).mockClear() })

let feeHeads: Record<string, unknown>[] = []
let feeInvoices: Record<string, unknown>[] = []
let feeStructureHistory: Record<string, unknown>[] = []
let students: Record<string, unknown>[] = []
let feePayments: Record<string, unknown>[] = []
let nextGenerateCreated = 4
let createdNotifications: Record<string, unknown>[] = []
let schoolIntegrations: Record<string, unknown> = {}
let razorpayOrderWire: Record<string, unknown> = { order_id: 'order_abc', amount: 36000, currency: 'INR', key_id: 'rzp_test_1' }
let failNextPay = false

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const wireSummary = {
  collected_today: 12000,
  collected_term: 450000,
  outstanding: 89000,
  defaulters: 12,
  billed_term: 539000,
  pct: 83,
  by_class: [{ label: 'X-A', value: 48, n: 32 }],
  by_mode: [{ label: 'UPI (manual)', value: 200000 }],
  latest_payment: {
    id: 9,
    student_id: 's1',
    student_name: 'Asha Verma',
    cls: 'X-A',
    head_id: 'h1',
    amount: 4800,
    mode: 'UPI (manual)',
    ref: 'TXN1',
    date: '01 Jun 2026',
  },
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  feeHeads = [
    { id: 'h1', name: 'Academic', code: 'ACAD', active: true, is_system: true },
    { id: 'h2', name: 'Transport', active: true },
    { id: 'h3', name: 'Other', active: true },
  ]
  feeStructureHistory = []
  students = []
  nextGenerateCreated = 4
  createdNotifications = []
  feeInvoices = [
    {
      id: 'inv-1', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
      academic_year: '2025-26', term: 'Term 1', lines: [{ head_id: 'h1', head_name: 'Academic', amount: 36000 }],
      total: 36000, paid: 0, waived: 0, due: 36000, status: 'due',
    },
    {
      id: 'inv-2', student_id: 's2', student_name: 'Rohan Iyer', cls: 'X-B', grade: 'X',
      academic_year: '2025-26', term: 'Term 1', lines: [{ head_id: 'h1', head_name: 'Academic', amount: 36000 }],
      total: 36000, paid: 36000, waived: 0, due: 0, status: 'paid',
    },
  ]
  feePayments = [
    { id: 1, student_id: 's2', student_name: 'Rohan Iyer', cls: 'X-B', fee_type: 'academic', amount: 36000, mode: 'Cheque', ref: 'CHQ-1', date: '01 Jun 2026' },
    { id: 2, student_id: 's3', student_name: 'Meera Nair', cls: 'IX-A', fee_type: 'academic', amount: 36000, mode: 'Razorpay', ref: 'pay_xyz', date: '02 Jun 2026' },
  ]
  schoolIntegrations = {
    email: { enabled: false },
    sms: { enabled: false },
    razorpay: { enabled: false, key_id: '', mode: 'test', status: 'not_configured' },
  }
  razorpayOrderWire = { order_id: 'order_abc', amount: 36000, currency: 'INR', key_id: 'rzp_test_1' }
  failNextPay = false

  vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => {
    const u = String(url)
    const method = opts?.method ?? 'GET'

    if (u.includes('/auth/login')) return jsonOk({ data: { access_token: 'a', refresh_token: 'r' } })
    if (u.includes('/auth/me')) return jsonOk({ data: { id: 'u1', tenant_id: null, roles: ['principal'], is_platform: false } })

    if (u.includes('/fees/heads')) {
      if (method === 'POST') {
        const body = JSON.parse((opts?.body as string) ?? '{}')
        const created = {
          id: `h${feeHeads.length + 1}`, name: body.name, code: body.code, active: true,
          is_transport_fee_head: !!body.is_transport_fee_head,
          description: body.description ?? null,
        }
        feeHeads = [...feeHeads, created]
        return jsonOk({ data: created })
      }
      if (method === 'PATCH') {
        const id = u.split('/fees/heads/')[1]
        const body = JSON.parse((opts?.body as string) ?? '{}')
        const idx = feeHeads.findIndex((h) => h.id === id)
        if (idx === -1) return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        feeHeads[idx] = { ...feeHeads[idx], ...body }
        return jsonOk({ data: feeHeads[idx] })
      }
      return jsonOk({ data: feeHeads, next_cursor: null })
    }

    if (u.includes('/fees/structures/')) {
      const rest = u.split('/fees/structures/')[1]
      if (rest.endsWith('/unpublish') && method === 'POST') {
        const id = rest.replace('/unpublish', '')
        feeStructureHistory = feeStructureHistory.map((s) => (s.id === id ? { ...s, status: 'inactive' } : s))
        return jsonOk({ data: { id, status: 'inactive' } })
      }
      if (rest.endsWith('/publish') && method === 'POST') {
        const id = rest.replace('/publish', '')
        // No "only one Published row" rule — publishing one version never changes any other.
        feeStructureHistory = feeStructureHistory.map((s) => (s.id === id ? { ...s, status: 'active' } : s))
        return jsonOk({ data: { id, status: 'active' } })
      }
      if (method === 'DELETE') {
        const target = feeStructureHistory.find((s) => s.id === rest)
        if (!target) {
          return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        }
        if (target.status === 'active') {
          return new Response(JSON.stringify({ error: { message: 'Cannot delete the currently published version' } }), { status: 409, headers: { 'Content-Type': 'application/json' } })
        }
        feeStructureHistory = feeStructureHistory.filter((s) => s.id !== rest)
        return new Response(null, { status: 204 })
      }
      const found = feeStructureHistory.find((s) => s.id === rest)
      return found ? jsonOk({ data: found }) : new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    }

    if (u.includes('/fees/structures')) {
      return jsonOk({
        data: feeStructureHistory.map((s) => {
          const amounts = (s.amounts as Record<string, Record<string, number>> | undefined) ?? {}
          const byHeadTotals: Record<string, number> = {}
          const byHeadStudents: Record<string, number> = {}
          for (const [classKey, byHead] of Object.entries(amounts)) {
            const enrolled = students.filter(
              (st) => String(st.class_label ?? '').trim().toLowerCase() === classKey.trim().toLowerCase(),
            ).length
            for (const [headId, rate] of Object.entries(byHead)) {
              const revenue = enrolled > 0 ? rate * enrolled : rate
              byHeadTotals[headId] = (byHeadTotals[headId] ?? 0) + revenue
              if (enrolled > 0) byHeadStudents[headId] = (byHeadStudents[headId] ?? 0) + enrolled
            }
          }
          const total = Object.values(byHeadTotals).reduce((a, n) => a + n, 0)
          const headAmounts = Object.entries(byHeadTotals).map(([headId, amount]) => {
            const headStudents = byHeadStudents[headId] ?? 0
            return {
              head_id: headId,
              head_name: feeHeads.find((h) => h.id === headId)?.name ?? headId,
              amount,
              per_student_amount: headStudents > 0 ? amount / headStudents : 0,
            }
          })
          return { ...s, amounts: undefined, amounts_json: undefined, total_amount: total, head_amounts: headAmounts }
        }),
        next_cursor: null,
      })
    }

    if (u.includes('/fees/structure')) {
      if (method === 'PUT') {
        const body = JSON.parse((opts?.body as string) ?? '{}')
        const saved = {
          ...body,
          id: `struct-${feeStructureHistory.length + 1}`,
          created_at: new Date(2026, 0, feeStructureHistory.length + 1).toISOString(),
        }
        // No "only one Published row" rule — saving another version as active never
        // retires whichever version(s) were already active.
        feeStructureHistory = [...feeStructureHistory, saved]
        return jsonOk({ data: body })
      }
      return jsonOk({ data: {} })
    }

    if (u.includes('/fees/invoices/generate')) {
      return jsonOk({ data: { created: nextGenerateCreated } })
    }

    if (u.includes('/razorpay/order') && method === 'POST') {
      return jsonOk({ data: razorpayOrderWire })
    }

    if (u.includes('/razorpay/verify') && method === 'POST') {
      const body = JSON.parse((opts?.body as string) ?? '{}')
      return jsonOk({ data: { id: Date.now(), student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', fee_type: 'academic', amount: 36000, mode: 'Razorpay', ref: body.razorpay_payment_id ?? '', date: '01 Jan 2026' } })
    }

    if (u.includes('/pay') && method === 'POST') {
      const body = JSON.parse((opts?.body as string) ?? '{}')
      if (failNextPay) {
        failNextPay = false
        return new Response(JSON.stringify({ error: { message: 'Server error' } }), { status: 500, headers: { 'Content-Type': 'application/json' } })
      }
      return jsonOk({ data: { id: Date.now(), student_id: body.student_id, student_name: body.student_name, cls: body.cls, head_id: body.head_id, amount: body.amount, mode: body.mode, ref: body.ref ?? '', date: '01 Jan 2026' } })
    }

    if (u.includes('/school/integrations')) {
      return jsonOk({ data: schoolIntegrations })
    }

    if (u.includes('/fees/invoices')) {
      return jsonOk({ data: feeInvoices, next_cursor: null })
    }

    if (u.includes('/fees/reports/summary')) {
      return jsonOk({ data: wireSummary })
    }

    if (u.includes('/fees/payments')) {
      return jsonOk({ data: feePayments, next_cursor: null })
    }

    if (u.includes('/notifications') && method === 'POST') {
      const body = JSON.parse((opts?.body as string) ?? '{}')
      createdNotifications.push(body)
      return jsonOk({ data: { id: createdNotifications.length, ...body, time: 'now', unread: true } })
    }

    if (u.includes('/classes')) {
      return jsonOk({
        data: [
          { id: 'c1', name: 'X-A', grade: 'X', section: 'A', student_count: 30, room: '101' },
          { id: 'c2', name: 'X-B', grade: 'X', section: 'B', student_count: 28, room: '102' },
          { id: 'c3', name: 'IX-A', grade: 'IX', section: 'A', student_count: 32, room: '201' },
        ],
        next_cursor: null,
      })
    }

    if (u.includes('/students')) {
      return jsonOk({ data: students, next_cursor: null })
    }

    return jsonOk({ data: [], next_cursor: null })
  }))
})

function renderScreen(opts: { asRole?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const body = opts.asRole ? <LoginAs role={opts.asRole}><FeesScreen /></LoginAs> : <FeesScreen />
  const u = render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          {body}
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
  const tabBar = within(u.container.querySelector('.sm-tabs') as HTMLElement)
  const clickTab = (label: string) => fireEvent.click(tabBar.getByText(label))
  return { ...u, clickTab }
}

describe('Fee collection tab', () => {
  it('renders rows from useFeeInvoices, not mock students', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    expect(within(container).getByText('Rohan Iyer')).toBeInTheDocument()
  })

  it('sends fee reminders to the guardians of every defaulter, via the real notify path — one reminder per student, with THAT student\'s own due', async () => {
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Asha Verma', gender: 'F', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9111111111', guardian_email: 'asha.parent@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
    ]
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Send reminders' }))
    const dialog = within(container).getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminders' }))

    await waitFor(() => {
      // Per-student send: her OWN due (36000, from the inv-1 fixture), never a blended total
      // across every defaulter, and no lingering "count" from the old bulk-message shape.
      expect(notifyFeeAudience).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'reminder',
        studentName: 'Asha Verma',
        amount: 36000,
        emails: ['asha.parent@x.com'],
        phones: ['9111111111'],
      }))
      expect(vi.mocked(notifyFeeAudience).mock.calls[0][0]).not.toHaveProperty('count')
    })
    await waitFor(() => {
      expect(within(container).getByText(/Reminders sent/i)).toBeInTheDocument()
    })
  })

  it('mixed Transport Yes/No students each get a reminder for their OWN amount — no transport fee leaks onto the No student, no shared total', async () => {
    students = [
      // Transport = No: base fees only (500 + 6300).
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Asha Verma', gender: 'F', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9111111111', guardian_email: 'asha.parent@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
      // Transport = Yes: same base fees + the ₹17,000 transport fee, already folded into
      // her invoice's `due` by the backend — the frontend never re-derives this.
      { id: 's4', admission_no: 'A4', class_label: 'X-B', name: 'Kabir Shah', gender: 'M', grade: 'X', section: 'B', roll: 2, guardian_name: 'P4', guardian_phone: '9222222222', guardian_email: 'kabir.parent@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 2 },
    ]
    feeInvoices = [
      {
        id: 'inv-1', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
        academic_year: '2025-26', term: 'Term 1',
        lines: [{ head_id: 'h1', head_name: 'Tour', amount: 500 }, { head_id: 'h2', head_name: 'Exam', amount: 6300 }],
        total: 6800, paid: 0, waived: 0, due: 6800, status: 'due',
      },
      {
        id: 'inv-4', student_id: 's4', student_name: 'Kabir Shah', cls: 'X-B', grade: 'X',
        academic_year: '2025-26', term: 'Term 1',
        lines: [
          { head_id: 'h1', head_name: 'Tour', amount: 500 }, { head_id: 'h2', head_name: 'Exam', amount: 6300 },
          { head_id: 'h3', head_name: 'Transport', amount: 17000 },
        ],
        total: 23800, paid: 0, waived: 0, due: 23800, status: 'due',
      },
    ]
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
      expect(within(container).getByText('Kabir Shah')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Send reminders' }))
    const dialog = within(container).getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminders' }))

    await waitFor(() => {
      expect(notifyFeeAudience).toHaveBeenCalledWith(expect.objectContaining({
        studentName: 'Asha Verma', amount: 6800, emails: ['asha.parent@x.com'],
      }))
      expect(notifyFeeAudience).toHaveBeenCalledWith(expect.objectContaining({
        studentName: 'Kabir Shah', amount: 23800, emails: ['kabir.parent@x.com'],
      }))
    })
    // Exactly one reminder per student — never one combined 6800+23800=30600 blended send.
    expect(notifyFeeAudience).toHaveBeenCalledTimes(2)
  })

  it('does not send a duplicate reminder or amount when the same student has more than one due invoice', async () => {
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Asha Verma', gender: 'F', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9111111111', guardian_email: 'asha.parent@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
    ]
    feeInvoices = [
      {
        id: 'inv-1', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
        academic_year: '2025-26', term: 'Term 1', lines: [{ head_id: 'h1', head_name: 'Academic', amount: 36000 }],
        total: 36000, paid: 0, waived: 0, due: 36000, status: 'due',
      },
      {
        id: 'inv-1b', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
        academic_year: '2025-26', term: 'Term 2', lines: [{ head_id: 'h1', head_name: 'Academic', amount: 12000 }],
        total: 12000, paid: 0, waived: 0, due: 12000, status: 'due',
      },
    ]
    const { container } = renderScreen()
    await waitFor(() => {
      // She now has TWO due invoice rows in Collection (one per period) — that's the point of
      // this fixture, not a bug: getAllByText, not getByText.
      expect(within(container).getAllByText('Asha Verma').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Send reminders' }))
    const dialog = within(container).getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send reminders' }))

    await waitFor(() => {
      // One reminder for Asha, with BOTH her due invoices summed (36000 + 12000) — not two
      // separate reminders and not just the first invoice's amount.
      expect(notifyFeeAudience).toHaveBeenCalledWith(expect.objectContaining({
        studentName: 'Asha Verma', amount: 48000,
      }))
    })
    expect(notifyFeeAudience).toHaveBeenCalledTimes(1)
  })

  it('shows the fee-head breakdown for a multi-line invoice, not just the lump total', async () => {
    feeInvoices = feeInvoices.map((inv) => inv.id === 'inv-1'
      ? {
        ...inv,
        lines: [
          { head_id: 'h1', head_name: 'Tuition Fee', amount: 30000 },
          { head_id: 'h2', head_name: 'Transport Fee', amount: 6000 },
        ],
      }
      : inv)
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    expect(within(container).getByText(/Tuition Fee.*Transport Fee/)).toBeInTheDocument()
  })

  it('shows the term/period on each row, so two same-amount invoices for the same student are not mistaken for duplicates', async () => {
    feeInvoices = [
      ...feeInvoices,
      {
        id: 'inv-3', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
        academic_year: '2025-26', term: 'Term 2', lines: [{ head_id: 'h2', head_name: 'Transport', amount: 21000 }],
        total: 21000, paid: 0, waived: 0, due: 21000, status: 'due',
      },
      {
        id: 'inv-4', student_id: 's1', student_name: 'Asha Verma', cls: 'X-A', grade: 'X',
        academic_year: '2025-26', term: 'Term 3', lines: [{ head_id: 'h2', head_name: 'Transport', amount: 21000 }],
        total: 21000, paid: 0, waived: 0, due: 21000, status: 'due',
      },
    ]
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getAllByText('Asha Verma').length).toBeGreaterThan(0)
    })
    expect(within(container).getByText('Term 2')).toBeInTheDocument()
    expect(within(container).getByText('Term 3')).toBeInTheDocument()
  })

  it('shows KPIs and live cue from useFeeReportSummary (not student math)', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText(/Payment received/i)).toBeInTheDocument()
    })
    expect(within(container).getByText(/Asha Verma \(X-A\)/)).toBeInTheDocument()
    expect(within(container).getByText(/83% of term billed collected/)).toBeInTheDocument()
  })

  it('records a payment with a head, mode from the full offline list, and POSTs to /fees/invoices/{id}/pay', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getAllByText('Pay fee')[0])
    const dialog = within(container).getByRole('dialog')
    // fee-head options load async; wait for the default head to be selected before changing it
    await waitFor(() => { expect(within(dialog).getByDisplayValue('Academic')).toBeInTheDocument() })
    const [headSelect, modeSelect] = within(dialog).getAllByRole('combobox')
    fireEvent.change(headSelect, { target: { value: 'h2' } })
    fireEvent.change(modeSelect, { target: { value: 'Bank transfer' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay fee' }))

    const fetchMock = vi.mocked(fetch)
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/pay'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body).toMatchObject({ head_id: 'h2', mode: 'Bank transfer' })
    })
  })

  it('does not fire a client-side notification after recording a manual payment (the backend already does)', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getAllByText('Pay fee')[0])
    const dialog = within(container).getByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByDisplayValue('Academic')).toBeInTheDocument() })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay fee' }))

    await waitFor(() => {
      expect(within(container).getByText(/Payment recorded/i)).toBeInTheDocument()
    })
    expect(notifyFeeAudience).not.toHaveBeenCalled()
  })

  it('sends a stable idempotency_key on payment submission', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getAllByText('Pay fee')[0])
    const dialog = within(container).getByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByDisplayValue('Academic')).toBeInTheDocument() })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay fee' }))

    const fetchMock = vi.mocked(fetch)
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/pay'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.idempotency_key).toMatch(GUID_RE)
    })
  })

  it('sends the same idempotency_key when a payment submission is retried after a failure', async () => {
    failNextPay = true
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getAllByText('Pay fee')[0])
    const dialog = within(container).getByRole('dialog')
    await waitFor(() => { expect(within(dialog).getByDisplayValue('Academic')).toBeInTheDocument() })

    const fetchMock = vi.mocked(fetch)
    const payCalls = () => fetchMock.mock.calls.filter(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/pay'))

    // First submit fails (server error); the modal stays open so the user can retry.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay fee' }))
    await waitFor(() => { expect(payCalls().length).toBe(1) })

    // Retry within the same modal instance — the idempotency key must not be regenerated.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pay fee' }))
    await waitFor(() => { expect(payCalls().length).toBe(2) })

    const [firstCall, secondCall] = payCalls()
    const firstBody = JSON.parse((firstCall[1] as RequestInit).body as string)
    const secondBody = JSON.parse((secondCall[1] as RequestInit).body as string)
    expect(firstBody.idempotency_key).toMatch(GUID_RE)
    expect(secondBody.idempotency_key).toBe(firstBody.idempotency_key)
  })

  it('approves a waiver with a stable idempotency_key', async () => {
    const { container } = renderScreen({ asRole: 'principal' })
    await waitFor(() => {
      expect(within(container).getAllByText('Waiver discount').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(container).getAllByText('Waiver discount')[0])
    const dialog = within(container).getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve waiver' }))

    const fetchMock = vi.mocked(fetch)
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/pay'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.idempotency_key).toMatch(GUID_RE)
    })
  })

  it('shows cheque fields only when payment mode is Cheque', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getAllByText('Pay fee')[0])
    const dialog = within(container).getByRole('dialog')
    expect(within(dialog).queryByText('Cheque number')).not.toBeInTheDocument()

    const [, modeSelect] = within(dialog).getAllByRole('combobox')
    fireEvent.change(modeSelect, { target: { value: 'Cheque' } })
    expect(within(dialog).getByText('Cheque number')).toBeInTheDocument()
  })

  it('approves a waiver via the pay endpoint with mode Adjustment / waiver', async () => {
    // Waiver approval requires `can(role, 'fees', 'A')`, granted to Principal only.
    const { container } = renderScreen({ asRole: 'principal' })
    await waitFor(() => {
      expect(within(container).getAllByText('Waiver discount').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(container).getAllByText('Waiver discount')[0])
    const dialog = within(container).getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('spinbutton'), { target: { value: '500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve waiver' }))

    const fetchMock = vi.mocked(fetch)
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/pay'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body).toMatchObject({ mode: 'Adjustment / waiver' })
    })
  })
})

describe('Fee collection tab — school Razorpay collect', () => {
  it('hides Collect online / Send pay link when school Razorpay is not configured', async () => {
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Asha Verma')).toBeInTheDocument()
    })
    expect(within(container).queryByText('Collect online')).not.toBeInTheDocument()
    expect(within(container).queryByText('Send pay link')).not.toBeInTheDocument()
  })

  it('shows Collect online / Send pay link on due rows once school Razorpay is enabled + configured', async () => {
    schoolIntegrations = { ...schoolIntegrations, razorpay: { enabled: true, key_id: 'rzp_test_1', mode: 'test', status: 'configured' } }
    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Collect online')).toBeInTheDocument()
    })
    expect(within(container).getByText('Send pay link')).toBeInTheDocument()
    // Rohan Iyer's invoice is fully paid (due: 0) — no online-collect actions for it.
    const rohanRow = within(container).getByText('Rohan Iyer').closest('tr') as HTMLElement
    expect(within(rohanRow).queryByText('Collect online')).not.toBeInTheDocument()
  })

  it('creates a Razorpay order, opens checkout, and verifies payment via POST /razorpay/verify on success', async () => {
    schoolIntegrations = { ...schoolIntegrations, razorpay: { enabled: true, key_id: 'rzp_test_1', mode: 'test', status: 'configured' } }
    type CheckoutResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
    let capturedHandler: ((r: CheckoutResponse) => void) | null = null
    const openMock = vi.fn()
    const RazorpayCtor = vi.fn((opts: Record<string, unknown>) => {
      capturedHandler = opts.handler as (r: CheckoutResponse) => void
      return { open: openMock }
    })
    vi.stubGlobal('Razorpay', RazorpayCtor)

    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Collect online')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByText('Collect online'))

    const fetchMock = vi.mocked(fetch)
    await waitFor(() => {
      const orderCall = fetchMock.mock.calls.find(([url, o]) => o?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/razorpay/order'))
      expect(orderCall).toBeDefined()
    })
    await waitFor(() => { expect(openMock).toHaveBeenCalled() })
    expect(RazorpayCtor).toHaveBeenCalledWith(expect.objectContaining({ key: 'rzp_test_1', order_id: 'order_abc' }))

    capturedHandler!({ razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_123', razorpay_signature: 'sig_1' })

    await waitFor(() => {
      const verifyCall = fetchMock.mock.calls.find(([url, o]) => o?.method === 'POST' && String(url).includes('/fees/invoices/inv-1/razorpay/verify'))
      expect(verifyCall).toBeDefined()
      const body = JSON.parse((verifyCall?.[1] as RequestInit).body as string)
      expect(body).toMatchObject({ razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_123', razorpay_signature: 'sig_1' })
    })
    await waitFor(() => {
      expect(within(container).getByText(/paid online via Razorpay/i)).toBeInTheDocument()
    })
  })

  it('does not fire a client-side notification after a successful Razorpay payment (the backend already does)', async () => {
    schoolIntegrations = { ...schoolIntegrations, razorpay: { enabled: true, key_id: 'rzp_test_1', mode: 'test', status: 'configured' } }
    type CheckoutResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
    let capturedHandler: ((r: CheckoutResponse) => void) | null = null
    const RazorpayCtor = vi.fn((opts: Record<string, unknown>) => {
      capturedHandler = opts.handler as (r: CheckoutResponse) => void
      return { open: vi.fn() }
    })
    vi.stubGlobal('Razorpay', RazorpayCtor)

    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Collect online')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByText('Collect online'))

    await waitFor(() => { expect(capturedHandler).not.toBeNull() })
    capturedHandler!({ razorpay_order_id: 'order_abc', razorpay_payment_id: 'pay_123', razorpay_signature: 'sig_1' })

    await waitFor(() => {
      expect(within(container).getByText(/paid online via Razorpay/i)).toBeInTheDocument()
    })
    expect(notifyFeeAudience).not.toHaveBeenCalled()
  })

  it('copies the pay link to the clipboard when the order includes one', async () => {
    schoolIntegrations = { ...schoolIntegrations, razorpay: { enabled: true, key_id: 'rzp_test_1', mode: 'test', status: 'configured' } }
    razorpayOrderWire = { ...razorpayOrderWire, pay_link: 'https://rzp.io/l/abc123' }
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    const { container } = renderScreen()
    await waitFor(() => {
      expect(within(container).getByText('Send pay link')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByText('Send pay link'))

    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('https://rzp.io/l/abc123') })
    await waitFor(() => {
      expect(within(container).getByText(/Pay link copied/i)).toBeInTheDocument()
    })
  })
})

describe('Fee collection history', () => {
  it('filters payment history by mode, including Razorpay', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('History')

    await waitFor(() => {
      expect(within(container).getByText('Rohan Iyer')).toBeInTheDocument()
    })
    expect(within(container).getByText('Meera Nair')).toBeInTheDocument()

    const modeSelect = within(container).getByDisplayValue('All modes')
    fireEvent.change(modeSelect, { target: { value: 'Razorpay' } })

    expect(within(container).queryByText('Rohan Iyer')).not.toBeInTheDocument()
    expect(within(container).getByText('Meera Nair')).toBeInTheDocument()
  })
})

describe('Fee structure', () => {
  it('shows fee heads from the API, adds one, and saves the class-wise structure', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')

    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })
    expect(within(container).getAllByText('Transport').length).toBeGreaterThan(0)
    expect(within(container).getAllByText('Other').length).toBeGreaterThan(0)

    await waitFor(() => {
      expect(within(container).getByRole('group', { name: 'Filter by grade' })).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => {
      expect(within(container).getAllByText('X-A').length).toBeGreaterThan(0)
    })
    expect(within(container).getAllByText('X-B').length).toBeGreaterThan(0)

    expect(within(container).getByDisplayValue(/School fees/i)).toBeInTheDocument()
    expect(within(container).getByText(/Fee structure name/i)).toBeInTheDocument()

    fireEvent.change(within(container).getByPlaceholderText(/Type fee name|e\.g\. Library|Custom head|Add another/i), { target: { value: 'Lab fee' } })
    fireEvent.click(within(container).getByRole('button', { name: /Add fee type/i }))
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/heads'))
      expect(postCall).toBeDefined()
    })
    await waitFor(() => {
      expect(within(container).getAllByText(/Lab [Ff]ee/).length).toBeGreaterThan(0)
    })

    const firstAmount = within(container).getAllByRole('spinbutton')[0] as HTMLInputElement
    fireEvent.change(firstAmount, { target: { value: '50000' } })
    fireEvent.click(within(container).getByText('Save only'))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const putCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'PUT' && String(url).includes('/fees/structure'))
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall?.[1] as RequestInit).body as string)
      expect(body.name).toBeTruthy()
      expect(body.academic_year).toBeTruthy()
      expect(body.effective_from).toBeTruthy()
      expect(body.status).toBe('inactive')
      expect(body.amounts['X-A'] || body.amounts['IX-A'] || body.amounts['X-B']).toBeTruthy()
    })
    await waitFor(() => {
      expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument()
    })
  }, 15000)

  it('generates invoices for selected classes (class-wise)', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')

    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })

    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => {
      expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0)
    })

    /* Index [0] is the "Same fee for all shown classes" bulk-apply row — use the
       real per-class cell (also rendered twice: mobile card + desktop table). */
    const firstAmount = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(firstAmount, { target: { value: '12000' } })
    fireEvent.blur(firstAmount)

    fireEvent.click(within(container).getByRole('button', { name: 'Save & generate' }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/generate'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.academic_year).toBeTruthy()
      expect(Array.isArray(body.classes)).toBe(true)
      expect(body.classes.length).toBeGreaterThan(0)
      expect(body.grades).toBeUndefined()
    })
    await waitFor(() => {
      expect(within(container).getByText(/invoices generated/i)).toBeInTheDocument()
    })
  })

  it('auto-notifies parents of the newly billed classes once invoices are generated', async () => {
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Kid One', gender: 'M', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9000000001', guardian_email: 'p1@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
    ]
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const firstAmount = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(firstAmount, { target: { value: '12000' } })
    fireEvent.blur(firstAmount)
    fireEvent.click(within(container).getByRole('button', { name: 'Save & generate' }))

    await waitFor(() => {
      expect(within(container).getByText(/invoices generated/i)).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(notifyFeeAudience).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'invoice_created',
        emails: ['p1@x.com'],
        phones: ['9000000001'],
      }))
    })
    // Deliberately generic (spec: never announce the full published structure amount to
    // every student) — no amount/total field of any kind on this call.
    const invoiceCreatedCall = vi.mocked(notifyFeeAudience).mock.calls
      .find(([arg]) => arg.kind === 'invoice_created')
    expect(invoiceCreatedCall?.[0]).not.toHaveProperty('amount')
    await waitFor(() => expect(createdNotifications.some((n) => n.title === 'Fee billed')).toBe(true))
  })

  it('does not auto-notify when Save & generate creates zero new invoices', async () => {
    nextGenerateCreated = 0
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Kid One', gender: 'M', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9000000001', guardian_email: 'p1@x.com', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
    ]
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const firstAmount = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(firstAmount, { target: { value: '12000' } })
    fireEvent.blur(firstAmount)
    fireEvent.click(within(container).getByRole('button', { name: 'Save & generate' }))

    await waitFor(() => {
      expect(within(container).getByText(/no new invoices/i)).toBeInTheDocument()
    })
    expect(notifyFeeAudience).not.toHaveBeenCalled()
    expect(createdNotifications).toHaveLength(0)
  })

  it('creates a fee head with the Transport flag checked', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })

    fireEvent.change(within(container).getByPlaceholderText(/Type fee name|e\.g\. Library|Custom head|Add another/i), { target: { value: 'Transport Fee' } })
    fireEvent.click(within(container).getByLabelText(/mark as transport fee/i))
    fireEvent.click(within(container).getByRole('button', { name: /Add fee type/i }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/heads'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.is_transport_fee_head).toBe(true)
    })
    await waitFor(() => {
      expect(within(container).getAllByText('🚌 Transport').length).toBeGreaterThan(0)
    })
  })

  it('creates a fee head with a description that shows as a tooltip on its chip', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })

    fireEvent.change(within(container).getByPlaceholderText(/Type fee name|e\.g\. Library|Custom head|Add another/i), { target: { value: 'Trip' } })
    fireEvent.change(within(container).getByPlaceholderText(/Annual educational trip to Mumbai/i), { target: { value: 'Annual educational trip to Mumbai, Nov 2026' } })
    fireEvent.click(within(container).getByRole('button', { name: /Add fee type/i }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/heads'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.description).toBe('Annual educational trip to Mumbai, Nov 2026')
    })
    await waitFor(() => {
      const chip = within(container).getAllByText('Trip')[0].closest('[title]')
      expect(chip).toHaveAttribute('title', 'Annual educational trip to Mumbai, Nov 2026')
    })
  })

  it('creates a fee head without the Transport flag (shown as Regular)', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })

    fireEvent.change(within(container).getByPlaceholderText(/Type fee name|e\.g\. Library|Custom head|Add another/i), { target: { value: 'Lab fee' } })
    fireEvent.click(within(container).getByRole('button', { name: /Add fee type/i }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const postCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/heads'))
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string)
      expect(body.is_transport_fee_head).toBe(false)
    })
    await waitFor(() => {
      expect(within(container).getAllByText(/Lab [Ff]ee/).length).toBeGreaterThan(0)
    })
    expect(within(container).getAllByText('Regular').length).toBeGreaterThan(0)
  })

  it('shows a Transport badge only for fee heads flagged as transport', async () => {
    feeHeads = feeHeads.map((h) => (h.id === 'h2' ? { ...h, is_transport_fee_head: true } : h))
    const { container, clickTab } = renderScreen()
    clickTab('Structure')

    await waitFor(() => {
      expect(within(container).getAllByText('🚌 Transport').length).toBeGreaterThan(0)
    })
    expect(within(container).getAllByText('Regular').length).toBeGreaterThan(0)
  })

  it('marks an existing fee head as Transport via the toggle + confirmation modal', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })

    fireEvent.click(within(container).getByRole('button', { name: /Mark Academic as transport fee/i }))
    await waitFor(() => {
      expect(within(container).getByText('Mark as Transport Fee?')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const patchCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'PATCH' && String(url).includes('/fees/heads/h1'))
      expect(patchCall).toBeDefined()
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string)
      expect(body.is_transport_fee_head).toBe(true)
    })
    await waitFor(() => {
      expect(within(container).getByText(/marked as Transport/i)).toBeInTheDocument()
    })
  })

  it('unmarks an existing transport fee head back to Regular via the toggle + confirmation modal', async () => {
    feeHeads = feeHeads.map((h) => (h.id === 'h2' ? { ...h, is_transport_fee_head: true } : h))
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => {
      expect(within(container).getAllByText('🚌 Transport').length).toBeGreaterThan(0)
    })

    fireEvent.click(within(container).getByRole('button', { name: /Unmark Transport as transport fee/i }))
    await waitFor(() => {
      expect(within(container).getByText('Mark as Regular Fee?')).toBeInTheDocument()
    })
    fireEvent.click(within(container).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const patchCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'PATCH' && String(url).includes('/fees/heads/h2'))
      expect(patchCall).toBeDefined()
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string)
      expect(body.is_transport_fee_head).toBe(false)
    })
    await waitFor(() => {
      expect(within(container).getByText(/marked as Regular/i)).toBeInTheDocument()
    })
  })

  it('lists saved fee structure versions and can view one’s amounts', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')

    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => {
      expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0)
    })
    const firstAmount = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(firstAmount, { target: { value: '12000' } })
    fireEvent.blur(firstAmount)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => {
      expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument()
    })

    clickTab('Saved Versions')
    await waitFor(() => {
      expect(within(container).getAllByRole('button', { name: /view/i }).length).toBeGreaterThan(0)
    })

    fireEvent.click(within(container).getAllByRole('button', { name: /view/i })[0])
    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })
    expect(within(container).getAllByText(/12,000|12000/).length).toBeGreaterThan(0)
  })

  it('saving twice keeps both versions in the Saved versions list instead of overwriting', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')

    await waitFor(() => {
      expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => {
      expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0)
    })
    const amountInput = () => within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement

    fireEvent.change(amountInput(), { target: { value: '1000' } })
    fireEvent.blur(amountInput())
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    fireEvent.change(amountInput(), { target: { value: '2000' } })
    fireEvent.blur(amountInput())
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const putCalls = fetchMock.mock.calls.filter(([url, opts]) => opts?.method === 'PUT' && String(url).includes('/fees/structure'))
      expect(putCalls.length).toBeGreaterThanOrEqual(2)
    })

    clickTab('Saved Versions')
    await waitFor(() => {
      expect(within(container).getAllByRole('button', { name: /view/i }).length).toBe(2)
    })
  })

  it('"Save only" creates a Draft with Edit/Publish/Delete actions; "Save & generate" publishes with only View', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '1000' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getByText('Draft')).toBeInTheDocument())
    expect(within(container).getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(within(container).getByRole('button', { name: /^publish$/i })).toBeInTheDocument()
    expect(within(container).getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('publishing a draft marks it Published and shows a success toast', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '1500' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getByRole('button', { name: /^publish$/i })).toBeInTheDocument())
    fireEvent.click(within(container).getByRole('button', { name: /^publish$/i }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const publishCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/publish'))
      expect(publishCall).toBeDefined()
    })
    await waitFor(() => expect(within(container).getAllByText('Published').length).toBeGreaterThan(0))
  })

  it('publishing never asks for a Term and never calls generate — Publish is term-free', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '1500' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getByRole('button', { name: /^publish$/i })).toBeInTheDocument())
    fireEvent.click(within(container).getByRole('button', { name: /^publish$/i }))

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const publishCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/publish'))
      expect(publishCall).toBeDefined()
      const body = (publishCall?.[1] as RequestInit).body
      expect(body).toBeFalsy() // publish takes no body/term at all
    })
    await waitFor(() => expect(within(container).getAllByText('Published').length).toBeGreaterThan(0))

    expect(within(container).queryByText(/which term/i)).not.toBeInTheDocument()
    expect(within(container).queryByText('Bill this now?')).not.toBeInTheDocument()
    const fetchMock = vi.mocked(fetch)
    expect(fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'POST' && String(url).includes('/fees/invoices/generate'))).toBeUndefined()
  })

  it('deleting a draft removes it after confirming, but the published version has no delete action', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = () => within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement

    fireEvent.change(amountInput(), { target: { value: '1000' } })
    fireEvent.blur(amountInput())
    fireEvent.click(within(container).getByText('Save & generate'))
    await waitFor(() => expect(within(container).getByText(/Structure published/i)).toBeInTheDocument())

    clickTab('Structure')
    fireEvent.change(amountInput(), { target: { value: '2000' } })
    fireEvent.blur(amountInput())
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getAllByRole('button', { name: /view/i }).length).toBe(2))
    expect(within(container).getAllByRole('button', { name: /^delete$/i }).length).toBe(1)

    fireEvent.click(within(container).getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(within(container).getByText('Delete this draft?')).toBeInTheDocument())
    const deleteButtons = within(container).getAllByRole('button', { name: /^delete$/i })
    fireEvent.click(deleteButtons[deleteButtons.length - 1])

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch)
      const deleteCall = fetchMock.mock.calls.find(([url, opts]) => opts?.method === 'DELETE' && String(url).includes('/fees/structures/'))
      expect(deleteCall).toBeDefined()
    })
    await waitFor(() => expect(within(container).getAllByRole('button', { name: /view/i }).length).toBe(1))
  })

  it('shows the saved version\'s total amount in the Saved versions list', async () => {
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '4200' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getAllByText(/4,200|4200/).length).toBeGreaterThan(0))
    expect(within(container).getByText(/Academic.*4,200|Academic.*4200/)).toBeInTheDocument()
  })

  it('previews fee-per-student and total-for-shown-students as you type in the bulk "Same fee" panel', async () => {
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Kid One', gender: 'M', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9000000001', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
      { id: 's2', admission_no: 'A2', class_label: 'X-A', name: 'Kid Two', gender: 'F', grade: 'X', section: 'A', roll: 2, guardian_name: 'P2', guardian_phone: '9000000002', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 2 },
    ]
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByText(/students?$/i).length).toBeGreaterThan(0))

    const bulkAcademicInput = within(container).getByLabelText('Same Academic amount for all shown classes') as HTMLInputElement
    fireEvent.change(bulkAcademicInput, { target: { value: '500' } })

    await waitFor(() => {
      expect(within(container).getByText(/Fee.*500\/student/)).toBeInTheDocument()
    })
    expect(within(container).getAllByText(/2 students/).length).toBeGreaterThan(0)
    expect(within(container).getByText(/Total.*1,000|Total.*1000/)).toBeInTheDocument()
  })

  it('shows both the per-student rate and the total for a fee head in the Saved versions list', async () => {
    students = [
      { id: 's1', admission_no: 'A1', class_label: 'X-A', name: 'Kid One', gender: 'M', grade: 'X', section: 'A', roll: 1, guardian_name: 'P1', guardian_phone: '9000000001', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 1 },
      { id: 's2', admission_no: 'A2', class_label: 'X-A', name: 'Kid Two', gender: 'F', grade: 'X', section: 'A', roll: 2, guardian_name: 'P2', guardian_phone: '9000000002', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 2 },
      { id: 's3', admission_no: 'A3', class_label: 'X-A', name: 'Kid Three', gender: 'M', grade: 'X', section: 'A', roll: 3, guardian_name: 'P3', guardian_phone: '9000000003', attendance_pct: 0, fee_status: 'due', fee_due: 0, status: 'active', house: '', avatar_hue: 3 },
    ]
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '6500' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save only'))
    await waitFor(() => expect(within(container).getByText(/Draft saved/i)).toBeInTheDocument())

    clickTab('Saved Versions')
    await waitFor(() => expect(within(container).getAllByText(/19,500|19500/).length).toBeGreaterThan(0))
    expect(within(container).getByText(/Academic.*6,500\/student.*Total.*19,500/)).toBeInTheDocument()
  })

  it('tells the user no new invoices were made when everyone already has one for that term, instead of implying success', async () => {
    nextGenerateCreated = 0
    const { container, clickTab } = renderScreen()
    clickTab('Structure')
    await waitFor(() => expect(within(container).getAllByText('Academic').length).toBeGreaterThan(0))
    fireEvent.click(within(container).getByRole('button', { name: 'X' }))
    await waitFor(() => expect(within(container).getAllByLabelText('X-A Academic amount').length).toBeGreaterThan(0))
    const amountInput = within(container).getAllByLabelText('X-A Academic amount')[0] as HTMLInputElement
    fireEvent.change(amountInput, { target: { value: '19000' } })
    fireEvent.blur(amountInput)
    fireEvent.click(within(container).getByText('Save & generate'))

    await waitFor(() => {
      expect(within(container).getByText(/no new invoices/i)).toBeInTheDocument()
    })
    expect(within(container).queryByText(/invoices generated/i)).not.toBeInTheDocument()
    expect(within(container).getByText(/already has an invoice/i)).toBeInTheDocument()
  })
})
