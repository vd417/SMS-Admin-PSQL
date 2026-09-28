/* ============================================================
   SchoolMate — Students (SIS) list + Student 360 profile.
   Phase 1 flagship screen. Live /students list + create.
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import {
  PageHead, Card, CardHead, Btn, Badge, Avatar, Search, Select,
  Drawer, Tabs, Icon, Empty, Progress, Spark, Bars, DataTable,
  type Column, type BadgeTone,
} from '@/components/ui'
import { gateRole, tierIncludes } from '@/lib/gating'
import { useStudents, useStudentsPage, useStudent } from '@/api/hooks/useStudents'
import { useExams } from '@/api/hooks/useExams'
import { useExamPapers } from '@/api/hooks/useExamPapers'
import { useExamMarksMap, useStudentGrades } from '@/api/hooks/useGrades'
import { useClasses } from '@/api/hooks/useClasses'
import { studentGuardianName } from '@/api/students'
import { formatStudentRoll } from '@/lib/studentRoll'
import { listStoredDocs, downloadStoredDoc, openStoredDoc, isStoredImage, studentPhotoUrl, fetchStudentExtras } from '@/api/studentExtras'
import { openMailCompose, guardianEmailsFromStudent } from '@/lib/composeMail'
import { markKey } from '@/lib/examData'
import { properName, properPlace } from '@/lib/properCase'
import { printReportCard } from '@/lib/reportCardPrint'
import {
  reportFor, classRank, fmtMoney,
  overallToppers, classToppers,
  type TopperMetric, type ScoredStudent, type ClassTopperGroup, type TopperScoreOpts,
} from '@/lib/format'
import { useStudentMonthlyAttendance } from '@/api/hooks/useStudentMonthlyAttendance'
import { useFeeInvoices } from '@/api/hooks/useFeeInvoices'
import { useFeePayments } from '@/api/hooks/useFeePayments'
import { buildStudentTimeline } from '@/lib/studentTimeline'
import { monthlyBreakdown, monthlySeriesForKeys, academicYearMonthKeys, academicYearStart, monthDailyGrid } from '@/api/studentAttendance'
import { type AttendanceStatus } from '@/api/attendance'
import { parseCsvText, parseXlsxBuffer, type ParsedFile, type ParsedRow } from '@/lib/importFileParse'
import { BULK_IMPORT_FIELDS, suggestColumnMapping } from '@/lib/importColumnMapping'
import { validateStudentForm } from '@/lib/studentValidation'
import { isDuplicateValue, normalizePhoneDigits, normalizeEmailKey } from '@/lib/validation'
import { errorRowsToCsv, type ErrorReportRow } from '@/lib/importErrorReport'
import { downloadTextFile, downloadArrayBuffer } from '@/lib/feeExport'
import ExcelJS from 'exceljs'
import { parseImportDate } from '@/lib/importDate'
import { classCellMatches } from '@/lib/importClassMatch'
import { buildStudentFromRow, toBulkImportRowPayload, parseBulkGender, type BulkStudentRow, type BulkImportRowPayload } from '@/lib/studentMapping'
import { useBulkImportStudents, isTransportFailedRow, BATCH_SIZE } from '@/api/hooks/useBulkImportStudents'
import type { BulkImportRowResult } from '@/api/bulkImportStudents'
import { useTransportRoutes, useRouteStopsByRoute } from '@/api/hooks/useOperations'
import { useFeeHeads } from '@/api/hooks/useFeeHeads'
import { useSchoolHouses } from '@/api/hooks/useSchoolHouses'
import type { Student, FeeStatus, Role, Exam, FeeHead } from '@/types'
import type { TransportRoute, RouteStop } from '@/api/transport'
import type { SchoolClass } from '@/api/classes'
import { DEFAULT_GRADES, compareClassesAscending } from '@/lib/defaultClasses'

/* ---------- shared helpers ---------- */
const feeTone: Record<FeeStatus, BadgeTone> = { paid: 'success', partial: 'warning', due: 'danger' }
const feeLabel: Record<FeeStatus, string> = { paid: 'Paid', partial: 'Partial', due: 'Due' }
const dayStatusTone: Record<AttendanceStatus, BadgeTone> = { present: 'success', late: 'warning', absent: 'danger', half_day: 'warning' }
const dayStatusLabel: Record<AttendanceStatus, string> = { present: 'Present', late: 'Late', absent: 'Absent', half_day: 'Half day' }
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function fmtDayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${WEEKDAY[d.getDay()]} ${d.getDate()}`
}
const attColor = (v: number): string => (v >= 90 ? 'var(--success)' : v >= 80 ? 'var(--brand-600)' : v >= 75 ? 'var(--warning)' : 'var(--danger)')

function classLabelOf(c: SchoolClass): string {
  return (c.name || `${c.grade}-${c.section}`).trim()
}

/** Prefer marks_entry / completed exams, then latest end date. */
function pickLatestExam(exams: Exam[] | undefined): Exam | null {
  if (!exams?.length) return null
  const rank = (e: Exam) => (e.status === 'completed' ? 3 : e.status === 'marks_entry' ? 2 : e.published ? 1 : 0)
  return [...exams].sort((a, b) => {
    const rd = rank(b) - rank(a)
    if (rd) return rd
    return String(b.to || '').localeCompare(String(a.to || ''))
  })[0] ?? null
}

export function canEdit(role: Role): boolean {
  return gateRole(role) === 'admin' || role === 'principal' || role === 'vice_principal'
}

/** Stricter than canEdit(): POST /students/bulk-import/batch is guarded by the backend's
 *  Principal-tier policy, whereas POST /students only needs the broader staff check that
 *  also admits vice_principal. Gating the menu entry on the real requirement stops an
 *  unauthorized admin from completing the entire 4-step wizard only to eat a 403 on Start
 *  Import. (The hook ALSO handles a 403 as non-retryable — this gate is the first line,
 *  never the only one, since the server stays the authority.) */
export function canBulkImport(role: Role): boolean {
  return gateRole(role) === 'admin' || role === 'principal'
}

/* ============================================================
   Bulk-import wizard (upload → map → done)
   ============================================================ */
const IMPORT_ROW_CAP = 10000

/** Reads a File as text via FileReader (works in jsdom test envs too, unlike File.prototype.text()). */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

/** Reads a File as an ArrayBuffer via FileReader (works in jsdom test envs too, unlike File.prototype.arrayBuffer()). */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsArrayBuffer(file)
  })
}

/** Same class-name lookup studentAdd.tsx's resolveClass() uses, kept local since it isn't
 *  exported — bulk rows resolve their raw "Class + Section" cell against live classes the
 *  same way a single Add/Edit save does. */
function resolveImportClass(classes: SchoolClass[], classKey: string): { grade: string; section: string; cls: string } {
  const key = classKey.trim()
  // classCellMatches, not string equality: this app's default grades are Roman (X-A) while a
  // school's exported spreadsheet writes them in Arabic ("10-A", "Class 10 A", "10a"). Both
  // spellings name the same class, and the resolved record always wins, so the student is
  // filed under the class's OWN name whichever way the admin typed it.
  const match = classes.find((c) => classCellMatches(c, key))
  if (match) {
    return { grade: match.grade || key, section: match.section || '', cls: match.name || `${match.grade}-${match.section}` }
  }
  const dash = key.lastIndexOf('-')
  if (dash > 0) return { grade: key.slice(0, dash), section: key.slice(dash + 1), cls: key }
  return { grade: key, section: '', cls: key }
}

/** True only when the row's raw class cell resolves to a REAL class in the fetched roster of
 *  classes (same match rule resolveImportClass's first branch uses) — a garbage class string
 *  like "99-Z" or "Grade Five" that merely gets dash-split into a display label does not
 *  count as existing. Blank input is treated as non-existent (the required-field check on
 *  `cls` already flags blank separately). */
function importClassExists(classes: SchoolClass[], classKey: string): boolean {
  const key = classKey.trim()
  if (!key) return false
  return classes.some((c) => classCellMatches(c, key))
}

/* ---------- reference-data resolution (spec §6: Class / House / Route / Stop) ----------
   A real admin's spreadsheet holds NAMES ("Route 4 — North", "Ruby", "Gandhi Chowk"), not
   GUIDs, and the wizard's own column labels ("Transport Route", "Pickup Stop", "House")
   promise exactly that. Every one of these resolvers therefore accepts either the raw id
   or the display name, case/whitespace-insensitively, and returns null when the cell
   matches NOTHING in the already-loaded reference list — which Preview turns into a row
   Error instead of shipping unresolvable text to the server as if it were an ID. */
function refKey(value: string): string {
  return (value ?? '').trim().toLowerCase()
}

export function resolveImportHouse(houses: string[], value: string): string | null {
  const key = refKey(value)
  if (!key) return null
  return houses.find((h) => refKey(h) === key) ?? null
}

export function resolveImportRoute(routes: TransportRoute[], value: string): TransportRoute | null {
  const key = refKey(value)
  if (!key) return null
  return routes.find((r) => refKey(r.id) === key) ?? routes.find((r) => refKey(r.name) === key) ?? null
}

/** Stops are only ever looked up WITHIN one already-resolved route's stop list, so a stop
 *  that exists on a different route can never satisfy a row — that is the
 *  "stop-belongs-to-route" half of spec §6. */
export function resolveImportStop(stops: RouteStop[], value: string): RouteStop | null {
  const key = refKey(value)
  if (!key) return null
  return stops.find((s) => refKey(s.id) === key) ?? stops.find((s) => refKey(s.name) === key) ?? null
}

export function resolveImportFeeHead(feeHeads: FeeHead[], value: string): FeeHead | null {
  const key = refKey(value)
  if (!key) return null
  return feeHeads.find((f) => refKey(f.id) === key)
    ?? feeHeads.find((f) => refKey(f.name) === key)
    ?? feeHeads.find((f) => refKey(f.code ?? '') === key)
    ?? null
}

/** Every reference list the Preview step validates against and the payload builder resolves
 *  IDs from — all already loaded by the drawer's own queries, none fetched per row. */
export interface BulkImportRefs {
  classes: SchoolClass[]
  houses: string[]
  routes: TransportRoute[]
  stopsByRoute: Record<string, RouteStop[]>
  feeHeads: FeeHead[]
}

export const EMPTY_BULK_IMPORT_REFS: BulkImportRefs = {
  classes: [], houses: [], routes: [], stopsByRoute: {}, feeHeads: [],
}

/** Every non-rowNumber field of BulkStudentRow (studentMapping.ts) — used so
 *  buildBulkRowRecord always returns a FULL BulkStudentRow-shaped record (every key present,
 *  defaulting to '' when the admin didn't map a column to it) rather than a sparse partial
 *  object. buildStudentFromRow dereferences these fields unguarded (e.g. row.phone.trim()),
 *  so a missing key would throw once Task 15 wires this record into it. */
const BULK_ROW_FIELD_KEYS: (keyof Omit<BulkStudentRow, 'rowNumber'>)[] = [
  'admissionNo', 'firstName', 'lastName', 'section', 'gender', 'dob', 'phone', 'email',
  'fatherName', 'fatherPhone', 'fatherEmail', 'fatherOccupation',
  'motherName', 'motherPhone', 'motherEmail', 'motherOccupation',
  'bloodGroup', 'house', 'religion', 'category', 'caste', 'motherTongue', 'languages',
  'lastSchool', 'address', 'academicYear', 'admissionDate', 'status',
  'transportOptedIn', 'transportRouteId', 'transportStopId', 'transportFeeHeadId',
]

/** Builds one row's field-key → cell-value record from a raw parsed row + the index-keyed
 *  column mapping (Task 13). Starts from a FULL BulkStudentRow-shaped record (every field
 *  defaulted to '') so every row shares the same key set (needed so errorRowsToCsv's header
 *  row is consistent, and so any field the admin didn't map is still safely present as ''
 *  rather than absent). */
export function buildBulkRowRecord(cells: string[], mapping: Record<number, string | null>): Record<string, string> {
  const rec: Record<string, string> = {}
  for (const key of BULK_ROW_FIELD_KEYS) rec[key] = ''
  cells.forEach((cell, index) => {
    const key = mapping[index]
    if (key) rec[key] = (cell ?? '').trim()
  })
  return rec
}

/** Groups rows by phone+email so duplicate entries within the SAME uploaded file (not the
 *  live roster — that's a separate check) get flagged. Rows with neither phone nor email
 *  never match each other (blank key), so they don't falsely collide. */
function bulkFileDuplicateKey(record: Record<string, string>): string {
  const phone = normalizePhoneDigits(record.phone)
  const email = normalizeEmailKey(record.email)
  if (!phone && !email) return ''
  return `${phone}|${email}`
}

/** Normalizes a bulk-file "transport opted in" cell to the exact 'yes' string
 *  validateStudentForm's `f.transportOptedIn === 'yes'` check expects — CSV data commonly
 *  spells this 'Yes', 'TRUE', 'Y', or with stray whitespace, none of which the shared
 *  validator (also used by single Add Student, which must stay behavior-identical) will
 *  recognize on its own. Only affects the copy of the value passed into validation, not the
 *  row's original record. */
function normalizeBulkTransportOptedIn(value: string): string {
  const v = (value ?? '').trim().toLowerCase()
  return (v === 'yes' || v === 'y' || v === 'true' || v === '1') ? 'yes' : value
}

export interface BulkPreviewRow {
  rowNumber: number
  record: Record<string, string>
  errors: Record<string, string>
}

export interface BulkPreview {
  rows: BulkPreviewRow[]
  validRows: BulkPreviewRow[]
  errorRows: BulkPreviewRow[]
}

/** Runs the same field validation single Add Student uses (validateStudentForm), plus bulk-only
 *  checks it has no concept of: an admission-number conflict (both against the live roster and
 *  within the same uploaded file), a duplicate-within-the-uploaded-file check (same phone+email
 *  on more than one row), reference-existence checks for Class / House / Route / Stop /
 *  Transport Fee Head (spec §6), and stricter parses for the free-text dob and gender cells
 *  than a bare "is it non-empty" required check can give. Exported for direct unit testing —
 *  pure/computation-only, never calls a create or transport API. */
export function buildBulkPreview(
  parsedRows: ParsedRow[],
  columnMapping: Record<number, string | null>,
  refs: BulkImportRefs,
  roster: Student[],
  opsEnabled: boolean,
): BulkPreview {
  const records = parsedRows.map((row) => buildBulkRowRecord(row.cells, columnMapping))
  const validationRoster = roster.map((s) => ({ id: s.id, email: s.email, phone: s.phone }))
  const admRoster = roster.map((s) => ({ id: s.id, value: s.adm }))
  const fileKeys = records.map(bulkFileDuplicateKey)
  // Map (not Set) so the collision message can name the earlier row it duplicates.
  const seenFileKeys = new Map<string, number>()
  const seenAdmissionNos = new Map<string, number>()

  const rows: BulkPreviewRow[] = records.map((record, i) => {
    // The ORIGINAL file line number (header counted as line 1), threaded through the parser
    // — never a sequential index over the already-header/blank-filtered rows, which would
    // point the admin's error report at the wrong line of their own spreadsheet (spec §9).
    const rowNumber = parsedRows[i].lineNumber
    const form: Record<string, string> = {
      ...record,
      cls: record.section ?? '',
      transportOptedIn: normalizeBulkTransportOptedIn(record.transportOptedIn ?? ''),
    }
    const errors = validateStudentForm({
      form,
      files: {},
      roster: validationRoster,
      existingId: undefined,
      transportEnabled: opsEnabled,
    })

    const admissionNo = (record.admissionNo ?? '').trim()
    if (admissionNo) {
      const admKey = admissionNo.toUpperCase()
      if (isDuplicateValue(admissionNo, admRoster, (v) => (v ?? '').trim().toUpperCase())) {
        errors.admissionNo = 'Another student already uses this admission number'
      } else if (seenAdmissionNos.has(admKey)) {
        errors.admissionNo = `Duplicate admission number — same as row ${seenAdmissionNos.get(admKey)}`
      } else {
        seenAdmissionNos.set(admKey, rowNumber)
      }
    }

    const sectionValue = (record.section ?? '').trim()
    if (sectionValue && !errors.cls && !importClassExists(refs.classes, sectionValue)) {
      errors.cls = `Class + Section "${sectionValue}" was not found — check spelling or add it in Academics first`
    }

    // dob: `required()` alone only proves the cell is non-empty. Anything that does not
    // actually parse becomes '' in toDateInputValue() downstream and is sent as dob: null,
    // which the server then rejects — Preview would have said "Valid" and the final counts
    // would not add up. Validate with the SAME parser the payload uses, so the two agree.
    const dobValue = (record.dob ?? '').trim()
    if (dobValue && !errors.dob && !parseImportDate(dobValue)) {
      errors.dob = 'Invalid date of birth — use a real date such as 23/04/2015 or 2015-04-23'
    }

    // Admission Date runs through the same parser on the payload side, so a cell that cannot
    // parse would be dropped to null silently. Flag it here instead.
    const admissionDateValue = (record.admissionDate ?? '').trim()
    if (admissionDateValue && !errors.admissionDate && !parseImportDate(admissionDateValue)) {
      errors.admissionDate = 'Invalid admission date — use a real date such as 01/04/2025 or 2025-04-01'
    }

    // gender: an uninterpretable cell must never be silently guessed (a "Female" that lands
    // as Male is real, unnoticed data corruption).
    const genderValue = (record.gender ?? '').trim()
    if (genderValue && !errors.gender && !parseBulkGender(genderValue)) {
      errors.gender = 'Invalid gender — use Male or Female'
    }

    const houseValue = (record.house ?? '').trim()
    if (houseValue && !errors.house && !resolveImportHouse(refs.houses, houseValue)) {
      errors.house = `House "${houseValue}" was not found — check spelling or add it in Academics → Houses first`
    }

    // Transport reference checks (spec §6). Only meaningful for a row that actually opted
    // in, and only on the Platinum/operations tier where routes/stops exist at all.
    if (opsEnabled && form.transportOptedIn === 'yes') {
      const routeValue = (record.transportRouteId ?? '').trim()
      // validateStudentForm is shared with the single Add form, so a blank route arrives
      // worded for a form ("Select a route before saving") — there is nothing to select in a
      // spreadsheet row, and the message names neither the column at fault nor the way out.
      if (errors.transportRouteId === 'Select a route before saving') {
        errors.transportRouteId = 'Uses School Transport is "Yes" but Transport Route is empty'
          + ' — fill the Transport Route column, or set Uses School Transport to "No"'
      }
      const stopValue = (record.transportStopId ?? '').trim()
      const feeHeadValue = (record.transportFeeHeadId ?? '').trim()
      const route = resolveImportRoute(refs.routes, routeValue)
      if (routeValue && !route && !errors.transportRouteId) {
        errors.transportRouteId = `Transport Route "${routeValue}" was not found — check spelling or add it in Transport first`
      }
      // A stop is only checked once its route resolved: with an unresolved/blank route
      // there is no stop list to check against, and transportRouteId already carries the
      // actionable error, so a second cascading message would just be noise.
      if (stopValue && route && !errors.transportStopId
        && !resolveImportStop(refs.stopsByRoute[route.id] ?? [], stopValue)) {
        errors.transportStopId = `Pickup Stop "${stopValue}" was not found on this route — check spelling or add it in Transport first`
      }
      if (feeHeadValue && !errors.transportFeeHeadId && !resolveImportFeeHead(refs.feeHeads, feeHeadValue)) {
        errors.transportFeeHeadId = `Transport Fee Head "${feeHeadValue}" was not found — check spelling or add it in Finance first`
      }
    }

    const key = fileKeys[i]
    if (key) {
      if (seenFileKeys.has(key)) {
        errors._duplicateInFile = `Duplicate row in this file — same phone & email as row ${seenFileKeys.get(key)}`
      } else {
        seenFileKeys.set(key, rowNumber)
      }
    }

    return { rowNumber, record, errors }
  })

  const validRows = rows.filter((r) => Object.keys(r.errors).length === 0)
  const errorRows = rows.filter((r) => Object.keys(r.errors).length > 0)
  return { rows, validRows, errorRows }
}

/** Original mapped columns + a trailing Error Reason column, for errorRowsToCsv. */
function bulkErrorReportRows(errorRows: BulkPreviewRow[]): ErrorReportRow[] {
  return errorRows.map((r) => ({
    Row: String(r.rowNumber),
    ...r.record,
    'Error Reason': Object.values(r.errors).join('; '),
  }))
}

/** Shapes Preview's validated rows into the exact BulkImportRowPayload[] the batch endpoint
 *  expects. Each row's `record` is already a FULL BulkStudentRow-shaped Record<string,string>
 *  (buildBulkRowRecord defaults every field to ''), so it's safe to spread directly into a
 *  BulkStudentRow.
 *
 *  Transport is only sent as opted-in when the row's normalized transportOptedIn cell reads
 *  'yes', and route/stop/fee-head are sent as the RESOLVED reference IDs — never the raw
 *  cell text. A real CSV holds names, so shipping the cell verbatim as if it were a GUID
 *  was the root cause of the batch failing server-side on data Preview had called valid.
 *  Every row reaching here has already passed Preview's reference checks, so a resolution
 *  miss can only mean a blank (opted-out-of-that-detail) cell, which becomes null on the
 *  wire exactly as the single-Add save does. House is canonicalized the same way, so the
 *  stored value matches the school's House catalog rather than the file's spelling. */
export function buildBulkImportPayloads(validRows: BulkPreviewRow[], refs: BulkImportRefs): BulkImportRowPayload[] {
  return validRows.map((r) => {
    const raw = { rowNumber: r.rowNumber, ...r.record } as BulkStudentRow
    const row: BulkStudentRow = { ...raw, house: resolveImportHouse(refs.houses, raw.house) ?? raw.house }
    const classInfo = resolveImportClass(refs.classes, row.section)
    const student = buildStudentFromRow(row, classInfo)
    const optedIn = normalizeBulkTransportOptedIn(row.transportOptedIn) === 'yes'
    let transport: { routeId: string; stopId: string; feeHeadId: string } | null = null
    if (optedIn) {
      const route = resolveImportRoute(refs.routes, row.transportRouteId)
      const stop = route ? resolveImportStop(refs.stopsByRoute[route.id] ?? [], row.transportStopId) : null
      const feeHead = resolveImportFeeHead(refs.feeHeads, row.transportFeeHeadId)
      transport = { routeId: route?.id ?? '', stopId: stop?.id ?? '', feeHeadId: feeHead?.id ?? '' }
    }
    return toBulkImportRowPayload(student, transport, row.rowNumber)
  })
}

/** One clearly-fictional example student for the downloadable template — never a real school's
 *  data. Reuses the same placeholder names/values the reference-resolution docs above and the
 *  test fixtures elsewhere in this file already use ("Ruby" house, "Gandhi Chowk" address,
 *  "9000000001" phone, a 2015 dob), so the template stays consistent with the rest of the app.
 *  section uses "I-A" (Grade I · Section A) — this app's own DEFAULT_GRADES/DEFAULT_SECTIONS
 *  convention (defaultClasses.ts), i.e. what a school gets from "Seed default classes" — so the
 *  example actually resolves out of the box for any school on the default class structure,
 *  rather than an arbitrary Arabic-numeral grade many schools never create.
 *  Uses School Transport is "No" with every transport column blank: Route / Stop / Fee Head are
 *  per-school foreign keys this template cannot safely guess, so leaving them blank both keeps
 *  the example truthful and demonstrates that transport is optional. */
const BULK_IMPORT_EXAMPLE_ROW: Record<(typeof BULK_IMPORT_FIELDS)[number]['key'], string> = {
  admissionNo: '',
  admissionDate: '2025-04-01',
  firstName: 'Aarav',
  lastName: 'Sharma',
  section: 'I-A',
  house: 'Ruby',
  gender: 'Male',
  dob: '2015-04-23',
  academicYear: '2025-2026',
  bloodGroup: 'O+',
  religion: 'Hindu',
  category: 'General',
  phone: '9000000001',
  email: 'aarav.sharma@example.com',
  caste: '',
  motherTongue: 'Hindi',
  languages: 'Hindi, English',
  lastSchool: '',
  address: 'Gandhi Chowk, Pune',
  fatherName: 'Ramesh Sharma',
  fatherEmail: '',
  fatherPhone: '9000000002',
  fatherOccupation: 'Business',
  motherName: 'Sunita Sharma',
  motherEmail: '',
  motherPhone: '',
  motherOccupation: 'Homemaker',
  status: '',
  transportOptedIn: 'No',
  transportFeeHeadId: '',
  transportRouteId: '',
  transportStopId: '',
}

/** Downloadable starter workbook: a bold, frozen header row matching the wizard's own mappable
 *  column labels (so a file built from it auto-maps end to end), plus exactly ONE example
 *  student row showing the expected format. Omits Admission Number — like Roll Number, it's
 *  server-auto-generated; the column stays mappable for schools migrating legacy data with
 *  existing admission numbers, but a fresh template shouldn't invite filling it. A cell note on
 *  the header row spells out that the example must be replaced, and that Class + Section /
 *  House / Route / Stop / Fee Head must match records that already exist for the school — this
 *  template never invents a real database value. */
export async function bulkImportTemplateXlsx(refs: BulkImportRefs = EMPTY_BULK_IMPORT_REFS): Promise<ArrayBuffer> {
  const fields = BULK_IMPORT_FIELDS.filter((f) => f.key !== 'admissionNo')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Students')
  ws.views = [{ state: 'frozen', ySplit: 1 }]

  const headerRow = ws.getRow(1)
  fields.forEach((f, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = f.label
    cell.font = { bold: true }
  })
  headerRow.commit()

  const exampleRow = ws.getRow(2)
  fields.forEach((f, i) => { exampleRow.getCell(i + 1).value = BULK_IMPORT_EXAMPLE_ROW[f.key] })
  exampleRow.commit()

  fields.forEach((f, i) => {
    const width = Math.max(f.label.length, BULK_IMPORT_EXAMPLE_ROW[f.key].length, 8) + 2
    ws.getColumn(i + 1).width = Math.min(32, width)
  })

  ws.getCell(1, 1).note = 'Row 2 is ONE example student, for format only — replace it with your '
    + 'own data. Class + Section, House, Transport Route, Pickup Stop and Transport Fee Head '
    + "must match records that already exist in this school's Academics / Transport / Finance. "
    + 'See the "Valid values" sheet for the exact list this school accepts.'

  ws.getCell(1, fields.findIndex((f) => f.key === 'section') + 1).note =
    'Grades are Roman here (I, II, III … X, XI, XII) to match how the classes in this school '
    + 'are named. Arabic is accepted too: '
    + '"10-A", "Class 10 A" and "10a" all resolve to X-A.'

  ws.getCell(1, fields.findIndex((f) => f.key === 'dob') + 1).note =
    'Any of these is accepted: 2015-04-23, 23/04/2015, 23-04-2015, 23 April 2015, or an Excel '
    + 'date cell. An all-numeric cell like 04/05/2015 is read DAY first (4 May).'

  addValidValuesSheet(wb, refs)

  return wb.xlsx.writeBuffer()
}

/** Second sheet listing the reference values THIS school actually has, so the admin can copy
 *  a Class + Section / House / Route / Stop / Fee Head straight across instead of guessing at
 *  a spelling and finding out only at Preview. Every "was not found" error the wizard can
 *  raise is a value that is either on this sheet or does not exist yet. */
function addValidValuesSheet(wb: ExcelJS.Workbook, refs: BulkImportRefs): void {
  const ws = wb.addWorksheet('Valid values')
  const columns: { header: string; values: string[] }[] = [
    {
      header: 'Class + Section',
      values: [...refs.classes]
        .sort(compareClassesAscending)
        .map((c) => (c.name || `${c.grade}-${c.section}`).trim())
        .filter(Boolean),
    },
    { header: 'House', values: refs.houses.filter(Boolean) },
    { header: 'Transport Route', values: refs.routes.map((r) => r.name).filter(Boolean) },
    {
      header: 'Pickup Stop',
      values: refs.routes.flatMap((r) => (refs.stopsByRoute[r.id] ?? [])
        .map((st) => `${st.name} (${r.name})`)),
    },
    { header: 'Transport Fee Head', values: refs.feeHeads.map((f) => f.name).filter(Boolean) },
  ]

  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const headerRow = ws.getRow(1)
  columns.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1)
    cell.value = col.header
    cell.font = { bold: true }
    // An empty column means the school has none of that record type yet — say so, rather than
    // leaving a blank the admin reads as "the template forgot this".
    const values = col.values.length ? col.values : ['(none set up for this school yet)']
    values.forEach((v, r) => { ws.getRow(r + 2).getCell(i + 1).value = v })
    const widest = values.reduce((w, v) => Math.max(w, v.length), col.header.length)
    ws.getColumn(i + 1).width = Math.min(36, widest + 2)
  })
  headerRow.commit()
}

function ImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp()
  const [step, setStep] = useState(0)
  const steps = ['Upload', 'Map columns', 'Preview', 'Import']
  const [upload, setUpload] = useState<{ fileName: string; parsed: ParsedFile } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Keyed by column INDEX (not header text) so two uploaded columns that share the
  // same literal header name still get independent mapping entries instead of
  // silently collapsing onto one.
  const [columnMapping, setColumnMapping] = useState<Record<number, string | null>>({})

  const opsEnabled = tierIncludes(app.plan, 'operations')
  const classesQ = useClasses()
  const rosterQ = useStudents({ enabled: open })
  const housesQ = useSchoolHouses()
  // Transport/fee reference data for the Route / Stop / Transport Fee Head columns. These
  // are the SAME hooks the single Add Student form uses to populate its own route/stop/fee
  // dropdowns — bulk import validates against exactly what single Add would let you pick.
  const routesQ = useTransportRoutes()
  const feeHeadsQ = useFeeHeads()
  const routeIds = useMemo(() => (routesQ.data ?? []).map((r) => r.id), [routesQ.data])
  const { stopsByRoute, isReady: stopsReady } = useRouteStopsByRoute(routeIds)

  const refs = useMemo<BulkImportRefs>(() => ({
    classes: classesQ.data ?? [],
    houses: housesQ.data ?? [],
    routes: routesQ.data ?? [],
    stopsByRoute,
    feeHeads: feeHeadsQ.data ?? [],
  }), [classesQ.data, housesQ.data, routesQ.data, stopsByRoute, feeHeadsQ.data])

  // Transport reference queries only run on the operations tier (useTransportRoutes is
  // `enabled: ops`), so off-tier they never reach isSuccess — treat them as ready there,
  // since no transport validation runs either.
  const transportRefsReady = !opsEnabled || (routesQ.isSuccess && feeHeadsQ.isSuccess && stopsReady)
  const refsReady = rosterQ.isSuccess && classesQ.isSuccess && housesQ.isSuccess && transportRefsReady
  const refsError = rosterQ.isError || classesQ.isError || housesQ.isError
    || (opsEnabled && (routesQ.isError || feeHeadsQ.isError))
  const retryRefs = () => {
    if (rosterQ.isError) void rosterQ.refetch()
    if (classesQ.isError) void classesQ.refetch()
    if (housesQ.isError) void housesQ.refetch()
    if (opsEnabled && routesQ.isError) void routesQ.refetch()
    if (opsEnabled && feeHeadsQ.isError) void feeHeadsQ.refetch()
  }

  // Gated on rosterQ.isSuccess (not just rosterQ.data ?? []) so Preview never computes counts
  // against a still-loading roster — this drawer's useStudents({ enabled: open }) uses a
  // different query key than the parent list's useStudentsPage, so it's genuinely cold when
  // the drawer opens; without this gate every row would silently pass as Valid (roster-based
  // duplicate/admission checks skipped) during that window.
  // Also gated on classesQ.isSuccess for the same reason: an empty/not-yet-loaded classes
  // array reads as "no classes match" to importClassExists, which would falsely flag every
  // row's class as not found while classes are still loading (or leave that false-invalid
  // state permanently if the classes query ever errors).
  // The same gate now also covers the House / Route / Stop / Fee-head reference lists that
  // Preview validates against: an empty-because-still-loading reference list reads as
  // "nothing matches", which would falsely flag every row.
  const preview = useMemo<BulkPreview | null>(() => {
    if (step !== 2 || !upload || !refsReady) return null
    return buildBulkPreview(upload.parsed.rows, columnMapping, refs, rosterQ.data ?? [], opsEnabled)
  }, [step, upload, columnMapping, refs, refsReady, rosterQ.data, opsEnabled])

  const bulkImport = useBulkImportStudents()
  // Snapshot of the SUBMITTED rows' original mapped-column data, keyed by rowNumber, captured
  // at startImport (from preview.validRows — the only rows ever sent to the batch endpoint).
  // Needed because `preview` itself goes back to null once step advances past 2 (its useMemo
  // is gated on step === 2), so by the time Complete renders in step 3 the original row data
  // would otherwise be unrecoverable for the final error report / skipped-row list.
  const importedRowRecordsRef = useRef<Map<number, Record<string, string>>>(new Map())
  const [showSkippedList, setShowSkippedList] = useState(false)

  // True only while the hook's import loop is actively iterating batches (its own explicit
  // isRunning signal) — never inferred from a processed/total count comparison, since a
  // short/partial server response (processed < rows sent) would otherwise leave that
  // comparison stuck true forever with no outstanding request, permanently locking the UI.
  // Matches the initial (not running) state as "not in flight" so the drawer stays closable
  // before Start Import is clicked, and also covers the retry() round-trip so Retry can't be
  // double-clicked into two concurrent runs.
  const importInFlight = bulkImport.isRunning
  const totalBatches = Math.max(1, Math.ceil(bulkImport.progress.total / BATCH_SIZE))

  // Resets wizard state and returns to Step 1 WITHOUT closing the drawer — used by both the
  // drawer's own close/backdrop (which also calls onClose, via `reset` below) and the
  // Complete screen's "Import Another File" action (which must NOT close the drawer).
  const resetToUpload = () => {
    setStep(0); setUpload(null); setUploadError(null); setColumnMapping({})
    bulkImport.resetImport()
    importedRowRecordsRef.current = new Map()
    setShowSkippedList(false)
  }
  const reset = () => { resetToUpload(); onClose() }

  const startImport = () => {
    if (!preview || preview.validRows.length === 0) return
    importedRowRecordsRef.current = new Map(preview.validRows.map((r) => [r.rowNumber, r.record]))
    const rows = buildBulkImportPayloads(preview.validRows, refs)
    setStep(3)
    void bulkImport.runImport(rows)
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadError(null)
    try {
      const isXlsx = /\.xlsx$/i.test(file.name)
      // NOTE: parseXlsxBuffer relies on ExcelJS's eachRow with the default
      // includeEmpty:false — a worksheet whose literal row 1 is blank will
      // shift its real header row into the data set. We can't detect that
      // case reliably here, so we guard the visible symptom instead: zero
      // detected headers surfaces as an upload error below rather than
      // silently treating data rows as headerless columns.
      const parsed = isXlsx
        ? await parseXlsxBuffer(await readFileAsArrayBuffer(file))
        : parseCsvText(await readFileAsText(file))
      if (parsed.headers.length === 0) {
        setUploadError('Could not detect column headers in this file. Check that the first row contains column names and try again.')
      } else if (parsed.rows.length > IMPORT_ROW_CAP) {
        setUploadError(`This file exceeds the maximum of 10,000 rows (found ${parsed.rows.length.toLocaleString()}). Split it into smaller files and try again.`)
      }
      setUpload({ fileName: file.name, parsed })
      const suggestedByHeader = suggestColumnMapping(parsed.headers)
      const suggestedByIndex: Record<number, string | null> = {}
      parsed.headers.forEach((header, index) => { suggestedByIndex[index] = suggestedByHeader[header] ?? null })
      setColumnMapping(suggestedByIndex)
    } catch {
      setUpload(null)
      setUploadError('Could not read this file. Check that it is a valid CSV or XLSX file and try again.')
    }
  }

  const requiredFields = BULK_IMPORT_FIELDS.filter((f) => f.required)
  const missingRequired = requiredFields.some((f) => !Object.values(columnMapping).includes(f.key))
  const canContinue = step === 0 ? (!!upload && !uploadError) : step === 1 ? !missingRequired : true
  const canStartImport = !!preview && preview.validRows.length > 0

  // Done means the loop actually finished running (isRunning is the real, explicit signal —
  // see the importInFlight comment above) without pausing on a failure. Deliberately not
  // `processed >= total`: that comparison can under-count forever on a short/partial batch
  // response even though the loop itself is finished, which would leave the drawer showing
  // neither a Retry nor a Done control.
  const importDone = bulkImport.progress.total > 0 && !bulkImport.isRunning && bulkImport.pausedAtBatch == null

  return (
    <Drawer
      // Genuinely un-closable (not just visually dimmed) while a batch round-trip is in
      // flight: onClose is omitted entirely, so the header's X button doesn't render, Esc
      // is a no-op, and a backdrop click is a no-op too.
      open={open} onClose={importInFlight ? undefined : reset} icon="upload"
      title="Bulk import students" sub={`Step ${step + 1} of ${steps.length} · ${steps[step]}`}
      footer={
        <div className="row gap8 jc-between">
          <Btn variant="ghost" disabled={step === 0 || step === 3} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Btn>
          {step < 2 && (
            <Btn variant="primary" iconRight="arrowRight" disabled={!canContinue} onClick={() => setStep((s) => s + 1)}>Continue</Btn>
          )}
          {step === 2 && (
            <Btn variant="primary" icon="check" disabled={!canStartImport || importInFlight} onClick={startImport}>Start Import</Btn>
          )}
          {/* No Retry after an authorization failure — retrying a 403 can only fail again. */}
          {step === 3 && bulkImport.canRetry && (
            <Btn variant="primary" icon="refresh" disabled={importInFlight} onClick={() => void bulkImport.retry()}>Retry Import</Btn>
          )}
        </div>
      }
    >
      <div className="row gap8" style={{ marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={s} className="row ai-center gap8 flex1">
            <Badge tone={i <= step ? 'brand' : 'neutral'} solid={i === step}>{i + 1}</Badge>
            <span className={i === step ? 'fw6 t-sm' : 'muted t-sm'}>{s}</span>
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="col gap12">
          <label className="sm-empty" style={{ border: '1px dashed var(--border)', borderRadius: 12, cursor: 'pointer', position: 'relative' }}>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFile}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
            <div className="sm-empty-ic"><Icon name="upload" size={26} /></div>
            <div className="sm-empty-title">Drop your CSV / XLSX here</div>
            <div className="sm-empty-body">Or use our template (Name, Class, Guardian, Phone…). Max 10,000 rows.</div>
          </label>
          {/* Deliberately OUTSIDE the <label>: inside it, a click was swallowed by the
              label's default behaviour and just reopened the file picker — the button
              looked wired but downloaded nothing. */}
          <div className="row jc-center">
            <Btn
              variant="secondary"
              icon="download"
              onClick={() => {
                void bulkImportTemplateXlsx(refs).then((buf) => downloadArrayBuffer(
                  'student-import-template.xlsx',
                  buf,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                ))
              }}
            >
              Download template
            </Btn>
          </div>
          {upload && (
            <div className="row ai-center gap8 t-sm muted">
              <Icon name="doc" size={14} />
              <span>{upload.fileName}</span>
              <span>Rows detected: {upload.parsed.rows.length}</span>
            </div>
          )}
          {uploadError && (
            <div className="sm-err row ai-center gap8"><Icon name="alert" size={14} />{uploadError}</div>
          )}
        </div>
      )}

      {step === 1 && upload && (
        <div className="col gap10">
          <div className="muted t-sm">Match spreadsheet columns to SchoolMate fields.</div>
          {upload.parsed.headers.map((header, index) => {
            const mappedKey = columnMapping[index] ?? ''
            const mappedField = BULK_IMPORT_FIELDS.find((f) => f.key === mappedKey)
            return (
              <div key={index} className="row ai-center gap12">
                <Badge tone="neutral">{header}</Badge>
                <Icon name="arrowRight" size={14} />
                <Select
                  style={{ flex: 1 }}
                  options={[
                    { value: '', label: 'Ignore' },
                    ...BULK_IMPORT_FIELDS.map((f) => ({ value: f.key, label: f.label })),
                  ]}
                  value={mappedKey}
                  onChange={(e) => setColumnMapping((prev) => ({ ...prev, [index]: e.target.value || null }))}
                />
                {mappedField && (
                  <Badge tone={mappedField.required ? 'brand' : 'neutral'}>{mappedField.required ? 'Required' : 'Optional'}</Badge>
                )}
              </div>
            )
          })}
        </div>
      )}

      {step === 2 && (
        // Error branch FIRST: without it, a failed roster/classes/reference query left this
        // step showing "Preparing preview…" forever, with no message and no way out.
        refsError ? (
          <div className="col gap12">
            <div className="sm-err col gap4">
              <div className="row ai-center gap8">
                <Icon name="alert" size={14} />
                <span className="fw6">Could not load the data needed to check this file</span>
              </div>
              <div className="t-xs">
                Preview compares every row against your live students, classes, houses and transport
                routes. One of those could not be loaded, so the file cannot be checked yet.
              </div>
            </div>
            <div className="row"><Btn variant="secondary" icon="refresh" onClick={retryRefs}>Retry</Btn></div>
          </div>
        ) : rosterQ.isLoading ? (
          <div className="t-sm muted">Loading roster…</div>
        ) : classesQ.isLoading ? (
          <div className="t-sm muted">Loading classes…</div>
        ) : preview === null ? (
          <div className="t-sm muted">Preparing preview…</div>
        ) : (
          <div className="col gap16">
            <div className="row gap12 wrap">
              <Badge tone="neutral">{`Total Rows: ${preview.rows.length}`}</Badge>
              <Badge tone="success">{`Valid: ${preview.validRows.length}`}</Badge>
              <Badge tone="danger">{`Errors: ${preview.errorRows.length}`}</Badge>
              {/* No Warnings badge: warnings were never implemented, so the badge could
                  only ever read "Warnings: 0" — a fake control, removed rather than faked. */}
            </div>

            {preview.errorRows.length > 0 && (
              <div className="col gap10">
                <div className="row ai-center jc-between gap12">
                  <span className="fw6 t-sm">Rows with errors</span>
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon="download"
                    onClick={() => {
                      const csv = errorRowsToCsv(bulkErrorReportRows(preview.errorRows))
                      downloadTextFile('bulk-import-errors.csv', csv)
                    }}
                  >
                    Download Error Report
                  </Btn>
                </div>
                <div className="col gap8" style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {preview.errorRows.map((r) => {
                    const cls = resolveImportClass(refs.classes, r.record.section ?? '').cls
                    const name = [r.record.firstName, r.record.lastName].filter(Boolean).join(' ') || `Row ${r.rowNumber}`
                    return (
                      <div key={r.rowNumber} className="sm-err col gap4">
                        <div className="row ai-center gap8">
                          <Icon name="alert" size={14} />
                          <span className="fw6">Row {r.rowNumber} · {name}{cls ? ` · ${cls}` : ''}</span>
                        </div>
                        <div className="t-xs">{Object.values(r.errors).join('; ')}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {preview.errorRows.length === 0 && (
              <Empty
                icon="checkCircle"
                title="Ready to import"
                body={`${preview.validRows.length} valid row(s) · 0 errors. Click Start Import to enrol all students.`}
              />
            )}
          </div>
        )
      )}

      {step === 3 && (
        <div className="col gap16">
          <div className="t-sm fw6">{`Processed ${bulkImport.progress.processed} / ${bulkImport.progress.total}`}</div>
          <Progress
            value={bulkImport.progress.total > 0 ? (bulkImport.progress.processed / bulkImport.progress.total) * 100 : 0}
          />
          <div className="row gap12 wrap">
            <Badge tone="success">{`Created: ${bulkImport.progress.created}`}</Badge>
            <Badge tone="neutral">{`Skipped: ${bulkImport.progress.skipped}`}</Badge>
            <Badge tone="warning">{`Transport pending: ${bulkImport.progress.transportPending}`}</Badge>
            {/* Only rendered when there really are any — a permanent "Transport issues: 0"
                would be the same fake badge the Warnings count used to be. */}
            {bulkImport.progress.transportFailed > 0 && (
              <Badge tone="danger">{`Transport issues: ${bulkImport.progress.transportFailed}`}</Badge>
            )}
          </div>

          {bulkImport.pausedAtBatch != null && (
            <div className="sm-err col gap4">
              <div className="row ai-center gap8">
                <Icon name="alert" size={14} />
                <span className="fw6">
                  {bulkImport.permissionDenied
                    ? 'Import stopped — permission denied'
                    : `Import paused at batch ${bulkImport.pausedAtBatch + 1} / ${totalBatches}`}
                </span>
              </div>
              <div className="t-xs">
                {bulkImport.lastError || 'This batch failed after several attempts. Check your connection and click Retry Import.'}
              </div>
            </div>
          )}

          {importDone && (() => {
            const { total, created, skipped } = bulkImport.progress
            const skippedResults = bulkImport.progress.rowResults.filter((r) => r.status === 'skipped')
            // A row the server CREATED whose transport mapping failed outright. Not a skip
            // (the student exists) and not "pending" (nothing is awaiting a bus) — it used
            // to be dropped on the floor by the `status === 'skipped'` filter, taking its
            // real explanatory `error` with it. Surfaced as its own class of problem.
            const transportIssueResults = bulkImport.progress.rowResults.filter(isTransportFailedRow)
            const problemResults = [...skippedResults, ...transportIssueResults]
              .sort((a, b) => a.rowNumber - b.rowNumber)
            const reasonFor = (r: BulkImportRowResult): string => (
              r.status === 'skipped'
                ? (r.error || 'Row was skipped during import.')
                : `Student created, but transport was not assigned: ${r.error || 'transport mapping failed.'}`
            )
            const message = skipped === 0
              ? `${total.toLocaleString()} students imported successfully.`
              : `${created.toLocaleString()} students imported. ${skipped.toLocaleString()} rows were skipped.`
            return (
              <div className="col gap16">
                <Empty icon="checkCircle" title={skipped === 0 ? 'Import complete' : 'Import completed with some skipped rows'} body={message} />
                {transportIssueResults.length > 0 && (
                  <div className="sm-err col gap4">
                    <div className="row ai-center gap8">
                      <Icon name="alert" size={14} />
                      <span className="fw6">
                        {`${transportIssueResults.length.toLocaleString()} student(s) were created but could not be mapped to transport`}
                      </span>
                    </div>
                    <div className="t-xs">
                      These students are enrolled. Assign their route and stop from Transport → Students,
                      or re-check the route/stop values in your file. Use View Errors for the per-row reason.
                    </div>
                  </div>
                )}
                <div className="row gap8 wrap">
                  <Btn
                    variant="primary"
                    icon="users"
                    onClick={() => { app.go('school.sis'); reset() }}
                  >
                    View Imported Students
                  </Btn>
                  <Btn
                    variant="secondary"
                    icon="alert"
                    disabled={problemResults.length === 0}
                    onClick={() => setShowSkippedList((v) => !v)}
                  >
                    View Errors
                  </Btn>
                  <Btn
                    variant="secondary"
                    icon="download"
                    disabled={problemResults.length === 0}
                    onClick={() => {
                      const rows: ErrorReportRow[] = problemResults.map((r) => ({
                        Row: String(r.rowNumber),
                        ...(importedRowRecordsRef.current.get(r.rowNumber) ?? {}),
                        Outcome: r.status === 'skipped' ? 'Skipped' : 'Created — transport not assigned',
                        'Error Reason': reasonFor(r),
                      }))
                      const csv = errorRowsToCsv(rows)
                      downloadTextFile('bulk-import-final-errors.csv', csv)
                    }}
                  >
                    Download Error Report
                  </Btn>
                  <Btn variant="secondary" icon="refresh" onClick={resetToUpload}>Import Another File</Btn>
                  <Btn variant="ghost" onClick={reset}>Close</Btn>
                </div>

                {showSkippedList && problemResults.length > 0 && (
                  <div className="col gap8" style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {problemResults.map((r) => {
                      const record = importedRowRecordsRef.current.get(r.rowNumber)
                      const name = record ? [record.firstName, record.lastName].filter(Boolean).join(' ') : ''
                      return (
                        <div key={`${r.status}-${r.rowNumber}`} className="sm-err col gap4">
                          <div className="row ai-center gap8">
                            <Icon name="alert" size={14} />
                            <span className="fw6">Row {r.rowNumber}{name ? ` · ${name}` : ''}</span>
                            <Badge tone={r.status === 'skipped' ? 'neutral' : 'warning'}>
                              {r.status === 'skipped' ? 'Skipped' : 'Transport issue'}
                            </Badge>
                          </div>
                          <div className="t-xs">{reasonFor(r)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      )}
    </Drawer>
  )
}

/* ============================================================
   Toppers — overall leaderboard + class-wise cards
   ============================================================ */
const metricLabel: Record<TopperMetric, string> = { exam: 'Exam %', attendance: 'Attendance %' }
const secondaryHdr: Record<TopperMetric, string> = { exam: 'Attendance', attendance: 'Exam %' }

function RankMedal({ rank }: { rank: number }) {
  const tone = rank === 1 ? '#d4af37' : rank === 2 ? '#9ca3af' : rank === 3 ? '#cd7f32' : null
  if (!tone) return <span className="muted fw6" style={{ width: 26, display: 'inline-block', textAlign: 'center' }}>{rank}</span>
  return (
    <span className="row ai-center jc-center fw7 t-sm" style={{ width: 26, height: 26, borderRadius: 99, flex: '0 0 auto', background: tone, color: '#fff' }}>{rank}</span>
  )
}

function Leaderboard({ rows, metric, onPick, examLabel }: {
  rows: ScoredStudent[]; metric: TopperMetric; onPick: (id: string) => void; examLabel?: string
}) {
  return (
    <Card pad={false}>
      <div style={{ padding: 16 }}>
        <CardHead
          title="Overall toppers"
          sub={examLabel
            ? `Top ${rows.length} · ${examLabel} · live marks`
            : `Top ${rows.length} · school-wide`}
          icon="cap"
        />
      </div>
      <table className="sm-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>Rank</th>
            <th>Student</th>
            <th>Class</th>
            <th className="ta-right">{metricLabel[metric]}</th>
            <th className="ta-right">{secondaryHdr[metric]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.student.id} style={{ cursor: 'pointer' }} onClick={() => onPick(r.student.id)}>
              <td><RankMedal rank={i + 1} /></td>
              <td>
                <div className="row ai-center gap10">
                  <Avatar name={properName(r.student.name)} hue={r.student.avatarHue} size={30} src={studentPhotoUrl(r.student.id)} />
                  <div>
                    <div className="fw6">{properName(r.student.name)}</div>
                    <div className="t-xs muted">{r.student.adm}</div>
                  </div>
                </div>
              </td>
              <td className="fw6">{r.student.cls}</td>
              <td className="ta-right fw7">{r.score}%</td>
              <td className="ta-right muted">{metric === 'exam' ? `${r.secondary}%` : (r.secondary > 0 ? `${r.secondary}%` : '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ClassToppersGrid({ groups, onPick }: { groups: ClassTopperGroup[]; onPick: (id: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
      {groups.map((g) => (
        <Card key={g.cls}>
          <CardHead title={`Class ${g.cls}`} sub={`Top ${g.toppers.length}`} icon="users" />
          <div className="col gap10" style={{ marginTop: 8 }}>
            {g.toppers.map((r, i) => (
              <div key={r.student.id} className="row ai-center gap10" style={{ cursor: 'pointer' }} onClick={() => onPick(r.student.id)}>
                <RankMedal rank={i + 1} />
                <Avatar name={properName(r.student.name)} hue={r.student.avatarHue} size={28} src={studentPhotoUrl(r.student.id)} />
                <div style={{ flex: 1 }}>
                  <div className="fw6">{properName(r.student.name)}</div>
                  <div className="t-xs muted">{r.student.adm}</div>
                </div>
                <span className="fw7 t-sm">{r.score}%</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  )
}

function ToppersView({ students, onPick }: { students: Student[]; onPick: (id: string) => void }) {
  const [cat, setCat] = useState<TopperMetric>('exam')
  const examsQ = useExams()
  const latestExam = useMemo(() => pickLatestExam(examsQ.data), [examsQ.data])

  const marksQ = useExamMarksMap(latestExam?.id ?? null)
  const papersQ = useExamPapers(latestExam?.id ?? null)
  const examSubjects = useMemo(
    () => [...new Set((papersQ.data ?? []).map((p) => p.subject).filter(Boolean))],
    [papersQ.data],
  )
  const liveMarks = marksQ.data ?? {}
  const subjectMax = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of papersQ.data ?? []) {
      if (p.subject) m[p.subject] = p.maxMarks || 100
    }
    return m
  }, [papersQ.data])
  const getMax = useMemo(() => (subject: string) => subjectMax[subject] ?? 100, [subjectMax])
  /* Official period attendance % from student API (PeriodAttendanceRecords aggregate). */
  const getAttendance = useMemo(
    () => (sid: string): number | null => {
      const s = students.find((x) => x.id === sid)
      return s?.attendance == null ? null : Number(s.attendance)
    },
    [students],
  )
  const scoreOpts = useMemo<TopperScoreOpts>(() => {
    /* Always resolve exam % from live marks (never the seeded/dummy report),
       so it is correct whether it's the primary column (Exam toppers) or the
       secondary column (Attendance toppers). No live marks → null → shown as "—". */
    const opts: TopperScoreOpts = { getAttendance, liveOnly: true, getMax }
    if (latestExam?.id) {
      opts.examId = latestExam.id
      opts.subjects = examSubjects.length ? examSubjects : undefined
      opts.getMark = (sid, subject) => liveMarks[markKey(latestExam.id, sid, subject)]
    }
    return opts
  }, [latestExam, examSubjects, liveMarks, getAttendance, getMax])

  const overall = useMemo(
    () => overallToppers(students, cat, 10, scoreOpts),
    [students, cat, scoreOpts],
  )
  const byClass = useMemo(
    () => classToppers(students, cat, 3, scoreOpts),
    [students, cat, scoreOpts],
  )
  const catTabs = [
    { value: 'exam', label: 'Exam toppers', icon: 'cap' },
    { value: 'attendance', label: 'Attendance toppers', icon: 'calendar' },
  ]
  const examLoading = cat === 'exam' && (examsQ.isLoading || marksQ.isLoading || papersQ.isLoading)
  const noLiveExam = cat === 'exam' && !examLoading && overall.length === 0
  const noLiveAttendance = cat === 'attendance' && overall.length === 0

  return (
    <div className="col gap16">
      <Tabs value={cat} onChange={(v) => setCat(v as TopperMetric)} tabs={catTabs} />
      {students.length === 0
        ? <Empty icon="users" title="No students" body="Add students to see toppers." />
        : examLoading
          ? <div className="t-sm muted" style={{ padding: 24 }}>Loading live exam marks…</div>
          : noLiveExam
            ? (
              <Empty
                icon="cap"
                title="No live exam marks yet"
                body="Enter marks under Exams → Marks entry. Sample / dummy exam % is not shown on toppers."
              />
            )
            : noLiveAttendance
            ? (
              <Empty
                icon="calendar"
                title="No live attendance yet"
                body="Mark students under Attendance. Toppers rank on real day marks — the dummy SIS % is not used."
              />
            )
            : (
              <>
                <Leaderboard
                  rows={overall}
                  metric={cat}
                  onPick={onPick}
                  examLabel={cat === 'exam' && latestExam ? latestExam.name : undefined}
                />
                {byClass.length === 0
                  ? null
                  : <ClassToppersGrid groups={byClass} onPick={onPick} />}
              </>
            )}
    </div>
  )
}

/* ============================================================
   StudentsScreen — SIS list
   ============================================================ */
function StudentsScreen() {
  const app = useApp()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [grade, setGrade] = useState('all')
  const [status, setStatus] = useState('all')
  const [fee, setFee] = useState('all')
  const [importOpen, setImportOpen] = useState(false)
  const [view, setView] = useState<'list' | 'toppers'>('list')
  const [cursor, setCursor] = useState<string | undefined>()
  const [prevCursors, setPrevCursors] = useState<string[]>([])

  const editable = canEdit(app.role)
  const bulkImportable = canBulkImport(app.role)
  const classesQ = useClasses()

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 300)
    return () => window.clearTimeout(t)
  }, [q])

  useEffect(() => {
    setCursor(undefined)
    setPrevCursors([])
  }, [qDebounced, grade, status, fee])

  const listOpts = {
    q: qDebounced.trim() || undefined,
    grade,
    status,
    fee,
    limit: 25 as const,
    cursor,
  }
  const pageQ = useStudentsPage({ ...listOpts, enabled: view === 'list' })
  const toppersQ = useStudents({ enabled: view === 'toppers' })

  const students = view === 'toppers' ? (toppersQ.data ?? []) : (pageQ.data?.rows ?? [])
  const nextCursor = pageQ.data?.nextCursor ?? null

  /* Official period attendance % from student API; null when unmarked. */
  const attendancePctOf = (s: Student): number | null =>
    s.attendance == null ? null : Number(s.attendance)

  const gradeOptions = useMemo(() => {
    const unique = new Set<string>([...DEFAULT_GRADES])
    for (const c of classesQ.data ?? []) {
      if (c.grade) unique.add(c.grade)
    }
    return [...unique]
  }, [classesQ.data])

  const rows = students

  const columns: Column<Student>[] = [
    {
      key: 'name', label: 'Student', sortValue: (s) => s.name,
      render: (s) => (
        <div className="row ai-center gap10">
          <Avatar name={s.name} hue={s.avatarHue} size={34} src={studentPhotoUrl(s.id)} />
          <div>
            <div className="fw6">{s.name}</div>
            <div className="t-xs muted">{s.adm} · {s.gender === 'M' ? 'Male' : 'Female'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'cls', label: 'Class', sortValue: (s) => s.cls,
      render: (s) => (
        <div>
          <div className="fw6">{s.cls}</div>
          <div className="t-xs muted">Roll {formatStudentRoll(s.roll)}</div>
        </div>
      ),
    },
    {
      key: 'guardian', label: 'Guardian', sortValue: (s) => studentGuardianName(s) || s.guardian,
      render: (s) => (
        <div>
          <div>{studentGuardianName(s) || '—'}</div>
          <div className="t-xs muted">{s.phone || '—'}</div>
        </div>
      ),
    },
    {
      key: 'attendance', label: 'Attendance', align: 'left', sortValue: (s) => attendancePctOf(s) ?? -1,
      render: (s) => {
        const pct = attendancePctOf(s)
        return pct == null
          ? <span className="t-sm muted3">Not marked</span>
          : (
            <div className="row ai-center gap8" style={{ minWidth: 120 }}>
              <div style={{ flex: 1 }}><Progress value={pct} color={attColor(pct)} /></div>
              <span className="t-sm fw6" style={{ width: 34 }}>{pct}%</span>
            </div>
          )
      },
    },
    {
      key: 'fee', label: 'Fees', sortValue: (s) => s.feeDue,
      render: (s) => (
        <div className="row ai-center gap8">
          <Badge tone={feeTone[s.feeStatus]} dot>{feeLabel[s.feeStatus]}</Badge>
          {s.feeDue > 0 && <span className="t-xs muted">{fmtMoney(s.feeDue)}</span>}
        </div>
      ),
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (s) => s.status,
      render: (s) => <Badge tone={s.status === 'active' ? 'success' : 'neutral'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge>,
    },
  ]

  const sub = view === 'toppers'
    ? `${students.length} students · ${app.school.name}`
    : `${rows.length} on this page${nextCursor ? ' · more available' : ''} · ${app.school.name}`

  return (
    <div>
      <PageHead
        title="Students (SIS)"
        sub={sub}
        actions={editable ? (
          <>
            <Btn variant="primary" icon="plus" onClick={() => app.go('school.sis.add')}>Add Student</Btn>
            {/* Bulk import needs a stricter role than single Add (see canBulkImport):
                showing it to a role the server will 403 is a working-looking dead end. */}
            {bulkImportable && (
              <Btn variant="secondary" icon="upload" onClick={() => setImportOpen(true)}>Bulk Import</Btn>
            )}
            <Btn variant="secondary" icon="arrowRight" onClick={() => toast.info('Promote class', 'Open the year-end promotion wizard to advance students.')}>Promote class</Btn>
          </>
        ) : <Badge tone="neutral" icon="eye">View only</Badge>}
      />

      <div style={{ margin: '0 0 16px' }}>
        <Tabs
          value={view}
          onChange={(v) => setView(v as 'list' | 'toppers')}
          tabs={[
            { value: 'list', label: 'All students', icon: 'users' },
            { value: 'toppers', label: 'Toppers', icon: 'cap' },
          ]}
        />
      </div>

      {view === 'toppers' ? (
        <ToppersView students={students} onPick={(id) => app.go('school.student', { focus: id })} />
      ) : (
      <>
      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search name, admission no, class…" style={{ flex: 1, minWidth: 220 }} />
          <Select options={['all', ...gradeOptions]} value={grade} onChange={(e) => setGrade(e.target.value)} />
          <Select options={[{ value: 'all', label: 'All status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} value={status} onChange={(e) => setStatus(e.target.value)} />
          <Select options={[{ value: 'all', label: 'All fees' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'due', label: 'Due' }]} value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>

        <DataTable<Student>
          columns={columns}
          rows={rows}
          pageSize={25}
          rowKey={(s) => s.id}
          initialSort={{ key: 'name', dir: 'asc' }}
          bulk
          onRowClick={(s) => app.go('school.student', { focus: s.id })}
          bulkActions={(selected, clear) => (
            <>
              <Btn
                variant="secondary"
                size="sm"
                icon="message"
                onClick={() => {
                  const emails = [...new Set(selected.flatMap((s) => guardianEmailsFromStudent(s)))]
                  if (!emails.length) {
                    toast.danger('No guardian emails', 'Selected students have no guardian email on file.')
                    return
                  }
                  try {
                    openMailCompose({
                      to: emails,
                      subject: `Message from ${app.school.name}`,
                      body: 'Dear Parent / Guardian,\n\n',
                    })
                    toast.success('Opening mail', `Compose to ${emails.length} guardian email(s).`)
                    clear()
                  } catch (err) {
                    toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
                  }
                }}
              >
                Message
              </Btn>
              <Btn variant="secondary" size="sm" icon="arrowRight" onClick={() => { toast.success('Promoted', `${selected.length} student(s) advanced.`); clear() }}>Promote</Btn>
              <Btn variant="ghost" size="sm" onClick={clear}>Clear</Btn>
            </>
          )}
          empty={<Empty icon="users" title="No students match" body="Try adjusting the search or filters." />}
        />
        <div className="row ai-center jc-between gap12" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <Btn
            variant="secondary"
            size="sm"
            disabled={!prevCursors.length || pageQ.isFetching}
            onClick={() => {
              const prev = prevCursors[prevCursors.length - 1]
              setPrevCursors((s) => s.slice(0, -1))
              setCursor(prev)
            }}
          >
            Previous
          </Btn>
          <span className="t-xs muted">{pageQ.isFetching ? 'Loading…' : `${rows.length} students`}</span>
          <Btn
            variant="secondary"
            size="sm"
            disabled={!nextCursor || pageQ.isFetching}
            onClick={() => {
              setPrevCursors((s) => [...s, cursor ?? ''])
              setCursor(nextCursor ?? undefined)
            }}
          >
            Next
          </Btn>
        </div>
      </Card>

      <ImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />
      </>
      )}
    </div>
  )
}

/* ============================================================
   Student 360 — full profile
   ============================================================ */
function StatTile({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <div className="row ai-center gap10">
      <span className="sm-kpi-ic" style={{ color: color, background: 'var(--surface-2)' }}><Icon name={icon} size={18} /></span>
      <div>
        <div className="fw7 t-lg">{value}</div>
        <div className="t-xs muted">{label}</div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  const v = value === undefined || value === null || String(value).trim() === '' ? '—' : String(value)
  return (
    <div className="row ai-center jc-between gap12" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted t-sm">{label}</span>
      <span className="fw6 t-sm" style={{ textAlign: 'right' }}>{v}</span>
    </div>
  )
}

function Student360() {
  const app = useApp()
  const toast = useToast()
  const [tab, setTab] = useState('details')
  const [openMonth, setOpenMonth] = useState<string | null>(null)
  const editable = canEdit(app.role)

  const { data: fetched, isLoading, isError } = useStudent(app.focus)
  const examsQ = useExams()
  const classesQ = useClasses()
  const studentsQ = useStudents({
    grade: fetched?.grade,
    enabled: Boolean(fetched?.grade),
  })
  const latestExam = useMemo(() => pickLatestExam(examsQ.data), [examsQ.data])
  // NOTE: keep every hook above the loading/error guards below so the hook
  // order stays stable across renders (React crashes otherwise).
  const classId = (classesQ.data ?? []).find((c) => classLabelOf(c) === fetched?.cls)?.id
  const papersQ = useExamPapers(latestExam?.id ?? null)
  /* One request for this student's marks — not N× /exam-papers/{id}/grades. */
  const studentGradesQ = useStudentGrades(fetched?.id ?? null)
  /* Peer marks for class rank: only this class's papers, and only when rank UI needs them. */
  const needPeerMarks = tab === 'overview' || tab === 'academics'
  const marksQ = useExamMarksMap(latestExam?.id ?? null, {
    classId: classId ?? null,
    enabled: needPeerMarks && !!classId,
  })
  const monthsQ = useStudentMonthlyAttendance(
    fetched?.id,
    classId,
    Boolean(fetched) && (tab === 'attendance' || tab === 'overview' || tab === 'timeline'),
  )
  const invoicesQ = useFeeInvoices()
  const paymentsQ = useFeePayments()
  const [extrasTick, setExtrasTick] = useState(0)

  useEffect(() => {
    if (!fetched?.id) return
    let cancelled = false
    void fetchStudentExtras(fetched.id)
      .then(() => { if (!cancelled) setExtrasTick((n) => n + 1) })
      .catch(() => { /* keep cache/legacy */ })
    return () => { cancelled = true }
  }, [fetched?.id])

  if (isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 240 }}><div className="t-sm muted">Loading student…</div></div>
  }
  if (isError || !fetched) {
    return (
      <div>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.sis')}>Back to students</Btn>
        <Empty icon="user" title="Student not found" body="This student is not in the live SIS for this school." />
      </div>
    )
  }
  const stu = fetched
  const classPapers = (papersQ.data ?? []).filter((p) => !classId || !p.classId || p.classId === classId)
  const examSubjects = [...new Set(classPapers.map((p) => p.subject).filter(Boolean))]
  const examId = latestExam?.id
  const liveMarks = marksQ.data ?? {}
  const subjectMax: Record<string, number> = {}
  for (const p of classPapers) {
    if (p.subject) subjectMax[p.subject] = p.maxMarks || 100
  }
  const getMax = (subject: string) => subjectMax[subject] ?? 100
  const paperIds = new Set(classPapers.map((p) => p.id))
  const studentMarkBySubject = new Map<string, number>()
  for (const g of studentGradesQ.data ?? []) {
    if (!paperIds.has(g.examPaperId)) continue
    const subject = g.subject || classPapers.find((p) => p.id === g.examPaperId)?.subject
    if (subject) studentMarkBySubject.set(subject, g.marks)
  }
  const getMark = (sid: string, subject: string) => {
    if (sid === stu.id) {
      const own = studentMarkBySubject.get(subject)
      if (own != null) return own
    }
    return examId ? liveMarks[markKey(examId, sid, subject)] : undefined
  }
  const peers = (studentsQ.data ?? []).filter((s) => s.cls === stu.cls)
  const live = { liveOnly: true as const, getMax }
  const report = examId && examSubjects.length
    ? reportFor(stu, examId, getMark, examSubjects, live)
    : { rows: [], total: 0, maxTotal: 0, pct: 0, grade: '—', gpa: 0, result: 'PASS' as const }
  const hasLiveMarks = report.rows.length > 0
  const rank = hasLiveMarks && examId && needPeerMarks && marksQ.data
    ? classRank(stu, examId, getMark, peers, examSubjects, live)
    : { rank: 0, classSize: peers.length }
  const academicsSub = hasLiveMarks && latestExam
    ? `${latestExam.name} · live marks · Overall ${report.pct}% · Grade ${report.grade} · Rank ${rank.rank}/${rank.classSize}`
    : 'No live exam marks yet — enter under Exams → Marks entry'
  const guardian = studentGuardianName(stu) || stu.guardian
  const attRecords = monthsQ.data ?? []
  const months = monthlyBreakdown(attRecords, stu.id)
  /* Official period % from API (PeriodAttendanceRecords); null when unmarked. */
  const attPct = stu.attendance == null ? null : Number(stu.attendance)
  const attPctLabel = attPct == null ? 'Not marked' : `${attPct}%`
  const academicStartYear = (() => {
    const m = String(stu.academicYear || '').match(/\d{4}/)
    return m ? Number(m[0]) : academicYearStart()
  })()
  const monthAxis = monthlySeriesForKeys(attRecords, stu.id, academicYearMonthKeys(academicStartYear))
  const markedMonths = months // months that actually have marks (for stats)
  const openMonthDays = openMonth ? monthDailyGrid(attRecords, stu.id, openMonth) : []
  const docs = listStoredDocs(stu.id, stu)
  void extrasTick
  const photoUrl = studentPhotoUrl(stu.id) ?? docs.find((d) => d.key === 'photo' && d.dataUrl)?.dataUrl
  const fatherPhotoUrl = docs.find((d) => d.key === 'fatherPhoto' && d.dataUrl)?.dataUrl
  const motherPhotoUrl = docs.find((d) => d.key === 'motherPhoto' && d.dataUrl)?.dataUrl

  const tabs = [
    { value: 'details', label: 'Details', icon: 'user' },
    { value: 'overview', label: 'Overview', icon: 'grid' },
    { value: 'academics', label: 'Academics', icon: 'cap' },
    { value: 'attendance', label: 'Attendance', icon: 'calendar' },
    { value: 'fees', label: 'Fees', icon: 'rupee' },
    { value: 'documents', label: 'Documents', icon: 'doc' },
    { value: 'timeline', label: 'Timeline', icon: 'clock' },
  ]

  // Live fee ledger — invoices for this student (API or local fallback).
  const studentInvoices = (invoicesQ.data ?? []).filter(
    (inv) => inv.studentId === stu.id || (stu.adm && inv.studentAdm === stu.adm),
  )
  const ledger = studentInvoices.map((inv) => ({
    id: inv.id,
    /** Per-fee-head breakdown of this invoice's total — e.g. "Tuition Fee ₹1,000 · Transport Fee ₹500" —
     *  so the admin/parent can see what makes up the amount, not just a lump sum. Falls back to the
     *  period label for invoices created before line items existed (or created manually). */
    label: inv.lines?.length
      ? inv.lines.map((l) => `${l.headName} ${fmtMoney(l.amount)}`).join(' · ')
      : [inv.term, inv.academicYear].filter(Boolean).join(' · ') || 'Fee invoice',
    amount: inv.total,
    paid: inv.paid,
    date: inv.dueDate || '—',
  }))
  const ledgerOutstanding = studentInvoices.length
    ? studentInvoices.reduce((s, inv) => s + (inv.due || 0), 0)
    : stu.feeDue

  const timeline = buildStudentTimeline({
    student: stu,
    payments: paymentsQ.data ?? [],
    invoices: studentInvoices,
    attendance: attRecords,
  })
  const feeTimeline = buildStudentTimeline({
    student: stu,
    payments: paymentsQ.data ?? [],
    invoices: studentInvoices,
    feeOnly: true,
  })
  const timelineLoading = paymentsQ.isLoading || invoicesQ.isLoading || monthsQ.isLoading
  const feeTimelineLoading = paymentsQ.isLoading || invoicesQ.isLoading

  const fmtSize = (n: number) => (n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : '—')

  return (
    <div>
      <div className="row ai-center gap12" style={{ marginBottom: 16 }}>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.sis')}>Back to students</Btn>
        <Btn variant="ghost" icon="users" onClick={() => app.go('school.parents')}>Parents</Btn>
      </div>

      <Card>
        <div className="row ai-center gap16 wrap jc-between">
          <div className="row ai-center gap16">
            <Avatar name={stu.name} hue={stu.avatarHue} size={68} src={photoUrl} />
            <div>
              <div className="row ai-center gap8 wrap">
                <h2 className="sm-pagehead-title" style={{ margin: 0 }}>{stu.name}</h2>
                <Badge tone={stu.status === 'active' ? 'success' : 'neutral'}>{stu.status === 'active' ? 'Active' : 'Inactive'}</Badge>
                {hasLiveMarks && latestExam && <Badge tone="brand">{latestExam.name}</Badge>}
              </div>
              <div className="row ai-center gap12 wrap muted t-sm" style={{ marginTop: 4 }}>
                <span>{stu.adm}</span><span>·</span>
                <span>Class {stu.cls} · Roll {formatStudentRoll(stu.roll)}</span><span>·</span>
                <span>{stu.house || '—'} House</span><span>·</span>
                <span>{guardian || '—'} · {stu.phone || '—'}</span>
              </div>
            </div>
          </div>
          <div className="row ai-center gap12 wrap">
            <StatTile icon="calendar" label="Attendance" value={attPctLabel} color={attPct == null ? 'var(--text-3)' : attColor(attPct)} />
            <StatTile
              icon="cap"
              label={hasLiveMarks && rank.rank > 0 ? `Rank · ${rank.rank}/${rank.classSize}` : 'Exam %'}
              value={hasLiveMarks ? `${report.pct}%` : '—'}
              color="var(--brand-600)"
            />
            <StatTile icon="rupee" label="Fee status" value={feeLabel[stu.feeStatus]} color={`var(--${feeTone[stu.feeStatus] === 'success' ? 'success' : feeTone[stu.feeStatus] === 'warning' ? 'warning' : 'danger'})`} />
            {editable && (
              <Btn variant="primary" icon="edit" onClick={() => app.go('school.sis.edit', { focus: stu.id })}>Edit</Btn>
            )}
            <Btn
              variant="secondary"
              icon="message"
              onClick={() => {
                const emails = guardianEmailsFromStudent(stu)
                if (!emails.length) {
                  toast.danger('No email on file', `Add a guardian email for ${guardian || stu.name} before messaging.`)
                  return
                }
                try {
                  openMailCompose({
                    to: emails,
                    subject: `Regarding ${stu.name} · ${app.school.name}`,
                    body: `Dear ${guardian || 'Parent / Guardian'},\n\n`,
                  })
                  toast.success('Opening mail', `Compose email to ${guardian || 'guardian'}.`)
                } catch (err) {
                  toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
                }
              }}
            >
              Message
            </Btn>
          </div>
        </div>
      </Card>

      <div style={{ margin: '16px 0' }}>
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {tab === 'details' && (
        <div className="sm-grid-2 gap16">
          <Card>
            <CardHead title="Student" icon="user" />
            <div style={{ marginTop: 4 }}>
              <DetailRow label="Admission no." value={stu.adm} />
              <DetailRow label="Name" value={stu.name} />
              <DetailRow label="Gender" value={stu.gender === 'F' ? 'Female' : 'Male'} />
              <DetailRow label="Date of birth" value={stu.dob} />
              <DetailRow label="Class / section" value={stu.cls} />
              <DetailRow label="Roll" value={formatStudentRoll(stu.roll)} />
              <DetailRow label="House" value={stu.house} />
              <DetailRow label="Email" value={stu.email} />
              <DetailRow label="Address" value={stu.address} />
              <DetailRow label="Blood group" value={stu.bloodGroup} />
              <DetailRow label="Religion" value={stu.religion} />
              <DetailRow label="Category" value={stu.category} />
              <DetailRow label="Caste" value={stu.caste} />
              <DetailRow label="Mother tongue" value={stu.motherTongue} />
              <DetailRow label="Languages" value={stu.languages} />
              <DetailRow label="Last school" value={stu.lastSchool} />
              <DetailRow label="Aadhaar" value={stu.aadhaar} />
              <DetailRow label="Academic year" value={stu.academicYear} />
              <DetailRow label="Admission date" value={stu.admissionDate} />
            </div>
          </Card>
          <div className="col gap16">
            <Card>
              <CardHead title="Guardian / parents" icon="users" />
              <div style={{ marginTop: 4 }}>
                {(fatherPhotoUrl || motherPhotoUrl) && (
                  <div className="row ai-center gap16" style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                    {fatherPhotoUrl && (
                      <div className="col ai-center gap6">
                        <img src={fatherPhotoUrl} alt="Father" className="sm-upload-thumb is-photo" style={{ width: 64, height: 64 }} />
                        <span className="t-xs muted">Father</span>
                      </div>
                    )}
                    {motherPhotoUrl && (
                      <div className="col ai-center gap6">
                        <img src={motherPhotoUrl} alt="Mother" className="sm-upload-thumb is-photo" style={{ width: 64, height: 64 }} />
                        <span className="t-xs muted">Mother</span>
                      </div>
                    )}
                  </div>
                )}
                <DetailRow label="Guardian" value={guardian} />
                <DetailRow label="Phone" value={stu.phone} />
                <DetailRow label="Guardian email" value={stu.guardianEmail} />
                <DetailRow label="Father" value={stu.father?.name} />
                <DetailRow label="Father phone" value={stu.father?.phone} />
                <DetailRow label="Father email" value={stu.father?.email} />
                <DetailRow label="Father occupation" value={stu.father?.occupation} />
                <DetailRow label="Mother" value={stu.mother?.name} />
                <DetailRow label="Mother phone" value={stu.mother?.phone} />
                <DetailRow label="Mother email" value={stu.mother?.email} />
                <DetailRow label="Mother occupation" value={stu.mother?.occupation} />
              </div>
            </Card>
            <Card>
              <CardHead title="Fees & status" icon="rupee" />
              <div style={{ marginTop: 4 }}>
                <DetailRow label="Fee status" value={feeLabel[stu.feeStatus]} />
                <DetailRow label="Outstanding" value={fmtMoney(ledgerOutstanding)} />
                <DetailRow label="Attendance" value={attPctLabel} />
                <DetailRow label="Status" value={stu.status} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'overview' && (
        <div className="sm-grid-2 gap16">
          <Card>
            <CardHead
              title="Performance by subject"
              sub={hasLiveMarks && latestExam ? `${latestExam.name} · marks out of 100` : 'Live exam marks only'}
              icon="cap"
            />
            {hasLiveMarks ? (
              <Bars data={report.rows.map((r) => ({ label: r.subject.slice(0, 4), value: r.marks, color: attColor(r.marks) }))} h={150} valueFmt={(v) => v} />
            ) : (
              <Empty icon="cap" title="No live marks" body="Enter marks under Exams → Marks entry. Sample scores are not shown." />
            )}
          </Card>
          <Card>
            <CardHead title="Snapshot" icon="user" />
            <div className="col gap14" style={{ marginTop: 8 }}>
              <div className="row ai-center jc-between"><span className="muted t-sm">Overall</span><span className="fw7">{hasLiveMarks ? `${report.pct}% · ${report.grade}` : '—'}</span></div>
              <div className="row ai-center jc-between"><span className="muted t-sm">Class rank</span><span className="fw7">{hasLiveMarks && rank.rank > 0 ? `${rank.rank} / ${rank.classSize}` : '—'}</span></div>
              <div className="row ai-center jc-between"><span className="muted t-sm">GPA</span><span className="fw7">{hasLiveMarks ? report.gpa : '—'}</span></div>
              <div className="row ai-center jc-between"><span className="muted t-sm">Result</span>{hasLiveMarks ? <Badge tone={report.result === 'PASS' ? 'success' : 'danger'}>{report.result}</Badge> : <span className="fw7">—</span>}</div>
              <div className="row ai-center jc-between">
                <span className="muted t-sm">Attendance trend</span>
                {months.length
                  ? <Spark data={months.map((m) => m.value)} w={120} color={attColor(attPct ?? 0)} />
                  : <span className="fw7 t-sm muted">{attPctLabel}</span>}
              </div>
              <div className="row ai-center jc-between"><span className="muted t-sm">Outstanding fees</span><span className="fw7">{fmtMoney(ledgerOutstanding)}</span></div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'academics' && (
        <Card pad={false}>
          <div style={{ padding: 16 }}>
            <CardHead
              title="Subject-wise marks"
              sub={academicsSub}
              icon="cap"
              action={hasLiveMarks ? (
                <div className="row ai-center gap8">
                  <Badge tone={report.result === 'PASS' ? 'success' : 'danger'}>{report.result}</Badge>
                  <Btn
                    variant="secondary"
                    size="sm"
                    icon="download"
                    onClick={() => {
                      const school = app.school
                      const ok = printReportCard({
                        schoolName: properName(school.name),
                        schoolCity: properPlace(school.city),
                        schoolSlug: school.slug,
                        schoolLogoInitials: (school.logo || school.name.slice(0, 2)).toUpperCase(),
                        schoolLogoUrl: school.logoUrl,
                        schoolImageUrl: school.imageUrl,
                        schoolBrandColor: school.color,
                        examName: properName(latestExam?.name) || latestExam?.name,
                        student: {
                          ...stu,
                          name: properName(stu.name),
                          guardian: properName(guardian) || guardian,
                          attendance: attPct ?? stu.attendance,
                        },
                        report,
                        rank: rank.rank,
                        classSize: rank.classSize || peers.length,
                      })
                      if (!ok) toast.danger('Could not open print', 'Allow pop-ups, then try Print again.')
                      else toast.success('Print / PDF', 'In the print dialog choose Save as PDF if you want a file.')
                    }}
                  >
                    Print
                  </Btn>
                </div>
              ) : undefined}
            />
          </div>
          {!hasLiveMarks ? (
            <div style={{ padding: '0 16px 16px' }}>
              <Empty
                icon="cap"
                title="No live exam marks yet"
                body="Enter marks under Exams → Marks entry (class-wise). Dummy sample scores are not shown."
              />
            </div>
          ) : (
          <table className="sm-table">
            <thead>
              <tr><th>Subject</th><th className="ta-right">Marks</th><th className="ta-right">Max</th><th className="ta-center">Grade</th><th className="ta-center">Result</th></tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.subject}>
                  <td className="fw6">{r.subject}</td>
                  <td className="ta-right">{r.marks}</td>
                  <td className="ta-right muted">{r.max}</td>
                  <td className="ta-center"><Badge tone="brand">{r.grade}</Badge></td>
                  <td className="ta-center"><Badge tone={r.pass ? 'success' : 'danger'}>{r.pass ? 'Pass' : 'Fail'}</Badge></td>
                </tr>
              ))}
              <tr>
                <td className="fw7">Total</td>
                <td className="ta-right fw7">{report.total}</td>
                <td className="ta-right muted">{report.maxTotal}</td>
                <td className="ta-center fw7">{report.grade}</td>
                <td className="ta-center fw7">{report.pct}%</td>
              </tr>
            </tbody>
          </table>
          )}
        </Card>
      )}

      {tab === 'attendance' && (
        <Card>
          <CardHead
            title="Monthly attendance"
            sub={monthsQ.isLoading
              ? 'Loading live marks…'
              : months.length
                ? `From class attendance marks · year average ${attPctLabel}`
                : `Year average ${attPctLabel} · no monthly marks yet`}
            icon="calendar"
          />
          {monthsQ.isLoading ? (
            <div className="t-sm muted" style={{ padding: '24px 0' }}>Loading attendance…</div>
          ) : months.length === 0 ? (
            <Empty
              icon="calendar"
              title="No monthly attendance yet"
              body="Mark students under Attendance. This chart uses real day marks only — sample months are not shown."
            />
          ) : (
            <>
              <Bars
                data={monthAxis.map((m) => ({
                  label: m.label,
                  value: m.value,
                  color: attColor(m.value),
                  valueLabel: m.total ? `${m.value}%` : '—',
                  empty: m.total === 0,
                }))}
                h={160}
                activeIndex={openMonth ? monthAxis.findIndex((m) => m.key === openMonth) : undefined}
                onBarClick={(i) => {
                  const key = monthAxis[i]?.key
                  if (key) setOpenMonth((cur) => (cur === key ? null : key))
                }}
              />
              <div className="t-xs muted3" style={{ marginTop: 6 }}>Blank months have no marks yet. Click a month to see its daily marks.</div>
              {markedMonths.length > 0 && (
                <div className="row ai-center gap20 wrap" style={{ marginTop: 16 }}>
                  <StatTile icon="check" label="Best month" value={Math.max(...markedMonths.map((m) => m.value)) + '%'} color="var(--success)" />
                  <StatTile icon="alert" label="Lowest month" value={Math.min(...markedMonths.map((m) => m.value)) + '%'} color="var(--warning)" />
                  <StatTile
                    icon="trend"
                    label="Trend"
                    value={markedMonths[markedMonths.length - 1].value >= markedMonths[0].value ? 'Improving' : 'Declining'}
                    color="var(--brand-600)"
                  />
                </div>
              )}
              {openMonth && (() => {
                const m = months.find((x) => x.key === openMonth)
                return (
                  <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                    <div className="row ai-center jc-between gap12 wrap" style={{ marginBottom: 12 }}>
                      <div className="row ai-center gap8">
                        <span className="fw7">{m?.label} daily marks</span>
                        {m && <Badge tone={attColor(m.value) === 'var(--success)' ? 'success' : m.value >= 75 ? 'warning' : 'danger'}>{m.present}/{m.total} present · {m.value}%</Badge>}
                      </div>
                      <Btn variant="ghost" size="sm" icon="x" onClick={() => setOpenMonth(null)}>Close</Btn>
                    </div>
                    {openMonthDays.length === 0 ? (
                      <div className="t-sm muted">No day marks recorded for this month.</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                        {openMonthDays.map((d) => (
                          <div
                            key={d.date}
                            className="row ai-center jc-between gap8"
                            style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 10, opacity: d.status ? 1 : (d.weekend ? 0.5 : 0.7) }}
                          >
                            <span className="t-sm fw6">{fmtDayLabel(d.date)}</span>
                            {d.status
                              ? <Badge tone={dayStatusTone[d.status]} dot>{dayStatusLabel[d.status]}</Badge>
                              : <span className="t-xs muted3">{d.weekend ? 'Weekend' : 'Blank'}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}
        </Card>
      )}

      {tab === 'fees' && (
        <div className="col gap16">
          <Card pad={false}>
            <div style={{ padding: 16 }}>
              <CardHead
                title="Fee ledger"
                sub={invoicesQ.isLoading
                  ? 'Loading invoices…'
                  : `Outstanding ${fmtMoney(ledgerOutstanding)} · ${ledger.length} invoice${ledger.length === 1 ? '' : 's'}`}
                icon="rupee"
                action={<Badge tone={feeTone[stu.feeStatus]} dot>{feeLabel[stu.feeStatus]}</Badge>}
              />
            </div>
            {invoicesQ.isLoading ? (
              <div className="t-sm muted" style={{ padding: '0 16px 20px' }}>Loading fee invoices…</div>
            ) : ledger.length === 0 ? (
              <div style={{ padding: '0 16px 16px' }}>
                <Empty
                  icon="rupee"
                  title="No invoices yet"
                  body="No fee invoices for this student. Generate invoices under Fees to see the live ledger here."
                />
              </div>
            ) : (
            <table className="sm-table">
              <thead>
                <tr><th>Invoice</th><th>Description</th><th className="ta-right">Amount</th><th className="ta-right">Paid</th><th className="ta-right">Balance</th><th>Due date</th></tr>
              </thead>
              <tbody>
                {ledger.map((l) => {
                  const bal = l.amount - l.paid
                  return (
                    <tr key={l.id}>
                      <td className="fw6">{l.id}</td>
                      <td>{l.label}</td>
                      <td className="ta-right">{fmtMoney(l.amount)}</td>
                      <td className="ta-right">{fmtMoney(l.paid)}</td>
                      <td className="ta-right"><Badge tone={bal > 0 ? 'danger' : 'success'}>{fmtMoney(bal)}</Badge></td>
                      <td className="muted">{l.date}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            )}
          </Card>

          <Card>
            <CardHead
              title="Fee timeline"
              sub={feeTimelineLoading
                ? 'Loading…'
                : `${feeTimeline.length} event${feeTimeline.length === 1 ? '' : 's'} · invoices & payments`}
              icon="clock"
            />
            {feeTimelineLoading ? (
              <div className="t-sm muted" style={{ padding: '16px 0' }}>Loading fee activity…</div>
            ) : feeTimeline.length === 0 ? (
              <Empty
                icon="clock"
                title="No fee activity yet"
                body="Invoices and payments for this student will appear here in date order."
              />
            ) : (
              <div className="col" style={{ marginTop: 8 }}>
                {feeTimeline.map((t, i) => (
                  <div key={t.id} className="row gap12" style={{ paddingBottom: 16 }}>
                    <div className="col ai-center" style={{ width: 12 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 99, background: t.tone, marginTop: 4, flex: '0 0 auto' }} />
                      {i < feeTimeline.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
                    </div>
                    <div className="col" style={{ flex: 1, minWidth: 0 }}>
                      <div className="row ai-center jc-between gap8 wrap">
                        <div className="fw6">{t.title}</div>
                        <div className="t-xs muted">{t.date}</div>
                      </div>
                      <div className="t-sm muted">{t.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'documents' && (
        <Card>
          <CardHead
            title="Documents"
            sub={docs.length ? `${docs.length} file${docs.length === 1 ? '' : 's'} on this device` : 'No enrolment files yet'}
            icon="doc"
            action={editable ? (
              <Btn variant="secondary" size="sm" icon="upload" onClick={() => app.go('school.sis.edit', { focus: stu.id })}>Add / replace</Btn>
            ) : undefined}
          />
          {docs.length === 0 ? (
            <Empty
              icon="doc"
              title="No documents"
              body={editable ? 'Edit this student and upload birth certificate, Aadhaar, or photo to see them here.' : 'No documents were uploaded for this student.'}
            />
          ) : (
            <div className="col gap8" style={{ marginTop: 8 }}>
              {docs.map((d) => (
                <div key={d.key + d.fileName} className="row ai-center jc-between" style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div className="row ai-center gap12">
                    {d.dataUrl && isStoredImage(d) ? (
                      <img
                        src={d.dataUrl}
                        alt={d.label}
                        className="sm-upload-thumb is-photo"
                        style={{ width: 52, height: 52, borderRadius: 10 }}
                      />
                    ) : (
                      <span className="sm-card-ic"><Icon name="doc" size={16} /></span>
                    )}
                    <div>
                      <div className="fw6">{d.label}</div>
                      <div className="t-xs muted">{d.fileName}{d.size ? ` · ${fmtSize(d.size)}` : ''}</div>
                    </div>
                  </div>
                  <div className="row ai-center gap8">
                    <Badge tone={d.dataUrl ? 'success' : 'neutral'}>{d.dataUrl ? 'Ready' : 'Name only'}</Badge>
                    <Btn
                      variant="ghost"
                      size="sm"
                      icon="eye"
                      onClick={() => {
                        if (!openStoredDoc(d)) {
                          toast.info(
                            'Preview unavailable',
                            d.dataUrl
                              ? 'Popup blocked — try Download, or allow popups for this site.'
                              : 'Re-upload this PDF (max ~2.5 MB) from Edit student, then View again.',
                          )
                        }
                      }}
                    >
                      View
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="sm"
                      icon="download"
                      onClick={() => {
                        if (!downloadStoredDoc(d)) {
                          toast.info('Download unavailable', 'Re-upload this file from Edit student (PDF under ~2.5 MB).')
                        }
                      }}
                    >
                      Download
                    </Btn>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'timeline' && (
        <Card>
          <CardHead
            title="Activity timeline"
            sub={timelineLoading ? 'Loading activity…' : `${timeline.length} event${timeline.length === 1 ? '' : 's'} · payments, invoices & attendance`}
            icon="clock"
          />
          {timelineLoading ? (
            <div className="t-sm muted" style={{ padding: '16px 0' }}>Loading activity…</div>
          ) : timeline.length === 0 ? (
            <Empty
              icon="clock"
              title="No activity yet"
              body="Fee payments, invoices, and attendance marks for this student will appear here as they happen."
            />
          ) : (
            <div className="col" style={{ marginTop: 8 }}>
              {timeline.map((t, i) => (
                <div key={t.id} className="row gap12" style={{ paddingBottom: 16 }}>
                  <div className="col ai-center" style={{ width: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 99, background: t.tone, marginTop: 4, flex: '0 0 auto' }} />
                    {i < timeline.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 4 }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="row ai-center jc-between">
                      <span className="fw6">{t.title}</span>
                      <span className="t-xs muted">{t.date}</span>
                    </div>
                    <div className="t-sm muted">{t.body}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

/* ---------- export contract ---------- */
export const sisScreens: Record<string, ComponentType> = {
  'school.sis': StudentsScreen,
  'school.student': Student360,
}
