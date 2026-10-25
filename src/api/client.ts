import { config } from './config'
import { tokenStore } from './auth/tokenStore'
import { ApiError } from './ApiError'
import type { ErrorBody } from './types'

export { ApiError }

let onAuthFailure: () => void = () => {}
export function setOnAuthFailure(cb: () => void): void { onAuthFailure = cb }

const NO_AUTH = new Set([
  '/auth/refresh', '/auth/login',
  '/auth/password/forgot', '/auth/password/reset',
])

export interface RequestOpts {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  auth?: boolean
}

function buildUrl(path: string, query?: RequestOpts['query']): string {
  const url = new URL(config.apiBaseUrl + path)
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v))
  return url.toString()
}

async function rawFetch(path: string, opts: RequestOpts, accessToken: string | null): Promise<Response> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  const useAuth = opts.auth !== false && !NO_AUTH.has(path)
  if (useAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  // Tenant comes from /auth/me — never send X-Tenant-Id on /auth/* (stale header → 403).
  const tenant = tokenStore.getTenantId()
  if (useAuth && tenant && !path.startsWith('/auth/')) headers['X-Tenant-Id'] = tenant
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    /* Hard cap so a wedged API cannot freeze CRM screens (esp. attendance fan-out). */
    signal: AbortSignal.timeout(25_000),
  })
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    return text ? JSON.parse(text) : {}
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    return {}
  }
}

function throwIfError(res: Response, json: unknown): void {
  if (res.ok) return
  const err = (json as { error?: ErrorBody }).error
  throw new ApiError(res.status, err?.code ?? 'internal_error', err?.message ?? res.statusText, err?.details ?? null)
}

/* Refresh tokens are single-use (rotated server-side). When several requests 401 at
   once — e.g. every screen's queries refetching right as the access token expires —
   each independently calling /auth/refresh would race: only the first wins, the rest
   resubmit an already-revoked token and force a spurious logout. Share one in-flight
   refresh across all callers instead. */
let pendingRefresh: Promise<boolean> | null = null

/* The in-flight promise only de-dupes within one tab. Two TABS whose access tokens
   expire together would each POST the shared (rotating) refresh token at once — the
   backend honours the first and 401s the second, which then clears localStorage and
   logs BOTH tabs out. Serialise refreshes across tabs on a named Web Lock: the losing
   tab waits, then reads the already-rotated token (written to localStorage by the
   winner before it released the lock) and refreshes cleanly. Falls back to in-tab
   single-flight where Web Locks are unavailable. */
const REFRESH_LOCK = 'sms-admin-auth-refresh'
function withRefreshLock(fn: () => Promise<boolean>): Promise<boolean> {
  const nav = typeof navigator !== 'undefined'
    ? (navigator as unknown as { locks?: { request(name: string, cb: () => Promise<boolean>): Promise<boolean> } })
    : undefined
  return nav?.locks?.request ? nav.locks.request(REFRESH_LOCK, fn) : fn()
}

async function tryRefresh(): Promise<boolean> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = withRefreshLock(doRefresh).finally(() => { pendingRefresh = null })
  return pendingRefresh
}

async function doRefresh(): Promise<boolean> {
  // Read inside the lock callback so a tab that waited picks up the token a sibling just rotated.
  const refresh = tokenStore.getRefresh()
  if (!refresh) return false
  const res = await rawFetch('/auth/refresh', { method: 'POST', body: { refresh_token: refresh } }, null)
  if (!res.ok) return false
  const body = (await res.json()) as { data: { access_token: string; refresh_token: string } }
  tokenStore.set(body.data)
  return true
}

async function executeWithRefresh(path: string, opts: RequestOpts): Promise<Response> {
  let res = await rawFetch(path, opts, tokenStore.getAccess())
  if (res.status === 401 && !NO_AUTH.has(path)) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      res = await rawFetch(path, opts, tokenStore.getAccess())
      if (res.status === 401) { tokenStore.clear(); onAuthFailure() }
    } else {
      tokenStore.clear(); onAuthFailure()
    }
  }
  return res
}

export async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await executeWithRefresh(path, opts)
  const json = await readJson(res)
  throwIfError(res, json)
  return (json as { data: T }).data
}

/** Returns the full parsed body (no `.data` unwrap) — for list endpoints whose
 *  response IS the envelope: `{ data: [...], next_cursor }`. */
export async function listRequest<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await executeWithRefresh(path, opts)
  const json = await readJson(res)
  throwIfError(res, json)
  return json as T
}
