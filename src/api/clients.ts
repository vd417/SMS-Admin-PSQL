import { request, listRequest } from './client'
import type { Client, CreateClientBody, IncreaseSeatsBody, ListEnvelope } from './ownerTypes'

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

/** Platform: raise a school's billed seat limit (recomputes MRR, prorates per-student). */
export function increaseClientSeats(id: string, body: IncreaseSeatsBody): Promise<Client> {
  return request<Client>(`/clients/${id}/seats`, { method: 'POST', body })
}
