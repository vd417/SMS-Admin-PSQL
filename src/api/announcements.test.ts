import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listAnnouncements, createAnnouncement } from './announcements'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('listAnnouncements', () => {
  it('maps API AnnouncementResponse fields into the UI shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{
        id: 'A1',
        tenant_id: 't1',
        title: 'Holiday',
        body: 'School closed',
        date: '2026-07-16T00:00:00Z',
        from: 'admin',
        role: 'admin',
        type: 'general',
        pinned: false,
        audience: 'parents',
      }],
      next_cursor: null,
    })))
    const row = (await listAnnouncements())[0]
    expect(row).toMatchObject({ id: 'A1', title: 'Holiday', audience: 'parents', ch: 'general', body: 'School closed' })
    expect(row.when).not.toBe('—')
  })
})

describe('createAnnouncement', () => {
  it('POSTs /announcements with title + body (required by CreateAnnouncementRequest)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: {
        id: 'A2',
        title: 'PTM',
        body: 'Friday 4pm',
        date: '2026-07-16T00:00:00Z',
        type: 'general',
        audience: 'parents',
        pinned: false,
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const created = await createAnnouncement({ title: 'PTM', body: 'Friday 4pm', audience: 'parents' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/announcements')
    expect((init as RequestInit).method).toBe('POST')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      title: 'PTM',
      body: 'Friday 4pm',
      type: 'general',
      user_id: null,
      audience: 'parents',
      emails: [],
      phones: [],
      channels: ['email', 'sms', 'app'],
      school_name: null,
      event_date: null,
      event_kind: null,
      attachment_base64: null,
      attachment_file_name: null,
      attachment_content_type: null,
    })
    expect(created).toMatchObject({ id: 'A2', title: 'PTM', body: 'Friday 4pm' })
  })

  it('rejects blank body before hitting the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(createAnnouncement({ title: 'PTM', body: '  ' })).rejects.toThrow(/body/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
