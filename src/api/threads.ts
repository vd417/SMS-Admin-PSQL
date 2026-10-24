import { request, listRequest } from './client'
import { snakeToCamel, camelToSnake } from './mapper'

/** UI-facing chat thread (mapped from backend ChatThreadResponse). */
export interface ChatThread {
  id: string
  name: string
  role: string
  last: string
  lastAt: string | null
  time: string
  unread: number
  group: boolean
  childId: string | null
}

/** A file/image attached to a chat message (shown inline in the app). */
export interface ChatAttachment {
  id: string
  name: string
  url: string
  type: string
  size: number
}

/** UI-facing chat message (mapped from backend ChatMessageResponse). */
export interface ChatMessage {
  id: string
  threadId: string
  text: string
  at: string
  mine: boolean
  /** Data URL or http(s) URL — same storage convention as Tenant/User/Student photos
   *  (no blob storage): the image is embedded directly, capped at ~300KB by the backend. */
  imageUrl?: string | null
  /** Delivered into the recipient's own inbox thread (see DeliverToPeerInboxAsync). */
  delivered: boolean
  /** Recipient has opened the thread since this was sent. */
  read: boolean
  attachments?: ChatAttachment[]
}

export interface CreateThreadInput {
  name: string
  role?: string | null
  group?: boolean
  childId?: string | null
  /** "teacher" | "staff" | "student" (student ⇒ that student's parent) | "user" (a CRM login
   *  account — owner/admin/principal/vice_principal — addressed directly by its own Users id)
   *  — lets the server resolve the real recipient account instead of matching free-text name. */
  contactKind?: 'teacher' | 'staff' | 'student' | 'user' | null
  /** The Teacher/Staff/Student row id matching `contactKind`. */
  contactId?: string | null
}

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

// All chat timestamps are shown in India Standard Time regardless of the viewer's device
// timezone (server sends UTC ISO with a trailing Z; this is an India-only product).
const IST = 'Asia/Kolkata'

/** Short relative label (now / 5m / 3h / 2d / 12 Jan) from an ISO datetime. */
export function relTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: IST })
}

/** In-conversation message timestamp — 12-hour clock with AM/PM (e.g. "2:35 PM"), prefixed
 *  with the date when the message isn't from today. */
export function messageTime(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST })
  // "Same day" is evaluated in IST too, so the date prefix matches the IST clock shown above.
  const istDay = (x: Date): string => x.toLocaleDateString('en-CA', { timeZone: IST })
  const sameDay = istDay(d) === istDay(new Date())
  return sameDay ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: IST })}, ${time}`
}

export function toThread(wire: Record<string, unknown>): ChatThread {
  const t = snakeToCamel<Record<string, unknown>>(wire)
  const lastAt = (typeof t.lastAt === 'string' ? t.lastAt : null)
  return {
    id: String(t.id ?? ''),
    name: String(t.name ?? '—'),
    role: typeof t.role === 'string' ? t.role : '',
    last: String(t.lastMessage ?? t.last ?? ''),
    lastAt,
    time: relTime(lastAt),
    unread: typeof t.unread === 'number' ? t.unread : 0,
    group: Boolean(t.group),
    childId: t.childId ? String(t.childId) : null,
  }
}

export function toMessage(wire: Record<string, unknown>): ChatMessage {
  const m = snakeToCamel<Record<string, unknown>>(wire)
  const imageUrl = typeof m.imageUrl === 'string' && m.imageUrl ? m.imageUrl : null
  return {
    id: String(m.id ?? ''),
    threadId: String(m.threadId ?? ''),
    text: String(m.text ?? ''),
    at: messageTime(m.sentAt),
    mine: Boolean(m.isMine),
    imageUrl,
    delivered: Boolean(m.isDelivered),
    read: Boolean(m.isRead),
    attachments: imageUrl ? [{ id: `${String(m.id ?? '')}-img`, name: 'image', url: imageUrl, type: 'image/jpeg', size: 0 }] : undefined,
  }
}

export async function listThreads(): Promise<ChatThread[]> {
  const env = await listRequest<ListEnvelope>('/threads')
  return env.data.map(toThread)
}

export async function createThread(input: CreateThreadInput): Promise<ChatThread> {
  const name = input.name.trim()
  if (!name) throw new Error('Name is required')
  const payload = camelToSnake({
    name,
    role: input.role?.trim() || null,
    group: Boolean(input.group),
    childId: input.childId ?? null,
    contactKind: input.contactKind ?? null,
    contactId: input.contactId ?? null,
  })
  const wire = await request<Record<string, unknown>>('/threads', { method: 'POST', body: payload })
  return toThread(wire)
}

export async function listThreadMessages(threadId: string): Promise<ChatMessage[]> {
  const env = await listRequest<ListEnvelope>(`/threads/${threadId}/messages`)
  return env.data.map(toMessage)
}

export async function sendMessage(threadId: string, text: string, imageUrl?: string | null): Promise<ChatMessage> {
  const t = text.trim()
  const img = imageUrl?.trim() || null
  if (!t && !img) throw new Error('Message is required')
  const body: Record<string, unknown> = { text: t }
  if (img) body.image_url = img
  const wire = await request<Record<string, unknown>>(`/threads/${threadId}/messages`, {
    method: 'POST',
    body,
  })
  return toMessage(wire)
}
