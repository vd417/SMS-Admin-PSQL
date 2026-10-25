import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import App from './App'

vi.mock('@/api/hooks/useAttendanceLive', () => ({
  useAttendanceLiveSocket: () => ({ connected: false }),
}))

vi.mock('@/api/hooks/useThreadsLive', () => ({
  useThreadsLiveSocket: () => ({ connected: false }),
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/* Sign-in performs a real password login: POST /auth/login then GET /auth/me.
   Mock both so a form submit lands the user in the app. */
function mockAuth(roles: string[] = ['admin'], tenantId: string | null = 't1', isPlatform = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('/auth/me')) return jsonResponse({ data: { id: 'u1', tenant_id: tenantId, roles, is_platform: isPlatform } })
    if (url.includes('/auth/')) return jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } })
    /* Any other business endpoint (portfolio schools, plans, fee summary, …) — empty list is enough for smoke routing. */
    return jsonResponse({ data: [] })
  }))
}

/* Fill the email/password form and submit. Console routing is determined by
   the is_platform flag from /auth/me, not the email domain. */
function signIn(email: string, password = 'demo1234') {
  fireEvent.change(screen.getByPlaceholderText(/you@school\.edu/), { target: { value: email } })
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /^sign in/i }))
}

describe('App (smoke)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('shows the login screen first', () => {
    render(<App />)
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
  })

  it('owner demo account lands in the owner console', async () => {
    mockAuth(['admin'], null, true)
    render(<App />)
    signIn('anil@schoolmate.io')
    expect(await screen.findByText('Portfolio Overview')).toBeInTheDocument()
    const sidebar = document.querySelector('.sm-sidebar') as HTMLElement
    expect(within(sidebar).getByText('Schools')).toBeInTheDocument()
  })

  it('school admin lands in the school console with dashboard nav', async () => {
    mockAuth()
    render(<App />)
    signIn('admin@greenwood.edu')
    const sidebar = (await screen.findByRole('complementary')) as HTMLElement
    expect(within(sidebar).getByText('Dashboard')).toBeInTheDocument()
    expect(within(sidebar).getByText('Students (SIS)')).toBeInTheDocument()
  })

  it('theme toggle flips data-theme', async () => {
    mockAuth()
    render(<App />)
    signIn('admin@greenwood.edu')
    const toggle = await screen.findByLabelText('Toggle theme')
    const before = document.documentElement.getAttribute('data-theme')
    fireEvent.click(toggle)
    const after = document.documentElement.getAttribute('data-theme')
    expect(after).not.toBe(before)
  })
})
