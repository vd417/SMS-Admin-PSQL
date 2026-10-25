import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { AppProvider, useApp } from './AppProvider'
import { tokenStore } from '@/api/auth/tokenStore'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  tokenStore.clear()
  vi.restoreAllMocks()
})

const wrapper = ({ children }: { children: React.ReactNode }) => <AppProvider>{children}</AppProvider>

describe('AppProvider auth', () => {
  it('password login authenticates then loads role/tenant from /auth/me', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } })) // /auth/login
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['principal'] } })) // /auth/me
      .mockResolvedValueOnce(jsonResponse({ data: [] }))) // /me/schools
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('p@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.role).toBe('principal')
    expect(tokenStore.getTenantId()).toBe('t1')
  })

  it('surfaces an auth error on bad credentials and stays logged out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_credentials', message: 'Wrong email or password.' } }, 401)))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('x@y.edu', 'bad') })
    expect(result.current.loggedIn).toBe(false)
    expect(result.current.authError).toBe('Wrong email or password.')
  })

  it('a platform account routes to the owner console', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: null, roles: ['admin'], is_platform: true } })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('owner@anything.com', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.consoleKind).toBe('owner')
    expect(result.current.view).toBe('owner.dashboard')
  })

  it('a non-platform account routes to the school console even with an @schoolmate.io email', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['admin'], is_platform: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('anil@schoolmate.io', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.consoleKind).toBe('school')
    expect(result.current.view).toBe('school.dashboard')
  })

  it('an unknown backend role falls back to admin (no crash)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['school_admin'] } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('admin@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.role).toBe('admin')
  })

  it('a school.owner account routes to the owner console as role owner', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['school.owner'], is_platform: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('owner@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.role).toBe('owner')
    expect(result.current.consoleKind).toBe('owner')
    expect(result.current.view).toBe('owner.dashboard')
    expect(result.current.isPlatform).toBe(false)
  })

  it('school login applies silver/gold/platinum from /me/schools for gating', async () => {
    const tenantId = '11111111-2222-3333-4444-555555555555'
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: tenantId, roles: ['admin'], is_platform: false } }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{
          id: tenantId, name: 'Silver High', slug: 'silver-high', country: 'IN', status: 'active',
          plan_id: null, plan_name: 'Silver', tier: 'silver', mrr: 1000, students_count: 100, staff_count: 10,
          storage_gb: 1, created: '2026-01-01', contact_name: null, contact_email: null, contact_phone: null,
          address: null, logo_url: null, image_url: null, health_score: 70,
        }],
      })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('admin@silver.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.plan).toBe('silver')
    expect(result.current.school.name).toBe('Silver High')
  })

  it('shows the real name/email from /auth/me, not the email prefix', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        id: 'u1', tenant_id: 't1', roles: ['admin'], is_platform: false,
        name: 'Ravi Menon', email: 'admin@greenwood.edu',
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('admin@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.user?.name).toBe('Ravi Menon')
    expect(result.current.user?.email).toBe('admin@greenwood.edu')
  })

  it('falls back to the email prefix when /auth/me returns no name', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['admin'], is_platform: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('admin@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.user?.name).toBe('admin')
  })

  it('logout clears the session and returns to the login screen', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a', refresh_token: 'r' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['admin'] } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })) // /me/schools hydrate
      .mockResolvedValueOnce(new Response(null, { status: 204 })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await act(async () => { await result.current.loginWithPassword('admin@greenwood.edu', 'pw') })
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    await act(async () => { await result.current.logout() })
    expect(result.current.loggedIn).toBe(false)
  })

  it('restores session from refresh token after reload (no logout)', async () => {
    tokenStore.set({ access_token: 'old', refresh_token: 'r-keep' })
    tokenStore.setEmail('admin@greenwood.edu')
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a-new', refresh_token: 'r-new' } })) // /auth/refresh
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'u1', tenant_id: 't1', roles: ['admin'], is_platform: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [] })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => expect(result.current.sessionRestoring).toBe(false))
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.user?.email).toBe('admin@greenwood.edu')
    expect(tokenStore.getAccess()).toBe('a-new')
  })

  it('re-aligns JWT tenant when owner reloads inside another school console', async () => {
    const jwtTenant = '05ABE07A-C068-4EE5-A185-CE59B20AEC5D'
    const sccTenant = '4D941F97-AD14-467E-A47A-EDC4AAAFC759'
    tokenStore.set({ access_token: 'old', refresh_token: 'r-keep' })
    tokenStore.setEmail('owner@example.com')
    tokenStore.setUi({
      schoolId: sccTenant,
      consoleKind: 'school',
      ownerViewingSchool: true,
      view: 'school.attendance',
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'a-new', refresh_token: 'r-new' } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: 'u1', tenant_id: jwtTenant, roles: ['school.owner'], is_platform: false },
      }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({
        data: { access_token: 'scc-access', refresh_token: 'scc-refresh' },
      })))
    const { result } = renderHook(() => useApp(), { wrapper })
    await waitFor(() => expect(result.current.sessionRestoring).toBe(false))
    await waitFor(() => expect(result.current.loggedIn).toBe(true))
    expect(result.current.schoolId).toBe(sccTenant)
    expect(tokenStore.getTenantId()).toBe(sccTenant)
    expect(tokenStore.getAccess()).toBe('scc-access')
  })

  it('enterSchool uses the portfolio school plan for feature gating', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: { access_token: 'school-access', refresh_token: 'school-refresh' },
      })))
    const { result } = renderHook(() => useApp(), { wrapper })
    const goldSchool = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      name: 'Gold Academy',
      city: 'Pune',
      plan: 'gold' as const,
      students: 400,
      staff: 40,
      status: 'active' as const,
      mrr: 50000,
      attendance: 0,
      fees: 80,
      payroll: 0,
      currency: 'INR',
      tz: 'Asia/Kolkata',
      logo: 'GA',
      color: '#4f46e5',
    }
    await act(async () => { await result.current.enterSchool(goldSchool.id, goldSchool) })
    expect(result.current.plan).toBe('gold')
    expect(result.current.school.name).toBe('Gold Academy')
    expect(result.current.consoleKind).toBe('school')
  })
})
