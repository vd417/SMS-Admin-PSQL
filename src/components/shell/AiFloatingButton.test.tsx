import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { tokenStore } from '@/api/auth/tokenStore'
import { AiFloatingButton } from './AiFloatingButton'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function schoolResponse(tier: string, status = 'active') {
  return jsonResponse({
    data: [{
      id: 'school-1', name: 'Greenwood High', slug: 'greenwood', country: 'IN', status,
      plan_id: null, plan_name: tier, tier, mrr: 0, students_count: 0, staff_count: 0,
      storage_gb: 0, created: '2026-01-01', contact_name: null, contact_email: null,
      contact_phone: null, address: null, health_score: 100,
    }],
    next_cursor: null,
  })
}

function mockFetch(opts: { tier: string; isPlatform?: boolean; status?: string }) {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (url.includes('/auth/refresh')) return Promise.resolve(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
    if (url.includes('/auth/me')) {
      return Promise.resolve(jsonResponse({
        data: {
          id: 'u1', tenant_id: 'school-1', roles: [opts.isPlatform ? 'owner' : 'school.admin'],
          is_platform: !!opts.isPlatform,
        },
      }))
    }
    if (url.includes('/me/schools') && (init?.method ?? 'GET') === 'GET') return Promise.resolve(schoolResponse(opts.tier, opts.status))
    if (url.includes('/students')) return Promise.resolve(jsonResponse({ data: [], next_cursor: null }))
    if (url.includes('/attendance/period-records/summary/range')) {
      return Promise.resolve(jsonResponse({ data: { total_marked_periods: 0, present: 0, absent: 0, late: 0, leave: 0, attendance_percentage: null } }))
    }
    return Promise.resolve(jsonResponse({ data: {} }))
  })
}

function renderAi(opts: { tier: string; isPlatform?: boolean; status?: string }) {
  const fetchMock = mockFetch(opts)
  vi.stubGlobal('fetch', fetchMock)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider><AiFloatingButton /></ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
  return fetchMock
}

/** Fire the Topbar "open AI" event. */
function openAi() {
  fireEvent(window, new Event('sm:open-ai'))
}

beforeEach(() => {
  tokenStore.set({ access_token: 'a', refresh_token: 'r' })
  tokenStore.setEmail('admin@greenwood.edu')
})

afterEach(() => {
  tokenStore.clear()
  vi.unstubAllGlobals()
})

describe('AiFloatingButton (centered modal)', () => {
  it('renders nothing until opened', async () => {
    const fetchMock = renderAi({ tier: 'platinum' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/schools'), expect.anything()))
    expect(screen.queryByText(/Ask a question about your school/i)).not.toBeInTheDocument()
  })

  it('opens the AI panel centered for a Platinum school', async () => {
    const fetchMock = renderAi({ tier: 'platinum' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/schools'), expect.anything()))
    openAi()
    await waitFor(() => expect(screen.getByText(/Ask a question about your school/i)).toBeInTheDocument())
  })

  it('gives the owner console live AI regardless of any school plan', async () => {
    const fetchMock = renderAi({ tier: 'gold', isPlatform: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/auth/me'), expect.anything()))
    openAi()
    await waitFor(() => expect(screen.getByText(/Ask a question about your school/i)).toBeInTheDocument())
    expect(screen.queryByText(/Upgrade to Platinum/i)).not.toBeInTheDocument()
  })

  it('shows the upgrade veil for a non-Platinum school', async () => {
    const fetchMock = renderAi({ tier: 'gold' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/schools'), expect.anything()))
    openAi()
    await waitFor(() => expect(screen.getByText(/Upgrade to Platinum/i)).toBeInTheDocument())
    expect(screen.queryByText(/Ask a question about your school/i)).not.toBeInTheDocument()
  })

  it('does not open when the school is pending activation', async () => {
    const fetchMock = renderAi({ tier: 'platinum', status: 'past_due' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/schools'), expect.anything()))
    openAi()
    expect(screen.queryByText(/Ask a question about your school/i)).not.toBeInTheDocument()
  })

  it('closes when the close button is clicked', async () => {
    const fetchMock = renderAi({ tier: 'platinum' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/me/schools'), expect.anything()))
    openAi()
    await waitFor(() => expect(screen.getByText(/Ask a question about your school/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /close ai/i }))
    expect(screen.queryByText(/Ask a question about your school/i)).not.toBeInTheDocument()
  })
})
