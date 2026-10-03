/* ============================================================
   Transport module — dashboard, routes & route builder
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can, tierIncludes } from '@/lib/gating'
import {
  PageHead, Card, CardHead, Kpi, Btn, Badge, Field, Input, Modal, Empty, IconBtn, Icon, Select,
} from '@/components/ui'
import { TierGate } from '@/components/shell/gates'
import {
  useTransportSummary, useTransportFleet, useTransportRoutes, useCreateRoute,
  useRouteStops, useCreateRouteStop, useUpdateRouteStop, useDeleteRouteStop, useReorderRouteStops,
  useTransportBuses, useCreateBus, useUpdateBus, useAssignBusTeacher, useUnassignBusTeacher,
  useDeleteRoute, useTravelingTeachers, useAddTravelingTeacher, useRemoveTravelingTeacher,
  useRouteGeometry,
} from '@/api/hooks/useOperations'
import { useStaff } from '@/api/hooks/useStaff'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useLeadershipRoleByEmail } from '@/api/hooks/useUsers'
import type { TransportRoute, RouteStop, TransportBus, TravelingTeacher } from '@/api/operations'
import type { Teacher } from '@/types'
import { RouteBuilderMap } from '@/components/maps/RouteBuilderMap'
import { staffCategoryLabel } from '@/lib/staffCategory'
import { routeMetrics } from '@/lib/routeMetrics'
import { TransportStudentsScreen } from './transportStudents'

const OPEN_ROUTE_KEY = 'sm.transport.openRouteId'
const OPEN_BUS_KEY = 'sm.transport.openBusId'

function openRouteBuilder(app: ReturnType<typeof useApp>, routeId: string) {
  try { sessionStorage.setItem(OPEN_ROUTE_KEY, routeId) } catch { /* ignore */ }
  app.go('school.transport.routes')
}

function openBusEditor(app: ReturnType<typeof useApp>, busId: string) {
  try { sessionStorage.setItem(OPEN_BUS_KEY, busId) } catch { /* ignore */ }
  app.go('school.transport.buses')
}

function TransportApiError({ message }: { message: string }) {
  return (
    <div className="t-sm" style={{ padding: 12, marginBottom: 12, borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)' }}>
      {message}
    </div>
  )
}

function kpiVal(loading: boolean, err: boolean, val: number | undefined, fmt: (n: number) => string): string {
  if (loading) return '…'
  if (err || val == null) return '—'
  return fmt(val)
}

function TransportDashboardBody() {
  const app = useApp()
  const canEdit = can(app.role, 'operations', 'E')
  const summary = useTransportSummary()
  const routesQ = useTransportRoutes()
  const busesQ = useTransportBuses()
  const fleetQ = useTransportFleet(true, 15_000)
  const fleet = fleetQ.data ?? []
  const routes = routesQ.data ?? []
  const buses = busesQ.data ?? []
  const active = fleet.filter((b) => b.status === 'on_route' || b.status === 'delayed' || b.status === 'at_stop').length
  const gpsLive = fleet.filter((b) => b.lat != null && b.lng != null).length
  const [routeModalOpen, setRouteModalOpen] = useState(false)
  const [busModalOpen, setBusModalOpen] = useState(false)

  return (
    <div>
      <PageHead title="Transport" sub="Routes, buses, live GPS & student assignments"
        actions={
          <div className="row gap8 wrap">
            {canEdit && <Btn variant="secondary" icon="plus" onClick={() => setRouteModalOpen(true)}>Add route</Btn>}
            {canEdit && <Btn variant="primary" icon="plus" onClick={() => setBusModalOpen(true)}>Add bus</Btn>}
          </div>
        } />
      <div className="col gap16">
        <div className="sm-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <Kpi icon="bus" label="Vehicles" value={kpiVal(summary.isLoading, summary.isError, summary.data?.vehicles, (n) => String(n))} />
          <Kpi icon="pin" iconBg="var(--info-bg)" iconColor="var(--info)" label="Routes" value={kpiVal(summary.isLoading, summary.isError, summary.data?.routes, (n) => String(n))} />
          <Kpi icon="users" iconBg="var(--success-bg)" iconColor="var(--success)" label="Students" value={kpiVal(summary.isLoading, summary.isError, summary.data?.students, (n) => String(n))} />
          <Kpi icon="zap" iconBg="var(--warning-bg)" iconColor="var(--warning)" label="Active now" value={String(active)} />
        </div>

        <div className="sm-grid-2 gap16">
          <Card pad={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <CardHead title="Routes" icon="pin"
                action={
                  <div className="row gap6">
                    {canEdit && <Btn variant="ghost" size="sm" icon="plus" onClick={() => setRouteModalOpen(true)}>Add</Btn>}
                    <Btn variant="ghost" size="sm" onClick={() => app.go('school.transport.routes')}>All</Btn>
                  </div>
                } />
            </div>
            {routesQ.isError ? (
              <div style={{ padding: 16 }}>
                <TransportApiError message="Could not load routes. Check your connection and that Operations is enabled on your plan." />
                <Btn variant="secondary" size="sm" onClick={() => routesQ.refetch()}>Retry</Btn>
              </div>
            ) : routesQ.isLoading ? (
              <div className="t-sm muted" style={{ padding: 16 }}>Loading…</div>
            ) : routes.length === 0 ? (
              <Empty icon="pin" title="No routes" body="Create a route, then place stops on the map."
                action={canEdit ? <Btn variant="primary" size="sm" onClick={() => setRouteModalOpen(true)}>Add route</Btn> : undefined} />
            ) : (
              <div>
                {routes.slice(0, 6).map((r) => (
                  <div key={r.id} className="row ai-center jc-between gap10" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="fw6">{r.name}</div>
                      <div className="t-xs muted3">{r.stops} stop{r.stops === 1 ? '' : 's'}</div>
                    </div>
                    <Btn variant="ghost" size="sm" onClick={() => openRouteBuilder(app, r.id)}>Open builder</Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card pad={false}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <CardHead title="Buses" icon="bus"
                action={
                  <div className="row gap6">
                    {canEdit && <Btn variant="ghost" size="sm" icon="plus" onClick={() => setBusModalOpen(true)}>Add</Btn>}
                    <Btn variant="ghost" size="sm" onClick={() => app.go('school.transport.buses')}>All</Btn>
                  </div>
                } />
            </div>
            {busesQ.isError ? (
              <div style={{ padding: 16 }}>
                <TransportApiError message="Could not load buses. Restart the API if you recently updated transport." />
                <Btn variant="secondary" size="sm" onClick={() => busesQ.refetch()}>Retry</Btn>
              </div>
            ) : busesQ.isLoading ? (
              <div className="t-sm muted" style={{ padding: 16 }}>Loading…</div>
            ) : buses.length === 0 ? (
              <Empty icon="bus" title="No buses" body="Add a vehicle and assign a route and driver."
                action={canEdit ? <Btn variant="primary" size="sm" onClick={() => setBusModalOpen(true)}>Add bus</Btn> : undefined} />
            ) : (
              <div>
                {buses.slice(0, 6).map((b) => (
                  <div key={b.busId} className="row ai-center jc-between gap10" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="fw6">{b.busNo}</div>
                      <div className="t-xs muted3 truncate">{b.routeName ?? 'No route'}{b.driver ? ` · ${b.driver}` : ''}</div>
                    </div>
                    {canEdit && <Btn variant="ghost" size="sm" onClick={() => openBusEditor(app, b.busId)}>Edit</Btn>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="sm-grid-2 gap16">
          <Card>
            <CardHead title="Quick actions" icon="zap" />
            <div className="row gap10 wrap" style={{ marginTop: 12 }}>
              <Btn variant="secondary" icon="pin" onClick={() => app.go('school.transport.routes')}>Route builder</Btn>
              <Btn variant="secondary" icon="bus" onClick={() => app.go('school.transport.buses')}>Fleet list</Btn>
              <Btn variant="secondary" icon="users" onClick={() => app.go('school.transport.students')}>Students</Btn>
              {tierIncludes(app.plan, 'transport.gps') && (
                <Btn variant="secondary" icon="zap" onClick={() => app.go('school.gps')}>Live tracking</Btn>
              )}
            </div>
          </Card>
          <Card>
            <CardHead title="Live GPS" icon="zap" action={gpsLive > 0 ? <Badge tone="success" soft dot>{gpsLive} on map</Badge> : null} />
            <div className="t-sm muted" style={{ marginTop: 8 }}>
              {tierIncludes(app.plan, 'transport.gps')
                ? `${gpsLive} bus${gpsLive === 1 ? '' : 'es'} reporting position. Open live tracking for the full map.`
                : 'Upgrade to Platinum for live GPS bus tracking.'}
            </div>
          </Card>
        </div>
      </div>

      <CreateRouteModal open={routeModalOpen} onClose={() => setRouteModalOpen(false)}
        onCreated={(r) => openRouteBuilder(app, r.id)} />
      <BusEditModal open={busModalOpen} bus={null} onClose={() => setBusModalOpen(false)} />
    </div>
  )
}

function TransportDashboard() {
  return (
    <TierGate feature="operations" title="Transport" blurb="School bus transport management is available on the Platinum plan.">
      <TransportDashboardBody />
    </TierGate>
  )
}

function CreateRouteModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated?: (route: TransportRoute) => void }) {
  const toast = useToast()
  const create = useCreateRoute()
  const [name, setName] = useState('')
  const [stops, setStops] = useState('5')

  useEffect(() => { if (open) { setName(''); setStops('5') } }, [open])

  const submit = () => {
    create.mutate({ name, stops: Number(stops) || 5 }, {
      onSuccess: (r) => {
        toast.success('Route created', `${r.name} — open the route builder to place stops on the map.`)
        onCreated?.(r)
        onClose()
      },
      onError: (e) => toast.danger('Could not create route', e.message),
    })
  }

  return (
    <Modal open={open} onClose={onClose} size="sm" icon="pin" title="New route"
      sub="Stops are created as placeholders — place them on the map in the route builder."
      footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Create'}</Btn></div>}>
      <div className="col gap14">
        <Field label="Route name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. North Campus Loop" /></Field>
        <Field label="Initial stops" hint="Placeholder count (max 50)"><Input type="number" min={1} max={50} value={stops} onChange={(e) => setStops(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function RouteBuilder({ route, onBack }: { route: TransportRoute; onBack: () => void }) {
  const app = useApp()
  const canEdit = can(app.role, 'operations', 'E')
  const toast = useToast()
  const stopsQ = useRouteStops(route.id)
  const stops = stopsQ.data ?? []
  const createStop = useCreateRouteStop()
  const updateStop = useUpdateRouteStop()
  const deleteStop = useDeleteRouteStop()
  const reorder = useReorderRouteStops()
  const geometryQ = useRouteGeometry(route.id)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const sorted = useMemo(() => [...stops].sort((a, b) => a.sequence - b.sequence), [stops])
  const placed = sorted.filter((s) => (s.lat ?? 0) !== 0 || (s.lng ?? 0) !== 0)
  const metrics = routeMetrics(placed.map((s) => ({ lat: s.lat as number, lng: s.lng as number })))

  const selectStop = (stop: RouteStop) => {
    setSelectedId(stop.id)
    setEditName(stop.name)
  }

  const moveStop = (index: number, dir: -1 | 1) => {
    const j = index + dir
    if (j < 0 || j >= sorted.length) return
    const ids = sorted.map((s) => s.id)
    const [item] = ids.splice(index, 1)
    ids.splice(j, 0, item)
    reorder.mutate({ routeId: route.id, stopIds: ids }, {
      onError: (e) => toast.danger('Reorder failed', e.message),
    })
  }

  const handleMapClick = (lat: number, lng: number) => {
    if (selectedId) {
      const stop = stops.find((s) => s.id === selectedId)
      if (!stop) return
      updateStop.mutate({
        routeId: route.id,
        stopId: selectedId,
        input: { name: editName.trim() || stop.name, lat, lng },
      }, {
        onSuccess: () => toast.success('Stop updated', 'Position saved on the route.'),
        onError: (e) => toast.danger('Could not update stop', e.message),
      })
      return
    }
    const n = stops.length + 1
    createStop.mutate({
      routeId: route.id,
      input: { name: `Stop ${n}`, lat, lng },
    }, {
      onSuccess: (s) => { selectStop(s); toast.success('Stop added', s.name) },
      onError: (e) => toast.danger('Could not add stop', e.message),
    })
  }

  const saveName = () => {
    if (!selectedId) return
    const stop = stops.find((s) => s.id === selectedId)
    if (!stop) return
    updateStop.mutate({
      routeId: route.id,
      stopId: selectedId,
      input: { name: editName.trim() || stop.name, lat: stop.lat ?? 0, lng: stop.lng ?? 0 },
    }, {
      onSuccess: () => toast.success('Saved', 'Stop name updated.'),
      onError: (e) => toast.danger('Could not save', e.message),
    })
  }

  const removeStop = (stopId: string) => {
    deleteStop.mutate({ routeId: route.id, stopId }, {
      onSuccess: () => { if (selectedId === stopId) setSelectedId(null) },
      onError: (e) => toast.danger('Could not delete', e.message),
    })
  }

  return (
    <div className="col gap16">
      <PageHead
        title={route.name}
        sub="Route builder · click map to add or move stops"
        actions={<Btn variant="ghost" icon="arrowLeft" onClick={onBack}>Back to routes</Btn>}
      />
      <div className="row gap8 wrap">
        <Badge tone="info" soft>{placed.length} placed</Badge>
        <Badge tone="neutral" soft>{metrics.distanceKm} km</Badge>
        <Badge tone="neutral" soft>~{metrics.durationMin} min</Badge>
      </div>
      <div className="sm-grid-2 gap16" style={{ alignItems: 'start' }}>
        <Card pad={false}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <CardHead title="Stops" sub="Reorder · select then click map to place" icon="pin" />
          </div>
          {stopsQ.isLoading ? <div style={{ padding: 24 }} className="muted t-sm">Loading…</div> : sorted.length === 0 ? (
            <Empty icon="pin" title="No stops" body="Click the map to add the first stop." />
          ) : (
            <div className="col" style={{ maxHeight: 420, overflow: 'auto' }}>
              {sorted.map((s, i) => {
                const unplaced = (s.lat ?? 0) === 0 && (s.lng ?? 0) === 0
                const active = s.id === selectedId
                return (
                  <div
                    key={s.id}
                    className="row ai-center gap8"
                    style={{
                      padding: '10px 14px', borderBottom: '1px solid var(--border)',
                      background: active ? 'var(--brand-50, rgba(37,99,235,0.08))' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => selectStop(s)}
                  >
                    <span className="fw7 t-sm" style={{ width: 22 }}>{s.sequence}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="fw6 t-md truncate">{s.name}</div>
                      <div className="t-xs muted3">{unplaced ? 'Not on map — select & click map' : `${(s.lat as number).toFixed(4)}, ${(s.lng as number).toFixed(4)}`}</div>
                    </div>
                    {canEdit && (
                      <>
                        <IconBtn icon="chevUp" title="Move up" disabled={i === 0 || reorder.isPending} onClick={(e) => { e.stopPropagation(); moveStop(i, -1) }} />
                        <IconBtn icon="chevDown" title="Move down" disabled={i === sorted.length - 1 || reorder.isPending} onClick={(e) => { e.stopPropagation(); moveStop(i, 1) }} />
                        <IconBtn icon="trash" title="Delete" onClick={(e) => { e.stopPropagation(); removeStop(s.id) }} />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {selectedId && (
            <div style={{ padding: 14, borderTop: '1px solid var(--border)' }} className="col gap10">
              <Field label="Stop name">
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={saveName} disabled={!canEdit} />
              </Field>
              <div className="t-xs muted3 row ai-center gap6">
                <Icon name="pin" size={12} />
                Click the map to set or move this stop&apos;s position.
              </div>
            </div>
          )}
        </Card>
        <RouteBuilderMap
          stops={stops}
          height={420}
          geometry={geometryQ.data}
          selectedStopId={selectedId}
          onMapClick={canEdit ? handleMapClick : undefined}
          onStopClick={(stopId) => {
            const s = stops.find((x) => x.id === stopId)
            if (s) selectStop(s)
          }}
        />
      </div>
    </div>
  )
}

function TransportRoutesBody() {
  const app = useApp()
  const canEdit = can(app.role, 'operations', 'E')
  const toast = useToast()
  const routesQ = useTransportRoutes()
  const routes = routesQ.data ?? []
  const deleteRouteMut = useDeleteRoute()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TransportRoute | null>(null)
  const [deleting, setDeleting] = useState<TransportRoute | null>(null)

  async function confirmDelete() {
    if (!deleting) return
    try {
      await deleteRouteMut.mutateAsync(deleting.id)
      toast.success('Route deleted', `${deleting.name} was removed.`)
      setDeleting(null)
    } catch (e) {
      toast.danger('Could not delete route', e instanceof Error ? e.message : 'Unknown error')
    }
  }

  useEffect(() => {
    if (routesQ.isLoading || routes.length === 0) return
    try {
      const id = sessionStorage.getItem(OPEN_ROUTE_KEY)
      if (!id) return
      const r = routes.find((x) => x.id === id)
      if (r) setEditing(r)
      sessionStorage.removeItem(OPEN_ROUTE_KEY)
    } catch { /* ignore */ }
  }, [routes, routesQ.isLoading])

  if (editing) return <RouteBuilder route={editing} onBack={() => setEditing(null)} />

  return (
    <div>
      <PageHead title="Routes" sub="Build routes on the map · assign buses in Operations"
        actions={
          <div className="row gap8">
            <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.transport')}>Back to Transport</Btn>
            {canEdit && <Btn variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>New route</Btn>}
          </div>
        } />
      <Card pad={false}>
        {routesQ.isError ? (
          <div style={{ padding: 24 }}>
            <TransportApiError message="Could not load routes." />
            <Btn variant="secondary" size="sm" onClick={() => routesQ.refetch()}>Retry</Btn>
          </div>
        ) : routesQ.isLoading ? <div style={{ padding: 24 }} className="muted">Loading routes…</div> : routes.length === 0 ? (
          <Empty icon="pin" title="No routes yet" body="Create a route then place stops on the map."
            action={canEdit ? <Btn variant="primary" onClick={() => setCreateOpen(true)}>Create route</Btn> : undefined} />
        ) : (
          <div>
            {routes.map((r) => (
              <div key={r.id} className="row ai-center jc-between gap12" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div className="fw6 t-lg">{r.name}</div>
                  <div className="t-sm muted3">{r.stops} stop{r.stops === 1 ? '' : 's'}</div>
                </div>
                <div className="row gap8">
                  <Btn variant="secondary" icon="pin" onClick={() => setEditing(r)}>Open builder</Btn>
                  {canEdit && <IconBtn icon="trash" title="Delete route" onClick={() => setDeleting(r)} />}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      {deleting && (
        <Modal
          open icon="alert" title="Delete route"
          sub={`${deleting.name} · ${deleting.stops} stop${deleting.stops === 1 ? '' : 's'}`}
          onClose={() => { if (!deleteRouteMut.isPending) setDeleting(null) }}
          footer={
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={() => setDeleting(null)} disabled={deleteRouteMut.isPending}>Cancel</Btn>
              <Btn variant="danger" icon="trash" onClick={() => void confirmDelete()} disabled={deleteRouteMut.isPending}>
                {deleteRouteMut.isPending ? 'Deleting…' : 'Delete route'}
              </Btn>
            </div>
          }
        >
          <div className="t-sm muted">
            This permanently removes the route and its stops. If any bus is currently assigned to
            this route, the delete will be blocked until you reassign them.
          </div>
        </Modal>
      )}
      <CreateRouteModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function TransportRoutes() {
  return (
    <TierGate feature="operations" title="Transport routes" blurb="Route management requires the Platinum Operations module.">
      <TransportRoutesBody />
    </TierGate>
  )
}

function BusEditModal({
  open, bus, onClose,
}: { open: boolean; bus: TransportBus | null; onClose: () => void }) {
  const toast = useToast()
  const routes = useTransportRoutes()
  const driversQ = useStaff({ cat: 'all' })
  const busesQ = useTransportBuses()
  const teachersQ = useTeachers()
  const leadershipByEmail = useLeadershipRoleByEmail()
  const create = useCreateBus()
  const update = useUpdateBus()
  const assignTeacher = useAssignBusTeacher()
  const unassignTeacher = useUnassignBusTeacher()
  const travelingTeachersQ = useTravelingTeachers(bus?.busId ?? '')
  const addTravelingTeacher = useAddTravelingTeacher()
  const removeTravelingTeacher = useRemoveTravelingTeacher()
  const isEdit = bus != null
  const [busNo, setBusNo] = useState('')
  const [routeId, setRouteId] = useState('')
  const [driverStaffId, setDriverStaffId] = useState('')
  const [conductorStaffId, setConductorStaffId] = useState('')
  const [dutyTeacherId, setDutyTeacherId] = useState('')
  const [travelingTeacherIds, setTravelingTeacherIds] = useState<string[]>([])
  const [travelingTeacherStops, setTravelingTeacherStops] = useState<Record<string, string>>({})
  const [capacity, setCapacity] = useState('')
  const travelingStopsQ = useRouteStops(routeId)
  const travelingStopOptions = useMemo(
    () => [
      { value: '', label: '— No stop (started/ended only) —' },
      ...[...(travelingStopsQ.data ?? [])]
        .sort((a, b) => a.sequence - b.sequence)
        .map((s) => ({ value: s.id, label: s.name })),
    ],
    [travelingStopsQ.data],
  )

  useEffect(() => {
    if (!open) return
    setBusNo(bus?.busNo ?? '')
    setRouteId(bus?.routeId ?? '')
    setDriverStaffId(bus?.driverStaffId ?? '')
    setConductorStaffId(bus?.conductorStaffId ?? '')
    setDutyTeacherId(bus?.teacherUserId ?? '')
    setCapacity(bus?.capacity != null ? String(bus.capacity) : '')
  }, [open, bus])

  // Staff already driving or conducting a *different* bus — a staff member can only be
  // committed to one bus at a time, in either role, so they're not offered here.
  const busyElsewhere = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of busesQ.data ?? []) {
      if (isEdit && b.busId === bus!.busId) continue
      if (b.driverStaffId) m.set(b.driverStaffId, b.busNo)
      if (b.conductorStaffId) m.set(b.conductorStaffId, b.busNo)
    }
    return m
  }, [busesQ.data, isEdit, bus])

  const seededTravelingTeachersFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) { seededTravelingTeachersFor.current = null; return }
    if (!travelingTeachersQ.isSuccess) return
    // Seed exactly once per (open, busId) — travelingTeachersQ.data gets a new array
    // reference on every refetch (window refocus, cache invalidation, etc.), and this
    // must NOT re-run then or it clobbers the admin's in-progress checkbox edits.
    const key = bus?.busId ?? 'new'
    if (seededTravelingTeachersFor.current === key) return
    seededTravelingTeachersFor.current = key
    setTravelingTeacherIds((travelingTeachersQ.data ?? []).map((t) => t.teacherUserId))
    setTravelingTeacherStops(
      Object.fromEntries(
        (travelingTeachersQ.data ?? []).filter((t) => t.stopId).map((t) => [t.teacherUserId, t.stopId as string]),
      ),
    )
  }, [open, bus?.busId, travelingTeachersQ.isSuccess, travelingTeachersQ.data])

  /** Bus Duty is its own PUT/DELETE endpoint, separate from the bus record itself —
   *  apply it after the bus save succeeds, only if the selection actually changed. */
  async function saveDutyTeacher(busId: string) {
    const before = bus?.teacherUserId ?? ''
    if (dutyTeacherId === before) return
    if (dutyTeacherId) await assignTeacher.mutateAsync({ busId, teacherUserId: dutyTeacherId })
    else await unassignTeacher.mutateAsync({ busId })
  }

  /** Traveling teachers are a many-to-many list with an optional per-teacher stop — diff against
   *  what the bus already has and PUT only the ones newly added or whose stop changed (the PUT is
   *  an idempotent upsert), then DELETE the ones removed. */
  async function saveTravelingTeachers(busId: string, before: TravelingTeacher[]) {
    const beforeStopById = new Map(before.map((t) => [t.teacherUserId, t.stopId ?? '']))
    const afterSet = new Set(travelingTeacherIds)
    for (const id of travelingTeacherIds) {
      const stopId = travelingTeacherStops[id] || null
      const prevStop = beforeStopById.get(id)
      if (prevStop === undefined || (prevStop || '') !== (stopId ?? '')) {
        await addTravelingTeacher.mutateAsync({ busId, teacherUserId: id, stopId })
      }
    }
    for (const t of before) {
      if (!afterSet.has(t.teacherUserId)) await removeTravelingTeacher.mutateAsync({ busId, teacherUserId: t.teacherUserId })
    }
  }

  async function save() {
    const trimmed = busNo.trim()
    if (!trimmed) { toast.danger('Bus number is required'); return }
    if (driverStaffId && busyElsewhere.has(driverStaffId)) {
      toast.danger('Driver already assigned', `This staff member already drives/conducts Bus ${busyElsewhere.get(driverStaffId)}.`)
      return
    }
    if (conductorStaffId && busyElsewhere.has(conductorStaffId)) {
      toast.danger('Conductor already assigned', `This staff member already drives/conducts Bus ${busyElsewhere.get(conductorStaffId)}.`)
      return
    }
    const capNum = capacity.trim() ? Number(capacity) : null
    if (capNum != null && (!Number.isInteger(capNum) || capNum < 1)) { toast.danger('Capacity must be a whole number of 1 or more'); return }
    try {
      if (isEdit) {
        await update.mutateAsync({
          busId: bus!.busId,
          busNo: trimmed,
          routeId: routeId || null,
          driverStaffId: driverStaffId || null,
          clearDriver: !driverStaffId,
          conductorStaffId: conductorStaffId || null,
          clearConductor: !conductorStaffId,
          capacity: capNum,
          clearCapacity: capNum == null,
        })
        await saveDutyTeacher(bus!.busId)
        await saveTravelingTeachers(bus!.busId, travelingTeachersQ.data ?? [])
        toast.success('Bus updated')
      } else {
        const created = await create.mutateAsync({
          busNo: trimmed,
          routeId: routeId || null,
          driverStaffId: driverStaffId || null,
          conductorStaffId: conductorStaffId || null,
          capacity: capNum,
        })
        if (dutyTeacherId) await assignTeacher.mutateAsync({ busId: created.busId, teacherUserId: dutyTeacherId })
        await saveTravelingTeachers(created.busId, [])
        toast.success('Bus added')
      }
      onClose()
    } catch (e) {
      toast.danger('Could not save bus', e instanceof Error ? e.message : 'Unknown error')
    }
  }

  const routeOpts = routes.data ?? []
  const driverOpts = (driversQ.data ?? []).filter((s) => !busyElsewhere.has(s.id))
  // Bus duty / traveling-teacher access is authorized against the teacher's LOGIN (Users.Id),
  // not their Teachers row id — a teacher who hasn't accepted their invite yet has no linked
  // account to authorize against, so they can't be picked here at all.
  const teacherOpts = (teachersQ.data ?? []).filter((t): t is Teacher & { userId: string } => !!t.userId)
  const busy = create.isPending || update.isPending || assignTeacher.isPending || unassignTeacher.isPending
    || addTravelingTeacher.isPending || removeTravelingTeacher.isPending

  function toggleTravelingTeacher(teacherId: string) {
    setTravelingTeacherIds((ids) => (ids.includes(teacherId) ? ids.filter((id) => id !== teacherId) : [...ids, teacherId]))
  }
  /** A teacher who was also separately invited to the CRM as Admin/Principal/Vice-Principal
   *  shows that leadership role here instead of their teaching designation — same lookup
   *  People uses for Suspend/Unsuspend, keyed by email since there's no other link. */
  function teacherRoleLabel(t: Teacher): string {
    return leadershipByEmail.get(t.email.trim().toLowerCase()) ?? t.desig ?? t.dept
  }
  const dutyTeacherSelectOptions = [
    { value: '', label: teachersQ.isLoading ? 'Loading teachers…' : '— Unassigned —' },
    ...teacherOpts.map((t) => ({ value: t.userId, label: `${t.name} · ${teacherRoleLabel(t)}` })),
  ]
  const driverSelectOptions = [
    { value: '', label: driversQ.isLoading ? 'Loading staff…' : '— Unassigned —' },
    ...driverOpts.map((s) => ({
      value: s.id,
      label: `${s.name} · ${staffCategoryLabel(s.cat, s.dept, s.role)}`,
    })),
  ]
  const conductorSelectOptions = [
    { value: '', label: driversQ.isLoading ? 'Loading staff…' : '— Unassigned —' },
    ...driverOpts.filter((s) => s.id !== driverStaffId).map((s) => ({
      value: s.id,
      label: `${s.name} · ${staffCategoryLabel(s.cat, s.dept, s.role)}`,
    })),
  ]
  const routeSelectOptions = [
    { value: '', label: '— No route —' },
    ...routeOpts.map((r) => ({ value: r.id, label: `${r.name} (${r.stops} stops)` })),
  ]

  return (
    <Modal open={open} onClose={onClose} size="sm" icon="bus"
      title={isEdit ? `Edit bus ${bus?.busNo}` : 'Add bus'}
      sub="Assign a route and transport staff driver."
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Btn>
        </div>
      }>
      <div className="col gap14">
        <Field label="Bus number" required>
          <Input value={busNo} onChange={(e) => setBusNo(e.target.value)} placeholder="e.g. BUS-01" />
        </Field>
        <Field label="Route">
          <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} options={routeSelectOptions} />
        </Field>
        <Field label="Driver (staff)" hint={driversQ.isError ? 'Could not load staff list' : 'Pick any staff member; transport drivers are usually category Transport'}>
          <Select value={driverStaffId} onChange={(e) => setDriverStaffId(e.target.value)} options={driverSelectOptions} disabled={driversQ.isLoading} />
        </Field>
        <Field label="Conductor / helper (staff)" hint="Optional — a second staff member assigned to this bus">
          <Select value={conductorStaffId} onChange={(e) => setConductorStaffId(e.target.value)} options={conductorSelectOptions} disabled={driversQ.isLoading} />
        </Field>
        {busyElsewhere.size > 0 && (
          <div className="t-xs muted3">
            {busyElsewhere.size} staff member{busyElsewhere.size === 1 ? '' : 's'} hidden — already driving/conducting another bus.
          </div>
        )}
        <Field label="Capacity" hint="Optional — leave blank for unlimited seats">
          <Input type="number" min={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="e.g. 40" />
        </Field>
        <Field label="Bus duty teacher" hint={teachersQ.isError ? 'Could not load teacher list' : 'Teacher assigned to supervise this bus'}>
          <Select value={dutyTeacherId} onChange={(e) => setDutyTeacherId(e.target.value)} options={dutyTeacherSelectOptions} disabled={teachersQ.isLoading} />
        </Field>
        <Field label="Traveling teachers" hint="Any number of teachers who can track this bus's route and live location, separate from the duty teacher">
          {teachersQ.isLoading ? (
            <div className="t-sm muted">Loading teachers…</div>
          ) : teacherOpts.length === 0 ? (
            <div className="t-sm muted">No teachers with an active app login yet — they must accept their invite first</div>
          ) : (
            <div className="col gap6" style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
              {teacherOpts.map((t) => {
                const checked = travelingTeacherIds.includes(t.userId)
                return (
                  <div key={t.userId} className="row gap8" style={{ alignItems: 'center' }}>
                    <label className="row gap8" style={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTravelingTeacher(t.userId)}
                      />
                      <span className="t-sm">{t.name} · {teacherRoleLabel(t)}</span>
                    </label>
                    {checked && travelingStopOptions.length > 1 ? (
                      <Select
                        value={travelingTeacherStops[t.userId] ?? ''}
                        onChange={(e) => setTravelingTeacherStops((m) => ({ ...m, [t.userId]: e.target.value }))}
                        options={travelingStopOptions}
                        style={{ maxWidth: 170 }}
                        title="Stop for the ~1 km bus-approaching alert"
                      />
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </Field>
      </div>
    </Modal>
  )
}

/** Own component (not inlined in the table map) so the useTravelingTeachers hook call per
 *  row stays rules-of-hooks legal — the list itself doesn't carry this data, so each row
 *  fetches its own bus's traveling-teacher list. */
function TravelingTeachersCell({ busId }: { busId: string }) {
  const q = useTravelingTeachers(busId)
  const rows = q.data ?? []
  if (q.isLoading) return <span className="t-sm muted">…</span>
  if (rows.length === 0) return <span>—</span>
  return <span title={rows.map((t) => t.teacherName ?? 'Unknown').join(', ')}>{rows.length} teacher{rows.length === 1 ? '' : 's'}</span>
}

function TransportBusesBody() {
  const app = useApp()
  const canEdit = can(app.role, 'operations', 'E')
  const busesQ = useTransportBuses()
  const buses = busesQ.data ?? []
  const staffQ = useStaff()
  const staffById = useMemo(() => new Map((staffQ.data ?? []).map((s) => [s.id, s.name])), [staffQ.data])
  const [editBus, setEditBus] = useState<TransportBus | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => {
    if (busesQ.isLoading || buses.length === 0) return
    try {
      const id = sessionStorage.getItem(OPEN_BUS_KEY)
      if (!id) return
      const b = buses.find((x) => x.busId === id)
      if (b) setEditBus(b)
      sessionStorage.removeItem(OPEN_BUS_KEY)
    } catch { /* ignore */ }
  }, [buses, busesQ.isLoading])

  return (
    <div>
      <PageHead title="Buses" sub="Fleet vehicles, route assignment & drivers"
        actions={
          <div className="row gap8">
            <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.transport')}>Back to Transport</Btn>
            {canEdit && <Btn variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Add bus</Btn>}
          </div>
        } />
      <Card>
        {busesQ.isError ? (
          <div style={{ padding: 16 }}>
            <TransportApiError message="Could not load buses." />
            <Btn variant="secondary" size="sm" onClick={() => busesQ.refetch()}>Retry</Btn>
          </div>
        ) : busesQ.isLoading ? <div className="t-sm muted" style={{ padding: 16 }}>Loading…</div> : buses.length === 0 ? (
          <Empty icon="bus" title="No buses yet" body="Add a vehicle and assign a route and driver." />
        ) : (
          <table className="sm-table">
            <thead>
              <tr>
                <th>Bus</th><th>Route</th><th>Driver</th><th>Conductor</th><th>Bus duty teacher</th><th>Traveling teachers</th><th>Stops</th><th>Students</th><th>Capacity</th><th />
              </tr>
            </thead>
            <tbody>
              {buses.map((b) => (
                <tr key={b.busId}>
                  <td className="fw6">{b.busNo}</td>
                  <td>{b.routeName ?? '—'}</td>
                  <td>{b.driver ?? '—'}{b.driverPhone ? ` · ${b.driverPhone}` : ''}</td>
                  <td>{b.conductorStaffId ? (staffById.get(b.conductorStaffId) ?? '—') : '—'}</td>
                  <td>{b.teacherName ?? '—'}</td>
                  <td><TravelingTeachersCell busId={b.busId} /></td>
                  <td>{b.stopCount}</td>
                  <td>{b.studentsAssigned}</td>
                  <td>{b.studentsAssigned} / {b.capacity ?? '∞'}</td>
                  <td>{canEdit ? <IconBtn icon="edit" title="Edit" onClick={() => setEditBus(b)} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <BusEditModal open={createOpen} bus={null} onClose={() => setCreateOpen(false)} />
      <BusEditModal open={editBus != null} bus={editBus} onClose={() => setEditBus(null)} />
    </div>
  )
}

function TransportBuses() {
  return (
    <TierGate feature="operations" title="Buses" blurb="Bus fleet management requires the Platinum Operations module.">
      <TransportBusesBody />
    </TierGate>
  )
}

function TransportStudents() {
  return (
    <TierGate feature="operations" title="Transport students" blurb="Student mapping status requires the Platinum Operations module.">
      <TransportStudentsScreen />
    </TierGate>
  )
}

export const transportScreens: Record<string, ComponentType> = {
  'school.transport': TransportDashboard,
  'school.transport.routes': TransportRoutes,
  'school.transport.buses': TransportBuses,
  'school.transport.students': TransportStudents,
}
