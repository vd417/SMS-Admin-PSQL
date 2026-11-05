/* Sibling link: shared father/mother contact copied onto each student.
   Students stay separate records. Matching uses the roster already loaded
   for this school (the API session is the tenant). Link on parent email or
   parent phone. Guardian name, the child's own email, class, and section
   are not match keys. */
import { parentMailFromStudent, studentGuardianName, studentParentLabel } from '@/api/students'
import { normalizeEmailKey, normalizePhoneDigits } from '@/lib/validation'
import type { ParentInfo, Student } from '@/types'

export interface ParentWard {
  id: string
  name: string
  cls: string
  section: string
}

/** A student row from the signed-in school. organizationId is set only when a mixed list must be filtered. */
export type RosterStudent = Student & { organizationId?: string | null }

export interface LinkedParent {
  id: string
  name: string
  phone: string
  email: string
  hue: number
  wards: ParentWard[]
  due: number
}

export interface ParentLinkMatch {
  type: 'link'
  key: string
  parentName: string
  wards: ParentWard[]
  sourceId: string
  message: string
}

export interface ParentProbeInput {
  fatherName?: string
  motherName?: string
  fatherEmail?: string
  motherEmail?: string
  fatherPhone?: string
  motherPhone?: string
  phone?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isParentEmail(value: string | null | undefined): boolean {
  const key = normalizeEmailKey(value)
  return !!key && EMAIL_RE.test(key)
}

/** Father, mother, and stored guardian email. The student's own email is ignored. */
export function parentEmailsOf(s: {
  email?: string | null
  guardianEmail?: string | null
  father?: { email?: string | null } | null
  mother?: { email?: string | null } | null
}): string[] {
  const keys = [s.guardianEmail, s.father?.email, s.mother?.email]
    .map((v) => normalizeEmailKey(v))
    .filter((v) => isParentEmail(v))
  return [...new Set(keys)]
}

/** Digits only. A leading 91 on a 12-digit mobile, or a single leading 0, is dropped. */
export function parentPhoneKey(value: string | null | undefined): string {
  let digits = normalizePhoneDigits(value)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits.length >= 10 ? digits : ''
}

/** Guardian, father, and mother mobiles. */
export function parentPhonesOf(s: {
  phone?: string | null
  father?: { phone?: string | null } | null
  mother?: { phone?: string | null } | null
}): string[] {
  const keys = [s.phone, s.father?.phone, s.mother?.phone]
    .map((v) => parentPhoneKey(v))
    .filter(Boolean)
  return [...new Set(keys)]
}

/** Class label plus section, without repeating a section that is already in the class label. */
export function wardClassSection(w: { cls?: string; section?: string }): string {
  const cls = (w.cls || '').trim()
  const section = (w.section || '').trim()
  if (!cls && !section) return '—'
  if (!section) return cls
  const lower = cls.toLowerCase()
  const sec = section.toLowerCase()
  if (lower === sec || lower.endsWith(`-${sec}`) || lower.endsWith(` ${sec}`)) return cls
  return cls ? `${cls}-${section}` : section
}

function forOrganization<T extends { organizationId?: string | null }>(rows: T[], organizationId?: string): T[] {
  const org = (organizationId ?? '').trim()
  if (!org) return rows
  return rows.filter((row) => !row.organizationId || row.organizationId === org)
}

function wardsOf(students: RosterStudent[]): ParentWard[] {
  return students
    .map((s) => ({ id: s.id, name: s.name, cls: s.cls, section: s.section || '' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function linkConfirmMessage(parentName: string, wards: ParentWard[]): string {
  const label = wards.length === 1 ? 'ward' : 'wards'
  const list = wards.map((w) => `${w.name} (${wardClassSection(w)})`).join(', ')
  return `${parentName} already has ${wards.length} ${label}: ${list}. Do you want to link this student?`
}

class UnionFind {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    let p = i
    while (this.parent[p] !== p) p = this.parent[p]
    let c = i
    while (this.parent[c] !== p) {
      const next = this.parent[c]
      this.parent[c] = p
      c = next
    }
    return p
  }
  union(a: number, b: number) {
    const pa = this.find(a)
    const pb = this.find(b)
    if (pa !== pb) this.parent[pb] = pa
  }
}

/** One parent row per shared father/mother email or shared parent phone.
    The guardian name is only a label. */
export function groupStudentsByParent(students: RosterStudent[], organizationId?: string): LinkedParent[] {
  const rows = forOrganization(students, organizationId)
  const uf = new UnionFind(rows.length)
  const byEmail = new Map<string, number[]>()
  const byPhone = new Map<string, number[]>()

  rows.forEach((s, i) => {
    for (const email of parentEmailsOf(s)) {
      const bucket = byEmail.get(email) ?? []
      bucket.push(i)
      byEmail.set(email, bucket)
    }
    for (const phone of parentPhonesOf(s)) {
      const bucket = byPhone.get(phone) ?? []
      bucket.push(i)
      byPhone.set(phone, bucket)
    }
  })

  const connect = (buckets: Map<string, number[]>) => {
    for (const ids of buckets.values()) {
      for (let k = 1; k < ids.length; k++) uf.union(ids[0], ids[k])
    }
  }
  connect(byEmail)
  connect(byPhone)

  const groups = new Map<number, Student[]>()
  rows.forEach((s, i) => {
    const root = uf.find(i)
    const list = groups.get(root) ?? []
    list.push(s)
    groups.set(root, list)
  })

  return Array.from(groups.values()).map((members) => {
    const head = members.find((s) => studentGuardianName(s)) ?? members[0]
    const wards = wardsOf(members)
    const email = members.map((s) => parentMailFromStudent(s)).find((v) => v.trim()) ?? ''
    const phone = (head.phone || head.father?.phone || head.mother?.phone || '').trim()
    return {
      id: `PAR-${members.map((s) => s.id).sort().join(':')}`,
      name: studentParentLabel(head),
      phone,
      email,
      hue: head.avatarHue,
      wards,
      due: members.reduce((sum, s) => sum + (Number(s.feeDue) || 0), 0),
    }
  })
}

function formEmails(input: ParentProbeInput): string[] {
  return [input.fatherEmail, input.motherEmail]
    .map((v) => normalizeEmailKey(v))
    .filter((v) => isParentEmail(v))
}

function formPhones(input: ParentProbeInput): string[] {
  return [input.fatherPhone, input.motherPhone, input.phone]
    .map((v) => parentPhoneKey(v))
    .filter(Boolean)
    .filter((v, i, all) => all.indexOf(v) === i)
}

function toLink(hits: RosterStudent[]): ParentLinkMatch {
  const head = hits.find((s) => studentGuardianName(s)) ?? hits[0]
  const wards = wardsOf(hits)
  const parentName = studentParentLabel(head)
  return {
    type: 'link',
    key: `link:${wards.map((w) => w.id).join(',')}`,
    parentName,
    wards,
    sourceId: head.id,
    message: linkConfirmMessage(parentName, wards),
  }
}

/** Link when the parent email or parent phone matches. The typed name is ignored. */
export function findParentProbe(
  input: ParentProbeInput,
  roster: RosterStudent[],
  excludeId?: string,
  organizationId?: string,
): ParentLinkMatch | null {
  const others = forOrganization(roster, organizationId).filter((s) => s.id !== excludeId)
  const emails = formEmails(input)
  const phones = formPhones(input)

  const expand = (hits: Student[]) => {
    const hitIds = new Set(hits.map((s) => s.id))
    const families = groupStudentsByParent(others).filter((g) => g.wards.some((w) => hitIds.has(w.id)))
    const ids = new Set(families.flatMap((g) => g.wards.map((w) => w.id)))
    if (!ids.size) return hits
    return others.filter((s) => ids.has(s.id))
  }

  if (emails.length) {
    const hits = others.filter((s) => parentEmailsOf(s).some((e) => emails.includes(e)))
    if (hits.length) return toLink(expand(hits))
  }
  if (phones.length) {
    const hits = others.filter((s) => parentPhonesOf(s).some((p) => phones.includes(p)))
    if (hits.length) return toLink(expand(hits))
  }
  return null
}

/** Copy father and mother details only. Class, section, student email, and admission stay as entered. */
export function applyLinkedParent(
  form: Record<string, string>,
  source: Student,
  extras?: { father?: ParentInfo | null; mother?: ParentInfo | null } | null,
): Record<string, string> {
  const father = extras?.father ?? source.father
  const mother = extras?.mother ?? source.mother
  const next = { ...form }
  const fatherName = (father?.name || source.guardian || '').trim()
  const fatherEmail = (father?.email || source.guardianEmail || '').trim()
  const fatherPhone = (father?.phone || source.phone || '').trim()
  if (fatherName) next.fatherName = fatherName
  if (fatherEmail) next.fatherEmail = fatherEmail
  if (fatherPhone) next.fatherPhone = fatherPhone
  if (father?.occupation) next.fatherOccupation = father.occupation
  if (father?.aadhaar) next.fatherAadhaar = father.aadhaar
  if (mother?.name) next.motherName = mother.name
  if (mother?.email) next.motherEmail = mother.email
  if (mother?.phone) next.motherPhone = mother.phone
  if (mother?.occupation) next.motherOccupation = mother.occupation
  return next
}
