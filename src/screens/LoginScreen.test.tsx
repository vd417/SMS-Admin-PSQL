import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen } from './LoginScreen'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { tokenStore } from '@/api/auth/tokenStore'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => { localStorage.clear(); tokenStore.clear(); vi.restoreAllMocks() })

const renderLogin = () => render(
  <ToastProvider><AppProvider><LoginScreen /></AppProvider></ToastProvider>
)

describe('LoginScreen', () => {
  it('shows the API error message when password sign-in fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }, 401)))
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /^Sign in/i }))
    expect(await screen.findAllByText('Wrong email or password.')).not.toHaveLength(0)
  })

  it('Remember me saves login id only — never the password', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }, 401)))
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText(/you@school.edu or/i), 'owner@school.edu')
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'secret123')
    await userEvent.click(screen.getByLabelText(/remember me/i))
    await userEvent.click(screen.getByRole('button', { name: /^Sign in/i }))
    expect(await screen.findAllByText('Wrong email or password.')).not.toHaveLength(0)
    const raw = localStorage.getItem('sm.login.remember')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed.id).toBe('owner@school.edu')
    expect(parsed.pw).toBeUndefined()
  })

  it('prefills remembered id on load and strips any legacy stored password', () => {
    localStorage.setItem('sm.login.remember', JSON.stringify({ id: 'kept@school.edu', pw: 'should-not-keep' }))
    renderLogin()
    expect(screen.getByPlaceholderText(/you@school.edu or/i)).toHaveValue('kept@school.edu')
    expect(screen.getByPlaceholderText('••••••••')).toHaveValue('')
    expect(JSON.parse(localStorage.getItem('sm.login.remember')!)).toEqual({ id: 'kept@school.edu' })
  })
})

describe('LoginScreen password reset', () => {
  it('opens the reset panel from the Forgot password link', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    expect(screen.getByText(/Set your password/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/you@school.edu or/i)).toBeInTheDocument()
  })

  it('surfaces a no-account message when the identifier is not registered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'not_registered', message: 'nope' } }, 404)))
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@school.edu or/i), 'ghost@nowhere.edu')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    expect(await screen.findByText(/No account is registered/i)).toBeInTheDocument()
    // popup (toast) also appears for the not-registered case
    expect(await screen.findByText(/not registered/i)).toBeInTheDocument()
    expect(screen.getByText(/No account exists for that email or mobile/i)).toBeInTheDocument()
    // still on the identify step
    expect(screen.getByPlaceholderText(/you@school.edu or/i)).toBeInTheDocument()
  })

  it('resets the password then returns to sign in with a success banner', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true } })) // /auth/password/forgot
      .mockResolvedValueOnce(new Response(null, { status: 204 }))     // /auth/password/reset
    vi.stubGlobal('fetch', fetchMock)
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@school.edu or/i), 'admin@greenwood.edu')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    await userEvent.type(await screen.findByPlaceholderText('••••••'), '123456')
    await userEvent.type(screen.getByPlaceholderText(/at least 8 characters/i), 'newPass123')
    await userEvent.type(screen.getByPlaceholderText(/re-enter your password/i), 'newPass123')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByText(/Password updated/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Sign in/i })).toBeInTheDocument()
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('/auth/password/forgot')
    expect(urls[1]).toContain('/auth/password/reset')
  }, 15000)

  it('keeps the user on the reset step when the code is invalid', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true } }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_code', message: 'bad' } }, 401))
    vi.stubGlobal('fetch', fetchMock)
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@school.edu or/i), 'admin@greenwood.edu')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    await userEvent.type(await screen.findByPlaceholderText('••••••'), '000000')
    await userEvent.type(screen.getByPlaceholderText(/at least 8 characters/i), 'newPass123')
    await userEvent.type(screen.getByPlaceholderText(/re-enter your password/i), 'newPass123')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByText(/invalid or expired/i)).toBeInTheDocument()
  }, 15000)

  it('blocks a too-short password without calling the reset API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { sent: true } })) // forgot only
    vi.stubGlobal('fetch', fetchMock)
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    await userEvent.type(screen.getByPlaceholderText(/you@school.edu or/i), 'admin@greenwood.edu')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    await userEvent.type(await screen.findByPlaceholderText('••••••'), '123456')
    await userEvent.type(screen.getByPlaceholderText(/at least 8 characters/i), 'short')
    await userEvent.type(screen.getByPlaceholderText(/re-enter your password/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByText(/Password must be at least 8 characters/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1) // forgot only; no reset call
  }, 15000)
})
