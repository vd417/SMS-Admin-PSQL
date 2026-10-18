import {
  required, validateAadhaar, validateEmail, validatePhone, validateFile,
  validateMinAge, isDuplicateValue, normalizePhoneDigits, normalizeEmailKey, type FileLike,
} from './validation'

export const MIN_STUDENT_AGE_YEARS = 3

const REQUIRED_FIELDS = ['firstName', 'lastName', 'cls', 'dob', 'gender', 'phone', 'email'] as const

export interface StudentValidationInput {
  form: Record<string, string>
  files: Record<string, FileLike | null>
  roster: { id: string; email?: string | null; phone?: string | null }[]
  existingId?: string
  transportEnabled: boolean
}

/** The exact validation rules studentAdd.tsx's single Add/Edit form uses — extracted so bulk
 *  import can run the same checks client-side without a second, divergent rule set. */
export function validateStudentForm(input: StudentValidationInput): Record<string, string> {
  const { form: f, files, roster, existingId, transportEnabled } = input
  const e: Record<string, string> = {}
  for (const key of REQUIRED_FIELDS) {
    const msg = required(f[key])
    if (msg) e[key] = msg
  }
  if (!e.dob) {
    const ageMsg = validateMinAge(f.dob, MIN_STUDENT_AGE_YEARS)
    if (ageMsg) e.dob = ageMsg
  }
  if (!f.fatherName?.trim() && !f.motherName?.trim()) {
    e.fatherName = 'Enter father or mother name'
  }
  const checks: [string, string | null][] = [
    ['aadhaar', validateAadhaar(f.aadhaar)],
    ['fatherAadhaar', validateAadhaar(f.fatherAadhaar)],
    ['email', e.email ? null : validateEmail(f.email)
      || (isDuplicateValue(f.email, roster.map((s) => ({ id: s.id, value: s.email })), normalizeEmailKey, existingId)
        ? 'Another student already uses this email' : null)],
    ['fatherEmail', validateEmail(f.fatherEmail)],
    ['motherEmail', validateEmail(f.motherEmail)],
    ['phone', e.phone ? null : validatePhone(f.phone)
      || (isDuplicateValue(f.phone, roster.map((s) => ({ id: s.id, value: s.phone })), normalizePhoneDigits, existingId)
        ? 'Another student already uses this phone number' : null)],
    ['fatherPhone', validatePhone(f.fatherPhone)],
    ['motherPhone', validatePhone(f.motherPhone)],
  ]
  for (const [key, msg] of checks) if (msg) e[key] = msg
  for (const key of Object.keys(files)) {
    const msg = validateFile(files[key])
    if (msg) e[key] = msg
  }
  if (transportEnabled && f.transportOptedIn === 'yes' && !f.transportRouteId) {
    e.transportRouteId = 'Select a route before saving'
  }
  return e
}
