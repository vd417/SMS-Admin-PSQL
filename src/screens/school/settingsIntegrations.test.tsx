import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, fireEvent, screen, within, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { ThemeProvider } from '@/context/ThemeProvider'
import { adminScreens } from './admin'
import type { SaveSchoolIntegrationsInput } from '@/api/schoolIntegrations'
import type { SchoolIntegrations } from '@/types'

const SettingsScreen = adminScreens['school.settings']

const mockIntegrations: SchoolIntegrations = {
  email: { enabled: true, fromName: 'Riverdale', fromAddress: 'fees@riverdale.edu' },
  sms: { enabled: false, senderId: 'RIVDAL' },
  razorpay: {
    enabled: true, keyId: 'rzp_test_abc', mode: 'test', status: 'configured',
    keySecretSet: true, webhookSecretSet: false,
  },
}

const getSchoolIntegrations = vi.fn(async () => mockIntegrations)
const saveSchoolIntegrations = vi.fn(async (_input: SaveSchoolIntegrationsInput) => mockIntegrations)
const verifySchoolRazorpay = vi.fn(async () => ({ status: 'configured' as const }))
const testSchoolEmailConnection = vi.fn(async () => ({ status: 'connected' }))

vi.mock('@/api/schoolIntegrations', () => ({
  getSchoolIntegrations: (...args: unknown[]) => getSchoolIntegrations(...(args as [])),
  saveSchoolIntegrations: (input: SaveSchoolIntegrationsInput) => saveSchoolIntegrations(input),
  verifySchoolRazorpay: (...args: unknown[]) => verifySchoolRazorpay(...(args as [])),
  testSchoolEmailConnection: (...args: unknown[]) => testSchoolEmailConnection(...(args as [])),
}))

afterEach(() => {
  cleanup()
  getSchoolIntegrations.mockImplementation(async () => mockIntegrations)
  saveSchoolIntegrations.mockClear()
  testSchoolEmailConnection.mockClear()
})

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ThemeProvider>
          <AppProvider>
            <SettingsScreen />
          </AppProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Settings — Integrations card', () => {
  it('loads and shows Email/SMS/Razorpay values without echoing the secret', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByDisplayValue('Riverdale')).toBeInTheDocument())
    expect(within(container).getByDisplayValue('rzp_test_abc')).toBeInTheDocument()
    expect(within(container).getByPlaceholderText('•••• (set)')).toBeInTheDocument()
    expect(within(container).getByText('Connected')).toBeInTheDocument()
  })

  it('saves without sending empty secret fields', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByDisplayValue('Riverdale')).toBeInTheDocument())

    fireEvent.change(within(container).getByDisplayValue('Riverdale'), { target: { value: 'Riverdale School' } })
    fireEvent.click(within(container).getByText('Save integrations'))

    await waitFor(() => expect(saveSchoolIntegrations).toHaveBeenCalled())
    const payload = saveSchoolIntegrations.mock.calls[0]![0]
    expect(payload.email!.fromName).toBe('Riverdale School')
    expect(payload.razorpay!.keySecret).toBeUndefined()
    expect(payload.razorpay!.webhookSecret).toBeUndefined()
  })

  it('tests the Razorpay connection', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByDisplayValue('Riverdale')).toBeInTheDocument())
    fireEvent.click(within(container).getByText('Test connection'))
    await waitFor(() => expect(verifySchoolRazorpay).toHaveBeenCalled())
  })

  it('shows Connected when school email is on, not the Catre off copy', async () => {
    getSchoolIntegrations.mockImplementation(async () => ({
      ...mockIntegrations,
      email: {
        ...mockIntegrations.email,
        enabled: true,
        status: 'connected',
        lastTestAt: '2026-11-16T10:29:16.000Z',
        catreMailConfigured: false,
      },
    }))
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/send from this school mailbox/i)).toBeInTheDocument())
    expect(within(container).getAllByText('Connected').length).toBeGreaterThan(0)
    expect(within(container).queryByText(/until then they go from catre/i)).not.toBeInTheDocument()
    expect(within(container).queryByText(/need 2 mail configs/i)).not.toBeInTheDocument()
  })

  it('asks twice to turn school email off and requires typing yes', async () => {
    getSchoolIntegrations.mockImplementation(async () => ({
      ...mockIntegrations,
      email: {
        ...mockIntegrations.email,
        enabled: true,
        status: 'connected',
      },
    }))
    saveSchoolIntegrations.mockImplementation(async (input) => ({
      ...mockIntegrations,
      email: { ...mockIntegrations.email, ...input.email, enabled: false, status: 'connected' },
    }))
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/send from this school mailbox/i)).toBeInTheDocument())
    const emailToggle = within(container).getAllByRole('button', { pressed: true })[0]
    fireEvent.click(emailToggle!)
    expect(saveSchoolIntegrations).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByText('Continue')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Continue'))
    const yes = screen.getByPlaceholderText('yes')
    fireEvent.click(screen.getByText('Turn off'))
    expect(saveSchoolIntegrations).not.toHaveBeenCalled()
    fireEvent.change(yes, { target: { value: 'yes' } })
    fireEvent.click(screen.getByText('Turn off'))
    await waitFor(() => expect(saveSchoolIntegrations).toHaveBeenCalled())
    expect(saveSchoolIntegrations.mock.calls[0]![0].email!.enabled).toBe(false)
  })

  it('when email is off, copy says mail sends from Catre', async () => {
    getSchoolIntegrations.mockImplementation(async () => ({
      ...mockIntegrations,
      email: {
        ...mockIntegrations.email,
        enabled: false,
        status: 'connected',
        lastTestAt: '2026-11-16T10:29:16.000Z',
      },
    }))
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/mail sends from catre/i)).toBeInTheDocument())
    expect(within(container).queryByText(/need 2 mail configs/i)).not.toBeInTheDocument()
  })

  it('tests SMTP with the host and password currently in the form', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByDisplayValue('Riverdale')).toBeInTheDocument())
    fireEvent.click(within(container).getByText('SMTP'))
    fireEvent.change(within(container).getByPlaceholderText('smtp.gmail.com'), { target: { value: 'smtp.gmail.com' } })
    const usernames = within(container).getAllByPlaceholderText('fees@school.edu')
    fireEvent.change(usernames[usernames.length - 1]!, { target: { value: 'fees@riverdale.edu' } })
    fireEvent.change(within(container).getByPlaceholderText('App password'), { target: { value: 'app-pass' } })
    fireEvent.click(within(container).getByText('Test SMTP'))
    await waitFor(() => expect(testSchoolEmailConnection).toHaveBeenCalledWith({
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      encryption: 'starttls',
      smtpUsername: 'fees@riverdale.edu',
      smtpPassword: 'app-pass',
      enabled: true,
    }))
  })
})
