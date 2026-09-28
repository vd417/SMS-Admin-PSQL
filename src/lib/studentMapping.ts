import { properName, properPlace } from './properCase'
import { parseImportDate } from './importDate'
import { fromStudent } from '@/api/students'
import { extrasFromStudent } from '@/api/studentExtras'
import type { Student } from '@/types'

/** One parsed+mapped row from an uploaded bulk-import file, before it becomes a Student.
 *  Every field is a plain string (as parsed from CSV/XLSX) — never a File, since bulk
 *  import rows never carry per-row document/photo uploads. */
export interface BulkStudentRow {
  rowNumber: number
  admissionNo: string
  firstName: string
  lastName: string
  section: string
  gender: string
  dob: string
  phone: string
  email: string
  fatherName: string
  fatherPhone: string
  fatherEmail: string
  fatherOccupation: string
  motherName: string
  motherPhone: string
  motherEmail: string
  motherOccupation: string
  bloodGroup: string
  house: string
  religion: string
  category: string
  caste: string
  motherTongue: string
  languages: string
  lastSchool: string
  address: string
  academicYear: string
  admissionDate: string
  status: string
  transportOptedIn: string
  transportRouteId: string
  transportStopId: string
  transportFeeHeadId: string
}

/** Parses a free-text bulk-import "gender" cell into the app's 'M' | 'F' encoding, or
 *  `null` when the cell is blank or says something this app cannot interpret.
 *
 *  The single-Add form's dropdown only ever supplies the literal 'M'/'F', so its own
 *  `f.gender === 'F' ? 'F' : 'M'` exact-match check is fine there — but a bulk-upload CSV
 *  cell is free text. Returning `null` (rather than silently defaulting to 'M') is the
 *  point: an unrecognised cell is real data corruption waiting to happen, so Preview turns
 *  it into a row Error the admin can see and fix, instead of quietly enrolling a girl as
 *  male. Exported so Preview validation and payload building share ONE parser. */
export function parseBulkGender(value: string): 'M' | 'F' | null {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized === 'f' || normalized === 'female') return 'F'
  if (normalized === 'm' || normalized === 'male') return 'M'
  return null
}

/** Same shape as buildStudent() in studentAdd.tsx, minus file handling (bulk rows carry no
 *  files) — kept as a separate pure function since bulk import has no React form state to
 *  read files/existing-record from. */
export function buildStudentFromRow(
  row: BulkStudentRow,
  classInfo: { grade: string; section: string; cls: string },
): Student {
  const firstName = properName(row.firstName)
  const lastName = properName(row.lastName)
  const name = `${firstName} ${lastName}`.trim()
  const fatherName = properName(row.fatherName) || undefined
  const motherName = properName(row.motherName) || undefined
  const guardian = (fatherName || motherName || '').trim()
  const father = {
    name: fatherName, email: row.fatherEmail.trim() || undefined,
    phone: row.fatherPhone || undefined, occupation: row.fatherOccupation || undefined,
  }
  const mother = {
    name: motherName, email: row.motherEmail.trim() || undefined,
    phone: row.motherPhone || undefined, occupation: row.motherOccupation || undefined,
  }
  return {
    id: `BULK-${row.rowNumber}-${Date.now().toString(36).toUpperCase()}`,
    adm: row.admissionNo.trim(),
    name,
    // Preview marks any row whose gender cell does not parse as an Error, so a valid,
    // actually-submitted row always resolves here. The 'M' fallback only exists so this
    // pure helper stays total for direct unit calls — it is unreachable via the wizard.
    gender: parseBulkGender(row.gender) ?? 'M',
    grade: classInfo.grade,
    section: classInfo.section,
    cls: classInfo.cls,
    roll: 0, /* server assigns A-Z by name within class, same as single Add */
    guardian,
    phone: row.phone.trim(),
    guardianEmail: (father.email || mother.email || '').trim() || undefined,
    attendance: 0,
    feeStatus: 'due',
    feeDue: 0,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    house: row.house.trim(),
    avatarHue: (name.length * 47) % 360,
    academicYear: row.academicYear,
    // Normalized HERE, not left raw: fromStudent() runs the value through toDateInputValue(),
    // which only understands ISO and US month-first — so a "23/04/2015" cell that Preview
    // just validated with parseImportDate would have been sent as null. Both sides parse the
    // cell the same way, so a row Preview calls valid is a row the server can actually store.
    admissionDate: parseImportDate(row.admissionDate) || undefined,
    dob: parseImportDate(row.dob) || row.dob,
    bloodGroup: row.bloodGroup || undefined,
    religion: row.religion || undefined,
    category: row.category || undefined,
    caste: row.caste || undefined,
    motherTongue: row.motherTongue || undefined,
    languages: row.languages || undefined,
    lastSchool: properName(row.lastSchool) || undefined,
    address: properPlace(row.address) || undefined,
    email: row.email || undefined,
    father,
    mother,
  } as Student
}

export interface BulkTransportInput {
  routeId: string
  stopId: string
  feeHeadId: string
}

export interface BulkImportRowPayload {
  /** Required, never optional: the whole error-report join (and the backend's own
   *  BulkImportRowResult.rowNumber, which is non-optional) keys on this value, so a row
   *  without one is unusable. Callers must supply the ORIGINAL file line number. */
  rowNumber: number
  createStudentRequest: Record<string, unknown>
  extrasJson: string
  transport: { optedIn: true; routeId: string | null; stopId: string | null; feeHeadId: string | null } | null
}

/** Shapes one built Student into the exact wire payload the bulk-import batch endpoint
 *  expects — reusing fromStudent() (the same function POST /students uses) and
 *  extrasFromStudent() (the same function PUT /students/{id}/extras uses), with an empty
 *  files list since bulk rows never carry documents. `rowNumber` is taken as an explicit
 *  argument (rather than left for the caller to bolt on afterwards) so the payload type's
 *  non-optional rowNumber is guaranteed by construction. */
export function toBulkImportRowPayload(
  student: Student, transport: BulkTransportInput | null, rowNumber: number,
): BulkImportRowPayload {
  return {
    rowNumber,
    createStudentRequest: fromStudent(student),
    extrasJson: JSON.stringify(extrasFromStudent(student, [])),
    transport: transport
      ? { optedIn: true, routeId: transport.routeId || null, stopId: transport.stopId || null, feeHeadId: transport.feeHeadId || null }
      : null,
  }
}
