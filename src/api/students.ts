import { request, listRequest } from './client'
import { snakeToCamel } from './mapper'
import { mergeStudentExtras } from './studentExtras'
import { toDateInputValue } from '@/lib/dateInput'
import type { Student, ListStudentsOpts } from '@/types'

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

function cleanName(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!s || s === '—' || s === '-') return ''
  return s
}

/** Map one wire record (snake_case) to the UI `Student` shape.
 *  API uses guardian_name / guardian_phone / attendance_pct — UI uses guardian / phone / attendance. */
export function toStudent(wire: Record<string, unknown>): Student {
  const c = snakeToCamel<Record<string, unknown>>(wire)
  const {
    admissionNo, classLabel, guardianName, guardianPhone, guardianEmail, attendancePct,
    ...rest
  } = c
  const guardian = cleanName(guardianName ?? rest.guardian)
  const phone = String(guardianPhone ?? rest.phone ?? '').trim()
  const parentEmail = String(guardianEmail ?? rest.guardianEmail ?? '').trim()
  const rawPct = attendancePct ?? rest.attendance
  const attendance = rawPct == null || rawPct === '' ? null : Number(rawPct)
  const dob = toDateInputValue(c.dob) || undefined
  const base = {
    ...rest,
    adm: admissionNo,
    cls: classLabel,
    guardian,
    phone,
    guardianEmail: parentEmail || undefined,
    attendance,
    dob,
  } as unknown as Student
  return mergeStudentExtras(base)
}

/** Prefer guardian name, then father/mother enrolment names. */
export function studentGuardianName(s: Student): string {
  return (
    cleanName(s.guardian)
    || cleanName(s.father?.name)
    || cleanName(s.mother?.name)
  )
}

function genericParentLabel(name: string): boolean {
  return /^(parent|mother|father|guardian|dad|mom)$/i.test(name.trim())
}

/** Guardian, then father, then mother — never the student name or the word Parent. */
export function actualParentName(s: {
  name?: string | null
  guardian?: string | null
  father?: { name?: string | null } | null
  mother?: { name?: string | null } | null
}): string {
  const student = cleanName(s.name).toLowerCase()
  for (const raw of [s.guardian, s.father?.name, s.mother?.name]) {
    const name = cleanName(raw)
    if (!name || genericParentLabel(name)) continue
    if (student && name.toLowerCase() === student) continue
    return name
  }
  return ''
}

/** Display label for Parents — never empty when a student exists. */
export function studentParentLabel(s: Student): string {
  return studentGuardianName(s) || (s.phone ? `Guardian · ${s.phone}` : `Parent of ${s.name}`)
}

/** Parent login / mail — father, mother, or stored guardian_email. Never the student's school email. */
export function parentMailFromStudent(s: {
  guardianEmail?: string | null
  father?: { email?: string } | null
  mother?: { email?: string } | null
}): string {
  return (s.guardianEmail || s.father?.email || s.mother?.email || '').trim()
}

export async function listStudents(opts: ListStudentsOpts = {}): Promise<Student[]> {
  const page = await listStudentsPage(opts)
  return page.rows
}

export async function listStudentsPage(opts: ListStudentsOpts = {}): Promise<{ rows: Student[]; nextCursor: string | null }> {
  const query: Record<string, string | undefined> = {}
  if (opts.q) query.q = opts.q
  if (opts.grade && opts.grade !== 'all') query.grade = opts.grade
  if (opts.status && opts.status !== 'all') query.status = opts.status
  if (opts.fee && opts.fee !== 'all') query.fee = opts.fee
  if (opts.limit != null) query.limit = String(opts.limit)
  if (opts.cursor) query.cursor = opts.cursor
  const env = await listRequest<ListEnvelope>('/students', { query })
  return { rows: env.data.map(toStudent), nextCursor: env.next_cursor }
}

export async function getStudent(id: string): Promise<Student> {
  const wire = await request<Record<string, unknown>>(`/students/${id}`)
  return toStudent(wire)
}

/** Fields shared by the create and update wire payloads. */
function studentCoreFields(s: Student): Record<string, unknown> {
  const guardianPhone = String(s.phone ?? '').trim()
    || String(s.father?.phone ?? '').trim()
    || String(s.mother?.phone ?? '').trim()
    || null
  return {
    admission_no: s.adm?.trim() || null,
    name: s.name,
    gender: s.gender,
    grade: s.grade,
    section: s.section,
    guardian_name: studentGuardianName(s) || null,
    guardian_phone: guardianPhone,
    guardian_email: parentMailFromStudent(s) || null,
    house: s.house || null,
    avatar_hue: s.avatarHue ?? 0,
    dob: toDateInputValue(s.dob) || null,
    email: s.email || null,
    address: s.address || null,
  }
}

/** Body for POST /students — only fields the SIS create contract accepts. */
export function fromStudent(s: Student): Record<string, unknown> {
  return { ...studentCoreFields(s), roll: s.roll ?? 0 }
}

/** Body for PATCH /students/{id}. Roll is assigned A–Z on the server — do not
 *  send 0 from the form or an edit save overwrites the class roll. */
export function fromStudentUpdate(s: Student): Record<string, unknown> {
  return {
    ...studentCoreFields(s),
    fee_status: s.feeStatus,
    fee_due: s.feeDue,
    status: s.status,
  }
}

export async function createStudent(s: Student): Promise<Student> {
  const wire = await request<Record<string, unknown>>('/students', { method: 'POST', body: fromStudent(s) })
  return toStudent(wire)
}

export async function updateStudent(id: string, s: Student): Promise<Student> {
  const wire = await request<Record<string, unknown>>(`/students/${id}`, {
    method: 'PATCH',
    body: fromStudentUpdate(s),
  })
  return toStudent(wire)
}
