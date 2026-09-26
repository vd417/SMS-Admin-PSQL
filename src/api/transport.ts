import { request } from './client'
import { snakeToCamel, camelToSnake } from './mapper'
import type { BusStatus } from '@/types'

/* ---------- KPI summaries ---------- */
export interface TransportSummary { vehicles: number; routes: number; students: number; stops: number }

/* ---------- Live fleet board (GET /v1/transport/fleet) ---------- */
export interface FleetBus {
  busId: string
  routeId?: string | null
  busNo: string
  routeName?: string | null
  driver?: string | null
  driverPhone?: string | null
  stopCount: number
  studentsRiding: number
  status: BusStatus
  lat?: number | null
  lng?: number | null
  speedKmh?: number | null
  heading?: number | null
  nextStopName?: string | null
  etaMinutes?: number | null
  lastPingAt?: string | null
  conductorStaffId?: string | null
  capacity?: number | null
}

export interface StudentBusAssignment {
  studentId: string
  studentName: string
  initials: string
  admissionNo: string
  busId: string
  busNo: string
  routeName?: string | null
  stopId?: string | null
  stopName?: string | null
}

export interface CreateBusInput {
  busNo: string
  routeName?: string | null
  routeId?: string | null
  driver?: string | null
  driverPhone?: string | null
  driverStaffId?: string | null
  conductorStaffId?: string | null
  capacity?: number | null
}

export interface UpdateBusInput {
  busNo?: string | null
  routeId?: string | null
  driverStaffId?: string | null
  clearDriver?: boolean
  conductorStaffId?: string | null
  clearConductor?: boolean
  capacity?: number | null
  clearCapacity?: boolean
}

export interface TransportBus {
  busId: string
  busNo: string
  routeId?: string | null
  routeName?: string | null
  driverStaffId?: string | null
  driver?: string | null
  driverPhone?: string | null
  stopCount: number
  studentsAssigned: number
  teacherUserId?: string | null
  teacherName?: string | null
  conductorStaffId?: string | null
  capacity?: number | null
}
export interface TransportRoute { id: string; name: string; stops: number }
export interface CreateRouteInput { name: string; stops?: number }

export interface RouteStop {
  id: string
  routeId: string
  name: string
  sequence: number
  lat?: number | null
  lng?: number | null
}

export interface StudentTransportStatus {
  optedIn: boolean
  assigned: boolean
  status: 'assigned' | 'pending' | 'opted_out' | 'not_mapped'
  busId?: string | null
  routeId?: string | null
  stopId?: string | null
  feeHeadId?: string | null
  pendingReason?: { code: string; message: string } | null
}

export interface SetStudentTransportInput {
  optedIn: boolean
  routeId?: string | null
  stopId?: string | null
  feeHeadId?: string | null
}

export interface TransportMappedStudent {
  studentId: string
  studentName: string
  admissionNo: string
  grade?: string | null
  section?: string | null
  feeHeadId?: string | null
  feeHeadName?: string | null
  routeId?: string | null
  routeName?: string | null
  stopId?: string | null
  stopName?: string | null
  busId?: string | null
  busNo?: string | null
  driver?: string | null
  conductorName?: string | null
  capacity?: number | null
  busOccupied: number
  mappingStatus: 'mapped' | 'pending'
}

export interface TransportStudentsFilter {
  routeId?: string
  stopId?: string
  busId?: string
  grade?: string
  feeHeadId?: string
  status?: 'mapped' | 'pending'
}

export interface SendBusNotificationInput {
  eventType: 'departed' | 'approaching' | 'arrived'
  stopId?: string | null
  channels: ('push' | 'sms')[]
}

export interface TripPingInput {
  lat: number
  lng: number
  speedKmh?: number
  heading?: number
  at?: string
}

export interface TripSummary {
  tripId: string
  durationMin: number
  distanceKm: number
  stopsCovered: number
  boardedCount: number
}

const asObj = <T>(wire: unknown): T => snakeToCamel<T>(wire)
const asList = <T>(wire: unknown): T[] => (Array.isArray(wire) ? wire.map((w) => snakeToCamel<T>(w)) : [])

export async function getTransportSummary(): Promise<TransportSummary> {
  return asObj<TransportSummary>(await request<Record<string, unknown>>('/transport/summary'))
}

export async function getTransportFleet(): Promise<FleetBus[]> {
  return asList<FleetBus>(await request<Record<string, unknown>[]>('/transport/fleet'))
}

export async function listTransportBuses(): Promise<TransportBus[]> {
  return asList<TransportBus>(await request<Record<string, unknown>[]>('/transport/buses'))
}

export async function createBus(input: CreateBusInput): Promise<FleetBus> {
  const busNo = input.busNo.trim()
  if (!busNo) throw new Error('Bus number is required')
  const body = camelToSnake({
    busNo,
    routeName: input.routeName?.trim() || null,
    routeId: input.routeId || null,
    driver: input.driver?.trim() || null,
    driverPhone: input.driverPhone?.trim() || null,
    driverStaffId: input.driverStaffId || null,
    conductorStaffId: input.conductorStaffId || null,
    capacity: input.capacity ?? null,
  })
  return asObj<FleetBus>(await request<Record<string, unknown>>('/transport/buses', { method: 'POST', body }))
}

export async function updateBus(busId: string, input: UpdateBusInput): Promise<TransportBus> {
  if (!busId) throw new Error('Bus ID required')
  const body = camelToSnake({
    busNo: input.busNo?.trim() || null,
    routeId: input.routeId || null,
    driverStaffId: input.driverStaffId || null,
    clearDriver: input.clearDriver ?? false,
    conductorStaffId: input.conductorStaffId || null,
    clearConductor: input.clearConductor ?? false,
    capacity: input.capacity ?? null,
    clearCapacity: input.clearCapacity ?? false,
  })
  return asObj<TransportBus>(await request<Record<string, unknown>>(`/transport/buses/${busId}`, { method: 'PUT', body }))
}

export interface BusTeacherAssignment {
  busId: string
  busNo: string
  teacherUserId: string | null
  teacherName: string | null
}

/** Assigns a teacher to Bus Duty (escort/supervisor) for this bus. One teacher per bus. */
export async function assignBusTeacher(busId: string, teacherUserId: string): Promise<BusTeacherAssignment> {
  if (!busId) throw new Error('Bus ID required')
  if (!teacherUserId) throw new Error('Teacher is required')
  const body = camelToSnake({ teacherUserId })
  return asObj<BusTeacherAssignment>(
    await request<Record<string, unknown>>(`/transport/buses/${busId}/teacher`, { method: 'PUT', body }),
  )
}

/** Removes the Bus Duty teacher assignment for this bus. */
export async function unassignBusTeacher(busId: string): Promise<void> {
  if (!busId) throw new Error('Bus ID required')
  await request<void>(`/transport/buses/${busId}/teacher`, { method: 'DELETE' })
}

export interface TravelingTeacher {
  teacherUserId: string
  teacherName: string | null
}

/** Teachers granted live-tracking view access on this bus — a many-to-many list distinct
 *  from the single Bus Duty escort; a bus may have any number of traveling teachers. */
export async function listTravelingTeachers(busId: string): Promise<TravelingTeacher[]> {
  if (!busId) throw new Error('Bus ID required')
  return asList<TravelingTeacher>(await request<Record<string, unknown>[]>(`/transport/buses/${busId}/traveling-teachers`))
}

export async function addTravelingTeacher(busId: string, teacherUserId: string): Promise<TravelingTeacher[]> {
  if (!busId) throw new Error('Bus ID required')
  if (!teacherUserId) throw new Error('Teacher is required')
  return asList<TravelingTeacher>(
    await request<Record<string, unknown>[]>(`/transport/buses/${busId}/traveling-teachers/${teacherUserId}`, { method: 'PUT' }),
  )
}

export async function removeTravelingTeacher(busId: string, teacherUserId: string): Promise<void> {
  if (!busId) throw new Error('Bus ID required')
  if (!teacherUserId) throw new Error('Teacher is required')
  await request<void>(`/transport/buses/${busId}/traveling-teachers/${teacherUserId}`, { method: 'DELETE' })
}

export async function listTransportRoutes(): Promise<TransportRoute[]> {
  return asList<TransportRoute>(await request<Record<string, unknown>[]>('/transport/routes'))
}

export async function createRoute(input: CreateRouteInput): Promise<TransportRoute> {
  const name = input.name.trim()
  if (!name) throw new Error('Route name is required')
  const body = camelToSnake({ name, stops: Math.max(1, (input.stops ?? 1) | 0) })
  return asObj<TransportRoute>(await request<Record<string, unknown>>('/transport/routes', { method: 'POST', body }))
}

/** Deletes a route. The backend rejects this (409) if any bus is still assigned to it. */
export async function deleteRoute(routeId: string): Promise<void> {
  if (!routeId) throw new Error('Route ID required')
  await request<void>(`/transport/routes/${routeId}`, { method: 'DELETE' })
}

export async function listRouteStops(routeId: string): Promise<RouteStop[]> {
  if (!routeId) return []
  return asList<RouteStop>(await request<Record<string, unknown>[]>(`/transport/routes/${routeId}/stops`))
}

export async function listBusStudents(busId: string): Promise<StudentBusAssignment[]> {
  if (!busId) throw new Error('Pick a bus')
  return asList<StudentBusAssignment>(await request<Record<string, unknown>[]>(`/transport/buses/${busId}/students`))
}

export async function assignStudentToBus(busId: string, studentId: string, stopId?: string | null): Promise<void> {
  if (!busId) throw new Error('Pick a bus')
  if (!studentId) throw new Error('Pick a student')
  await request<void>(`/transport/buses/${busId}/students/${studentId}`, {
    method: 'PUT',
    body: camelToSnake({ stopId: stopId || null }),
  })
}

export async function unassignStudentFromBus(busId: string, studentId: string): Promise<void> {
  if (!busId || !studentId) throw new Error('Missing bus or student')
  await request<void>(`/transport/buses/${busId}/students/${studentId}`, { method: 'DELETE' })
}

export async function sendBusNotification(busId: string, input: SendBusNotificationInput): Promise<{ reach: number }> {
  if (!busId) throw new Error('Bus ID required')
  return request<{ reach: number }>(`/transport/buses/${busId}/notify`, {
    method: 'POST',
    body: camelToSnake(input),
  })
}

/** Start a live trip for GPS tracking (writes to TripPings). */
export async function startBusTrip(busId: string, direction = 'pickup'): Promise<void> {
  if (!busId) throw new Error('Bus ID required')
  await request<void>(`/transport/buses/${busId}/trip/start`, {
    method: 'POST',
    body: camelToSnake({ direction }),
  })
}

/** Batch GPS pings for the bus's active trip. */
export async function pingBusTrip(busId: string, pings: TripPingInput[]): Promise<void> {
  if (!busId) throw new Error('Bus ID required')
  if (pings.length === 0) return
  const body = camelToSnake({
    pings: pings.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      speedKmh: p.speedKmh ?? 0,
      heading: p.heading ?? 0,
      at: p.at ?? new Date().toISOString(),
    })),
  })
  await request<void>(`/transport/buses/${busId}/trip/pings`, { method: 'POST', body })
}

export async function endBusTrip(busId: string): Promise<TripSummary> {
  if (!busId) throw new Error('Bus ID required')
  return asObj<TripSummary>(await request<Record<string, unknown>>(`/transport/buses/${busId}/trip/end`, { method: 'POST' }))
}

export interface CreateRouteStopInput { name: string; lat: number; lng: number }

export async function createRouteStop(routeId: string, input: CreateRouteStopInput): Promise<RouteStop> {
  const name = input.name.trim()
  if (!routeId) throw new Error('Route ID required')
  if (!name) throw new Error('Stop name is required')
  return asObj<RouteStop>(await request<Record<string, unknown>>(`/transport/routes/${routeId}/stops`, {
    method: 'POST',
    body: camelToSnake({ name, lat: input.lat, lng: input.lng }),
  }))
}

export async function updateRouteStop(routeId: string, stopId: string, input: CreateRouteStopInput): Promise<RouteStop> {
  const name = input.name.trim()
  if (!routeId || !stopId) throw new Error('Route and stop ID required')
  if (!name) throw new Error('Stop name is required')
  return asObj<RouteStop>(await request<Record<string, unknown>>(`/transport/routes/${routeId}/stops/${stopId}`, {
    method: 'PUT',
    body: camelToSnake({ name, lat: input.lat, lng: input.lng }),
  }))
}

export async function deleteRouteStop(routeId: string, stopId: string): Promise<void> {
  if (!routeId || !stopId) throw new Error('Route and stop ID required')
  await request<void>(`/transport/routes/${routeId}/stops/${stopId}`, { method: 'DELETE' })
}

export async function reorderRouteStops(routeId: string, stopIds: string[]): Promise<void> {
  if (!routeId) throw new Error('Route ID required')
  await request<void>(`/transport/routes/${routeId}/stops/reorder`, {
    method: 'PUT',
    body: camelToSnake({ stopIds }),
  })
}

export async function getStudentTransport(studentId: string): Promise<StudentTransportStatus> {
  if (!studentId) throw new Error('Student ID required')
  return asObj<StudentTransportStatus>(await request<Record<string, unknown>>(`/students/${studentId}/transport`))
}

export async function setStudentTransport(studentId: string, input: SetStudentTransportInput): Promise<StudentTransportStatus> {
  if (!studentId) throw new Error('Student ID required')
  const body = camelToSnake({
    optedIn: input.optedIn,
    routeId: input.optedIn ? (input.routeId || null) : null,
    stopId: input.optedIn ? (input.stopId || null) : null,
    feeHeadId: input.optedIn ? (input.feeHeadId || null) : null,
  })
  return asObj<StudentTransportStatus>(
    await request<Record<string, unknown>>(`/students/${studentId}/transport`, { method: 'PUT', body }),
  )
}

export type RouteGeometryStatus = 'available' | 'unavailable'

export interface RouteGeometry {
  routeId: string
  status: RouteGeometryStatus
  format: string | null
  geometry: string | null
  distanceMeters: number | null
  durationSeconds: number | null
  stopSequenceHash: string
  generatedAt: string | null
}

export async function getRouteGeometry(routeId: string): Promise<RouteGeometry> {
  if (!routeId) throw new Error('Route ID required')
  return asObj<RouteGeometry>(await request<Record<string, unknown>>(`/transport/routes/${routeId}/geometry`))
}

export async function listTransportStudents(filter: TransportStudentsFilter = {}): Promise<TransportMappedStudent[]> {
  const query: Record<string, string> = {}
  if (filter.routeId) query.routeId = filter.routeId
  if (filter.stopId) query.stopId = filter.stopId
  if (filter.busId) query.busId = filter.busId
  if (filter.grade) query.grade = filter.grade
  if (filter.feeHeadId) query.feeHeadId = filter.feeHeadId
  if (filter.status) query.status = filter.status
  const qs = new URLSearchParams(query).toString()
  return asList<TransportMappedStudent>(
    await request<Record<string, unknown>[]>(`/transport/students${qs ? `?${qs}` : ''}`),
  )
}
