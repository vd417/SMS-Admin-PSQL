import { listRequest, request } from './client'
import { snakeToCamel, camelToSnake } from './mapper'
import type { AppNotification } from '@/types'

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

export async function listNotifications(): Promise<AppNotification[]> {
  const env = await listRequest<ListEnvelope>('/notifications')
  return env.data.map((n) => snakeToCamel<AppNotification>(n))
}

/** POST /v1/notifications/read — marks the signed-in user's notices read. */
export async function markNotificationsRead(): Promise<void> {
  await request<unknown>('/notifications/read', { method: 'POST' })
}

export interface CreateNotificationInput {
  title: string
  body?: string
  icon?: string
  tone?: string
}

export interface AppointmentNoticeResult {
  notified: number
  parentNotified: boolean
  teacherNotified: boolean
}

/** Desk appointment: principal app, the teacher when one is chosen, the parent login, and school CRM users. */
export async function notifyAppointment(input: {
  parentName: string
  parentPhone?: string
  with: string
  teacherUserId?: string
  teacherName?: string
  when: string
  reason?: string
}): Promise<AppointmentNoticeResult> {
  const wire = await request<Record<string, unknown>>('/front-office/appointments/notify', {
    method: 'POST',
    body: camelToSnake(input),
  })
  return snakeToCamel<AppointmentNoticeResult>(wire)
}

/** Drops a bell-icon notification for every staff member in the tenant (no userId = broadcast). */
export async function createNotification(input: CreateNotificationInput): Promise<AppNotification> {
  const wire = await request<unknown>('/notifications', {
    method: 'POST',
    body: camelToSnake({
      title: input.title.trim(),
      body: input.body?.trim() || undefined,
      icon: input.icon || 'bell',
      tone: input.tone || 'info',
    }),
  })
  return snakeToCamel<AppNotification>(wire as Record<string, unknown>)
}
