import { describe, it, expect, beforeEach, vi } from 'vitest'
import { request, listRequest, ApiError, setOnAuthFailure } from './client'
import { tokenStore } from './auth/tokenStore'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => { localStorage.clear(); tokenStore.clear(); vi.restoreAllMocks() })

describe('request', () => {
  it('unwraps the data envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { ok: 1 } })))
    expect(await request<{ ok: number }>('/ping')).toEqual({ ok: 1 })
  })

  it('attaches the bearer token and tenant header when authed', async () => {
    tokenStore.set({ access_token: 'a1', refresh_token: 'r1' })
    tokenStore.setTenantId('t9')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await request('/secure')
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer a1')
    expect(headers['X-Tenant-Id']).toBe('t9')
  })

  it('does not send X-Tenant-Id on /auth/me even when a tenant is stored', async () => {
    tokenStore.set({ access_token: 'a1', refresh_token: 'r1' })
    tokenStore.setTenantId('t9')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'u1' } }))
    vi.stubGlobal('fetch', fetchMock)
    await request('/auth/me')
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer a1')
    expect(headers['X-Tenant-Id']).toBeUndefined()
  })

  it('does not send Bearer on auth bootstrap routes', async () => {
    tokenStore.set({ access_token: 'a1', refresh_token: 'r1' })
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await request('/auth/password/forgot', { method: 'POST', body: {} })
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBeUndefined()
  })

  it('throws a typed ApiError on error envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'forbidden', message: 'nope', details: null } }, 403)))
    await expect(request('/x')).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(request('/x')).rejects.toBeInstanceOf(ApiError)
  })

  it('refreshes once on 401 then retries the original request', async () => {
    tokenStore.set({ access_token: 'old', refresh_token: 'r1' })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_token', message: 'exp' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ data: { access_token: 'new', refresh_token: 'r2' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await request<{ ok: boolean }>('/secure')).toEqual({ ok: true })
    expect(tokenStore.getAccess()).toBe('new')
    const retryHeaders = (fetchMock.mock.calls[2][1] as RequestInit).headers as Record<string, string>
    expect(retryHeaders.Authorization).toBe('Bearer new')
  })

  it('shares a single in-flight refresh across concurrent 401s (avoids a spurious logout)', async () => {
    tokenStore.set({ access_token: 'old', refresh_token: 'r1' })
    let refreshCalls = 0
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/auth/refresh')) {
        refreshCalls++
        return jsonResponse({ data: { access_token: 'new', refresh_token: 'r2' } })
      }
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization === 'Bearer new') return jsonResponse({ data: { ok: true } })
      return jsonResponse({ error: { code: 'invalid_token', message: 'exp' } }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([
      request<{ ok: boolean }>('/secure-a'),
      request<{ ok: boolean }>('/secure-b'),
    ])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    // A single-use rotated refresh token means a second concurrent /auth/refresh
    // call would fail and force a spurious logout — assert it never happens.
    expect(refreshCalls).toBe(1)
    expect(tokenStore.getAccess()).toBe('new')
  })

  it('serializes refresh across tabs via a Web Lock and uses the latest stored refresh token', async () => {
    // Multi-tab race: a sibling tab already rotated r1 -> r2 in shared localStorage and
    // released the lock before this tab's refresh runs. This tab must read r2 (not the
    // spent r1 it started with) and refresh cleanly instead of 401-ing into a logout.
    tokenStore.set({ access_token: 'old', refresh_token: 'r2' })
    const locksRequest = vi.fn((_name: string, cb: () => Promise<boolean>) => cb())
    vi.stubGlobal('navigator', { locks: { request: locksRequest } })
    const onFail = vi.fn()
    setOnAuthFailure(onFail)
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (path.endsWith('/auth/refresh')) {
        const sent = (JSON.parse(init?.body as string) as { refresh_token: string }).refresh_token
        if (sent !== 'r2') return jsonResponse({ error: { code: 'invalid_token', message: 'spent' } }, 401)
        return jsonResponse({ data: { access_token: 'new', refresh_token: 'r3' } })
      }
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (headers.Authorization === 'Bearer new') return jsonResponse({ data: { ok: true } })
      return jsonResponse({ error: { code: 'invalid_token', message: 'exp' } }, 401)
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await request<{ ok: boolean }>('/secure')).toEqual({ ok: true })
    expect(locksRequest).toHaveBeenCalledWith('sms-admin-auth-refresh', expect.any(Function))
    expect(tokenStore.getRefresh()).toBe('r3')
    expect(onFail).not.toHaveBeenCalled()
  })

  it('clears tokens and fires onAuthFailure when refresh fails', async () => {
    tokenStore.set({ access_token: 'old', refresh_token: 'r1' })
    const onFail = vi.fn()
    setOnAuthFailure(onFail)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_token', message: 'exp' } }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'invalid_token', message: 'bad' } }, 401)))
    await expect(request('/secure')).rejects.toBeInstanceOf(ApiError)
    expect(onFail).toHaveBeenCalledOnce()
    expect(tokenStore.getRefresh()).toBeNull()
  })

  it('treats a 401 on a no-auth password route as a normal error (no refresh, no logout)', async () => {
    tokenStore.set({ access_token: 'a1', refresh_token: 'r1' })
    const onFail = vi.fn()
    setOnAuthFailure(onFail)
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: 'invalid_code', message: 'bad code' } }, 401))
    vi.stubGlobal('fetch', fetchMock)
    await expect(request('/auth/password/reset', { method: 'POST', body: {} }))
      .rejects.toMatchObject({ status: 401, code: 'invalid_code' })
    expect(fetchMock).toHaveBeenCalledOnce()      // no refresh retry
    expect(onFail).not.toHaveBeenCalled()         // no session-expiry path
    expect(tokenStore.getRefresh()).toBe('r1')    // tokens untouched
  })
})

describe('listRequest', () => {
  it('returns the full envelope (no .data unwrap)', async () => {
    const envelope = { data: [{ id: 1 }], next_cursor: 'abc' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(envelope)))
    expect(await listRequest<typeof envelope>('/items')).toEqual(envelope)
  })
})
