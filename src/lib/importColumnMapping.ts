import type { BulkStudentRow } from './studentMapping'

export type BulkStudentRowInput = Omit<BulkStudentRow, 'rowNumber'>

export interface BulkImportFieldDef {
  key: keyof BulkStudentRowInput
  label: string
  required: boolean
  aliases: string[]
}

/** Every field the single Add Student form supports, except Roll Number (never mappable —
 *  always server-assigned, same as single Add). Admission Number is optional/mappable here
 *  (unlike single Add's read-only UI) for migrating legacy records that already have one.
 *
 *  Status is deliberately ABSENT too: the create contract (`fromStudent` →
 *  `studentCoreFields` in src/api/students.ts) carries no `status` field at all, so neither
 *  single Add nor bulk import can set a student's active/inactive state at creation time —
 *  it is only settable later via PATCH (`fromStudentUpdate`). Offering a Status column that
 *  the payload silently drops would be a fake control, so it is not offered. (Adding real
 *  status-at-create support is a pre-existing gap in the single-add path, out of scope here.) */
export const BULK_IMPORT_FIELDS: BulkImportFieldDef[] = [
  { key: 'admissionNo', label: 'Student ID', required: false, aliases: ['admission no', 'admission number', 'adm no', 'student id'] },
  { key: 'admissionDate', label: 'Admission Date', required: false, aliases: ['admission date', 'doa'] },
  { key: 'firstName', label: 'First Name', required: true, aliases: ['first name', 'given name'] },
  { key: 'lastName', label: 'Last Name', required: true, aliases: ['last name', 'surname', 'family name'] },
  { key: 'section', label: 'Class + Section', required: true, aliases: ['class', 'section', 'class/section', 'grade'] },
  { key: 'house', label: 'House', required: false, aliases: ['house'] },
  { key: 'gender', label: 'Gender', required: true, aliases: ['gender', 'sex'] },
  { key: 'dob', label: 'Date of Birth', required: true, aliases: ['dob', 'date of birth', 'birth date'] },
  { key: 'academicYear', label: 'Academic Year', required: false, aliases: ['academic year', 'session'] },
  { key: 'bloodGroup', label: 'Blood Group', required: false, aliases: ['blood group'] },
  { key: 'religion', label: 'Religion', required: false, aliases: ['religion'] },
  { key: 'category', label: 'Category', required: false, aliases: ['category'] },
  { key: 'phone', label: 'Primary Contact Number', required: true, aliases: ['phone', 'primary contact', 'contact number', 'mobile'] },
  { key: 'email', label: 'Email', required: true, aliases: ['email', 'email address'] },
  { key: 'caste', label: 'Caste', required: false, aliases: ['caste'] },
  { key: 'motherTongue', label: 'Mother Tongue', required: false, aliases: ['mother tongue'] },
  { key: 'languages', label: 'Languages Known', required: false, aliases: ['languages known', 'languages'] },
  { key: 'lastSchool', label: 'Last School Name', required: false, aliases: ['last school', 'last school name', 'previous school'] },
  { key: 'address', label: 'Address', required: false, aliases: ['address'] },
  { key: 'fatherName', label: 'Father Name', required: false, aliases: ['father name', 'fathers name'] },
  { key: 'fatherEmail', label: 'Father Email', required: false, aliases: ['father email'] },
  { key: 'fatherPhone', label: 'Father Phone', required: false, aliases: ['father phone', 'dad phone', 'fathers phone'] },
  { key: 'fatherOccupation', label: 'Father Occupation', required: false, aliases: ['father occupation'] },
  { key: 'motherName', label: 'Mother Name', required: false, aliases: ['mother name', 'mothers name'] },
  { key: 'motherEmail', label: 'Mother Email', required: false, aliases: ['mother email'] },
  { key: 'motherPhone', label: 'Mother Phone', required: false, aliases: ['mother phone', 'mom phone', 'mothers phone'] },
  { key: 'motherOccupation', label: 'Mother Occupation', required: false, aliases: ['mother occupation'] },
  { key: 'transportOptedIn', label: 'Uses School Transport', required: false, aliases: ['uses school transport', 'transport', 'school transport'] },
  { key: 'transportFeeHeadId', label: 'Transport Fee Head', required: false, aliases: ['transport fee head', 'transport fee'] },
  { key: 'transportRouteId', label: 'Transport Route', required: false, aliases: ['transport route', 'route'] },
  { key: 'transportStopId', label: 'Pickup Stop', required: false, aliases: ['pickup stop', 'stop', 'bus stop'] },
]

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}

/** For each uploaded header, suggests the best-matching field key (exact label match first,
 *  then alias match), or null if nothing matches closely enough. Never suggests 'roll' since
 *  it isn't in BULK_IMPORT_FIELDS at all. */
export function suggestColumnMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {}
  for (const header of headers) {
    const normalized = normalizeHeader(header)
    const match = BULK_IMPORT_FIELDS.find((f) => normalizeHeader(f.label) === normalized)
      ?? BULK_IMPORT_FIELDS.find((f) => f.aliases.some((a) => normalizeHeader(a) === normalized))
    mapping[header] = match?.key ?? null
  }
  return mapping
}
