import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  MapControl: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  ControlPosition: { TOP_LEFT: 'TOP_LEFT' },
  useMap: () => null,
  useMapsLibrary: () => null,
}))

import { RouteBuilderMap, FleetLiveMap } from './RouteBuilderMap'
import type { RouteStop } from '@/api/transport'

// VITE_GOOGLE_MAPS_API_KEY / VITE_GOOGLE_MAPS_MAP_ID are provided for the test environment
// via `test.env` in vite.config.ts — Vite replaces `import.meta.env.*` statically at build
// time, so a runtime `vi.stubGlobal('import.meta', ...)` here is a no-op and must not be used.

const stops: RouteStop[] = [
  { id: 's1', routeId: 'r1', name: 'Stop 1', sequence: 1, lat: 12.1, lng: 77.1 },
  { id: 's2', routeId: 'r1', name: 'Stop 2', sequence: 2, lat: 12.2, lng: 77.2 },
]

describe('RouteBuilderMap route geometry', () => {
  it('shows a Route unavailable indicator when geometry status is unavailable', () => {
    render(
      <RouteBuilderMap
        stops={stops}
        geometry={{
          routeId: 'r1', status: 'unavailable', format: null, geometry: null,
          distanceMeters: null, durationSeconds: null, stopSequenceHash: 'h', generatedAt: null,
        }}
      />,
    )
    expect(screen.getByText(/route unavailable/i)).toBeInTheDocument()
  })

  it('does not show the unavailable indicator when geometry is available, and actually renders the map with stops', () => {
    render(
      <RouteBuilderMap
        stops={stops}
        geometry={{
          routeId: 'r1', status: 'available', format: 'google-encoded-polyline', geometry: 'abc',
          distanceMeters: 100, durationSeconds: 10, stopSequenceHash: 'h', generatedAt: '2026-09-19T10:00:00Z',
        }}
      />,
    )
    // Positive assertion beyond "badge is absent": prove the map actually rendered (stop
    // markers present) rather than silently falling back to the "Map not configured" state,
    // which would also make the badge assertion below pass vacuously.
    expect(screen.getByText('Stop 1')).toBeInTheDocument()
    expect(screen.getByText('Stop 2')).toBeInTheDocument()
    expect(screen.queryByText(/map not configured/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/route unavailable/i)).not.toBeInTheDocument()
  })
})

describe('FleetLiveMap route geometry', () => {
  const fleet = [{ busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 20 }]
  const routeStopsByRouteId = { r1: [
    { id: 's1', routeId: 'r1', name: 'Stop 1', sequence: 1, lat: 12.1, lng: 77.1 },
    { id: 's2', routeId: 'r1', name: 'Stop 2', sequence: 2, lat: 12.2, lng: 77.2 },
  ] }

  it('shows Route unavailable for a selected bus whose route geometry is unavailable', async () => {
    const user = userEvent.setup()
    render(
      <FleetLiveMap
        fleet={fleet}
        routeStopsByRouteId={routeStopsByRouteId}
        routeGeometryByRouteId={{ r1: {
          routeId: 'r1', status: 'unavailable', format: null, geometry: null,
          distanceMeters: null, durationSeconds: null, stopSequenceHash: 'h', generatedAt: null,
        } }}
      />,
    )
    // Selecting the bus is required to trigger route drawing per existing FleetLiveMap behavior
    // (no selection = no routes at all).
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    expect(screen.getByText(/route unavailable/i)).toBeInTheDocument()
  })

  it('does not show the unavailable indicator when a selected bus has available geometry', async () => {
    const user = userEvent.setup()
    render(
      <FleetLiveMap
        fleet={fleet}
        routeStopsByRouteId={routeStopsByRouteId}
        routeGeometryByRouteId={{ r1: {
          routeId: 'r1', status: 'available', format: 'google-encoded-polyline', geometry: 'abc',
          distanceMeters: 100, durationSeconds: 10, stopSequenceHash: 'h', generatedAt: '2026-09-19T10:00:00Z',
        } }}
      />,
    )
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    // Positive assertion: prove the map/route actually rendered (stop marker present),
    // not just that the badge happens to be absent.
    expect(screen.getByText('Stop 1')).toBeInTheDocument()
    expect(screen.queryByText(/route unavailable/i)).not.toBeInTheDocument()
  })

  it('renders speed, the highlightStop ★ overlay, and available road geometry together in one pass', async () => {
    const user = userEvent.setup()
    const fleetWithSpeed = [{ busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 42 }]
    render(
      <FleetLiveMap
        fleet={fleetWithSpeed}
        routeStopsByRouteId={routeStopsByRouteId}
        highlightStop={{ name: 'Home', lat: 12.15, lng: 77.15 }}
        routeGeometryByRouteId={{ r1: {
          routeId: 'r1', status: 'available', format: 'google-encoded-polyline', geometry: 'abc',
          distanceMeters: 100, durationSeconds: 10, stopSequenceHash: 'h', generatedAt: '2026-09-19T10:00:00Z',
        } }}
      />,
    )
    // Routes only draw once a bus is selected — same pattern as the geometry-only tests above.
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))

    // Bus marker with live speed.
    expect(screen.getByText('BUS-01 · 42 km/h')).toBeInTheDocument()
    // Bus icon rendered alongside the label, not a bare colored box.
    expect(screen.getByTestId('bus-icon-b1')).toBeInTheDocument()
    // ★ highlightStop overlay.
    expect(screen.getByText('★ Home')).toBeInTheDocument()
    // Road-following geometry rendered (available) — no "unavailable" fallback badge.
    expect(screen.queryByText(/route unavailable/i)).not.toBeInTheDocument()
    // Route stop markers (drawn alongside the road polyline for the selected bus's route).
    expect(screen.getByText('Stop 1')).toBeInTheDocument()
    expect(screen.getByText('Stop 2')).toBeInTheDocument()
  })

  it('renders a fixed yellow school-bus icon with a separate status-colored dot', async () => {
    const user = userEvent.setup()
    const movingFleet = [{ busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 20 }]
    render(<FleetLiveMap fleet={movingFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))

    const icon = screen.getByTestId('bus-icon-b1')
    expect(icon).toHaveAttribute('fill', '#FFC107')
    expect(screen.getByTestId('bus-status-dot-b1')).toHaveStyle({ background: 'rgb(22, 163, 74)' })
  })

  it('rotates the bus icon to match its GPS heading', async () => {
    const user = userEvent.setup()
    const fleetWithHeading = [{ busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 20, heading: 135 }]
    render(<FleetLiveMap fleet={fleetWithHeading} routeStopsByRouteId={routeStopsByRouteId} />)
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    expect(screen.getByTestId('bus-icon-b1')).toHaveStyle({ transform: 'rotate(135deg)' })
  })

  it('does not rotate the bus icon when heading is unavailable', async () => {
    const user = userEvent.setup()
    render(<FleetLiveMap fleet={fleet} routeStopsByRouteId={routeStopsByRouteId} />)
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    expect(screen.getByTestId('bus-icon-b1')).toHaveStyle({ transform: 'rotate(0deg)' })
  })

  it('filters buses by route', async () => {
    const user = userEvent.setup()
    const twoRouteFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', routeName: 'Route A', lat: 12.1, lng: 77.1, speedKmh: 20 },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r2', routeName: 'Route B', lat: 13.1, lng: 78.1, speedKmh: 10 },
    ]
    render(<FleetLiveMap fleet={twoRouteFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    expect(screen.getByText(/BUS-01/)).toBeInTheDocument()
    expect(screen.getByText(/BUS-02/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/route/i), 'r1')

    expect(screen.getByText(/BUS-01/)).toBeInTheDocument()
    expect(screen.queryByText(/BUS-02/)).not.toBeInTheDocument()
  })

  it('shows a bus that matches both a route filter and a status filter at once', async () => {
    const user = userEvent.setup()
    const twoRouteFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', routeName: 'Route A', lat: 12.1, lng: 77.1, speedKmh: 0, status: 'delayed' },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r2', routeName: 'Route B', lat: 13.1, lng: 78.1, speedKmh: 10, status: 'on_route' },
    ]
    render(<FleetLiveMap fleet={twoRouteFleet} routeStopsByRouteId={routeStopsByRouteId} />)

    await user.selectOptions(screen.getByLabelText(/route/i), 'r1')
    await user.selectOptions(screen.getByLabelText(/status/i), 'delayed')

    expect(screen.getByText(/BUS-01/)).toBeInTheDocument()
    expect(screen.queryByText(/BUS-02/)).not.toBeInTheDocument()
  })

  it('draws no route line before touching the route filter or picking a bus (default declutter)', () => {
    render(<FleetLiveMap fleet={fleet} routeStopsByRouteId={routeStopsByRouteId} />)
    expect(screen.queryByText('Stop 1')).not.toBeInTheDocument()
  })

  it('explicitly picking "All routes" in the filter draws every visible bus\'s route', async () => {
    const user = userEvent.setup()
    const twoRouteFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', routeName: 'Route A', lat: 12.1, lng: 77.1, speedKmh: 20 },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r2', routeName: 'Route B', lat: 13.1, lng: 78.1, speedKmh: 10 },
    ]
    const twoRouteStops = {
      ...routeStopsByRouteId,
      r2: [
        { id: 's3', routeId: 'r2', name: 'Stop 3', sequence: 1, lat: 13.1, lng: 78.1 },
        { id: 's4', routeId: 'r2', name: 'Stop 4', sequence: 2, lat: 13.2, lng: 78.2 },
      ],
    }
    render(<FleetLiveMap fleet={twoRouteFleet} routeStopsByRouteId={twoRouteStops} />)
    expect(screen.queryByText('Stop 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Stop 4')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/route/i), 'r1')
    await user.selectOptions(screen.getByLabelText(/route/i), '')

    expect(screen.getByText('Stop 1')).toBeInTheDocument()
    expect(screen.getByText('Stop 4')).toBeInTheDocument()
  })

  it('selecting a route in the filter draws its stops even with no bus explicitly selected', async () => {
    const user = userEvent.setup()
    const twoRouteFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', routeName: 'Route A', lat: 12.1, lng: 77.1, speedKmh: 20 },
    ]
    render(<FleetLiveMap fleet={twoRouteFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    expect(screen.queryByText('Stop 1')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/route/i), 'r1')

    expect(screen.getByText('Stop 1')).toBeInTheDocument()
    expect(screen.getByText('Stop 2')).toBeInTheDocument()
  })

  it('filters buses by status', async () => {
    const user = userEvent.setup()
    const twoStatusFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 20, status: 'on_route' },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r2', lat: 13.1, lng: 78.1, speedKmh: 0, status: 'delayed' },
    ]
    render(<FleetLiveMap fleet={twoStatusFleet} routeStopsByRouteId={routeStopsByRouteId} />)

    await user.selectOptions(screen.getByLabelText(/status/i), 'delayed')

    expect(screen.queryByText(/BUS-01/)).not.toBeInTheDocument()
    expect(screen.getByText(/BUS-02/)).toBeInTheDocument()
  })

  it('filters buses by a search term matching bus number or driver', async () => {
    const user = userEvent.setup()
    const searchableFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 20, driver: 'Raj Kumar' },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r2', lat: 13.1, lng: 78.1, speedKmh: 10, driver: 'Sunita Devi' },
    ]
    render(<FleetLiveMap fleet={searchableFleet} routeStopsByRouteId={routeStopsByRouteId} />)

    await user.type(screen.getByPlaceholderText(/search/i), 'sunita')

    expect(screen.queryByText(/BUS-01/)).not.toBeInTheDocument()
    expect(screen.getByText(/BUS-02/)).toBeInTheDocument()
  })

  it('calls onBusClick with the bus id when a bus marker is clicked', async () => {
    const user = userEvent.setup()
    const onBusClick = vi.fn()
    render(<FleetLiveMap fleet={fleet} routeStopsByRouteId={routeStopsByRouteId} onBusClick={onBusClick} />)
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    await user.click(screen.getByText('BUS-01 · 20 km/h'))
    expect(onBusClick).toHaveBeenCalledWith('b1')
  })

  it('draws the route line for a bus matched by the status filter alone', async () => {
    const user = userEvent.setup()
    const delayedFleet = [{ busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, speedKmh: 0, status: 'delayed' }]
    render(<FleetLiveMap fleet={delayedFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    expect(screen.queryByText('Stop 1')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/status/i), 'delayed')

    expect(screen.getByText('Stop 1')).toBeInTheDocument()
  })

  it('does not show a student count badge on stop markers (count is revealed via click instead)', async () => {
    const user = userEvent.setup()
    render(
      <FleetLiveMap
        fleet={fleet}
        routeStopsByRouteId={routeStopsByRouteId}
      />,
    )
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    expect(screen.queryByText('12')).not.toBeInTheDocument()
  })

  it('shows last known position for an idle bus, not only a live trip', () => {
    const idleFleet = [
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r1', lat: 12.5, lng: 77.5, speedKmh: null, status: 'idle' },
    ]
    render(<FleetLiveMap fleet={idleFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    expect(screen.getByText('BUS-02 · last')).toBeInTheDocument()
    expect(screen.queryByText(/waiting for live gps/i)).not.toBeInTheDocument()
  })

  it('selects and unselects every bus from the picker', async () => {
    const user = userEvent.setup()
    const twoBusFleet = [
      { busId: 'b1', busNo: 'BUS-01', routeId: 'r1', lat: 12.1, lng: 77.1, status: 'on_route' },
      { busId: 'b2', busNo: 'BUS-02', routeId: 'r1', lat: 12.5, lng: 77.5, status: 'idle' },
    ]
    render(<FleetLiveMap fleet={twoBusFleet} routeStopsByRouteId={routeStopsByRouteId} />)
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('button', { name: /select all/i }))
    expect(screen.getByRole('button', { name: /2 buses selected/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /unselect all/i }))
    expect(screen.getByRole('button', { name: /all buses/i })).toBeInTheDocument()
    expect(screen.getAllByText(/BUS-01/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/BUS-02 · last/).length).toBeGreaterThan(0)
  })

  it('calls onStopClick with the stop id when a stop marker is clicked', async () => {
    const user = userEvent.setup()
    const onStopClick = vi.fn()
    render(
      <FleetLiveMap
        fleet={fleet}
        routeStopsByRouteId={routeStopsByRouteId}
        onStopClick={onStopClick}
      />,
    )
    await user.click(screen.getByRole('button', { name: /all buses/i }))
    await user.click(screen.getByRole('checkbox', { name: /bus-01/i }))
    await user.click(screen.getByText('Stop 1'))
    expect(onStopClick).toHaveBeenCalledWith('s1')
  })
})
