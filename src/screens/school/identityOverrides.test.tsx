import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { adminScreens } from './admin'

const IdentityScreen = adminScreens['school.identity']

const mockUsers = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'admin@school.edu',
    phone: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    roles: ['school.admin'],
  },
]

vi.mock('@/api/users', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/users')>()
  return {
    ...actual,
    listSchoolUsers: vi.fn(async () => mockUsers),
    getUserPermissions: vi.fn(async () => []),
    setUserPermissions: vi.fn(async (_id: string, ov: import('@/types').UserOverrides) => {
      const rows: { module: string; cap: string; effect: string }[] = []
      for (const [module, caps] of Object.entries(ov)) {
        if (!caps) continue
        for (const [cap, effect] of Object.entries(caps)) {
          if (effect) rows.push({ module, cap, effect })
        }
      }
      return rows
    }),
    setUserRoles: vi.fn(async () => mockUsers[0]),
  }
})

const getRoleTemplateMock = vi.fn(async () => [] as import('@/api/roleTemplates').RoleTemplateOverride[])
const setRoleTemplateMock = vi.fn(async (overrides: import('@/api/roleTemplates').RoleTemplateOverride[]) => overrides)

vi.mock('@/api/roleTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/roleTemplates')>()
  return {
    ...actual,
    getRoleTemplate: (...args: []) => getRoleTemplateMock(...args),
    setRoleTemplate: (...args: [import('@/api/roleTemplates').RoleTemplateOverride[]]) => setRoleTemplateMock(...args),
  }
})

const listAuditLogMock = vi.fn(async (_params?: import('@/api/audit').AuditParams) => ({
  data: [] as import('@/api/audit').AuditEntry[],
  nextCursor: null as string | null,
}))

vi.mock('@/api/audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/audit')>()
  return {
    ...actual,
    listAuditLog: (...args: [import('@/api/audit').AuditParams?]) => listAuditLogMock(...args),
  }
})

const listInvitationsMock = vi.fn(async () => [] as import('@/api/invitations').Invitation[])

vi.mock('@/api/invitations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invitations')>()
  return {
    ...actual,
    listInvitations: (...args: []) => listInvitationsMock(...args),
  }
})

afterEach(cleanup)

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <IdentityScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
}

function moduleRow(container: HTMLElement, label: string): HTMLElement {
  const cell = within(container).getByText(label)
  return cell.closest('tr') as HTMLElement
}

describe('per-user access editor (by user id)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('opens from Permissions, cycles a capability, saves against user id', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())

    fireEvent.click(within(container).getAllByRole('button', { name: /^permissions$/i })[0])
    await waitFor(() => expect(within(container).getByText(/Per-user access/i)).toBeInTheDocument())

    const row = moduleRow(container, 'Fees & finance')
    const vChip = within(row).getByTitle(/^View —/)
    fireEvent.click(vChip)
    expect(within(row).getByTitle('View — grant')).toBeInTheDocument()

    fireEvent.click(within(container).getByText('Save changes'))
    await waitFor(() => expect(within(container).getByText(/Permissions saved/i)).toBeInTheDocument())
  })

  it('cycles a cell through grant, revoke, and back to inherit', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())
    fireEvent.click(within(container).getAllByRole('button', { name: /^permissions$/i })[0])
    await waitFor(() => expect(within(container).getByText(/Per-user access/i)).toBeInTheDocument())

    const row = moduleRow(container, 'Fees & finance')
    const eChip = within(row).getByTitle(/^Edit —/)

    fireEvent.click(eChip)
    expect(within(row).getByTitle('Edit — grant')).toBeInTheDocument()
    fireEvent.click(within(row).getByTitle('Edit — grant'))
    expect(within(row).getByTitle('Edit — revoke')).toBeInTheDocument()
    fireEvent.click(within(row).getByTitle('Edit — revoke'))
    expect(within(row).getByTitle('Edit — inherit')).toBeInTheDocument()
  })

  it('reflects a tenant-level role-template grant/revoke in the Effective column, with no per-user override', async () => {
    // admin's default caps for fees are ['E'] only (see mockDb PERMS). A tenant template
    // grant of 'V' plus a revoke of 'E' should change the Effective column even though
    // this user has zero per-user overrides on this cell.
    getRoleTemplateMock.mockResolvedValue([
      { role: 'admin', module: 'fees', cap: 'V', effect: 'grant' },
      { role: 'admin', module: 'fees', cap: 'E', effect: 'revoke' },
    ])
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())

    fireEvent.click(within(container).getAllByRole('button', { name: /^permissions$/i })[0])
    await waitFor(() => expect(within(container).getByText(/Per-user access/i)).toBeInTheDocument())

    const row = moduleRow(container, 'Fees & finance')
    const cells = within(row).getAllByRole('cell')
    const effectiveCell = cells[cells.length - 1]

    // Granted by the tenant template even though the user has no per-user override.
    await waitFor(() => expect(within(effectiveCell).getByText('V')).toBeInTheDocument())
    // Revoked by the tenant template, so it must not appear in Effective anymore.
    expect(within(effectiveCell).queryByText('E')).not.toBeInTheDocument()
  })
})

describe('role template matrix (Roles & permissions tab)', () => {
  beforeEach(() => { vi.clearAllMocks(); getRoleTemplateMock.mockResolvedValue([]) })

  it('loads the saved template, toggles a cap, and PUTs the overrides on save', async () => {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())

    fireEvent.click(within(container).getByRole('button', { name: /roles & permissions/i }))
    await waitFor(() => expect(within(container).getByText('Permission matrix')).toBeInTheDocument())
    await waitFor(() => expect(getRoleTemplateMock).toHaveBeenCalled())

    // dashboard row: teacher starts with only 'V' granted — toggle 'E' on.
    const row = moduleRow(container, 'Dashboard')
    const cells = within(row).getAllByRole('cell')
    const teacherCell = cells[5] // module, owner, admin, principal, vice_principal, teacher, staff
    fireEvent.click(within(teacherCell).getByText('E'))

    fireEvent.click(within(container).getByText('Save changes'))
    await waitFor(() => expect(within(container).getByText(/Permissions saved/i)).toBeInTheDocument())

    expect(setRoleTemplateMock).toHaveBeenCalledTimes(1)
    const overrides = setRoleTemplateMock.mock.calls[0][0]
    expect(overrides).toContainEqual({ role: 'teacher', module: 'dashboard', cap: 'E', effect: 'grant' })
  })

  it('shows an error toast when saving fails', async () => {
    setRoleTemplateMock.mockRejectedValueOnce(new Error('boom'))
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())

    fireEvent.click(within(container).getByRole('button', { name: /roles & permissions/i }))
    await waitFor(() => expect(within(container).getByText('Permission matrix')).toBeInTheDocument())

    fireEvent.click(within(container).getByText('Save changes'))
    await waitFor(() => expect(within(container).getByText(/Could not save/i)).toBeInTheDocument())
  })
})

describe('AuditTab (Audit log tab)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  async function openAuditTab() {
    const { container } = renderScreen()
    await waitFor(() => expect(within(container).getByText(/admin@school\.edu/i)).toBeInTheDocument())
    fireEvent.click(within(container).getByRole('button', { name: /audit log/i }))
    return container
  }

  it('renders a spinner while the audit log is loading', async () => {
    listAuditLogMock.mockImplementation(() => new Promise(() => {})) // never resolves
    const container = await openAuditTab()
    await waitFor(() => expect(container.querySelector('.sm-spin')).toBeTruthy())
  })

  it('shows a retry button on error, which refetches', async () => {
    listAuditLogMock.mockRejectedValueOnce(new Error('boom'))
    const container = await openAuditTab()
    await waitFor(() => expect(within(container).getByText(/Could not load activity/i)).toBeInTheDocument())

    listAuditLogMock.mockResolvedValueOnce({
      data: [{ id: 'A-1', actorId: 'U-1', actorName: 'Ravi Menon', action: 'user.role_changed', target: 'U-2', at: '2026-07-22T10:00:00Z' }],
      nextCursor: null,
    })
    fireEvent.click(within(container).getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(within(container).getByText('Ravi Menon')).toBeInTheDocument())
    expect(listAuditLogMock).toHaveBeenCalledTimes(2)
  })

  it('shows "No activity yet" when the audit log is empty', async () => {
    listAuditLogMock.mockResolvedValue({ data: [], nextCursor: null })
    const container = await openAuditTab()
    await waitFor(() => expect(within(container).getByText('No activity yet')).toBeInTheDocument())
  })

  it('re-queries with the typed text as the action filter', async () => {
    listAuditLogMock.mockResolvedValue({ data: [], nextCursor: null })
    const container = await openAuditTab()
    await waitFor(() => expect(listAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ action: undefined, q: undefined, cursor: undefined })))

    const search = within(container).getByPlaceholderText(/Search person, action, or target/i)
    fireEvent.change(search, { target: { value: 'Ravi' } })

    await waitFor(() => expect(listAuditLogMock).toHaveBeenCalledWith(expect.objectContaining({ q: 'Ravi', cursor: undefined })))
  })
})
