/* ============================================================
   SchoolMate — Form field validators (pure, framework-free).
   Each returns an error message string, or null when valid.
   Empty/optional values are treated as valid; required-ness is
   enforced separately via `required`.
   ============================================================ */

export interface FileLike {
  name: string
  size: number
  type?: string
}

export const ALLOWED_FILE_TYPES = ['pdf', 'jpg', 'jpeg', 'png']
export const MAX_FILE_MB = 4

const isBlank = (v: string | null | undefined): boolean => !v || !v.trim()

/** Non-empty check for required fields. */
export function required(value: string | null | undefined): string | null {
  return isBlank(value) ? 'This field is required' : null
}

/** Date of birth must be a real past date and the person at least `minYears` old. Empty is allowed. */
export function validateMinAge(value: string | null | undefined, minYears: number): string | null {
  if (isBlank(value)) return null
  const dob = new Date(value as string)
  if (Number.isNaN(dob.getTime())) return 'Enter a valid date of birth'
  const today = new Date()
  if (dob > today) return 'Date of birth cannot be in the future'
  const cutoff = new Date(today.getFullYear() - minYears, today.getMonth(), today.getDate())
  return dob > cutoff ? `Student must be at least ${minYears} years old` : null
}

/** Aadhaar: exactly 12 digits (spaces ignored). Empty is allowed. */
export function validateAadhaar(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  const digits = (value as string).replace(/\s+/g, '')
  return /^\d{12}$/.test(digits) ? null : 'Aadhaar must be exactly 12 digits'
}

/** File type (by extension) + size ceiling. null file is allowed. */
export function validateFile(
  file: FileLike | null | undefined,
  opts: { maxMb?: number; types?: string[] } = {},
): string | null {
  if (!file) return null
  const maxMb = opts.maxMb ?? MAX_FILE_MB
  const types = opts.types ?? ALLOWED_FILE_TYPES
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!types.includes(ext)) return `Allowed formats: ${types.map((t) => t.toUpperCase()).join(', ')}`
  if (file.size > maxMb * 1024 * 1024) return `File must be ${maxMb} MB or smaller`
  return null
}

/** Basic email shape. Empty is allowed. */
export function validateEmail(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value as string).trim()) ? null : 'Enter a valid email address'
}

/** Basic phone: 10–13 digits after stripping non-digits. Empty is allowed. */
export function validatePhone(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  const digits = (value as string).replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13 ? null : 'Enter a valid phone number'
}

/** PAN: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Empty is allowed. */
export function validatePAN(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((value as string).trim().toUpperCase())
    ? null : 'PAN must look like ABCDE1234F'
}

/** IFSC: 4 letters, a 0, then 6 alphanumerics (e.g. SBIN0001234). Empty allowed. */
export function validateIFSC(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test((value as string).trim().toUpperCase())
    ? null : 'Enter a valid IFSC code'
}

/** Basic http(s) URL. Empty is allowed. */
export function validateURL(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  return /^https?:\/\/[^\s.]+\.[^\s]+$/.test((value as string).trim()) ? null : 'Enter a valid URL'
}

/** Confirm-password match. Error only when a value is present and differs. */
export function passwordsMatch(
  password: string | null | undefined,
  confirm: string | null | undefined,
): string | null {
  if (isBlank(password) && isBlank(confirm)) return null
  return password === confirm ? null : 'Passwords do not match'
}

/** Password strength: minimum 8 characters. Empty is allowed (required
 *  enforced separately at the call site). */
export function validatePassword(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  return (value as string).length >= 8 ? null : 'Password must be at least 8 characters'
}

/** Digits only, for comparing phone numbers written with different spacing/punctuation. */
export function normalizePhoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** Trimmed + lowercased, for case-insensitive email comparison. */
export function normalizeEmailKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** True when `value` (already the raw, un-normalized field value) matches another record's
 *  `value` in `others` under `normalize` — e.g. the same phone number on a different student.
 *  Blank input never counts as a duplicate (required-ness is enforced separately). Pass the
 *  record's own id as `excludeId` when editing, so a record doesn't collide with itself. */
export function isDuplicateValue(
  value: string | null | undefined,
  others: { id: string; value: string | null | undefined }[],
  normalize: (v: string | null | undefined) => string,
  excludeId?: string,
): boolean {
  const key = normalize(value)
  if (!key) return false
  return others.some((o) => o.id !== excludeId && normalize(o.value) === key)
}
