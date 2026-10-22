import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getClassSubjects, setClassSubjects, subjectsForClass, loadClassSubjectsMap,
  subjectsMatchPeriodsHint, hydrateClassSubjectsFromClasses, unionMappedSubjects,
  parseSubjectsFromClassWire, listClassSubjects, saveClassSubjects,
  effectiveClassPeriods, periodChoicesForSchool, suggestedClassPeriods,
  __resetClassSubjectsMemoryForTests,
} from './classSubjects'
import { ApiError } from './ApiError'
import type { SchoolClass } from './classes'

beforeEach(() => {
  localStorage.clear()
  __resetClassSubjectsMemoryForTests()
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('class period override', () => {
  it('inherits the school bell until a class overrides it', () => {
    expect(effectiveClassPeriods(8, null)).toBe(8)
    expect(effectiveClassPeriods(8, 5)).toBe(5)
    expect(effectiveClassPeriods(8, 6)).toBe(6)
    expect(effectiveClassPeriods(6, 8)).toBe(6)
    expect(periodChoicesForSchool(8)).toEqual([5, 6, 8])
    expect(periodChoicesForSchool(6)).toEqual([5, 6])
  })

  it('suggests 8 for grades 5–8 and 5 for grades 9–12', () => {
    expect(suggestedClassPeriods('VII', 8)).toBe(8)
    expect(suggestedClassPeriods('9', 8)).toBe(5)
    expect(suggestedClassPeriods('XI', 8)).toBe(5)
    expect(suggestedClassPeriods('2', 8)).toBe(6)
  })
})

describe('classSubjects', () => {
  it('stores and returns subjects by class id in memory', () => {
    setClassSubjects('c1', 'IV-B', ['Math', 'English'])
    expect(getClassSubjects('c1', 'IV-B')).toEqual(['Math', 'English'])
    expect(loadClassSubjectsMap().c1).toEqual(['Math', 'English'])
    expect(localStorage.getItem('sms_class_subjects:default')).toBeNull()
  })

  it('falls back to catalog when class has no subjects', () => {
    expect(subjectsForClass(undefined, 'IV-B', ['Science', 'Hindi'])).toEqual(['Science', 'Hindi'])
  })

  it('can refuse catalog fallback for exams', () => {
    expect(subjectsForClass('c9', 'IV-B', ['Science', 'Hindi'], { fallbackCatalog: false })).toEqual([])
  })

  it('prefers assigned subjects over catalog', () => {
    setClassSubjects('c1', 'IV-B', ['Art'])
    expect(subjectsForClass('c1', 'IV-B', ['Science', 'Hindi'])).toEqual(['Art'])
  })

  it('unions mapped subjects across multiple classes', () => {
    setClassSubjects('c1', 'VI-A', ['Math', 'English'])
    setClassSubjects('c2', 'VI-B', ['English', 'Science'])
    expect(unionMappedSubjects([
      { id: 'c1', name: 'VI-A' },
      { id: 'c2', name: 'VI-B' },
    ])).toEqual(['Math', 'English', 'Science'])
  })

  it('hydrates from API class.subjects without wiping other mappings', () => {
    setClassSubjects('local', 'X-A', ['Art'])
    hydrateClassSubjectsFromClasses([
      { id: 'c1', name: 'VI-A', grade: 'VI', section: 'A', teacherId: '', students: 0, room: '—', subjects: ['Math', 'Hindi'] },
    ] as SchoolClass[])
    expect(getClassSubjects('c1', 'VI-A')).toEqual(['Math', 'Hindi'])
    expect(getClassSubjects('local', 'X-A')).toEqual(['Art'])
  })

  it('parses subject names from wire shapes', () => {
    expect(parseSubjectsFromClassWire({ subjects: ['Math', 'Sci'] })).toEqual(['Math', 'Sci'])
    expect(parseSubjectsFromClassWire({ subjects: [{ name: 'English' }] })).toEqual(['English'])
    expect(parseSubjectsFromClassWire({ subject: 'Math, Hindi' })).toEqual(['Math', 'Hindi'])
  })

  it('describes period ↔ subject match', () => {
    expect(subjectsMatchPeriodsHint(0, 8)).toMatch(/Pick 8 subjects/)
    expect(subjectsMatchPeriodsHint(8, 8)).toMatch(/Ready/)
    expect(subjectsMatchPeriodsHint(5, 8)).toMatch(/add 3 more/)
  })

  it('GETs /classes/{id}/subjects and caches in memory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: [{ name: 'Math' }, { name: 'Science' }],
    })))
    const names = await listClassSubjects('c1')
    expect(names).toEqual(['Math', 'Science'])
    expect(getClassSubjects('c1', '')).toEqual(['Math', 'Science'])
  })

  it('trusts an empty API list instead of the memory map', async () => {
    setClassSubjects('c1', 'VI-A', ['Hindi'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: [] })))
    expect(await listClassSubjects('c1')).toEqual([])
  })

  it('fails closed when /classes/{id}/subjects is 404', async () => {
    setClassSubjects('c1', 'VI-A', ['Hindi'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'x' } }, 404)))
    await expect(listClassSubjects('c1')).rejects.toBeInstanceOf(ApiError)
  })

  it('PUTs subjects and caches the saved list in memory', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: ['Math', 'English'] })))
    await saveClassSubjects('c1', 'VI-A', ['Math', 'English'])
    expect(getClassSubjects('c1', 'VI-A')).toEqual(['Math', 'English'])
  })

  it('requires class id for save', async () => {
    await expect(saveClassSubjects('', 'VI-A', ['Math'])).rejects.toThrow('Class id is required')
  })

  it('does not keep a memory map when PUT fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: { code: 'not_found', message: 'x' } }, 404)))
    await expect(saveClassSubjects('c1', 'VI-A', ['Math', 'English'])).rejects.toThrow()
    expect(getClassSubjects('c1', 'VI-A')).toEqual([])
  })
})
