import { request, listRequest } from './client'
import type { Client, CreateClientBody, IncreaseSeatsBody, ListEnvelope, SeatRequest, SeatSettingsBody } from './ownerTypes'

export function listClients(params: { status?: string; tier?: string; q?: string } = {}): Promise<ListEnvelope<Client>> {
  return listRequest<ListEnvelope<Client>>('/clients', { query: params })
}

export function getClient(id: string): Promise<Client> {
  return request<Client>(`/clients/${id}`)
}

export function createClient(body: CreateClientBody): Promise<Client> {
  return request<Client>('/clients', { method: 'POST', body })
}

export function setClientStatus(id: string, status: string, reason?: string): Promise<Client> {
  return request<Client>(`/clients/${id}/status`, { method: 'POST', body: { status, reason } })
}

/** Platform: hard-delete empty school (no students / teachers / staff). */
export function deleteClient(id: string): Promise<void> {
  return request<void>(`/clients/${id}`, { method: 'DELETE', body: { confirm: 'DELETE' } })
}

/** Platform: raise a school's billed seat limit directly (recomputes MRR, prorates per-student). */
export function increaseClientSeats(id: string, body: IncreaseSeatsBody): Promise<Client> {
  return request<Client>(`/clients/${id}/seats`, { method: 'POST', body })
}

/** Platform: update a school's seat policy (auto/manual mode + alert threshold). */
export function updateClientSeatSettings(id: string, body: SeatSettingsBody): Promise<Client> {
  return request<Client>(`/clients/${id}/seat-settings`, { method: 'POST', body })
}

/** Platform: seat-increase requests raised by schools (CATRE review queue). */
export function listSeatRequests(status?: string): Promise<SeatRequest[]> {
  return request<SeatRequest[]>('/seat-requests', { query: status ? { status } : {} })
}

/** Platform: approve a pending seat request (applies the increase). */
export function approveSeatRequest(id: string, note?: string): Promise<SeatRequest> {
  return request<SeatRequest>(`/seat-requests/${id}/approve`, { method: 'POST', body: { note } })
}

/** Platform: reject a pending seat request. */
export function rejectSeatRequest(id: string, note?: string): Promise<SeatRequest> {
  return request<SeatRequest>(`/seat-requests/${id}/reject`, { method: 'POST', body: { note } })
}
