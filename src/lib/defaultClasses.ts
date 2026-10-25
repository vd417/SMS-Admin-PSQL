/** Default Indian-school structure used across CRM dropdowns when seeded. */
export const DEFAULT_GRADES = [
  'Nursery', 'LKG', 'UKG',
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const

export const DEFAULT_SECTIONS = ['A', 'B', 'C'] as const

export interface DefaultClassSpec {
  name: string
  grade: string
  section: string
  teacherId: string
  students: number
  room: string
}

/** Build the default class specs for the chosen grades and sections.
 *  Defaults to Nursery–XII · A/B/C. Pass an empty `sections` array to create
 *  section-less classes (one row per grade, name = grade). */
export function defaultClassSpecs(
  opts?: { grades?: readonly string[]; sections?: readonly string[] },
): DefaultClassSpec[] {
  const grades = (opts?.grades ?? DEFAULT_GRADES).map((g) => String(g).trim()).filter(Boolean)
  const sections = (opts?.sections ?? DEFAULT_SECTIONS).map((s) => String(s).trim()).filter(Boolean)
  const row = (grade: string, section: string): DefaultClassSpec => ({
    name: section ? `${grade}-${section}` : grade,
    grade,
    section,
    teacherId: '',
    students: 0,
    room: '—',
  })
  if (sections.length === 0) return grades.map((grade) => row(grade, ''))
  return grades.flatMap((grade) => sections.map((section) => row(grade, section)))
}

/** Nursery–XII · A/B/C names for dropdowns. */
export function defaultClassNames(): string[] {
  return defaultClassSpecs().map((c) => c.name)
}

type ClassLike = string | { name?: string; grade?: string; section?: string }

/** Defaults + any live/custom classes (deduped, sorted). Always includes Nursery–XII · A/B/C. */
export function mergeClassNames(live: ClassLike[] | null | undefined): string[] {
  const names = new Set(defaultClassNames())
  for (const c of live ?? []) {
    const n = (typeof c === 'string' ? c : (c.name || `${c.grade ?? ''}-${c.section ?? ''}`)).trim()
    if (n && n !== '-') names.add(n)
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

const ROMAN_TO_NUM: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
}

/** Grade rank Nursery→XII (12) for ascending class lists. */
export function gradeRank(grade: string | undefined | null): number {
  const g = String(grade ?? '').trim()
  if (!g) return 999
  const lower = g.toLowerCase()
  if (lower === 'nursery') return -3
  if (lower === 'lkg') return -2
  if (lower === 'ukg') return -1
  if (ROMAN_TO_NUM[g.toUpperCase()] != null) return ROMAN_TO_NUM[g.toUpperCase()]
  const n = Number(g.replace(/[^0-9]/g, ''))
  if (Number.isFinite(n) && n > 0) return n
  const idx = DEFAULT_GRADES.findIndex((x) => x.toLowerCase() === lower)
  return idx >= 0 ? idx : 500 + g.charCodeAt(0)
}

/** Ascending: Nursery → XII, then section A→C, then name. */
export function compareClassesAscending(
  a: { name?: string; grade?: string; section?: string },
  b: { name?: string; grade?: string; section?: string },
): number {
  const byGrade = gradeRank(a.grade) - gradeRank(b.grade)
  if (byGrade !== 0) return byGrade
  const sa = String(a.section ?? '').trim()
  const sb = String(b.section ?? '').trim()
  if (sa !== sb) return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
  const na = String(a.name || `${a.grade ?? ''}-${a.section ?? ''}`).trim()
  const nb = String(b.name || `${b.grade ?? ''}-${b.section ?? ''}`).trim()
  return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' })
}

/** Compact label for selected grades, e.g. Nursery–XII or VI, VII, VIII. */
export function formatSelectedGrades(selected: Iterable<string>): string {
  const set = new Set([...selected].map((g) => String(g).trim()).filter(Boolean))
  const ordered = DEFAULT_GRADES.filter((g) => set.has(g))
  if (!ordered.length) return ''
  if (ordered.length === 1) return ordered[0]
  const idxs = ordered.map((g) => DEFAULT_GRADES.indexOf(g))
  const consecutive = idxs.every((idx, i) => i === 0 || idx === idxs[i - 1] + 1)
  if (consecutive) return `${ordered[0]}–${ordered[ordered.length - 1]}`
  return ordered.join(', ')
}

/** Exam create: board / curriculum options (school customer curriculum type). */
export const EXAM_CURRICULUM_TYPES = ['CBSE', 'ICSE', 'State Board', 'IB', 'Other'] as const

export type ExamCurriculumType = (typeof EXAM_CURRICULUM_TYPES)[number]

/** Grades line for an exam: "Nursery–XII · CBSE". */
export function formatExamGradesLabel(
  selected: Iterable<string>,
  curriculum?: string | null,
): string {
  const grades = formatSelectedGrades(selected)
  const board = String(curriculum ?? '').trim()
  if (!grades) return board
  if (!board || board === 'Other') return grades
  return `${grades} · ${board}`
}

/**
 * Reverse of formatExamGradesLabel / formatSelectedGrades.
 * "Nursery–XII · CBSE" → all grades Nursery…XII; "VI, VII, VIII" → those three.
 */
export function parseExamGrades(label: string | undefined | null): string[] {
  const raw = String(label ?? '').trim()
  if (!raw) return [...DEFAULT_GRADES]
  const gradesPart = raw.split('·')[0]?.trim() || raw
  if (!gradesPart) return [...DEFAULT_GRADES]

  const range = /^(.+?)[–—-](.+)$/.exec(gradesPart)
  if (range) {
    const a = range[1].trim()
    const b = range[2].trim()
    const ia = DEFAULT_GRADES.findIndex((g) => g.toLowerCase() === a.toLowerCase())
    const ib = DEFAULT_GRADES.findIndex((g) => g.toLowerCase() === b.toLowerCase())
    if (ia >= 0 && ib >= 0 && ia <= ib) return DEFAULT_GRADES.slice(ia, ib + 1).map(String)
  }

  const parts = gradesPart.split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length > 1) {
    const matched = parts
      .map((p) => DEFAULT_GRADES.find((g) => g.toLowerCase() === p.toLowerCase()))
      .filter((g): g is typeof DEFAULT_GRADES[number] => !!g)
    if (matched.length) return matched.map(String)
  }

  const single = DEFAULT_GRADES.find((g) => g.toLowerCase() === gradesPart.toLowerCase())
  if (single) return [single]
  return [...DEFAULT_GRADES]
}
