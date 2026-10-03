import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  startBusTrip, pingBusTrip, endBusTrip, listTransportBuses, createBus, updateBus,
  assignBusTeacher, unassignBusTeacher, deleteRoute,
  listTravelingTeachers, addTravelingTeacher, removeTravelingTeacher,
  getStudentTransport, setStudentTransport, listTransportStudents,
  getRouteGeometry,
} from './transport'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('transport buses API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs bus list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ bus_id: 'B1', bus_no: 'BUS-01', route_id: 'R1', driver_staff_id: null, stop_count: 5, students_assigned: 12 }],
    })))
    const rows = await listTransportBuses()
    expect(rows[0].busId).toBe('B1')
    expect(rows[0].routeId).toBe('R1')
  })

  it('POSTs create bus with route and driver', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B2', bus_no: 'BUS-02', route_id: 'R1', status: 'idle', stop_count: 5, students_riding: 0 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await createBus({ busNo: 'BUS-02', routeId: 'R1', driverStaffId: 'S1' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.route_id).toBe('R1')
    expect(body.driver_staff_id).toBe('S1')
  })

  it('POSTs create bus with capacity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B3', bus_no: 'BUS-03', status: 'idle', stop_count: 0, students_riding: 0, capacity: 40 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await createBus({ busNo: 'BUS-03', capacity: 40 })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.capacity).toBe(40)
    expect(row.capacity).toBe(40)
  })

  it('PUTs bus capacity clear', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', route_id: 'R2', driver_staff_id: 'S2', stop_count: 8, students_assigned: 10, capacity: null },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await updateBus('B1', { clearCapacity: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.clear_capacity).toBe(true)
  })

  it('PUTs bus update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', route_id: 'R2', driver_staff_id: 'S2', stop_count: 8, students_assigned: 10 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await updateBus('B1', { routeId: 'R2', driverStaffId: 'S2' })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1$/)
    expect(row.routeId).toBe('R2')
    expect(row.driverStaffId).toBe('S2')
  })

  it('POSTs create bus with a conductor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B3', bus_no: 'BUS-03', stop_count: 0, students_riding: 0, status: 'idle', conductor_staff_id: 'S9' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await createBus({ busNo: 'BUS-03', conductorStaffId: 'S9' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.conductor_staff_id).toBe('S9')
  })

  it('PUTs bus update with a conductor, and reports it back on the row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', stop_count: 5, students_assigned: 3, conductor_staff_id: 'S9' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await updateBus('B1', { conductorStaffId: 'S9' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.conductor_staff_id).toBe('S9')
    expect(row.conductorStaffId).toBe('S9')
  })

  it('PUTs bus update clearing the conductor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', stop_count: 5, students_assigned: 3, conductor_staff_id: null },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await updateBus('B1', { clearConductor: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.clear_conductor).toBe(true)
  })

  it('POSTs create bus with capacity', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B3', bus_no: 'BUS-03', status: 'idle', stop_count: 0, students_riding: 0, capacity: 40 },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await createBus({ busNo: 'BUS-03', capacity: 40 })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.capacity).toBe(40)
    expect(row.capacity).toBe(40)
  })

  it('PUTs bus capacity clear', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', route_id: 'R2', driver_staff_id: 'S2', stop_count: 8, students_assigned: 10, capacity: null },
    }))
    vi.stubGlobal('fetch', fetchMock)
    await updateBus('B1', { clearCapacity: true })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.clear_capacity).toBe(true)
  })

  it('PUTs bus duty teacher assignment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: { bus_id: 'B1', bus_no: 'BUS-01', teacher_user_id: 'T1', teacher_name: 'Meera Krishnan' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const row = await assignBusTeacher('B1', 'T1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/teacher$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.teacher_user_id).toBe('T1')
    expect(row.teacherUserId).toBe('T1')
    expect(row.teacherName).toBe('Meera Krishnan')
  })

  it('DELETEs bus duty teacher assignment', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await unassignBusTeacher('B1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/teacher$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('rejects assigning a teacher without an id', async () => {
    await expect(assignBusTeacher('B1', '')).rejects.toThrow()
  })

  it('GETs traveling teachers for a bus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [
        { teacher_user_id: 'T1', teacher_name: 'Asha Rao' },
        { teacher_user_id: 'T2', teacher_name: 'Bala Iyer' },
      ],
    })))
    const rows = await listTravelingTeachers('B1')
    expect(String((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/traveling-teachers$/)
    expect(rows).toEqual([
      { teacherUserId: 'T1', teacherName: 'Asha Rao' },
      { teacherUserId: 'T2', teacherName: 'Bala Iyer' },
    ])
  })

  it('PUTs to add a traveling teacher and returns the updated list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ teacher_user_id: 'T1', teacher_name: 'Asha Rao' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = await addTravelingTeacher('B1', 'T1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/traveling-teachers\/T1$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ stop_id: null })
    expect(rows).toEqual([{ teacherUserId: 'T1', teacherName: 'Asha Rao' }])
  })

  it('PUTs a traveling teacher with a chosen stop and maps stop fields back', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ teacher_user_id: 'T1', teacher_name: 'Asha Rao', stop_id: 'S9', stop_name: 'Gate A' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const rows = await addTravelingTeacher('B1', 'T1', 'S9')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('PUT')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ stop_id: 'S9' })
    expect(rows[0].stopId).toBe('S9')
    expect(rows[0].stopName).toBe('Gate A')
  })

  it('DELETEs to remove a traveling teacher', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await removeTravelingTeacher('B1', 'T1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/traveling-teachers\/T1$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('DELETEs a route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteRoute('R1')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/routes\/R1$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('surfaces the backend\'s "route in use" message when a bus is still assigned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: { code: 'route_in_use', message: '2 buses assigned to this route. Reassign them before deleting.' } },
      409,
    )))
    await expect(deleteRoute('R1')).rejects.toThrow(/2 buses assigned/)
  })
})

describe('bus trip GPS', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('POSTs trip start', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }))
    vi.stubGlobal('fetch', fetchMock)
    await startBusTrip('B1', 'pickup')
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toMatch(/\/transport\/buses\/B1\/trip\/start$/)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.direction).toBe('pickup')
  })

  it('POSTs trip pings batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: null }))
    vi.stubGlobal('fetch', fetchMock)
    await pingBusTrip('B1', [{ lat: 12.97, lng: 77.59, speedKmh: 30, at: '2026-08-01T10:00:00Z' }])
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/transport\/buses\/B1\/trip\/pings$/)
  })

  it('POSTs trip end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { trip_id: 'T1', duration_min: 10, distance_km: 5.2, stops_covered: 3, boarded_count: 12 },
    })))
    const summary = await endBusTrip('B1')
    expect(summary.tripId).toBe('T1')
    expect(summary.distanceKm).toBe(5.2)
  })
})

describe('student transport mapping API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('setStudentTransport sends snake_case body and maps a pending response', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return jsonResponse({
        data: {
          opted_in: true, assigned: false, status: 'pending', bus_id: null,
          route_id: 'r1', stop_id: 's1', fee_head_id: 'f1',
          pending_reason: { code: 'no_capacity', message: 'No bus currently has available capacity on this route.' },
        },
      })
    }))

    const result = await setStudentTransport('stu1', { optedIn: true, routeId: 'r1', stopId: 's1', feeHeadId: 'f1' })

    expect(calls[0].url).toContain('/students/stu1/transport')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ opted_in: true, route_id: 'r1', stop_id: 's1', fee_head_id: 'f1' })
    expect(result.status).toBe('pending')
    expect(result.pendingReason?.code).toBe('no_capacity')
  })

  it('getStudentTransport GETs the current status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: { opted_in: false, assigned: false, status: 'not_mapped', bus_id: null, route_id: null, stop_id: null, fee_head_id: null, pending_reason: null },
    })))
    const result = await getStudentTransport('stu2')
    expect(result.status).toBe('not_mapped')
  })

  it('listTransportStudents applies filters as query params', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return jsonResponse({ data: [], next_cursor: null })
    }))
    await listTransportStudents({ status: 'pending', routeId: 'r1' })
    expect(calls[0]).toContain('status=pending')
    expect(calls[0]).toContain('routeId=r1')
  })
})

describe('route geometry API', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GETs available geometry for a route', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        route_id: 'R1', status: 'available', format: 'google-encoded-polyline',
        geometry: 'abc123', distance_meters: 4210, duration_seconds: 780,
        stop_sequence_hash: 'sha256:abc', generated_at: '2026-09-19T10:00:00Z',
      },
    })))
    const result = await getRouteGeometry('R1')
    expect(result.status).toBe('available')
    expect(result.geometry).toBe('abc123')
    expect(result.distanceMeters).toBe(4210)
  })

  it('GETs unavailable geometry with null fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        route_id: 'R1', status: 'unavailable', format: null, geometry: null,
        distance_meters: null, duration_seconds: null, stop_sequence_hash: 'sha256:abc', generated_at: null,
      },
    })))
    const result = await getRouteGeometry('R1')
    expect(result.status).toBe('unavailable')
    expect(result.geometry).toBeNull()
  })
})
