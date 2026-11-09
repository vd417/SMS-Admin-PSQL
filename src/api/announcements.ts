import { request, listRequest } from './client'
import { snakeToCamel, camelToSnake } from './mapper'

/** UI-facing announcement row (mapped from API AnnouncementResponse). */
export interface Announcement {
  id: string
  title: string
  body?: string
  audience: string
  when: string
  reach: number
  ch: string
  type?: string
  pinned?: boolean
  /** Who sent it — display name (or username) and role, set by the backend from the sender. */
  from?: string
  role?: string
}

export interface CreateAnnouncementInput {
  title: string
  body: string
  type?: string | null
  audience?: string | null
  emails?: string[] | null
  phones?: string[] | null
  channels?: string[] | null
  schoolName?: string | null
  eventDate?: string | null
  eventKind?: string | null
  attachmentBase64?: string | null
  attachmentFileName?: string | null
  attachmentContentType?: string | null
  /** In-app notice for this login only. Omitted user id is a school-wide push. */
  userId?: string | null
}

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

function toAnnouncement(raw: Record<string, unknown>): Announcement {
  const a = snakeToCamel<Record<string, unknown>>(raw)
  const date = a.date ?? a.when
  let when = '—'
  if (typeof date === 'string' && date) {
    const d = new Date(date)
    when = Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  }
  return {
    id: String(a.id ?? ''),
    title: String(a.title ?? ''),
    body: typeof a.body === 'string' ? a.body : undefined,
    audience: String(a.audience ?? '—'),
    when,
    reach: typeof a.reach === 'number' ? a.reach : 0,
    ch: String(a.type ?? a.ch ?? 'app'),
    type: typeof a.type === 'string' ? a.type : undefined,
    pinned: Boolean(a.pinned),
    from: typeof a.from === 'string' ? a.from : undefined,
    role: typeof a.role === 'string' ? a.role : undefined,
  }
}

export async function listAnnouncements(): Promise<Announcement[]> {
  const env = await listRequest<ListEnvelope>('/announcements')
  return env.data.map((row) => toAnnouncement(row))
}

/**
 * POST /announcements — backend CreateAnnouncementRequest:
 * { title, body, type?, audience? }
 */
export async function createAnnouncement(input: CreateAnnouncementInput): Promise<Announcement> {
  const title = input.title.trim()
  const body = input.body.trim()
  if (!title) throw new Error('Title is required')
  if (!body) throw new Error('Body is required')
  const payload = camelToSnake({
    title,
    body,
    type: input.type?.trim() || 'general',
    audience: input.audience?.trim() || null,
    emails: (input.emails ?? []).map((e) => e.trim()).filter((e) => e.includes('@')),
    phones: (input.phones ?? []).map((p) => p.replace(/\D/g, '')).filter((p) => p.length >= 10),
    channels: (input.channels ?? ['email', 'sms', 'app']).map((c) => c.trim().toLowerCase()).filter(Boolean),
    schoolName: input.schoolName?.trim() || null,
    eventDate: input.eventDate?.trim() || null,
    eventKind: input.eventKind?.trim() || null,
    attachmentBase64: input.attachmentBase64 || null,
    attachmentFileName: input.attachmentFileName?.trim() || null,
    attachmentContentType: input.attachmentContentType?.trim() || null,
    userId: input.userId?.trim() || null,
  })
  const wire = await request<Record<string, unknown>>('/announcements', { method: 'POST', body: payload })
  return toAnnouncement(wire)
}
