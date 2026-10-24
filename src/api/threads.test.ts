import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listThreads, createThread, listThreadMessages, sendMessage, messageTime } from './threads'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('messageTime', () => {
  // Chat times always render in IST (Asia/Kolkata, UTC+5:30) regardless of the test runner's
  // own timezone. "Now" is pinned so same-day detection is deterministic.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T12:00:00Z')) }) // 17:30 IST
  afterEach(() => { vi.useRealTimers() })

  it('formats a same-day timestamp as 12-hour clock IST time with AM/PM', () => {
    expect(messageTime('2026-10-24T09:05:00Z')).toMatch(/^2:35\s?PM$/i) // 09:05Z -> 14:35 IST
  })

  it('prefixes the date for a timestamp not from today', () => {
    expect(messageTime('2026-10-21T03:35:00Z')).toMatch(/^\w{3} \d{1,2}, 9:05\s?AM$/i) // -> 09:05 IST, 21 Oct
  })

  it('returns empty string for missing/invalid input', () => {
    expect(messageTime(null)).toBe('')
    expect(messageTime('not-a-date')).toBe('')
  })
})

describe('listThreads', () => {
  it('maps backend ChatThreadResponse to the UI thread shape', async () => {
    const wire = {
      data: [{
        id: 'T1', tenant_id: 'x', name: 'Mrs A', role: 'Parent · X-A',
        last_message: 'hi', last_at: null, unread: 2, group: false, child_id: null,
      }],
      next_cursor: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(wire)))
    const rows = await listThreads()
    expect(rows[0]).toMatchObject({ id: 'T1', name: 'Mrs A', role: 'Parent · X-A', last: 'hi', unread: 2, group: false })
  })
})

describe('createThread', () => {
  it('POSTs name + role and returns the mapped thread', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'T2', name: 'Mr B', role: 'Teacher', unread: 0 } }))
    vi.stubGlobal('fetch', fetchMock)
    const t = await createThread({ name: 'Mr B', role: 'Teacher' })
    expect(t).toMatchObject({ id: 'T2', name: 'Mr B', role: 'Teacher' })
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toMatchObject({ name: 'Mr B', role: 'Teacher', group: false })
  })

  it('rejects an empty name', async () => {
    await expect(createThread({ name: '  ' })).rejects.toThrow(/name is required/i)
  })
})

describe('listThreadMessages', () => {
  it('maps messages with is_mine -> mine', async () => {
    const wire = { data: [{ id: 'M1', thread_id: 'T1', text: 'hello', sent_at: null, is_mine: true }], next_cursor: null }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(wire)))
    const rows = await listThreadMessages('T1')
    expect(rows[0]).toMatchObject({ id: 'M1', threadId: 'T1', text: 'hello', mine: true })
  })

  it('maps image_url, is_delivered, and is_read, and derives an image attachment', async () => {
    const wire = {
      data: [{
        id: 'M2', thread_id: 'T1', text: '', sent_at: null, is_mine: true,
        image_url: 'data:image/jpeg;base64,abc', is_delivered: true, is_read: true,
      }],
      next_cursor: null,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(wire)))
    const rows = await listThreadMessages('T1')
    expect(rows[0]).toMatchObject({
      imageUrl: 'data:image/jpeg;base64,abc', delivered: true, read: true,
    })
    expect(rows[0].attachments?.[0]).toMatchObject({ url: 'data:image/jpeg;base64,abc' })
  })
})

describe('sendMessage', () => {
  it('POSTs the trimmed text to the thread messages endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'M2', thread_id: 'T1', text: 'hi', is_mine: true } }))
    vi.stubGlobal('fetch', fetchMock)
    const m = await sendMessage('T1', '  hi  ')
    expect(m).toMatchObject({ id: 'M2', text: 'hi', mine: true })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/threads\/T1\/messages$/)
    expect(JSON.parse(opts.body as string)).toEqual({ text: 'hi' })
  })

  it('rejects an empty message', async () => {
    await expect(sendMessage('T1', '   ')).rejects.toThrow(/message is required/i)
  })

  it('POSTs image_url when an image is attached, with or without a caption', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { id: 'M3', thread_id: 'T1', text: '', image_url: 'data:image/jpeg;base64,abc', is_mine: true },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const m = await sendMessage('T1', '', 'data:image/jpeg;base64,abc')
    expect(m).toMatchObject({ id: 'M3', imageUrl: 'data:image/jpeg;base64,abc', mine: true })
    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body as string)).toEqual({ text: '', image_url: 'data:image/jpeg;base64,abc' })
  })

  it('accepts an image-only message with no text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'M4', thread_id: 'T1', text: '', is_mine: true } })))
    await expect(sendMessage('T1', '   ', 'data:image/jpeg;base64,abc')).resolves.toMatchObject({ id: 'M4' })
  })
})
