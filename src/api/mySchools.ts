import { listRequest, request } from './client'
import { tokenStore } from './auth/tokenStore'
import type { AuthTokens } from './types'
import type { Client, CreateMySchoolBody, FeeSummaryResponse, ListEnvelope, RaiseSeatRequestBody, SeatRequest } from './ownerTypes'

export function listMySchools(): Promise<ListEnvelope<Client>> {
  return listRequest<ListEnvelope<Client>>('/me/schools')
}

export function createMySchool(body: CreateMySchoolBody): Promise<Client> {
  return request<Client>('/me/schools', { method: 'POST', body })
}

/** Hard-delete an empty school you own (no students / teachers / staff). */
export function deleteMySchool(tenantId: string): Promise<void> {
  return request<void>(`/me/schools/${tenantId}`, { method: 'DELETE', body: { confirm: 'DELETE' } })
}

/** Owner raises a seat-increase request for CATRE to approve. */
export function requestMySchoolSeats(tenantId: string, body: RaiseSeatRequestBody): Promise<SeatRequest> {
  return request<SeatRequest>(`/me/schools/${tenantId}/seat-requests`, { method: 'POST', body })
}

/** Owner's own seat-increase requests (newest first). */
export function listMySchoolSeatRequests(tenantId: string): Promise<SeatRequest[]> {
  return request<SeatRequest[]>(`/me/schools/${tenantId}/seat-requests`)
}

/** Cross-school student fee collection for the signed-in owner's portfolio. */
export async function getMySchoolsFeeSummary(params: { from?: string; to?: string } = {}): Promise<FeeSummaryResponse> {
  return request<FeeSummaryResponse>('/me/schools/fee-summary', { query: params })
}

/** Switch JWT to another school the owner already has a user row for. */
export async function switchSchool(tenantId: string): Promise<AuthTokens> {
  const tokens = await request<AuthTokens>('/me/switch-school', {
    method: 'POST',
    body: { tenant_id: tenantId },
  })
  tokenStore.set(tokens)
  tokenStore.setTenantId(tenantId)
  return tokens
}
