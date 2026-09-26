import { request } from './client'
import { snakeToCamel, camelToSnake } from './mapper'

/* ---------- KPI summaries ---------- */
export interface LibrarySummary { catalogue: number; members: number; issued: number; finesDue: number }

export interface HostelSummary { blocks: number; rooms: number; residents: number; occupancyPct: number }
export interface SportsSummary { teams: number; events: number; athletes: number; medals: number }

/* ---------- Hostel masters ---------- */
export interface HostelBlock { id: string; name: string; warden: string | null }
export interface HostelRoom { id: string; blockId: string; blockName: string | null; roomNo: string; capacity: number; residents: number }
export interface HostelResident { id: string; roomId: string; roomNo: string | null; studentName: string; studentId: string | null }

export interface CreateHostelBlockInput { name: string; warden?: string | null }
export interface CreateHostelRoomInput { blockId: string; roomNo: string; capacity: number }
export interface CreateHostelResidentInput { roomId: string; studentName: string; studentId?: string | null }

/* ---------- Sports masters ---------- */
export interface SportsTeam { id: string; name: string; sport: string; coach: string | null; athletes: number }
export interface SportsEvent { id: string; name: string; eventDate: string; venue: string | null }
export interface SportsMedal { id: string; kind: string; title: string | null; year: number }

export interface CreateSportsTeamInput { name: string; sport: string; coach?: string | null; athletes: number }
export interface CreateSportsEventInput { name: string; eventDate: string; venue?: string | null }
export interface CreateSportsMedalInput { kind: string; title?: string | null; year?: number | null }

const asObj = <T>(wire: unknown): T => snakeToCamel<T>(wire)
const asList = <T>(wire: unknown): T[] => (Array.isArray(wire) ? wire.map((w) => snakeToCamel<T>(w)) : [])

/* ---------- Library ---------- */
export async function getLibrarySummary(): Promise<LibrarySummary> {
  return asObj<LibrarySummary>(await request<Record<string, unknown>>('/library/summary'))
}

/* ---------- Transport (re-exported from transport module) ---------- */
export {
  getTransportSummary, getTransportFleet, listTransportBuses, createBus, updateBus,
  assignBusTeacher, unassignBusTeacher,
  listTravelingTeachers, addTravelingTeacher, removeTravelingTeacher,
  listTransportRoutes, createRoute, deleteRoute,
  listRouteStops, listBusStudents, assignStudentToBus, unassignStudentFromBus,
  sendBusNotification, startBusTrip, pingBusTrip, endBusTrip,
  createRouteStop, updateRouteStop, deleteRouteStop, reorderRouteStops,
  getStudentTransport, setStudentTransport, listTransportStudents,
  type TransportSummary, type FleetBus, type TransportBus, type StudentBusAssignment,
  type BusTeacherAssignment, type TravelingTeacher,
  type CreateBusInput, type UpdateBusInput, type TransportRoute, type CreateRouteInput, type RouteStop,
  type SendBusNotificationInput, type TripPingInput, type TripSummary,
  type CreateRouteStopInput,
  type StudentTransportStatus, type SetStudentTransportInput, type TransportMappedStudent, type TransportStudentsFilter,
} from './transport'

/* ---------- Hostel ---------- */
export async function getHostelSummary(): Promise<HostelSummary> {
  return asObj<HostelSummary>(await request<Record<string, unknown>>('/hostel/summary'))
}
export async function listHostelBlocks(): Promise<HostelBlock[]> {
  return asList<HostelBlock>(await request<Record<string, unknown>[]>('/hostel/blocks'))
}
export async function createHostelBlock(input: CreateHostelBlockInput): Promise<HostelBlock> {
  const name = input.name.trim()
  if (!name) throw new Error('Block name is required')
  const body = camelToSnake({ name, warden: input.warden?.trim() || null })
  return asObj<HostelBlock>(await request<Record<string, unknown>>('/hostel/blocks', { method: 'POST', body }))
}
export async function listHostelRooms(): Promise<HostelRoom[]> {
  return asList<HostelRoom>(await request<Record<string, unknown>[]>('/hostel/rooms'))
}
export async function createHostelRoom(input: CreateHostelRoomInput): Promise<HostelRoom> {
  const roomNo = input.roomNo.trim()
  if (!input.blockId) throw new Error('Pick a block')
  if (!roomNo) throw new Error('Room number is required')
  const body = camelToSnake({ blockId: input.blockId, roomNo, capacity: Math.max(1, input.capacity | 0) })
  return asObj<HostelRoom>(await request<Record<string, unknown>>('/hostel/rooms', { method: 'POST', body }))
}
export async function listHostelResidents(): Promise<HostelResident[]> {
  return asList<HostelResident>(await request<Record<string, unknown>[]>('/hostel/residents'))
}
export async function createHostelResident(input: CreateHostelResidentInput): Promise<HostelResident> {
  const studentName = input.studentName.trim()
  if (!input.roomId) throw new Error('Pick a room')
  if (!studentName) throw new Error('Resident name is required')
  const body = camelToSnake({ roomId: input.roomId, studentName, studentId: input.studentId || null })
  return asObj<HostelResident>(await request<Record<string, unknown>>('/hostel/residents', { method: 'POST', body }))
}

/* ---------- Sports ---------- */
export async function getSportsSummary(): Promise<SportsSummary> {
  return asObj<SportsSummary>(await request<Record<string, unknown>>('/sports/summary'))
}
export async function listSportsTeams(): Promise<SportsTeam[]> {
  return asList<SportsTeam>(await request<Record<string, unknown>[]>('/sports/teams'))
}
export async function createSportsTeam(input: CreateSportsTeamInput): Promise<SportsTeam> {
  const name = input.name.trim(); const sport = input.sport.trim()
  if (!name) throw new Error('Team name is required')
  if (!sport) throw new Error('Sport is required')
  const body = camelToSnake({ name, sport, coach: input.coach?.trim() || null, athletes: Math.max(0, input.athletes | 0) })
  return asObj<SportsTeam>(await request<Record<string, unknown>>('/sports/teams', { method: 'POST', body }))
}
export async function listSportsEvents(): Promise<SportsEvent[]> {
  return asList<SportsEvent>(await request<Record<string, unknown>[]>('/sports/events'))
}
export async function createSportsEvent(input: CreateSportsEventInput): Promise<SportsEvent> {
  const name = input.name.trim()
  if (!name) throw new Error('Event name is required')
  if (!input.eventDate) throw new Error('Event date is required')
  const body = camelToSnake({ name, eventDate: input.eventDate, venue: input.venue?.trim() || null })
  return asObj<SportsEvent>(await request<Record<string, unknown>>('/sports/events', { method: 'POST', body }))
}
export async function listSportsMedals(): Promise<SportsMedal[]> {
  return asList<SportsMedal>(await request<Record<string, unknown>[]>('/sports/medals'))
}
export async function createSportsMedal(input: CreateSportsMedalInput): Promise<SportsMedal> {
  const kind = (input.kind || '').trim().toLowerCase()
  if (!['gold', 'silver', 'bronze'].includes(kind)) throw new Error('Pick gold, silver or bronze')
  const body = camelToSnake({ kind, title: input.title?.trim() || null, year: input.year ?? null })
  return asObj<SportsMedal>(await request<Record<string, unknown>>('/sports/medals', { method: 'POST', body }))
}
