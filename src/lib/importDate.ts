import { toDateInputValue } from './dateInput'

/** Excel serial-date epoch. Excel counts day 1 = 1900-01-01 but also believes 1900 was a
 *  leap year, so the usable epoch for every date after 1900-02-28 is 1899-12-30. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const MS_PER_DAY = 86_400_000

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 9999) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Two-digit years are only ever seen in hand-typed spreadsheet cells. For the dates this app
 *  parses (a student's birth date, an admission date) a pivot at 50 is unambiguous: '15' is
 *  2015, never 1915; '98' is 1998, never 2098. */
function expandYear(y: number): number {
  if (y >= 1000) return y
  return y < 50 ? 2000 + y : 1900 + y
}

/** Parses ONE date cell from an uploaded bulk-import file into the app's YYYY-MM-DD form,
 *  or '' when the cell holds nothing this app is willing to guess at.
 *
 *  toDateInputValue() (used everywhere else) is deliberately narrow: it takes ISO, then hands
 *  anything else to `new Date(s)`, whose only non-ISO format is US month-first. That is right
 *  for API values, which are always ISO — but a real school's spreadsheet holds "23/04/2015"
 *  and Excel-serial numbers, both of which `new Date()` reads as Invalid Date. Every such row
 *  was landing in Preview as "Invalid date of birth" even though the cell held a perfectly
 *  real date, which is why this parser exists rather than a widening of toDateInputValue():
 *  the day-first reading of an ambiguous "04/05/2015" is correct for an import file and wrong
 *  for the rest of the app, so the two parsers must stay separate.
 *
 *  Ambiguity rule: with both numbers <= 12 the cell is read DAY-first (the convention across
 *  Indian school records, and what this CRM's own template prints). When one number is > 12
 *  it can only be the day, so the cell is read unambiguously whichever way round it is. */
export function parseImportDate(raw: unknown): string {
  if (raw == null) return ''
  const s = String(raw).trim()
  if (!s) return ''

  // ISO / ISO-datetime first — identical to toDateInputValue, so an already-clean cell and an
  // API value parse to the same string through either function.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const isoPrefix = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoPrefix) {
    const [, y, m, d] = isoPrefix
    return isRealDate(+y, +m, +d) ? iso(+y, +m, +d) : ''
  }

  // Excel serial. XLSX cells typed as Date come through the parser as a bare number, and a
  // CSV exported from such a sheet sometimes carries the serial verbatim. Bounded to a
  // plausible date window (1901-01-01 .. 2099-12-31) so a stray "42" or a phone-like number
  // is never silently read as a date.
  if (/^\d{3,6}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s))
    if (serial >= 367 && serial <= 73050) {
      const d = new Date(EXCEL_EPOCH_MS + serial * MS_PER_DAY)
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
    return ''
  }
  // Any other bare number is not a date this app will guess at. Without this guard the
  // fallback below hands e.g. "42" to `new Date()`, which cheerfully returns 2042-01-01.
  if (/^\d+(\.\d+)?$/.test(s)) return ''

  // Numeric triples: d/m/y, d-m-y, d.m.y (and y/m/d when the first part is a 4-digit year).
  const triple = s.match(/^(\d{1,4})\s*[/.\-\s]\s*(\d{1,2})\s*[/.\-\s]\s*(\d{1,4})$/)
  if (triple) {
    const [, aRaw, bRaw, cRaw] = triple
    const a = Number(aRaw)
    const b = Number(bRaw)
    const c = Number(cRaw)
    if (aRaw.length === 4) {
      // Year first: the only sane reading is Y-M-D.
      return isRealDate(a, b, c) ? iso(a, b, c) : ''
    }
    const year = expandYear(c)
    // a > 12 → a can only be the day. b > 12 → b can only be the day (US-style m/d/y).
    // Neither > 12 → day-first, per the rule documented above.
    const [day, month] = b > 12 && a <= 12 ? [b, a] : [a, b]
    return isRealDate(year, month, day) ? iso(year, month, day) : ''
  }

  // Spelled-out months ("23 April 2015", "Apr 23, 2015") have no day/month ambiguity to
  // resolve, so the platform parser behind toDateInputValue handles them correctly.
  return toDateInputValue(s)
}
