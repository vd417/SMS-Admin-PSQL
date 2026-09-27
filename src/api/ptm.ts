/* Parent-Teacher Meetings — admin API (GET/POST/DELETE /v1/ptm). */
import { request } from './client'
import { snakeToCamel, camelToSnake } from './mapper'

export type PtmStatus = 'pending' | 'confirmed'

export interface PtmItem {
  id: string
  date: string
  time: string
  teacher: string
  subject: string | null
  studentId: string
  mode: string
  status: PtmStatus
  studentName: string
  teacherId: string | null
}

export interface PtmFilters {
  status?: string
  from?: string
  to?: string
  teacherId?: string
  studentId?: string
}

export interface CreatePtmInput {
  studentId: string
  teacherId: string
  subject?: string
  date: string
  time: string
  mode: string
}

function toPtm(row: Record<string, unknown>): PtmItem {
  const c = snakeToCamel<Record<string, unknown>>(row)
  return {
    id: String(c.id ?? ''),
    date: String(c.date ?? ''),
    time: String(c.time ?? ''),
    teacher: String(c.teacher ?? ''),
    subject: c.subject != null ? String(c.subject) : null,
    studentId: String(c.child ?? ''),
    mode: String(c.mode ?? ''),
    status: (String(c.status ?? 'pending')) as PtmStatus,
    studentName: c.studentName != null ? String(c.studentName) : '',
    teacherId: c.teacherId != null ? String(c.teacherId) : null,
  }
}

export async function listPtm(filters: PtmFilters = {}): Promise<PtmItem[]> {
  const query: Record<string, string> = {}
  if (filters.status) query.status = filters.status
  if (filters.from) query.from = filters.from
  if (filters.to) query.to = filters.to
  if (filters.teacherId) query.teacher_id = filters.teacherId
  if (filters.studentId) query.student_id = filters.studentId
  const rows = await request<Record<string, unknown>[]>('/ptm', {
    query: Object.keys(query).length ? query : undefined,
  })
  return (rows ?? []).map(toPtm)
}

export async function createPtm(input: CreatePtmInput): Promise<PtmItem> {
  if (!input.studentId?.trim()) throw new Error('Student is required')
  if (!input.teacherId?.trim()) throw new Error('Teacher is required')
  const payload = camelToSnake({
    studentId: input.studentId,
    teacherId: input.teacherId,
    subject: input.subject?.trim() || undefined,
    date: input.date,
    time: input.time,
    mode: input.mode,
  })
  const wire = await request<Record<string, unknown>>('/ptm', { method: 'POST', body: payload })
  return toPtm(wire)
}

export async function deletePtm(id: string): Promise<void> {
  if (!id) throw new Error('Meeting id is required')
  await request<void>(`/ptm/${id}`, { method: 'DELETE' })
}
