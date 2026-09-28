/** Grade tokens this app ships as its default structure (defaultClasses.ts) are ROMAN —
 *  I, II, III … XII. A real school's exported spreadsheet almost always writes the same
 *  grades in Arabic — 1, 2, 3 … 12, often as "Class 10 - A" or "10A". Matching the raw cell
 *  text against the class name character for character therefore failed on data that was
 *  perfectly correct, which is what produced the
 *  `Class + Section "10-A" was not found` errors across a whole uploaded file. */
const ROMAN_BY_NUMBER = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const

const NUMBER_BY_ROMAN: Record<string, number> = Object.fromEntries(
  ROMAN_BY_NUMBER.map((r, n) => [r, n]).filter(([r]) => r !== ''),
) as Record<string, number>

/** Words schools prefix a grade with. Stripped so "Class 10-A", "Std X A" and "10-A" all
 *  reduce to the same key. */
const GRADE_PREFIX = /^(class|grade|std|standard)\b[\s.:-]*/i

export interface ClassKey {
  grade: string
  section: string
}

/** Canonical grade token: Arabic and Roman both collapse to the Arabic number, and the
 *  pre-primary names collapse to lowercase. Anything else is kept as uppercased text so a
 *  school's own custom grade still matches itself exactly. */
function canonicalGrade(raw: string): string {
  // Trailing separator debris: the split below is greedy, so "10 - A" hands the grade side
  // over as "10 -". Stripping here keeps that one rule in one place.
  const g = raw.trim().replace(GRADE_PREFIX, '').replace(/^[-–—_/\|.\s]+|[-–—_/\|.\s]+$/g, '').trim()
  if (!g) return ''
  const upper = g.toUpperCase()
  if (NUMBER_BY_ROMAN[upper] != null) return String(NUMBER_BY_ROMAN[upper])
  if (/^\d{1,2}$/.test(upper)) {
    const n = Number(upper)
    // Only grades this app actually has a Roman spelling for are folded onto the number;
    // a "0" or "45" stays literal so it can never collide with a real grade.
    return n >= 1 && n <= 12 ? String(n) : upper
  }
  return upper
}

/** Splits a raw "Class + Section" cell (or a class's own name) into canonical parts.
 *  Handles "X-A", "10 - A", "Class 10/A", "10A" and a bare "X" with no section. */
export function parseClassKey(raw: string): ClassKey {
  const cleaned = String(raw ?? '').trim().replace(GRADE_PREFIX, '').trim()
  if (!cleaned) return { grade: '', section: '' }

  const separated = cleaned.match(/^(.*\S)\s*[-–—_/\|.\s]\s*([A-Za-z0-9]{1,3})$/)
  if (separated) {
    return { grade: canonicalGrade(separated[1]), section: separated[2].trim().toUpperCase() }
  }
  // No separator: "10A" / "12B". Only split a DIGIT run followed by letters — splitting a
  // letters-only token would turn the Roman "XI" into grade X + section I.
  const glued = cleaned.match(/^(\d{1,2})\s*([A-Za-z])$/)
  if (glued) return { grade: canonicalGrade(glued[1]), section: glued[2].toUpperCase() }

  return { grade: canonicalGrade(cleaned), section: '' }
}

/** The class key for a live class record: its explicit grade/section when the server supplies
 *  them, else whatever its display name parses to. */
export function classRecordKey(c: { name?: string | null; grade?: string | null; section?: string | null }): ClassKey {
  const grade = (c.grade ?? '').trim()
  const section = (c.section ?? '').trim()
  if (grade) return { grade: canonicalGrade(grade), section: section.toUpperCase() }
  return parseClassKey(c.name ?? '')
}

/** True when an uploaded cell names the same class as this record — "10-A", "X-A",
 *  "Class 10 A" and "10a" all match a class stored as grade X / section A. A cell with no
 *  section never matches a sectioned class (silently enrolling a child into whichever
 *  section happened to sort first would be worse than an error the admin can see). */
export function classCellMatches(
  c: { name?: string | null; grade?: string | null; section?: string | null },
  cell: string,
): boolean {
  const want = parseClassKey(cell)
  if (!want.grade) return false
  const have = classRecordKey(c)
  return have.grade === want.grade && have.section === want.section
}
