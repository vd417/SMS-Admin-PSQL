import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  Map: ({ children }: { children?: React.ReactNode }) => <div data-testid="campus-map">{children}</div>,
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useMap: () => null,
}))

import { CampusGeofenceMap } from './CampusGeofenceMap'

describe('CampusGeofenceMap', () => {
  it('shows the campus pin and map when coordinates are set', () => {
    render(<CampusGeofenceMap lat={12.9716} lng={77.5946} radiusMeters={250} name="Main Campus" />)
    expect(screen.getByTestId('campus-map')).toBeInTheDocument()
    expect(screen.getByText('Main Campus')).toBeInTheDocument()
    expect(screen.queryByText(/map not configured/i)).not.toBeInTheDocument()
  })

  it('prompts to click the map when no location is set and picking is allowed', () => {
    render(<CampusGeofenceMap lat={null} lng={null} radiusMeters={250} onPick={() => {}} />)
    expect(screen.getByText(/click the map/i)).toBeInTheDocument()
  })
})
