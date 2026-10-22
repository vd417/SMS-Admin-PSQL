/* ============================================================
   SchoolMate — Timetable model + teacher clash detection.
   Pure, UI-free helpers so the builder can detect when a
   teacher is booked in two classes at the same day+period.
   ============================================================ */

export type Cell = { subject: string; teacherId: string }
export type Grid = Record<string, Cell | null>
export type Grids = Record<string, Grid>
export type PeriodBellMap = Record<number, { start: string; end: string }>

/** Stable key for a 0-based day + 0-based period slot. */
export const cellKey = (day: number, period: number): string => `${day}-${period}`

/** Drop teaching slots at or after `periods` (0-based). Keeps a shorter class on the school bell. */
export function clipGridToPeriods(grid: Grid, periods: number): Grid {
  const next: Grid = {}
  for (const [key, cell] of Object.entries(grid)) {
    const p = Number(key.split('-')[1])
    if (Number.isFinite(p) && p >= 0 && p < periods) next[key] = cell
  }
  return next
}

/**
 * Auto-fill a class grid from periods-per-week quotas.
 * Uses a diagonal walk (start subject rotates by day+period) so consecutive
 * periods do not repeat the same Mon–Sat subject row — the old round-robin
 * token list did that whenever subject count ≈ day count.
 * Cells get empty teacherId; the screen assigns teachers via pickTeacher.
 */
export function generateAutoTimetableGrid(
  daysLen: number,
  periods: number,
  subjectNames: string[],
  ppw: Record<string, number>,
): Grid {
  const left: Record<string, number> = {}
  for (const s of subjectNames) left[s] = Math.max(0, Math.floor(ppw[s] ?? 0))
  const capacity = daysLen * periods
  const quotaTotal = subjectNames.reduce((a, s) => a + (left[s] ?? 0), 0)
  const target = Math.min(capacity, quotaTotal)
  const grid: Grid = {}
  if (subjectNames.length === 0 || target === 0) return grid

  let placed = 0
  for (let p = 0; p < periods && placed < target; p++) {
    for (let d = 0; d < daysLen && placed < target; d++) {
      const start = (d + p) % subjectNames.length
      let chosen: string | null = null
      for (let k = 0; k < subjectNames.length; k++) {
        const s = subjectNames[(start + k) % subjectNames.length]
        if ((left[s] ?? 0) > 0) {
          chosen = s
          break
        }
      }
      if (!chosen) continue
      left[chosen]!--
      grid[cellKey(d, p)] = { subject: chosen, teacherId: '' }
      placed++
    }
  }
  return grid
}

// ─── Backend publish reconciliation ─────────────────────────────────────────
// Pure diffing so it can be unit-tested without the API — the screen posts
// one PUT /timetable/replace with ownedClassIds + toCreate (toDeleteIds is
// kept for tests / legacy per-slot sync).

export interface RemoteTimetableSlot {
  id: string
  day: string
  period: number // 1-based, matches the backend's CreateTimetableSlotRequest.Period
  classId: string | null
}

export interface TimetableSyncTarget {
  day: string
  period: number // 1-based
  subject: string | null
  classId: string
  className: string
  teacherId: string | null
  startTime: string | null
  endTime: string | null
}

export interface TimetableSyncPlan {
  toCreate: TimetableSyncTarget[]
  toDeleteIds: string[]
  /** Classes present in the draft grids that resolved to a backend id. */
  ownedClassIds: string[]
}

/** Default Mon–Sat teaching bells (Period 1..8) when Periods tab is empty. */
export const DEFAULT_CLASS_BELL_TIMES: PeriodBellMap = {
  1: { start: '08:15', end: '09:00' },
  2: { start: '09:00', end: '09:45' },
  3: { start: '09:55', end: '10:40' },
  4: { start: '10:40', end: '11:25' },
  5: { start: '12:05', end: '12:50' },
  6: { start: '12:50', end: '13:35' },
  7: { start: '13:35', end: '14:20' },
  8: { start: '14:20', end: '15:05' },
}

/** Map Class-type period rows → 1-based teaching period → start/end. */
export function bellTimesFromPeriodRows(
  rows: Array<{ type: string; start: string; end: string }>,
): PeriodBellMap {
  const out: PeriodBellMap = {}
  let n = 0
  for (const r of rows) {
    if ((r.type ?? '').toLowerCase() !== 'class') continue
    n += 1
    out[n] = { start: r.start, end: r.end }
  }
  return out
}

/**
 * Diffs the local draft (`grids`, keyed by className, 0-based day/period cells)
 * against what the backend currently has for the classes present in `grids`.
 * Slots for classes NOT in `grids` are left alone (this reconciliation only
 * owns the classes the admin is actively publishing). `classIdFor` resolves a
 * grid's className key to its real backend class id — classes with no
 * resolvable id are skipped (nothing to publish them against).
 */
export function planTimetableSync(
  grids: Grids,
  days: string[],
  classIdFor: (className: string) => string | null,
  remote: RemoteTimetableSlot[],
  bellTimes: PeriodBellMap = {},
): TimetableSyncPlan {
  const toCreate: TimetableSyncTarget[] = []
  const ownedClassIds = new Set<string>()

  for (const [className, grid] of Object.entries(grids)) {
    const classId = classIdFor(className)
    if (!classId) continue
    // Only replace classes that still have at least one placed period.
    // Empty / all-null grids must NOT enter ownedClassIds — otherwise publish
    // DELETEs that class's live TimetableSlots and attendance shows "No periods".
    const filled = Object.values(grid).some(Boolean)
    if (!filled) continue
    ownedClassIds.add(classId)
    for (const [key, cell] of Object.entries(grid)) {
      if (!cell) continue
      const [dStr, pStr] = key.split('-')
      const d = Number(dStr)
      const p = Number(pStr)
      if (!days[d]) continue // key from a day index this school doesn't use
      const period = p + 1
      const bell = bellTimes[period]
      toCreate.push({
        day: days[d], period, subject: cell.subject || null,
        classId, className, teacherId: cell.teacherId || null,
        startTime: bell?.start ?? null, endTime: bell?.end ?? null,
      })
    }
  }

  // Anything already on the backend for a class we own, that isn't in the
  // fresh toCreate set, is stale (removed or changed) and must go — we always
  // delete+recreate rather than update-in-place (no update endpoint exists,
  // and the slot count/shape is small enough that this is cheap).
  const toDeleteIds = remote
    .filter((r) => r.classId && ownedClassIds.has(r.classId))
    .map((r) => r.id)

  return { toCreate, toDeleteIds, ownedClassIds: [...ownedClassIds] }
}

/** Rebuild editor grids from live GET /timetable slots (class_name + day + period). */
export function gridsFromRemoteSlots(
  slots: Array<{
    day: string
    period: number
    subject: string | null
    className: string | null
    teacherId?: string | null
    teacherName?: string | null
  }>,
  days: string[],
  teacherIdForName?: (name: string) => string | null,
): Grids {
  const dayIndex = (raw: string): number => {
    const v = raw.trim()
    const short = v.slice(0, 3)
    const i = days.findIndex((d) => d.toLowerCase() === short.toLowerCase() || d.toLowerCase() === v.toLowerCase())
    return i
  }
  const grids: Grids = {}
  for (const s of slots) {
    const className = (s.className ?? '').trim()
    const subject = (s.subject ?? '').trim()
    if (!className || !subject) continue
    const di = dayIndex(s.day)
    const p = Number(s.period) - 1
    if (di < 0 || p < 0) continue
    const tid =
      (s.teacherId && String(s.teacherId)) ||
      (s.teacherName ? teacherIdForName?.(s.teacherName) ?? '' : '') ||
      ''
    grids[className] ??= {}
    grids[className][cellKey(di, p)] = { subject, teacherId: tid }
  }
  return grids
}

export function hasFilledGrid(grids: Grids): boolean {
  return Object.values(grids).some((g) => Object.values(g).some(Boolean))
}

/** Show the builder when periods exist, even if mode was never flipped to `build`. */
export function classTimetableMode(
  mode: 'choice' | 'build' | undefined,
  grid: Grid | undefined,
): 'choice' | 'build' {
  if (grid && Object.values(grid).some(Boolean)) return 'build'
  return mode === 'build' ? 'build' : 'choice'
}

/** Distinct subjects placed on any class grid (for Teacher/Subject views). */
export function subjectsInGrids(grids: Grids): string[] {
  const set = new Set<string>()
  for (const grid of Object.values(grids)) {
    for (const cell of Object.values(grid)) {
      const s = cell?.subject?.trim()
      if (s) set.add(s)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/**
 * Every class OTHER than `exceptClass` in which `teacherId` already teaches at
 * this day+period. Empty array if none. An empty teacherId never clashes.
 */
export function clashingClasses(
  grids: Grids, teacherId: string, day: number, period: number, exceptClass: string,
): string[] {
  if (!teacherId) return []
  const key = cellKey(day, period)
  const out: string[] = []
  for (const [cls, grid] of Object.entries(grids)) {
    if (cls === exceptClass) continue
    const cell = grid[key]
    if (cell && cell.teacherId === teacherId) out.push(cls)
  }
  return out
}

/**
 * The first class OTHER than `exceptClass` in which `teacherId` already teaches
 * at this day+period, or null if none.
 */
export function clashingClass(
  grids: Grids, teacherId: string, day: number, period: number, exceptClass: string,
): string | null {
  return clashingClasses(grids, teacherId, day, period, exceptClass)[0] ?? null
}

/** True if the teacher is booked in another class at this slot. */
export function teacherBusyElsewhere(
  grids: Grids, teacherId: string, day: number, period: number, exceptClass: string,
): boolean {
  return clashingClass(grids, teacherId, day, period, exceptClass) !== null
}

/**
 * Pick a teacher from `roster` for a slot, preferring one free across all other
 * classes. Tries the roster in rotation order from `rotStart`. Falls back to the
 * rotated teacher (a residual clash) if everyone is busy. '' for an empty roster.
 */
export function pickTeacher(
  grids: Grids, roster: string[], day: number, period: number, exceptClass: string, rotStart: number,
): string {
  if (roster.length === 0) return ''
  const n = roster.length
  for (let i = 0; i < n; i++) {
    const cand = roster[(rotStart + i) % n]
    if (!teacherBusyElsewhere(grids, cand, day, period, exceptClass)) return cand
  }
  return roster[rotStart % n]
}

/**
 * The set of cell keys in `cls` whose assigned teacher is double-booked in
 * another class at the same slot.
 */
export function conflictsFor(grids: Grids, cls: string): Set<string> {
  const out = new Set<string>()
  const grid = grids[cls]
  if (!grid) return out
  for (const [key, cell] of Object.entries(grid)) {
    if (!cell || !cell.teacherId) continue
    const [d, p] = key.split('-').map(Number)
    if (teacherBusyElsewhere(grids, cell.teacherId, d, p, cls)) out.add(key)
  }
  return out
}

/** Total assigned periods per teacher across every class. */
export function teacherLoads(grids: Grids): Record<string, number> {
  const out: Record<string, number> = {}
  for (const grid of Object.values(grids)) {
    for (const cell of Object.values(grid)) {
      if (cell && cell.teacherId) out[cell.teacherId] = (out[cell.teacherId] ?? 0) + 1
    }
  }
  return out
}

/** Teacher ids that are double-booked in at least one slot (across all classes). */
export function clashingTeachers(grids: Grids): Set<string> {
  const out = new Set<string>()
  for (const cls of Object.keys(grids)) {
    const grid = grids[cls]
    for (const key of conflictsFor(grids, cls)) {
      const cell = grid[key]
      if (cell?.teacherId) out.add(cell.teacherId)
    }
  }
  return out
}

export interface TeacherSlotEntry { cls: string; subject: string }
export interface SubjectSlotEntry { cls: string; teacherId: string }

/** All of a teacher's placements, keyed by slot (2+ entries = clash). */
export function teacherSchedule(grids: Grids, teacherId: string): Record<string, TeacherSlotEntry[]> {
  const out: Record<string, TeacherSlotEntry[]> = {}
  if (!teacherId) return out
  for (const [cls, grid] of Object.entries(grids)) {
    for (const [key, cell] of Object.entries(grid)) {
      if (cell && cell.teacherId === teacherId) (out[key] ??= []).push({ cls, subject: cell.subject })
    }
  }
  return out
}

/** All placements of a subject, keyed by slot (2+ entries = same-slot in two classes). */
export function subjectSchedule(grids: Grids, subject: string): Record<string, SubjectSlotEntry[]> {
  const out: Record<string, SubjectSlotEntry[]> = {}
  if (!subject) return out
  for (const [cls, grid] of Object.entries(grids)) {
    for (const [key, cell] of Object.entries(grid)) {
      if (cell && cell.subject === subject) (out[key] ??= []).push({ cls, teacherId: cell.teacherId })
    }
  }
  return out
}
