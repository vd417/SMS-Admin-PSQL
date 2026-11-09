import { request } from './client'
import { snakeToCamel } from './mapper'

export interface CrmPresence {
  id: string
  email: string
  phone: string
  roles: string[]
  /** True when this CRM login was used in the last few minutes. */
  online: boolean
}

interface PresenceWire {
  id?: string
  email?: string | null
  phone?: string | null
  roles?: string | null
  online?: boolean
}

/** Active logins in this school, with who is signed in right now. */
export async function listCrmPresence(): Promise<CrmPresence[]> {
  const rows = await request<PresenceWire[]>('/crm-presence')
  return (rows ?? []).map((row) => {
    const c = snakeToCamel<PresenceWire>(row)
    return {
      id: String(c.id ?? ''),
      email: (c.email ?? '').trim(),
      phone: (c.phone ?? '').trim(),
      roles: String(c.roles ?? '').split(',').map((r) => r.trim()).filter(Boolean),
      online: Boolean(c.online),
    }
  }).filter((row) => row.id)
}
