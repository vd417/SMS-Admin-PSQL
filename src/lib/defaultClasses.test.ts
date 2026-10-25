import { describe, it, expect } from 'vitest'
import {
  compareClassesAscending,
  defaultClassSpecs,
  formatExamGradesLabel,
  formatSelectedGrades,
  parseExamGrades,
  gradeRank,
  DEFAULT_GRADES,
} from './defaultClasses'

describe('defaultClassSpecs', () => {
  it('defaults to Nursery–XII × A/B/C', () => {
    const specs = defaultClassSpecs()
    expect(specs).toHaveLength(DEFAULT_GRADES.length * 3)
    expect(specs[0]).toMatchObject({ name: 'Nursery-A', grade: 'Nursery', section: 'A' })
  })

  it('creates only the chosen grades and section set', () => {
    const specs = defaultClassSpecs({ grades: ['I', 'II'], sections: ['A', 'B', 'C', 'D'] })
    expect(specs.map((s) => s.name)).toEqual([
      'I-A', 'I-B', 'I-C', 'I-D', 'II-A', 'II-B', 'II-C', 'II-D',
    ])
  })

  it('creates section-less classes when sections is empty', () => {
    const specs = defaultClassSpecs({ grades: ['Nursery', 'I'], sections: [] })
    expect(specs.map((s) => s.name)).toEqual(['Nursery', 'I'])
    expect(specs.every((s) => s.section === '')).toBe(true)
  })
})

describe('gradeRank', () => {
  it('orders Nursery → XII ascending toward 12', () => {
    expect(gradeRank('Nursery')).toBeLessThan(gradeRank('LKG'))
    expect(gradeRank('UKG')).toBeLessThan(gradeRank('I'))
    expect(gradeRank('IX')).toBeLessThan(gradeRank('X'))
    expect(gradeRank('XI')).toBeLessThan(gradeRank('XII'))
    expect(gradeRank('10')).toBe(10)
    expect(gradeRank('12')).toBe(12)
    expect(gradeRank('XII')).toBe(12)
  })
})

describe('compareClassesAscending', () => {
  it('sorts classes Nursery…XII then section', () => {
    const list = [
      { name: 'XII-A', grade: 'XII', section: 'A' },
      { name: 'IX-B', grade: 'IX', section: 'B' },
      { name: 'IX-A', grade: 'IX', section: 'A' },
      { name: 'Nursery-A', grade: 'Nursery', section: 'A' },
      { name: '10-A', grade: '10', section: 'A' },
    ]
    const sorted = [...list].sort(compareClassesAscending).map((c) => c.name)
    expect(sorted).toEqual(['Nursery-A', 'IX-A', 'IX-B', '10-A', 'XII-A'])
  })
})

describe('formatSelectedGrades', () => {
  it('collapses consecutive Nursery→XII to an en-dash range', () => {
    expect(formatSelectedGrades(DEFAULT_GRADES)).toBe('Nursery–XII')
    expect(formatSelectedGrades(['I', 'II', 'III', 'IV', 'V'])).toBe('I–V')
  })

  it('lists non-consecutive grades', () => {
    expect(formatSelectedGrades(['Nursery', 'VI', 'XII'])).toBe('Nursery, VI, XII')
  })
})

describe('formatExamGradesLabel', () => {
  it('appends curriculum type when set', () => {
    expect(formatExamGradesLabel(['VI', 'VII', 'VIII'], 'CBSE')).toBe('VI–VIII · CBSE')
    expect(formatExamGradesLabel(DEFAULT_GRADES, 'ICSE')).toBe('Nursery–XII · ICSE')
    expect(formatExamGradesLabel(['XII'], 'Other')).toBe('XII')
  })
})

describe('parseExamGrades', () => {
  it('expands Nursery–XII · CBSE to every grade', () => {
    expect(parseExamGrades('Nursery–XII · CBSE')).toEqual([...DEFAULT_GRADES])
  })

  it('expands a mid range', () => {
    expect(parseExamGrades('VI–VIII · CBSE')).toEqual(['VI', 'VII', 'VIII'])
  })

  it('expands VI–X', () => {
    expect(parseExamGrades('VI–X')).toEqual(['VI', 'VII', 'VIII', 'IX', 'X'])
  })

  it('parses a comma list', () => {
    expect(parseExamGrades('Nursery, VI, XII')).toEqual(['Nursery', 'VI', 'XII'])
  })
})
