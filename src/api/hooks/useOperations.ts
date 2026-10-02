import { useState, useEffect, useRef, useMemo } from 'react'
import {
  useQuery, useMutation, useQueryClient, useQueries,
  type UseQueryResult, type UseMutationResult,
} from '@tanstack/react-query'
import * as signalR from '@microsoft/signalr'
import { snakeToCamel } from '../mapper'
import { useApp } from '@/lib/hooks'
import { tierIncludes } from '@/lib/gating'
import { queryKeys } from '../queryKeys'
import { config } from '../config'
import { tokenStore } from '../auth/tokenStore'
import {
  getLibrarySummary, getTransportSummary, getTransportFleet, listTransportBuses,
  listBusStudents, assignStudentToBus, unassignStudentFromBus,
  sendBusNotification, startBusTrip, pingBusTrip, endBusTrip,
  createRouteStop, updateRouteStop, deleteRouteStop, reorderRouteStops,
  createBus, updateBus, assignBusTeacher, unassignBusTeacher,
  listTravelingTeachers, addTravelingTeacher, removeTravelingTeacher,
  listTransportRoutes, createRoute, deleteRoute, listRouteStops,
  getStudentTransport, setStudentTransport, listTransportStudents,
  getHostelSummary, listHostelBlocks, createHostelBlock, listHostelRooms, createHostelRoom,
  listHostelResidents, createHostelResident,
  getSportsSummary, listSportsTeams, createSportsTeam, listSportsEvents, createSportsEvent,
  listSportsMedals, createSportsMedal,
  type LibrarySummary, type TransportSummary, type FleetBus, type TransportBus, type StudentBusAssignment,
  type BusTeacherAssignment, type TravelingTeacher,
  type TransportRoute, type CreateBusInput, type UpdateBusInput, type CreateRouteInput, type RouteStop,
  type SendBusNotificationInput, type TripPingInput, type TripSummary,
  type CreateRouteStopInput,
  type StudentTransportStatus, type SetStudentTransportInput, type TransportMappedStudent, type TransportStudentsFilter,
  type HostelSummary, type SportsSummary,
  type HostelBlock, type HostelRoom, type HostelResident,
  type SportsTeam, type SportsEvent, type SportsMedal,
  type CreateHostelBlockInput, type CreateHostelRoomInput, type CreateHostelResidentInput,
  type CreateSportsTeamInput, type CreateSportsEventInput, type CreateSportsMedalInput,
} from '../operations'
import { getRouteGeometry, type RouteGeometry } from '../transport'

function useOperationsTier(): boolean {
  const app = useApp()
  return tierIncludes(app.plan, 'operations')
}

/* ---------- Library ---------- */
export function useLibrarySummary(): UseQueryResult<LibrarySummary> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.librarySummary, queryFn: getLibrarySummary, enabled: ops })
}

/* ---------- Transport ---------- */
export function useTransportSummary(): UseQueryResult<TransportSummary> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.transportSummary, queryFn: getTransportSummary, enabled: ops })
}
/**
 * Live fleet board. Polls every `refetchMs` (default 5s) while mounted so
 * positions / speed / status stay current without a manual refresh.
 */
export function useTransportFleet(poll = true, refetchMs = 5000): UseQueryResult<FleetBus[]> {
  const ops = useOperationsTier()
  const enabled = poll && ops
  return useQuery({
    queryKey: queryKeys.operations.transportFleet,
    queryFn: getTransportFleet,
    enabled,
    refetchInterval: enabled ? refetchMs : false,
    refetchIntervalInBackground: false,
  })
}

/** Students assigned to a bus (admin roster). Disabled until a bus is selected. */
export function useBusStudents(busId: string | null): UseQueryResult<StudentBusAssignment[]> {
  const ops = useOperationsTier()
  return useQuery({
    queryKey: queryKeys.operations.busStudents(busId ?? ''),
    queryFn: () => listBusStudents(busId as string),
    enabled: ops && !!busId,
  })
}

export function useAssignStudentToBus(): UseMutationResult<void, Error, { busId: string; studentId: string; stopId?: string | null }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, studentId, stopId }) => assignStudentToBus(busId, studentId, stopId),
    onSuccess: (_r, { busId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.busStudents(busId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useUnassignStudentFromBus(): UseMutationResult<void, Error, { busId: string; studentId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, studentId }) => unassignStudentFromBus(busId, studentId),
    onSuccess: (_r, { busId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.busStudents(busId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useSendBusNotification(): UseMutationResult<{ reach: number }, Error, { busId: string } & SendBusNotificationInput> {
  return useMutation({
    mutationFn: ({ busId, ...input }) => sendBusNotification(busId, input),
  })
}

export function useStartBusTrip(): UseMutationResult<void, Error, { busId: string; direction?: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, direction }) => startBusTrip(busId, direction),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
    },
  })
}

export function usePingBusTrip(): UseMutationResult<void, Error, { busId: string; pings: TripPingInput[] }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, pings }) => pingBusTrip(busId, pings),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
    },
  })
}

export function useEndBusTrip(): UseMutationResult<TripSummary, Error, { busId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId }) => endBusTrip(busId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
    },
  })
}

/** Merges a live-telemetry push into the cached fleet rows: only position/speed/status/next-stop
 *  fields come from the push — route/driver/etc. assignment fields are left as cached, since the
 *  socket only ever carries live GPS data and a stale push must never regress a freshly-saved edit. */
export function mergeFleetTelemetry(old: FleetBus[] | undefined, incoming: FleetBus[]): FleetBus[] {
  if (!old) return incoming
  const prevById = new Map(old.map((b) => [b.busId, b]))
  return incoming.map((r) => {
    const prev = prevById.get(r.busId)
    if (!prev) return r
    return {
      ...prev,
      lat: r.lat, lng: r.lng, speedKmh: r.speedKmh, status: r.status,
      nextStopName: r.nextStopName, lastPingAt: r.lastPingAt,
    }
  })
}

/**
 * SignalR subscription for live fleet updates (TransportFleetHub).
 * Writes incoming snapshots into the transportFleet query cache.
 * Falls back to HTTP polling when disconnected.
 */
export function useFleetWebSocket(enabled = true): { connected: boolean } {
  const ops = useOperationsTier()
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const connRef = useRef<signalR.HubConnection | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)
  const activeRef = useRef(true)

  useEffect(() => {
    if (!enabled || !ops) return
    activeRef.current = true
    backoffRef.current = 1000

    const hubBase = config.apiBaseUrl.replace(/\/v1\/?$/, '')
    const hubUrl = `${hubBase}/hubs/transport-fleet`

    function scheduleReconnect() {
      if (!activeRef.current) return
      retryRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
        connect()
      }, backoffRef.current)
    }

    function connect() {
      if (!activeRef.current) return
      const token = tokenStore.getAccess()
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory: () => token ?? '',
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect([0, 2000, 5000, 10_000, 30_000])
        .configureLogging(signalR.LogLevel.Warning)
        .build()

      connection.on('fleet_update', (wire: unknown) => {
        const rows = Array.isArray(wire)
          ? wire.map((w) => snakeToCamel<FleetBus>(w as Record<string, unknown>))
          : []
        qc.setQueryData<FleetBus[]>(queryKeys.operations.transportFleet, (old) => mergeFleetTelemetry(old, rows))
      })

      connection.onreconnected(() => setConnected(true))
      connection.onclose(() => {
        setConnected(false)
        connRef.current = null
        scheduleReconnect()
      })

      connRef.current = connection
      connection.start()
        .then(() => {
          setConnected(true)
          backoffRef.current = 1000
        })
        .catch(() => {
          setConnected(false)
          scheduleReconnect()
        })
    }

    connect()

    return () => {
      activeRef.current = false
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null }
      const c = connRef.current
      connRef.current = null
      if (c) c.stop().catch(() => {})
      setConnected(false)
    }
  }, [enabled, ops, qc])

  return { connected }
}

export function useTransportBuses(): UseQueryResult<TransportBus[]> {
  const ops = useOperationsTier()
  return useQuery({
    queryKey: queryKeys.operations.transportBuses,
    queryFn: listTransportBuses,
    enabled: ops,
  })
}

export function useUpdateBus(): UseMutationResult<TransportBus, Error, { busId: string } & UpdateBusInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, ...input }) => updateBus(busId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportBuses })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useAssignBusTeacher(): UseMutationResult<BusTeacherAssignment, Error, { busId: string; teacherUserId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, teacherUserId }) => assignBusTeacher(busId, teacherUserId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportBuses })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
    },
  })
}

export function useUnassignBusTeacher(): UseMutationResult<void, Error, { busId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId }) => unassignBusTeacher(busId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportBuses })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
    },
  })
}

export function useTravelingTeachers(busId: string): UseQueryResult<TravelingTeacher[], Error> {
  return useQuery({
    queryKey: queryKeys.operations.travelingTeachers(busId),
    queryFn: () => listTravelingTeachers(busId),
    enabled: !!busId,
  })
}

export function useAddTravelingTeacher(): UseMutationResult<TravelingTeacher[], Error, { busId: string; teacherUserId: string; stopId?: string | null }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, teacherUserId, stopId }) => addTravelingTeacher(busId, teacherUserId, stopId),
    onSuccess: (_data, { busId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.travelingTeachers(busId) })
    },
  })
}

export function useRemoveTravelingTeacher(): UseMutationResult<void, Error, { busId: string; teacherUserId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ busId, teacherUserId }) => removeTravelingTeacher(busId, teacherUserId),
    onSuccess: (_data, { busId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.travelingTeachers(busId) })
    },
  })
}

/** Route stops for an arbitrary set of routeIds, keyed by routeId.
 *  `isReady` is true only once every one of those per-route queries has actually resolved
 *  (trivially true for an empty/ops-disabled route list) — callers that VALIDATE against
 *  these stops (bulk import's Preview) must not treat a still-loading map as "no stops
 *  match", which would falsely flag every real stop as invalid. */
export function useRouteStopsByRoute(routeIds: string[]): { stopsByRoute: Record<string, RouteStop[]>; isReady: boolean } {
  const ops = useOperationsTier()
  const queries = useQueries({
    queries: routeIds.map((id) => ({
      queryKey: queryKeys.operations.transportRouteStops(id),
      queryFn: () => listRouteStops(id),
      enabled: ops && !!id,
      staleTime: 60_000,
    })),
  })
  const stopsSnapshots = queries.map((q) => q.data)
  const isReady = queries.every((q) => q.isSuccess)
  const stopsByRoute = useMemo(() => {
    const out: Record<string, RouteStop[]> = {}
    routeIds.forEach((id, i) => {
      const data = stopsSnapshots[i]
      if (data) out[id] = data
    })
    return out
    // NOTE: `stopsSnapshots` is a fresh array each render, so this memo recomputes every
    // render — same as before this hook was extracted. Building a small Record is cheap;
    // a variable-length dep list would be a far worse (illegal) trade.
  }, [routeIds, stopsSnapshots])
  return { stopsByRoute, isReady }
}

/** Route stops for every distinct routeId present in the live fleet board. */
export function useFleetRouteStops(fleet: FleetBus[]): Record<string, RouteStop[]> {
  const routeIds = useMemo(
    () => [...new Set(fleet.map((b) => b.routeId).filter(Boolean))] as string[],
    [fleet],
  )
  return useRouteStopsByRoute(routeIds).stopsByRoute
}

/** A failed/errored geometry lookup is surfaced as an explicit "unavailable" shaped object
 *  (never left as `undefined`) so callers can't confuse "query failed" with "still loading" —
 *  see spec §7: network failure must render the same "Route unavailable" state as an
 *  explicit `status: 'unavailable'` response. */
function unavailableGeometry(routeId: string): RouteGeometry {
  return {
    routeId, status: 'unavailable', format: null, geometry: null,
    distanceMeters: null, durationSeconds: null, stopSequenceHash: '', generatedAt: null,
  }
}

export function useRouteGeometry(routeId: string | null | undefined) {
  const ops = useOperationsTier()
  const query = useQuery({
    queryKey: queryKeys.operations.transportRouteGeometry(routeId ?? ''),
    queryFn: () => getRouteGeometry(routeId as string),
    enabled: ops && !!routeId,
    staleTime: 60_000,
  })
  // Pending (not yet resolved) stays `undefined` — no badge, no line, matches loading behavior.
  // A resolved error is mapped to an explicit unavailable object so it can never be mistaken
  // for "still loading" at the render layer.
  const data = query.data ?? (query.isError && routeId ? unavailableGeometry(routeId) : undefined)
  return { ...query, data }
}

/** Route geometry for every distinct routeId present in the live fleet board. */
export function useFleetRouteGeometries(fleet: FleetBus[]): Record<string, RouteGeometry> {
  const ops = useOperationsTier()
  const routeIds = useMemo(
    () => [...new Set(fleet.map((b) => b.routeId).filter(Boolean))] as string[],
    [fleet],
  )
  const queries = useQueries({
    queries: routeIds.map((id) => ({
      queryKey: queryKeys.operations.transportRouteGeometry(id),
      queryFn: () => getRouteGeometry(id),
      enabled: ops && !!id,
      staleTime: 60_000,
    })),
  })
  const snapshots = queries.map((q) => ({ data: q.data, isError: q.isError }))
  return useMemo(() => {
    const out: Record<string, RouteGeometry> = {}
    routeIds.forEach((id, i) => {
      const snap = snapshots[i]
      if (snap.data) out[id] = snap.data
      else if (snap.isError) out[id] = unavailableGeometry(id)
      // else: still pending — leave absent, matching existing "loading = no line, no badge" behavior.
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIds, snapshots])
}

export function useCreateBus(): UseMutationResult<FleetBus, Error, CreateBusInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createBus,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportBuses })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}
export function useTransportRoutes(): UseQueryResult<TransportRoute[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.transportRoutes, queryFn: listTransportRoutes, enabled: ops })
}
export function useRouteStops(routeId: string | null): UseQueryResult<RouteStop[]> {
  const ops = useOperationsTier()
  return useQuery({
    queryKey: queryKeys.operations.transportRouteStops(routeId ?? ''),
    queryFn: () => listRouteStops(routeId as string),
    enabled: ops && !!routeId,
  })
}
export function useStudentTransport(studentId: string | null): UseQueryResult<StudentTransportStatus> {
  const ops = useOperationsTier()
  return useQuery({
    queryKey: queryKeys.operations.studentTransport(studentId ?? ''),
    queryFn: () => getStudentTransport(studentId as string),
    enabled: ops && !!studentId,
  })
}

export function useSetStudentTransport(): UseMutationResult<StudentTransportStatus, Error, { studentId: string; input: SetStudentTransportInput }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ studentId, input }) => setStudentTransport(studentId, input),
    onSuccess: (_data, { studentId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.studentTransport(studentId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportStudentsList() })
    },
  })
}

export function useTransportStudentsList(filter: TransportStudentsFilter = {}): UseQueryResult<TransportMappedStudent[]> {
  const ops = useOperationsTier()
  return useQuery({
    queryKey: queryKeys.operations.transportStudentsList(filter),
    queryFn: () => listTransportStudents(filter),
    enabled: ops,
  })
}

export function useCreateRoute(): UseMutationResult<TransportRoute, Error, CreateRouteInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createRoute,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRoutes })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useDeleteRoute(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteRoute,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRoutes })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportBuses })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportFleet })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useCreateRouteStop(): UseMutationResult<RouteStop, Error, { routeId: string; input: CreateRouteStopInput }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routeId, input }) => createRouteStop(routeId, input),
    onSuccess: (_r, { routeId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteStops(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteGeometry(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRoutes })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useUpdateRouteStop(): UseMutationResult<RouteStop, Error, { routeId: string; stopId: string; input: CreateRouteStopInput }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routeId, stopId, input }) => updateRouteStop(routeId, stopId, input),
    onSuccess: (_r, { routeId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteStops(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteGeometry(routeId) })
    },
  })
}

export function useDeleteRouteStop(): UseMutationResult<void, Error, { routeId: string; stopId: string }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routeId, stopId }) => deleteRouteStop(routeId, stopId),
    onSuccess: (_r, { routeId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteStops(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteGeometry(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRoutes })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportSummary })
    },
  })
}

export function useReorderRouteStops(): UseMutationResult<void, Error, { routeId: string; stopIds: string[] }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ routeId, stopIds }) => reorderRouteStops(routeId, stopIds),
    onSuccess: (_r, { routeId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteStops(routeId) })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.transportRouteGeometry(routeId) })
    },
  })
}

/* ---------- Hostel ---------- */
export function useHostelSummary(): UseQueryResult<HostelSummary> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.hostelSummary, queryFn: getHostelSummary, enabled: ops })
}
export function useHostelBlocks(): UseQueryResult<HostelBlock[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.hostelBlocks, queryFn: listHostelBlocks, enabled: ops })
}
export function useHostelRooms(): UseQueryResult<HostelRoom[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.hostelRooms, queryFn: listHostelRooms, enabled: ops })
}
export function useHostelResidents(): UseQueryResult<HostelResident[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.hostelResidents, queryFn: listHostelResidents, enabled: ops })
}

export function useCreateHostelBlock(): UseMutationResult<HostelBlock, Error, CreateHostelBlockInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createHostelBlock,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelBlocks })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelSummary })
    },
  })
}
export function useCreateHostelRoom(): UseMutationResult<HostelRoom, Error, CreateHostelRoomInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createHostelRoom,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelRooms })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelSummary })
    },
  })
}
export function useCreateHostelResident(): UseMutationResult<HostelResident, Error, CreateHostelResidentInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createHostelResident,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelResidents })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelRooms })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.hostelSummary })
    },
  })
}

/* ---------- Sports ---------- */
export function useSportsSummary(): UseQueryResult<SportsSummary> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.sportsSummary, queryFn: getSportsSummary, enabled: ops })
}
export function useSportsTeams(): UseQueryResult<SportsTeam[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.sportsTeams, queryFn: listSportsTeams, enabled: ops })
}
export function useSportsEvents(): UseQueryResult<SportsEvent[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.sportsEvents, queryFn: listSportsEvents, enabled: ops })
}
export function useSportsMedals(): UseQueryResult<SportsMedal[]> {
  const ops = useOperationsTier()
  return useQuery({ queryKey: queryKeys.operations.sportsMedals, queryFn: listSportsMedals, enabled: ops })
}

export function useCreateSportsTeam(): UseMutationResult<SportsTeam, Error, CreateSportsTeamInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSportsTeam,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsTeams })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsSummary })
    },
  })
}
export function useCreateSportsEvent(): UseMutationResult<SportsEvent, Error, CreateSportsEventInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSportsEvent,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsEvents })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsSummary })
    },
  })
}
export function useCreateSportsMedal(): UseMutationResult<SportsMedal, Error, CreateSportsMedalInput> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createSportsMedal,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsMedals })
      void qc.invalidateQueries({ queryKey: queryKeys.operations.sportsSummary })
    },
  })
}
