import { request } from './client'
import type { Client } from './ownerTypes'

export interface UpdateSchoolProfileBody {
  name?: string
  /** Human school id (tenant slug). */
  slug?: string
  country?: string
  address?: string
  contact_name?: string
  contact_email?: string
  contact_phone?: string
  logo_url?: string | null
  image_url?: string | null
  set_logo?: boolean
  set_image?: boolean
  lat?: number
  lng?: number
  geofence_radius_meters?: number
  set_geofence?: boolean
  /** Education board: 'CBSE' | 'ICSE' | 'State Board' | a custom name. */
  board?: string
}

/** School owner/admin — PATCH /me/schools/{id} */
export function updateMySchoolProfile(tenantId: string, body: UpdateSchoolProfileBody): Promise<Client> {
  return request<Client>(`/me/schools/${tenantId}`, { method: 'PATCH', body })
}

/** Platform — PATCH /clients/{id} */
export function updateClientProfile(tenantId: string, body: UpdateSchoolProfileBody): Promise<Client> {
  return request<Client>(`/clients/${tenantId}`, { method: 'PATCH', body })
}

export function updateSchoolProfile(
  tenantId: string,
  body: UpdateSchoolProfileBody,
  isPlatform: boolean,
): Promise<Client> {
  return isPlatform ? updateClientProfile(tenantId, body) : updateMySchoolProfile(tenantId, body)
}
