import { config } from './config'
import { tokenStore } from './auth/tokenStore'
import { request } from './client'
import { camelToSnake, snakeToCamel } from './mapper'
import { browserUtcOffsetMinutes } from './principalAttendance'

export interface SchoolReportCatalogItem {
  key: string
  tab: string
  title: string
  dated: boolean
  note: string
  columns: string[]
  filters: string[]
}

export interface SchoolReportOptions {
  classes: string[]
  sections: string[]
  departments: string[]
  designations: string[]
  roles: string[]
  feeHeads: string[]
  paymentModes: string[]
  paymentStatuses: string[]
  attendanceStatuses: string[]
  routes: string[]
  vehicles: string[]
}

export interface SchoolReportQuery {
  reportKey: string
  fromDate?: string
  toDate?: string
  fromTime?: string
  toTime?: string
  offsetMinutes?: number
  className?: string
  section?: string
  student?: string
  teacher?: string
  employee?: string
  department?: string
  designation?: string
  role?: string
  gender?: string
  feeHead?: string
  paymentMode?: string
  paymentStatus?: string
  attendanceStatus?: string
  route?: string
  vehicle?: string
  subject?: string
  period?: string
  session?: string
  summary?: boolean
  columns?: string[]
  format?: 'xlsx' | 'pdf'
}

export interface SchoolReportChart {
  title: string
  kind: string
  points: { label: string; value: number }[]
}

export interface SchoolReportResult {
  reportKey: string
  title: string
  dated: boolean
  note: string
  schoolName: string
  fromDate: string
  toDate: string
  filters: string
  columns: string[]
  rows: string[][]
  cards: { label: string; value: string }[]
  charts: SchoolReportChart[]
}

export interface SchoolReportSchedule {
  id: string
  reportKey: string
  title: string
  frequency: string
  sendTime: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  utcOffsetMinutes: number
  format: string
  recipients: string
  subject?: string | null
  message?: string | null
  filtersJson: string
  status: string
  nextRunAt: string
  lastRunAt?: string | null
}

export interface SchoolReportRun {
  id: string
  scheduleId: string
  startedAt: string
  finishedAt?: string | null
  status: string
  detail?: string | null
  fromDate?: string | null
  toDate?: string | null
}

export interface SchoolReportEmailResult {
  email: string
  status: string
  detail?: string | null
}

export interface SchoolReportFilters {
  className?: string
  section?: string
  student?: string
  teacher?: string
  employee?: string
  department?: string
  designation?: string
  role?: string
  gender?: string
  feeHead?: string
  paymentMode?: string
  paymentStatus?: string
  attendanceStatus?: string
  route?: string
  vehicle?: string
  subject?: string
  period?: string
  session?: string
  fromDate?: string
  toDate?: string
  fromTime?: string
  toTime?: string
}

function withOffset(query: SchoolReportQuery): SchoolReportQuery {
  return { ...query, offsetMinutes: query.offsetMinutes ?? browserUtcOffsetMinutes() }
}

export function listSchoolReportCatalog(): Promise<SchoolReportCatalogItem[]> {
  return request<unknown>('/school-reports/catalog').then((raw) => snakeToCamel<SchoolReportCatalogItem[]>(raw))
}

export function schoolReportOptions(): Promise<SchoolReportOptions> {
  return request<unknown>('/school-reports/options').then((raw) => snakeToCamel<SchoolReportOptions>(raw))
}

export function runSchoolReport(query: SchoolReportQuery): Promise<SchoolReportResult> {
  return request<unknown>('/school-reports/run', { method: 'POST', body: camelToSnake(withOffset(query)) })
    .then((raw) => snakeToCamel<SchoolReportResult>(raw))
}

export function listReportSchedules(reportKey: string): Promise<SchoolReportSchedule[]> {
  return request<unknown>('/school-reports/schedules', { query: { report_key: reportKey } })
    .then((raw) => snakeToCamel<SchoolReportSchedule[]>(raw))
}

export function saveReportSchedule(body: {
  id?: string
  reportKey: string
  frequency: string
  sendTime: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  format: 'xlsx' | 'pdf'
  recipients: string[]
  subject?: string
  message?: string
  filters?: SchoolReportFilters
}): Promise<SchoolReportSchedule> {
  return request<unknown>('/school-reports/schedules', {
    method: 'POST',
    body: camelToSnake({ ...body, offsetMinutes: browserUtcOffsetMinutes() }),
  }).then((raw) => snakeToCamel<SchoolReportSchedule>(raw))
}

export function pauseReportSchedule(id: string): Promise<SchoolReportSchedule> {
  return request<unknown>(`/school-reports/schedules/${id}/pause`, { method: 'POST' })
    .then((raw) => snakeToCamel<SchoolReportSchedule>(raw))
}

export function resumeReportSchedule(id: string): Promise<SchoolReportSchedule> {
  return request<unknown>(`/school-reports/schedules/${id}/resume`, { method: 'POST' })
    .then((raw) => snakeToCamel<SchoolReportSchedule>(raw))
}

export function runReportScheduleNow(id: string): Promise<SchoolReportEmailResult[]> {
  return request<unknown>(`/school-reports/schedules/${id}/run`, { method: 'POST' })
    .then((raw) => snakeToCamel<SchoolReportEmailResult[]>(raw))
}

export function listReportScheduleRuns(id: string): Promise<SchoolReportRun[]> {
  return request<unknown>(`/school-reports/schedules/${id}/runs`)
    .then((raw) => snakeToCamel<SchoolReportRun[]>(raw))
}

export function emailSchoolReport(query: SchoolReportQuery, recipients: string[], subject: string, message: string, format: 'xlsx' | 'pdf'): Promise<SchoolReportEmailResult[]> {
  return request<unknown>('/school-reports/email', {
    method: 'POST',
    body: camelToSnake({ query: withOffset(query), recipients, subject, message, format }),
  }).then((raw) => snakeToCamel<SchoolReportEmailResult[]>(raw))
}

async function postFile(query: SchoolReportQuery): Promise<{ blob: Blob; fileName: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Client': 'sms-admin' }
  const token = tokenStore.getAccess()
  if (token) headers.Authorization = `Bearer ${token}`
  const tenant = tokenStore.getTenantId()
  if (tenant) headers['X-Tenant-Id'] = tenant
  const res = await fetch(config.apiBaseUrl + '/school-reports/export', {
    method: 'POST',
    headers,
    body: JSON.stringify(camelToSnake(withOffset(query))),
  })
  if (!res.ok) throw new Error(`Could not download the report (${res.status})`)
  const blob = await res.blob()
  const match = /filename="?([^"]+)"?/i.exec(res.headers.get('Content-Disposition') ?? '')
  return { blob, fileName: match?.[1] || 'report' }
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadSchoolReport(query: SchoolReportQuery): Promise<void> {
  const { blob, fileName } = await postFile(query)
  saveBlob(blob, fileName)
}

export async function printSchoolReport(query: SchoolReportQuery): Promise<void> {
  const { blob } = await postFile({ ...query, format: 'pdf' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url)
  if (!win) return
  win.addEventListener('load', () => win.print())
}
