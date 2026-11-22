import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'

/* Node 25 exposes localStorage without a valid --localstorage-file, so getItem/clear
   are missing and they shadow jsdom. Install a real in-memory Storage before any
   module reads it (query keys call getTenantId at import). */
function isStorage(value: unknown): value is Storage {
  return !!value && typeof (value as Storage).getItem === 'function' && typeof (value as Storage).clear === 'function'
}

function memoryStorage(): Storage {
  const mem = new Map<string, string>()
  return {
    get length() { return mem.size },
    clear() { mem.clear() },
    getItem(key) { return mem.has(key) ? mem.get(key)! : null },
    key(index) { return [...mem.keys()][index] ?? null },
    removeItem(key) { mem.delete(key) },
    setItem(key, value) { mem.set(String(key), String(value)) },
  }
}

function ensureStorage(name: 'localStorage' | 'sessionStorage') {
  const scope = globalThis as typeof globalThis & { window?: Window }
  if (isStorage(scope[name])) return
  const store = memoryStorage()
  Object.defineProperty(scope, name, { value: store, configurable: true, writable: true })
  if (scope.window && !isStorage(scope.window[name])) {
    Object.defineProperty(scope.window, name, { value: store, configurable: true, writable: true })
  }
}

ensureStorage('localStorage')
ensureStorage('sessionStorage')

/* Test isolation: give every test a clean slate so leaked state can't bleed
   between files/tests.

   - Storage: AppProvider persists UI/session to local/sessionStorage; a stale
     entry would make its mount restore effect clobber the current view.
   - fetch: default every test to a benign 200 empty-envelope response so no test
     accidentally hits the real network. A pending real request from one test can
     otherwise resolve during a later test, trip the API client's auth-failure
     path, and force a global logout() that resets the active view. Tests that
     need specific responses still override this with vi.stubGlobal('fetch', …). */
function benignFetch(): Response {
  return new Response(JSON.stringify({ data: [], next_cursor: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  globalThis.fetch = (() => Promise.resolve(benignFetch())) as typeof fetch
})

afterEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})
