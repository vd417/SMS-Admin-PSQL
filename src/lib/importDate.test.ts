import { describe, expect, it } from 'vitest'
import { parseImportDate } from './importDate'

describe('parseImportDate', () => {
  it('returns empty for blank cells', () => {
    expect(parseImportDate(null)).toBe('')
    expect(parseImportDate('')).toBe('')
    expect(parseImportDate('   ')).toBe('')
  })

  it('keeps ISO cells untouched', () => {
    expect(parseImportDate('2015-04-23')).toBe('2015-04-23')
    expect(parseImportDate('2015-04-23T00:00:00.000Z')).toBe('2015-04-23')
  })

  it('reads day-first dd/mm/yyyy — the format Indian school records use', () => {
    expect(parseImportDate('23/04/2015')).toBe('2015-04-23')
    expect(parseImportDate('23-04-2015')).toBe('2015-04-23')
    expect(parseImportDate('23.04.2015')).toBe('2015-04-23')
    expect(parseImportDate('1/5/2015')).toBe('2015-05-01')
  })

  it('reads an ambiguous all-small triple as day-first', () => {
    expect(parseImportDate('04/05/2015')).toBe('2015-05-04')
  })

  it('falls back to month-first when the SECOND number cannot be a month', () => {
    expect(parseImportDate('04/23/2015')).toBe('2015-04-23')
  })

  it('expands two-digit years around a 50 pivot', () => {
    expect(parseImportDate('23/04/15')).toBe('2015-04-23')
    expect(parseImportDate('23/04/98')).toBe('1998-04-23')
  })

  it('reads yyyy/mm/dd when the year comes first', () => {
    expect(parseImportDate('2015/04/23')).toBe('2015-04-23')
  })

  it('reads an Excel serial date', () => {
    expect(parseImportDate('42117')).toBe('2015-04-23')
    expect(parseImportDate(42117)).toBe('2015-04-23')
  })

  it('refuses numbers outside a plausible date window instead of guessing', () => {
    expect(parseImportDate('42')).toBe('')
    expect(parseImportDate('9000000001')).toBe('')
  })

  it('reads spelled-out months', () => {
    expect(parseImportDate('23 April 2015')).toBe('2015-04-23')
    expect(parseImportDate('Apr 23, 2015')).toBe('2015-04-23')
  })

  it('rejects impossible dates rather than rolling them over', () => {
    expect(parseImportDate('31/02/2015')).toBe('')
    expect(parseImportDate('32/01/2015')).toBe('')
    expect(parseImportDate('not a date')).toBe('')
  })
})
