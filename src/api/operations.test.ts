import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getLibrarySummary, getTransportSummary, getHostelSummary, getSportsSummary,
  listHostelBlocks, createHostelBlock, createHostelRoom, createHostelResident,
  createSportsTeam, createSportsEvent, createSportsMedal,
  listBusStudents, assignStudentToBus, unassignStudentFromBus,
  listRouteStops,
  sendBusNotification,
} from './operations'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function noContent(): Response {
  return new Response(null, { status: 204 })
}
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('summaries map snake_case → camelCase', () => {
  it('library summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { catalogue: 120, members: 40, issued: 12, fines_due: 250 } })))
    expect(await getLibrarySummary()).toEqual({ catalogue: 120, members: 40, issued: 12, finesDue: 250 })
  })
  it('transport summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { vehicles: 6, routes: 3, students: 88, stops: 24 } })))
    expect(await getTransportSummary()).toEqual({ vehicles: 6, routes: 3, students: 88, stops: 24 })
  })
  it('hostel summary maps occupancy_pct', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { blocks: 2, rooms: 20, residents: 50, occupancy_pct: 62 } })))
    expect(await getHostelSummary()).toEqual({ blocks: 2, rooms: 20, residents: 50, occupancyPct: 62 })
  })
  it('sports summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: { teams: 5, events: 2, athletes: 60, medals: 3 } })))
    expect(await getSportsSummary()).toEqual({ teams: 5, events: 2, athletes: 60, medals: 3 })
  })
})

describe('hostel lists + creates', () => {
  it('lists blocks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'B1', name: 'A Block', warden: 'Rao' }] })))
    const rows = await listHostelBlocks()
    expect(rows[0]).toEqual({ id: 'B1', name: 'A Block', warden: 'Rao' })
  })

  it('POSTs a block with snake_case body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'B2', name: 'B Block', warden: null } }))
    vi.stubGlobal('fetch', fetchMock)
    const b = await createHostelBlock({ name: '  B Block  ' })
    expect(b).toMatchObject({ id: 'B2', name: 'B Block' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/hostel\/blocks$/)
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ name: 'B Block', warden: null })
  })

  it('rejects empty block name', async () => {
    await expect(createHostelBlock({ name: '  ' })).rejects.toThrow(/name is required/i)
  })

  it('room requires a block and sends block_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'R1', block_id: 'B1', block_name: 'A', room_no: 'A-1', capacity: 4, residents: 0 } }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await createHostelRoom({ blockId: 'B1', roomNo: 'A-1', capacity: 4 })
    expect(r).toMatchObject({ id: 'R1', blockId: 'B1', roomNo: 'A-1', capacity: 4, residents: 0 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ block_id: 'B1', room_no: 'A-1', capacity: 4 })
    await expect(createHostelRoom({ blockId: '', roomNo: 'x', capacity: 1 })).rejects.toThrow(/pick a block/i)
  })

  it('resident requires a room', async () => {
    await expect(createHostelResident({ roomId: '', studentName: 'x' })).rejects.toThrow(/pick a room/i)
  })
})

describe('student → bus roster (admin)', () => {
  it('lists riders mapping snake_case → camelCase', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ student_id: 'S1', student_name: 'Alice Smith', initials: 'AS', admission_no: 'ADM-1', bus_id: 'B1', bus_no: 'KA-01', route_name: 'R1', stop_id: null, stop_name: 'Gate' }],
    })))
    const rows = await listBusStudents('B1')
    expect(rows[0]).toMatchObject({ studentId: 'S1', studentName: 'Alice Smith', admissionNo: 'ADM-1', busNo: 'KA-01', stopName: 'Gate' })
  })

  it('requires a bus id to list', async () => {
    await expect(listBusStudents('')).rejects.toThrow(/pick a bus/i)
  })

  it('PUTs an assignment with snake_case stop_id in body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent())
    vi.stubGlobal('fetch', fetchMock)
    await assignStudentToBus('B1', 'S1', 'STOP9')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/transport\/buses\/B1\/students\/S1$/)
    expect(opts.method).toBe('PUT')
    expect(JSON.parse(opts.body as string)).toEqual({ stop_id: 'STOP9' })
  })

  it('assign sends null stop_id when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent())
    vi.stubGlobal('fetch', fetchMock)
    await assignStudentToBus('B1', 'S1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ stop_id: null })
  })

  it('validates bus and student before assigning', async () => {
    await expect(assignStudentToBus('', 'S1')).rejects.toThrow(/pick a bus/i)
    await expect(assignStudentToBus('B1', '')).rejects.toThrow(/pick a student/i)
  })

  it('DELETEs an assignment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(noContent())
    vi.stubGlobal('fetch', fetchMock)
    await unassignStudentFromBus('B1', 'S1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/transport\/buses\/B1\/students\/S1$/)
    expect(opts.method).toBe('DELETE')
  })
})

describe('sports creates', () => {
  it('POSTs a team with clamped athletes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'T1', name: 'FC', sport: 'Football', coach: null, athletes: 11 } }))
    vi.stubGlobal('fetch', fetchMock)
    await createSportsTeam({ name: 'FC', sport: 'Football', athletes: 11 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ name: 'FC', sport: 'Football', athletes: 11 })
  })

  it('event requires a date', async () => {
    await expect(createSportsEvent({ name: 'Meet', eventDate: '' })).rejects.toThrow(/date is required/i)
  })

  it('medal validates kind', async () => {
    await expect(createSportsMedal({ kind: 'platinum' })).rejects.toThrow(/gold, silver or bronze/i)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { id: 'M1', kind: 'gold', title: 'Sprint', year: 2026 } }))
    vi.stubGlobal('fetch', fetchMock)
    const m = await createSportsMedal({ kind: 'Gold', title: 'Sprint' })
    expect(m).toMatchObject({ id: 'M1', kind: 'gold', year: 2026 })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toMatchObject({ kind: 'gold', title: 'Sprint' })
  })
})

describe('route stops', () => {
  it('fetches stops and maps snake_case → camelCase', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ id: 'ST1', route_id: 'R1', name: 'Main Gate', sequence: 1, lat: 28.7041, lng: 77.1025 }],
    })))
    const stops = await listRouteStops('R1')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toEqual({ id: 'ST1', routeId: 'R1', name: 'Main Gate', sequence: 1, lat: 28.7041, lng: 77.1025 })
  })

  it('hits GET /transport/routes/:routeId/stops', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await listRouteStops('R42')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/routes\/R42\/stops$/)
  })
})

describe('bus parent notifications', () => {
  it('POSTs notify event with snake_case body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { reach: 38 } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendBusNotification('B1', { eventType: 'departed', channels: ['push', 'sms'] })
    expect(result.reach).toBe(38)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(String(url)).toMatch(/\/transport\/buses\/B1\/notify$/)
    expect(opts.method).toBe('POST')
    const body = JSON.parse(opts.body as string)
    expect(body).toMatchObject({ event_type: 'departed', channels: ['push', 'sms'] })
  })

  it('includes stop_id when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { reach: 12 } }))
    vi.stubGlobal('fetch', fetchMock)
    await sendBusNotification('B1', { eventType: 'approaching', stopId: 'ST5', channels: ['push'] })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toMatchObject({ event_type: 'approaching', stop_id: 'ST5' })
  })
})
