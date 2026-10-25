import { describe, it, expect } from 'vitest'
import {
  required, validateAadhaar, validateFile, validateEmail, validatePhone, MAX_FILE_MB,
  validatePAN, validateIFSC, validateURL, passwordsMatch, validatePassword,
  validateMinAge, normalizePhoneDigits, normalizeEmailKey, isDuplicateValue, clampPhoneInput,
} from './validation'

describe('validateMinAge', () => {
  const yearsAgo = (n: number) => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - n)
    return d.toISOString().slice(0, 10)
  }
  it('treats empty as valid (optional)', () => {
    expect(validateMinAge('', 3)).toBeNull()
    expect(validateMinAge(undefined, 3)).toBeNull()
  })
  it('accepts a child at or above the minimum age', () => {
    expect(validateMinAge(yearsAgo(5), 3)).toBeNull()
  })
  it('rejects a child younger than the minimum age', () => {
    expect(validateMinAge(yearsAgo(2), 3)).not.toBeNull()
  })
  it('rejects a future date of birth', () => {
    const next = new Date(); next.setFullYear(next.getFullYear() + 1)
    expect(validateMinAge(next.toISOString().slice(0, 10), 3)).not.toBeNull()
  })
  it('rejects an invalid date string', () => {
    expect(validateMinAge('not-a-date', 3)).not.toBeNull()
  })
})

describe('required', () => {
  it('rejects empty / whitespace', () => {
    expect(required('')).not.toBeNull()
    expect(required('   ')).not.toBeNull()
    expect(required(undefined)).not.toBeNull()
  })
  it('accepts non-empty', () => {
    expect(required('Aarav')).toBeNull()
  })
})

describe('validateAadhaar', () => {
  it('accepts exactly 12 digits', () => {
    expect(validateAadhaar('123456789012')).toBeNull()
  })
  it('accepts 12 digits with spaces', () => {
    expect(validateAadhaar('1234 5678 9012')).toBeNull()
  })
  it('treats empty as valid (optional)', () => {
    expect(validateAadhaar('')).toBeNull()
    expect(validateAadhaar(undefined)).toBeNull()
  })
  it('rejects wrong length', () => {
    expect(validateAadhaar('1234567890')).not.toBeNull()
    expect(validateAadhaar('1234567890123')).not.toBeNull()
  })
  it('rejects non-digits', () => {
    expect(validateAadhaar('12345678901X')).not.toBeNull()
  })
})

describe('validateFile', () => {
  it('accepts a valid pdf under the size limit', () => {
    expect(validateFile({ name: 'aadhaar.pdf', size: 1_000_000 })).toBeNull()
  })
  it('accepts jpg/jpeg/png', () => {
    expect(validateFile({ name: 'photo.JPG', size: 100 })).toBeNull()
    expect(validateFile({ name: 'photo.jpeg', size: 100 })).toBeNull()
    expect(validateFile({ name: 'photo.png', size: 100 })).toBeNull()
  })
  it('treats null as valid (optional)', () => {
    expect(validateFile(null)).toBeNull()
  })
  it('rejects disallowed types', () => {
    expect(validateFile({ name: 'doc.docx', size: 100 })).not.toBeNull()
    expect(validateFile({ name: 'noext', size: 100 })).not.toBeNull()
  })
  it('rejects files over the size limit', () => {
    expect(validateFile({ name: 'big.png', size: (MAX_FILE_MB + 1) * 1024 * 1024 })).not.toBeNull()
  })
})

describe('validateEmail', () => {
  it('accepts a normal address', () => {
    expect(validateEmail('a.b@school.edu')).toBeNull()
  })
  it('treats empty as valid', () => {
    expect(validateEmail('')).toBeNull()
  })
  it('rejects malformed', () => {
    expect(validateEmail('not-an-email')).not.toBeNull()
    expect(validateEmail('a@b')).not.toBeNull()
  })
})

describe('validatePhone', () => {
  it('accepts exactly 10 digits', () => {
    expect(validatePhone('9876543210')).toBeNull()
  })
  it('accepts 10 digits with spaces', () => {
    expect(validatePhone('98765 43210')).toBeNull()
  })
  it('treats empty as valid', () => {
    expect(validatePhone('')).toBeNull()
  })
  it('rejects too-short numbers', () => {
    expect(validatePhone('12345')).not.toBeNull()
  })
  it('rejects more than 10 digits (incl. +91 country code)', () => {
    expect(validatePhone('+91 98765 43210')).not.toBeNull()
    expect(validatePhone('919876543210')).not.toBeNull()
    expect(validatePhone('98765432101')).not.toBeNull()
  })
  it('rejects non-digit characters', () => {
    expect(validatePhone('98765-43210')).not.toBeNull()
    expect(validatePhone('98765abcde')).not.toBeNull()
  })
})

describe('clampPhoneInput', () => {
  it('strips non-digits and caps at 10 by default', () => {
    expect(clampPhoneInput('98765-43210')).toBe('9876543210')
    expect(clampPhoneInput('98765432109999')).toBe('9876543210')
    // Only digits survive, and at most 10 — so a pasted country code is truncated, not cleaned up.
    expect(clampPhoneInput('919876543210')).toBe('9198765432')
  })
  it('honours a custom cap', () => {
    expect(clampPhoneInput('123456', 4)).toBe('1234')
  })
  it('returns empty for blank input', () => {
    expect(clampPhoneInput('')).toBe('')
  })
})

describe('validatePAN', () => {
  it('accepts a well-formed PAN (any case)', () => {
    expect(validatePAN('ABCDE1234F')).toBeNull()
    expect(validatePAN('abcde1234f')).toBeNull()
  })
  it('treats empty as valid', () => {
    expect(validatePAN('')).toBeNull()
  })
  it('rejects malformed PANs', () => {
    expect(validatePAN('ABCD1234F')).not.toBeNull()
    expect(validatePAN('ABCDE12345')).not.toBeNull()
  })
})

describe('validateIFSC', () => {
  it('accepts a well-formed IFSC', () => {
    expect(validateIFSC('SBIN0001234')).toBeNull()
  })
  it('treats empty as valid', () => {
    expect(validateIFSC('')).toBeNull()
  })
  it('rejects malformed IFSC codes', () => {
    expect(validateIFSC('SBIN1001234')).not.toBeNull() // 5th char must be 0
    expect(validateIFSC('SBI0001234')).not.toBeNull()
  })
})

describe('validateURL', () => {
  it('accepts http and https URLs', () => {
    expect(validateURL('https://linkedin.com/in/x')).toBeNull()
    expect(validateURL('http://x.io')).toBeNull()
  })
  it('treats empty as valid', () => {
    expect(validateURL('')).toBeNull()
  })
  it('rejects non-URLs', () => {
    expect(validateURL('linkedin.com')).not.toBeNull()
    expect(validateURL('not a url')).not.toBeNull()
  })
})

describe('passwordsMatch', () => {
  it('passes when both empty', () => {
    expect(passwordsMatch('', '')).toBeNull()
  })
  it('passes when equal', () => {
    expect(passwordsMatch('secret1', 'secret1')).toBeNull()
  })
  it('fails when different', () => {
    expect(passwordsMatch('secret1', 'secret2')).not.toBeNull()
  })
  it('fails when one side is blank', () => {
    expect(passwordsMatch('secret1', '')).not.toBeNull()
  })
})

describe('validatePassword', () => {
  it('accepts 8 or more characters', () => {
    expect(validatePassword('12345678')).toBeNull()
    expect(validatePassword('a-longer-password')).toBeNull()
  })
  it('rejects fewer than 8 characters', () => {
    expect(validatePassword('1234567')).not.toBeNull()
    expect(validatePassword('short')).not.toBeNull()
  })
  it('treats empty as valid (required enforced separately)', () => {
    expect(validatePassword('')).toBeNull()
    expect(validatePassword(undefined)).toBeNull()
  })
})

describe('normalizePhoneDigits', () => {
  it('strips everything but digits', () => {
    expect(normalizePhoneDigits('+91 98100-10001')).toBe('919810010001')
  })
  it('handles blank/undefined', () => {
    expect(normalizePhoneDigits('')).toBe('')
    expect(normalizePhoneDigits(undefined)).toBe('')
  })
})

describe('normalizeEmailKey', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmailKey('  Ravi@School.EDU  ')).toBe('ravi@school.edu')
  })
})

describe('isDuplicateValue', () => {
  const others = [
    { id: 'a', value: '9810010001' },
    { id: 'b', value: '9810010002' },
  ]
  it('flags a value already used by another record', () => {
    expect(isDuplicateValue('98100 10001', others, normalizePhoneDigits)).toBe(true)
  })
  it('does not flag a genuinely new value', () => {
    expect(isDuplicateValue('9810099999', others, normalizePhoneDigits)).toBe(false)
  })
  it('excludes the record\'s own id (editing)', () => {
    expect(isDuplicateValue('9810010001', others, normalizePhoneDigits, 'a')).toBe(false)
  })
  it('never treats a blank value as a duplicate', () => {
    expect(isDuplicateValue('', others, normalizePhoneDigits)).toBe(false)
    expect(isDuplicateValue(undefined, others, normalizePhoneDigits)).toBe(false)
  })
  it('matches emails case-insensitively', () => {
    const emails = [{ id: 'a', value: 'ravi@school.edu' }]
    expect(isDuplicateValue('Ravi@School.EDU', emails, normalizeEmailKey)).toBe(true)
  })
})
