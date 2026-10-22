/* Per-class subject lists — live API with optional in-memory cache (no localStorage). */
import { request } from './client'
import { tokenStore } from './auth/tokenStore'
import { loadPublishEnvelope } from '@/lib/academicsPublish'
import type { SchoolClass } from './classes'

/** Map of class key (id preferred, else name) → subject names. */
export type ClassSubjectsMap = Record<string, string[]>

export const CLASS_SUBJECTS_CHANGED = 'sms-class-subjects-changed'

/** Session cache populated by hydrate / successful list / save. */
const memoryByTenant = new Map<string, ClassSubjectsMap>()

function tenantId(): string {
  return tokenStore.getTenantId() || 'default'
}

function memoryMap(): ClassSubjectsMap {
  const tid = tenantId()
  let map = memoryByTenant.get(tid)
  if (!map) {
    map = {}
    memoryByTenant.set(tid, map)
  }
  return map
}

function notifyChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(CLASS_SUBJECTS_CHANGED))
  } catch {
    /* SSR / non-browser */
  }
}

function normalizeNames(list: unknown): string[] {
  if (!Array.isArray(list)) {
    if (typeof list === 'string') {
      return [...new Set(list.split(',').map((s) => s.trim()).filter(Boolean))]
    }
    return []
  }
  const out: string[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      const n = item.trim()
      if (n) out.push(n)
      continue
    }
    if (item && typeof item === 'object') {
      const row = item as Record<string, unknown>
      const n = String(row.name ?? row.subject ?? row.title ?? '').trim()
      if (n) out.push(n)
    }
  }
  return [...new Set(out)]
}

/** Extract subject names from a class wire / API payload. */
export function parseSubjectsFromClassWire(wire: Record<string, unknown>): string[] {
  if (Array.isArray(wire.subjects)) return normalizeNames(wire.subjects)
  if (Array.isArray(wire.subject_names)) return normalizeNames(wire.subject_names)
  if (typeof wire.subjects === 'string') return normalizeNames(wire.subjects)
  if (typeof wire.subject === 'string') return normalizeNames(wire.subject)
  return []
}

export function loadClassSubjectsMap(): ClassSubjectsMap {
  return { ...memoryMap() }
}

export function saveClassSubjectsMap(map: ClassSubjectsMap): ClassSubjectsMap {
  const next: ClassSubjectsMap = {}
  for (const [k, v] of Object.entries(map)) {
    const key = String(k).trim()
    if (!key) continue
    next[key] = normalizeNames(v)
  }
  memoryByTenant.set(tenantId(), next)
  notifyChanged()
  return { ...next }
}

export function classSubjectsKey(classId: string | undefined | null, className: string): string {
  const id = (classId ?? '').trim()
  if (id) return id
  return className.trim()
}

/** Mapped subjects only — never invents from the full catalog. Sync; [] if not hydrated. */
export function getClassSubjects(classId: string | undefined | null, className: string): string[] {
  const map = memoryMap()
  const id = (classId ?? '').trim()
  const name = className.trim()
  if (id && map[id]?.length) return [...map[id]]
  if (name && map[name]?.length) return [...map[name]]
  return []
}

export function setClassSubjects(
  classId: string | undefined | null,
  className: string,
  subjects: string[],
): ClassSubjectsMap {
  const map = { ...memoryMap() }
  const key = classSubjectsKey(classId, className)
  const list = normalizeNames(subjects)
  const prev = (key && map[key]) || []
  const same = prev.length === list.length && prev.every((s, i) => s === list[i])
  if (same) return { ...map }
  if (!list.length) {
    delete map[key]
    if (className.trim() && className.trim() !== key) delete map[className.trim()]
  } else {
    map[key] = list
    const name = className.trim()
    if (name && name !== key) map[name] = list
  }
  return saveClassSubjectsMap(map)
}

/**
 * Prefer API subjects on each class row; update in-memory cache only.
 */
export function hydrateClassSubjectsFromClasses(classes: SchoolClass[]): ClassSubjectsMap {
  const map = { ...memoryMap() }
  let changed = false
  for (const c of classes) {
    const id = (c.id ?? '').trim()
    const name = (c.name || `${c.grade}-${c.section}`).trim()
    const fromApi = normalizeNames(c.subjects ?? [])
    if (!fromApi.length) continue
    const key = id || name
    if (!key) continue
    const prev = map[key] ?? []
    const same = prev.length === fromApi.length && prev.every((s, i) => s === fromApi[i])
    if (!same) {
      map[key] = fromApi
      if (name && name !== key) map[name] = fromApi
      changed = true
    }
  }
  return changed ? saveClassSubjectsMap(map) : map
}

/**
 * Subjects for one class.
 * - prefer mapped list
 * - optional catalog fallback (timetable generate when unmapped)
 */
export function subjectsForClass(
  classId: string | undefined | null,
  className: string,
  catalog: string[],
  opts?: { fallbackCatalog?: boolean },
): string[] {
  const assigned = getClassSubjects(classId, className)
  if (assigned.length) return assigned
  if (opts?.fallbackCatalog === false) return []
  return catalog
}

/** Union of mapped subjects across many classes (first-seen order). */
export function unionMappedSubjects(
  classes: Array<{ id?: string | null; name: string }>,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of classes) {
    for (const s of getClassSubjects(c.id, c.name)) {
      if (!seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
  }
  return out
}

/**
 * GET /classes/{id}/subjects — returns names.
 * Fail closed on 404/405 (no localStorage fallback).
 */
export async function listClassSubjects(classId: string): Promise<string[]> {
  const id = classId.trim()
  if (!id) return []
  const data = await request<unknown>(`/classes/${id}/subjects`)
  let names: string[] = []
  if (Array.isArray(data)) names = normalizeNames(data)
  else if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>
    if (Array.isArray(row.subjects)) names = normalizeNames(row.subjects)
    else if (Array.isArray(row.data)) names = normalizeNames(row.data)
  }
  setClassSubjects(id, '', names)
  return names
}

/**
 * PUT /classes/{id}/subjects with `{ subjects: string[] }`.
 * Requires classId; updates in-memory cache after successful API write.
 */
export async function saveClassSubjects(
  classId: string,
  className: string,
  subjects: string[],
): Promise<string[]> {
  const id = classId.trim()
  const list = normalizeNames(subjects)
  if (!id) {
    throw new Error('Class id is required')
  }
  const saved = await request<unknown>(`/classes/${id}/subjects`, {
    method: 'PUT',
    body: { subjects: list },
  })
  const fromApi = Array.isArray(saved) ? normalizeNames(saved) : list
  setClassSubjects(id, className, fromApi)
  return fromApi
}

/** Class may use the full school bell, or stop after 5, 6, or 8 teaching periods. */
export const CLASS_PERIOD_CHOICES = [5, 6, 8] as const

export function periodChoicesForSchool(schoolPeriods: number): number[] {
  const school = schoolPeriods > 0 ? schoolPeriods : 8
  return CLASS_PERIOD_CHOICES.filter((n) => n <= school)
}

/** No override uses the school bell. An override cannot ask for a period the bell does not have. */
export function effectiveClassPeriods(schoolPeriods: number, override: number | null | undefined): number {
  const school = schoolPeriods > 0 ? schoolPeriods : 8
  if (override == null) return school
  if (!CLASS_PERIOD_CHOICES.includes(override as (typeof CLASS_PERIOD_CHOICES)[number])) return school
  return Math.min(override, school)
}

const GRADE_ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
}

export function suggestedClassPeriods(grade: string, schoolPeriods: number): number {
  const token = grade.trim().toUpperCase()
  const n = GRADE_ROMAN[token] ?? (Number.isFinite(Number(token)) && Number(token) > 0 ? Number(token) : null)
  let want = 6
  if (n != null && n >= 5 && n <= 8) want = 8
  else if (n != null && n >= 9 && n <= 12) want = 5
  const choices = periodChoicesForSchool(schoolPeriods)
  if (choices.includes(want)) return want
  return choices[choices.length - 1] ?? (schoolPeriods > 0 ? schoolPeriods : 8)
}

/** How many teaching (Class) periods are in the Periods schedule. */
export function teachingPeriodCount(fallback = 8): number {
  const env = loadPublishEnvelope<Array<{ type?: string }>>('periods')
  const rows = env.published ?? env.draft
  if (!Array.isArray(rows) || rows.length === 0) return fallback
  const n = rows.filter((r) => String(r?.type ?? '').toLowerCase() === 'class').length
  return n > 0 ? n : fallback
}

/** Soft match: class subjects should equal teaching periods (e.g. 8 periods → 8 subjects). */
export function subjectsMatchPeriodsHint(subjectCount: number, periodCount: number): string {
  if (periodCount <= 0) return 'Add Class periods under Academics → Periods first.'
  if (subjectCount === 0) return `Pick ${periodCount} subjects to match your ${periodCount} periods.`
  if (subjectCount === periodCount) return `Ready — ${subjectCount} subjects match ${periodCount} periods.`
  if (subjectCount < periodCount) return `${subjectCount} of ${periodCount} subjects — add ${periodCount - subjectCount} more to match periods.`
  return `${subjectCount} subjects for ${periodCount} periods — remove ${subjectCount - periodCount} for a 1:1 match.`
}

/** Test helper: clear in-memory cache for the active tenant. */
export function __resetClassSubjectsMemoryForTests(): void {
  memoryByTenant.clear()
}
