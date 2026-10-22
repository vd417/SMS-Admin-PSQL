/* Academics draft/publish snapshots — periods, tests, and timetable envelopes via API.
   publishMemory is only a cache of the last successful fetch/save (not the source of truth). */
import { request } from '@/api/client'
import { snakeToCamel, camelToSnake } from '@/api/mapper'
import { tokenStore } from '@/api/auth/tokenStore'

export type AcademicsPublishTab = 'periods' | 'timetable' | 'tests'

export type PublishStatus = 'empty' | 'draft' | 'published' | 'unpublished'

export interface PublishEnvelope<T> {
  draft: T | null
  published: T | null
  draftSavedAt: string | null
  publishedAt: string | null
}

function tenantKey(): string {
  return tokenStore.getTenantId() || 'default'
}

function storageKey(tab: AcademicsPublishTab): string {
  return `sms_academics_pub:${tenantKey()}:${tab}`
}

function emptyEnvelope<T>(): PublishEnvelope<T> {
  return { draft: null, published: null, draftSavedAt: null, publishedAt: null }
}

/** In-memory publish envelopes for the current session (not localStorage SoT). */
const publishMemory = new Map<string, PublishEnvelope<unknown>>()

function memKey(tab: AcademicsPublishTab): string {
  return `${tab}:${tenantKey()}`
}

function readMemory<T>(tab: AcademicsPublishTab): PublishEnvelope<T> {
  const prev = publishMemory.get(memKey(tab))
  if (!prev) return emptyEnvelope()
  return {
    draft: (prev.draft as T | null) ?? null,
    published: (prev.published as T | null) ?? null,
    draftSavedAt: prev.draftSavedAt ?? null,
    publishedAt: prev.publishedAt ?? null,
  }
}

function writeMemory<T>(tab: AcademicsPublishTab, env: PublishEnvelope<T>): void {
  publishMemory.set(memKey(tab), env as PublishEnvelope<unknown>)
}

function apiPath(tab: AcademicsPublishTab): string {
  if (tab === 'periods') return '/academic-periods'
  if (tab === 'tests') return '/class-tests'
  return '/class-routine'
}

function parseJsonField<T>(raw: unknown): T | null {
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  return raw as T
}

function fromWire<T>(wire: unknown): PublishEnvelope<T> {
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) return emptyEnvelope()
  const c = snakeToCamel<Record<string, unknown>>(wire)
  return {
    draft: parseJsonField<T>(c.draftJson ?? c.draft),
    published: parseJsonField<T>(c.publishedJson ?? c.published),
    draftSavedAt: c.draftSavedAt != null ? String(c.draftSavedAt) : null,
    publishedAt: c.publishedAt != null ? String(c.publishedAt) : null,
  }
}

function clearLegacy(tab: AcademicsPublishTab): void {
  try { localStorage.removeItem(storageKey(tab)) } catch { /* ignore */ }
}

/** Sync load — session memory only (never localStorage business SoT). */
export function loadPublishEnvelope<T>(tab: AcademicsPublishTab): PublishEnvelope<T> {
  return readMemory<T>(tab)
}

async function upsertRemote<T>(
  tab: AcademicsPublishTab,
  env: PublishEnvelope<T>,
): Promise<PublishEnvelope<T>> {
  const wire = await request<Record<string, unknown>>(apiPath(tab), {
    method: 'PUT',
    body: camelToSnake({
      draftJson: env.draft == null ? null : JSON.stringify(env.draft),
      publishedJson: env.published == null ? null : JSON.stringify(env.published),
      draftSavedAt: env.draftSavedAt,
      publishedAt: env.publishedAt,
    }),
  })
  clearLegacy(tab)
  const next = fromWire<T>(wire)
  writeMemory(tab, next)
  return next
}

export async function fetchPublishEnvelope<T>(tab: AcademicsPublishTab): Promise<PublishEnvelope<T>> {
  clearLegacy(tab)
  const wire = await request<Record<string, unknown>>(apiPath(tab))
  const remote = fromWire<T>(wire)
  writeMemory(tab, remote)
  return remote
}

export async function saveDraftSnapshot<T>(tab: AcademicsPublishTab, draft: T): Promise<PublishEnvelope<T>> {
  const prev = await fetchPublishEnvelope<T>(tab)
  const next: PublishEnvelope<T> = {
    ...prev,
    draft,
    draftSavedAt: new Date().toISOString(),
  }
  return upsertRemote(tab, next)
}

export async function publishSnapshot<T>(tab: AcademicsPublishTab, draft: T): Promise<PublishEnvelope<T>> {
  const now = new Date().toISOString()
  const next: PublishEnvelope<T> = {
    draft,
    published: draft,
    draftSavedAt: now,
    publishedAt: now,
  }
  return upsertRemote(tab, next)
}

export function publishStatusOf<T>(env: PublishEnvelope<T>, current: T): PublishStatus {
  const cur = JSON.stringify(current)
  const pub = env.published == null ? null : JSON.stringify(env.published)
  if (pub == null && env.draft == null && (current == null || cur === 'null' || cur === '[]' || cur === '{}')) {
    return 'empty'
  }
  if (pub == null) return 'draft'
  if (pub === cur) return 'published'
  return 'unpublished'
}

/** Prefer draft for editors; published (fallback draft) for view-only. */
export function activeSnapshot<T>(env: PublishEnvelope<T>, editable: boolean, fallback: T): T {
  if (editable) {
    if (env.draft != null) return env.draft
    if (env.published != null) return env.published
    return fallback
  }
  if (env.published != null) return env.published
  if (env.draft != null) return env.draft
  return fallback
}

export function statusLabel(s: PublishStatus): string {
  switch (s) {
    case 'empty': return 'Nothing saved'
    case 'draft': return 'Draft'
    case 'published': return 'Published'
    case 'unpublished': return 'Unpublished changes'
  }
}

export function statusTone(s: PublishStatus): 'neutral' | 'warning' | 'success' | 'info' {
  switch (s) {
    case 'empty': return 'neutral'
    case 'draft': return 'info'
    case 'published': return 'success'
    case 'unpublished': return 'warning'
  }
}

export function formatPublishTime(iso: string | null): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return null
  }
}

export function publishMetaLine(draftSavedAt: string | null, publishedAt: string | null): string | null {
  const draft = formatPublishTime(draftSavedAt)
  const pub = formatPublishTime(publishedAt)
  if (pub && draft && publishedAt !== draftSavedAt) return `Draft ${draft} · Published ${pub}`
  if (pub) return `Published ${pub}`
  if (draft) return `Draft saved ${draft}`
  return null
}

export function showPublishButton<T>(status: PublishStatus, env: PublishEnvelope<T>, current: T): boolean {
  if (status === 'published' || status === 'empty') return false
  if (env.draft == null) return false
  return JSON.stringify(env.draft) === JSON.stringify(current)
}

/** Test helper: clear in-memory publish envelopes. */
export function __resetTimetablePublishMemoryForTests(): void {
  publishMemory.clear()
}
