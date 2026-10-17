import { listRequest, request } from './client'
import { config } from './config'
import { tokenStore } from './auth/tokenStore'
import type { ListEnvelope } from './types'

export type InvoiceStatus = 'paid' | 'open' | 'past_due'
export type SubStatus = string

export interface ApiInvoice {
  id: string
  tenant_id: string
  tenant_name: string | null
  plan_name: string | null
  amount: number
  status: InvoiceStatus
  issued: string
  due: string
  paid_on: string | null
}

export interface ApiSubscription {
  id: string
  tenant_id: string
  tenant_name: string | null
  plan_id: string
  plan_name: string | null
  tier: string | null
  status: SubStatus
  current_period_start: string
  current_period_end: string | null
  next_charge: number | null
  seats: number
}

/** Platform-only: GET /subscriptions */
export function listSubscriptions(params: { status?: string; tenant_id?: string } = {}): Promise<ListEnvelope<ApiSubscription>> {
  return listRequest<ListEnvelope<ApiSubscription>>('/subscriptions', { query: params })
}

/** Platform-only: GET /invoices */
export function listInvoices(params: { status?: string; tenant_id?: string } = {}): Promise<ListEnvelope<ApiInvoice>> {
  return listRequest<ListEnvelope<ApiInvoice>>('/invoices', { query: params })
}

/** Owner: invoices for a school they own (billing history). */
export function listMySchoolInvoices(tenantId: string): Promise<ApiInvoice[]> {
  return request<ApiInvoice[]>(`/me/schools/${tenantId}/invoices`)
}

/** Download an invoice PDF (authed blob) and trigger a browser save. `path` is the API route. */
export async function downloadInvoicePdf(path: string, fileName: string): Promise<void> {
  const headers: Record<string, string> = {}
  const token = tokenStore.getAccess()
  if (token) headers.Authorization = `Bearer ${token}`
  const tenant = tokenStore.getTenantId()
  if (tenant) headers['X-Tenant-Id'] = tenant
  const res = await fetch(config.apiBaseUrl + path, { headers })
  if (!res.ok) throw new Error(`Could not download invoice (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Owner invoice PDF route for a school they own. */
export function myInvoicePdfPath(tenantId: string, invoiceId: string): string {
  return `/me/schools/${tenantId}/invoices/${invoiceId}/pdf`
}

/** Platform invoice PDF route. */
export function platformInvoicePdfPath(invoiceId: string): string {
  return `/invoices/${invoiceId}/pdf`
}
