import { describe, it, expect } from 'vitest'
import { validateStudentForm } from './studentValidation'

const baseForm = {
  firstName: 'Aarav', lastName: 'Sharma', cls: 'I-A', dob: '2015-01-01', gender: 'M',
  phone: '9876543210', email: 'aarav@example.com', fatherName: 'Suresh Sharma', motherName: '',
  aadhaar: '', fatherAadhaar: '', fatherEmail: '', motherEmail: '', fatherPhone: '', motherPhone: '',
  transportOptedIn: '', transportRouteId: '',
}

describe('validateStudentForm', () => {
  it('returns no errors for a fully valid form with no roster conflicts', () => {
    const errors = validateStudentForm({
      form: baseForm, files: {}, roster: [], transportEnabled: false,
    })
    expect(errors).toEqual({})
  })

  it('requires first name, last name, class, dob, gender, phone, email', () => {
    const errors = validateStudentForm({
      form: { ...baseForm, firstName: '', email: '' }, files: {}, roster: [], transportEnabled: false,
    })
    expect(errors.firstName).toBe('This field is required')
    expect(errors.email).toBe('This field is required')
  })

  it('requires father or mother name when both are blank', () => {
    const errors = validateStudentForm({
      form: { ...baseForm, fatherName: '', motherName: '' }, files: {}, roster: [], transportEnabled: false,
    })
    expect(errors.fatherName).toBe('Enter father or mother name')
  })

  it('allows the same primary phone on another student (shared parent mobile)', () => {
    const errors = validateStudentForm({
      form: baseForm, files: {}, transportEnabled: false,
      roster: [{ id: 'other-1', phone: '9876543210', email: 'someone-else@example.com' }],
    })
    expect(errors.phone).toBeUndefined()
  })

  it('allows the same father email and father phone on another student', () => {
    const errors = validateStudentForm({
      form: { ...baseForm, fatherEmail: 'dad@home.test', fatherPhone: '9000011111' },
      files: {}, transportEnabled: false,
      roster: [{ id: 'other-1', phone: '9000011111', email: 'other-child@school.test' }],
    })
    expect(errors.fatherEmail).toBeUndefined()
    expect(errors.fatherPhone).toBeUndefined()
    expect(errors.phone).toBeUndefined()
  })

  it('flags an email already used by another student, case-insensitively', () => {
    const errors = validateStudentForm({
      form: baseForm, files: {}, transportEnabled: false,
      roster: [{ id: 'other-2', phone: '9111111111', email: 'AARAV@EXAMPLE.COM' }],
    })
    expect(errors.email).toBe('Another student already uses this email')
  })

  it('does not flag a match against the record\'s own existingId', () => {
    const errors = validateStudentForm({
      form: baseForm, files: {}, transportEnabled: false, existingId: 'self-1',
      roster: [{ id: 'self-1', phone: '9876543210', email: 'aarav@example.com' }],
    })
    expect(errors).toEqual({})
  })

  it('requires a transport route when opted in and transport is enabled', () => {
    const errors = validateStudentForm({
      form: { ...baseForm, transportOptedIn: 'yes', transportRouteId: '' },
      files: {}, roster: [], transportEnabled: true,
    })
    expect(errors.transportRouteId).toBe('Select a route before saving')
  })
})
