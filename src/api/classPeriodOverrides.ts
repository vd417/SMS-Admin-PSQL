import { request } from './client'
import { snakeToCamel } from './mapper'

/** Class id → teaching periods per day. Missing id means “use the school bell”. */
export type ClassPeriodOverrideMap = Record<string, number>

export async function listClassPeriodOverrides(): Promise<ClassPeriodOverrideMap> {
  const wire = await request<Record<string, unknown>[] | null>('/classes/period-overrides')
  const map: ClassPeriodOverrideMap = {}
  if (!Array.isArray(wire)) return map
  for (const row of wire) {
    const c = snakeToCamel<{ classId?: string; periodCount?: number }>(row)
    const id = c.classId != null ? String(c.classId) : ''
    const n = Number(c.periodCount)
    if (id && Number.isFinite(n)) map[id] = n
  }
  return map
}

/** `null` clears the override so the class inherits the school bell. */
export async function saveClassPeriodOverride(classId: string, periodCount: number | null): Promise<void> {
  const id = classId.trim()
  if (!id) throw new Error('Class id is required')
  await request<unknown>(`/classes/${id}/period-override`, {
    method: 'PUT',
    body: { period_count: periodCount },
  })
}
