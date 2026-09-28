import { describe, expect, it } from 'vitest'
import { classCellMatches, parseClassKey } from './importClassMatch'

const CLASS_X_A = { name: 'X-A', grade: 'X', section: 'A' }
const CLASS_IX_B = { name: 'IX-B', grade: 'IX', section: 'B' }
const CLASS_NURSERY_A = { name: 'Nursery-A', grade: 'Nursery', section: 'A' }

describe('parseClassKey', () => {
  it('folds Roman and Arabic grades onto one key', () => {
    expect(parseClassKey('X-A')).toEqual({ grade: '10', section: 'A' })
    expect(parseClassKey('10-A')).toEqual({ grade: '10', section: 'A' })
  })

  it('accepts the separators and prefixes real spreadsheets use', () => {
    for (const cell of ['10-A', '10 - A', '10/A', '10 A', '10A', 'Class 10-A', 'Std X A', 'class 10a']) {
      expect(parseClassKey(cell)).toEqual({ grade: '10', section: 'A' })
    }
  })

  it('does not split a Roman grade into a phantom section', () => {
    expect(parseClassKey('XI')).toEqual({ grade: '11', section: '' })
    expect(parseClassKey('IX')).toEqual({ grade: '9', section: '' })
  })

  it('keeps pre-primary grades', () => {
    expect(parseClassKey('Nursery-A')).toEqual({ grade: 'NURSERY', section: 'A' })
    expect(parseClassKey('LKG B')).toEqual({ grade: 'LKG', section: 'B' })
  })
})

describe('classCellMatches', () => {
  it('matches the Arabic spelling of a Roman-named class', () => {
    expect(classCellMatches(CLASS_X_A, '10-A')).toBe(true)
    expect(classCellMatches(CLASS_IX_B, '9-B')).toBe(true)
  })

  it('still matches the exact stored name', () => {
    expect(classCellMatches(CLASS_X_A, 'X-A')).toBe(true)
    expect(classCellMatches(CLASS_NURSERY_A, 'Nursery-A')).toBe(true)
  })

  it('is case- and spacing-insensitive', () => {
    expect(classCellMatches(CLASS_X_A, ' class 10 a ')).toBe(true)
  })

  it('does not match a different section or grade', () => {
    expect(classCellMatches(CLASS_X_A, '10-B')).toBe(false)
    expect(classCellMatches(CLASS_X_A, '11-A')).toBe(false)
    expect(classCellMatches(CLASS_IX_B, '9-A')).toBe(false)
  })

  it('does not match a cell with no section against a sectioned class', () => {
    expect(classCellMatches(CLASS_X_A, '10')).toBe(false)
    expect(classCellMatches(CLASS_X_A, 'X')).toBe(false)
  })

  it('rejects blank and junk cells', () => {
    expect(classCellMatches(CLASS_X_A, '')).toBe(false)
    expect(classCellMatches(CLASS_X_A, '99-Z')).toBe(false)
  })

  it('falls back to the display name when grade/section are absent', () => {
    expect(classCellMatches({ name: 'X-A' }, '10-A')).toBe(true)
  })
})
