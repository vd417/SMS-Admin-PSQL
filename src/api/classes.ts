import { request, listRequest } from './client'
import { snakeToCamel } from './mapper'
import { defaultClassSpecs } from '@/lib/defaultClasses'

export interface SchoolClass {
  id?: string
  name: string
  grade: string
  section: string
  teacherId: string
  students: number
  room: string
  /** Subject names mapped to this class (from API when present). */
  subjects?: string[]
}

function parseSubjectNames(wire: Record<string, unknown>): string[] | undefined {
  const raw = wire.subjects ?? wire.subject_names ?? wire.subject
  if (raw == null) return undefined
  if (typeof raw === 'string') {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
    return list.length ? [...new Set(list)] : []
  }
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const n = item.trim()
      if (n) out.push(n)
    } else if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      const n = String(row.name ?? row.subject ?? '').trim()
      if (n) out.push(n)
    }
  }
  return [...new Set(out)]
}

/** Map API class row (class_teacher_id / student_count) to UI SchoolClass. */
export function toSchoolClass(wire: Record<string, unknown>): SchoolClass {
  const c = snakeToCamel<Record<string, unknown>>(wire)
  const subjects = parseSubjectNames(wire) ?? parseSubjectNames(c as Record<string, unknown>)
  return {
    id: c.id != null ? String(c.id) : undefined,
    name: String(c.name ?? ''),
    grade: String(c.grade ?? ''),
    section: String(c.section ?? ''),
    teacherId: String(c.classTeacherId ?? c.teacherId ?? ''),
    students: Number(c.studentCount ?? c.students ?? 0),
    room: String(c.room ?? '—') || '—',
    ...(subjects ? { subjects } : {}),
  }
}

function listRows(json: unknown): Record<string, unknown>[] {
  if (Array.isArray(json)) return json as Record<string, unknown>[]
  if (json && typeof json === 'object') {
    const data = (json as { data?: unknown }).data
    if (Array.isArray(data)) return data as Record<string, unknown>[]
  }
  return []
}

export async function listClasses(): Promise<SchoolClass[]> {
  const env = await listRequest<unknown>('/classes')
  return listRows(env).map(toSchoolClass)
}

export async function createClass(c: SchoolClass): Promise<SchoolClass> {
  const body: Record<string, unknown> = {
    name: c.name,
    grade: c.grade,
    section: c.section,
    subject: null as string | null,
    room: c.room === '—' ? null : c.room,
    class_teacher_id: c.teacherId || null,
  }
  if (c.subjects?.length) body.subjects = c.subjects
  const wire = await request<Record<string, unknown>>('/classes', { method: 'POST', body })
  return toSchoolClass(wire)
}

export interface UpdateClassPatch {
  name?: string
  grade?: string
  section?: string
  room?: string
  teacherId?: string | null
  subjects?: string[]
}

export async function updateClass(id: string, patch: UpdateClassPatch): Promise<SchoolClass> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.grade !== undefined) body.grade = patch.grade
  if (patch.section !== undefined) body.section = patch.section
  if (patch.room !== undefined) body.room = patch.room === '—' ? '' : patch.room
  if (patch.teacherId === null) body.clear_class_teacher = true
  else if (patch.teacherId !== undefined) body.class_teacher_id = patch.teacherId || null
  if (patch.subjects !== undefined) body.subjects = patch.subjects
  const wire = await request<Record<string, unknown>>(`/classes/${id}`, { method: 'PATCH', body })
  return toSchoolClass(wire)
}

/**
 * Ensure the chosen default classes exist for the school (defaults to Nursery–XII · A/B/C
 * when no opts are given). Skips names already present. Returns how many were newly created.
 */
export async function ensureDefaultClasses(
  existing?: SchoolClass[],
  opts?: { grades?: readonly string[]; sections?: readonly string[] },
): Promise<number> {
  const current = existing ?? await listClasses()
  const have = new Set(
    current.map((c) => (c.name || `${c.grade}-${c.section}`).trim().toLowerCase()).filter(Boolean),
  )
  const missing = defaultClassSpecs(opts).filter((c) => !have.has(c.name.toLowerCase()))
  let created = 0
  for (const c of missing) {
    await createClass(c)
    created += 1
  }
  return created
}
