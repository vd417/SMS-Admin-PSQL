import { request } from './client'
import { snakeToCamel } from './mapper'
import { attendanceCalendarDate } from './attendance'

export interface TimetableSlot {
  id: string
  day: string
  period: number
  subject: string | null
  classId: string | null
  className: string | null
  room: string | null
  startTime: string | null
  endTime: string | null
  teacherName: string | null
  teacherId: string | null
}

export interface CreateTimetableSlotInput {
  day: string
  period: number
  subject?: string | null
  classId?: string | null
  className?: string | null
  room?: string | null
  startTime?: string | null
  endTime?: string | null
  teacherId?: string | null
}

export interface TimetableHistoryEntry {
  id: string
  kind: string
  snapshotJson: string | null
  savedAt: string
}

/** Last 5 draft/publish snapshots, newest first. */
export async function listTimetableHistory(): Promise<TimetableHistoryEntry[]> {
  const wire = await request<Record<string, unknown>[] | null>('/class-routine/history')
  if (!Array.isArray(wire)) return []
  return wire.map((row) => snakeToCamel<TimetableHistoryEntry>(row))
}

export async function listTimetable(): Promise<TimetableSlot[]> {
  const wire = await request<Record<string, unknown>[] | null>('/timetable')
  return Array.isArray(wire) ? wire.map((s) => snakeToCamel<TimetableSlot>(s)) : []
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function isoWeekday(isoDate: string): string | null {
  // Period-attendance rows may carry a full UTC datetime (not a bare date) — normalize to the
  // browser-local calendar day first, same as every other attendance date comparison in this app.
  const day = attendanceCalendarDate(isoDate)
  return WEEKDAY_ABBR[new Date(`${day}T00:00:00`).getDay()] ?? null
}

/** Every published timetable slot for this class on this date's weekday, in period order. */
export function timetableSlotsForClassDate(
  slots: TimetableSlot[], classId: string, isoDate: string,
): TimetableSlot[] {
  const weekday = isoWeekday(isoDate)
  if (!weekday) return []
  return slots
    .filter((s) =>
      s.classId === classId
      && typeof s.day === 'string'
      && s.day.slice(0, 3).toLowerCase() === weekday.toLowerCase(),
    )
    .sort((a, b) => a.period - b.period)
}

/** The *current* published timetable slot for this class/period on this date's weekday
 *  (e.g. "2026-09-04" -> Friday -> whatever slot.day matches "Fri"). Returns null if unscheduled
 *  or the timetable hasn't been published for that slot. */
export function findTimetableSlot(
  slots: TimetableSlot[], classId: string, isoDate: string, period: number,
): TimetableSlot | null {
  return timetableSlotsForClassDate(slots, classId, isoDate).find((s) => s.period === period) ?? null
}

/** Just the subject from findTimetableSlot — null if unscheduled/not published. */
export function getTimetableSubject(
  slots: TimetableSlot[], classId: string, isoDate: string, period: number,
): string | null {
  return findTimetableSlot(slots, classId, isoDate, period)?.subject?.trim() || null
}

export async function createTimetableSlot(input: CreateTimetableSlotInput): Promise<TimetableSlot> {
  const wire = await request<Record<string, unknown>>('/timetable', {
    method: 'POST',
    body: {
      day: input.day,
      period: input.period,
      subject: input.subject ?? null,
      class_id: input.classId ?? null,
      class_name: input.className ?? null,
      room: input.room ?? null,
      start_time: input.startTime ?? null,
      end_time: input.endTime ?? null,
      teacher_id: input.teacherId ?? null,
    },
  })
  return snakeToCamel<TimetableSlot>(wire)
}

/** One-shot publish: clear class_ids then insert slots (avoids N× POST/DELETE). */
export async function replaceTimetableSlots(input: {
  classIds: string[]
  slots: CreateTimetableSlotInput[]
}): Promise<void> {
  await request<void>('/timetable/replace', {
    method: 'PUT',
    body: {
      class_ids: input.classIds,
      slots: input.slots.map((s) => ({
        day: s.day,
        period: s.period,
        subject: s.subject ?? null,
        class_id: s.classId ?? null,
        class_name: s.className ?? null,
        room: s.room ?? null,
        start_time: s.startTime ?? null,
        end_time: s.endTime ?? null,
        teacher_id: s.teacherId ?? null,
      })),
    },
  })
}

export async function deleteTimetableSlot(id: string): Promise<void> {
  await request<void>(`/timetable/${id}`, { method: 'DELETE' })
}
