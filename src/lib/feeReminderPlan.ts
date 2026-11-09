import { fmtMoney } from '@/lib/format'

/** One student with an unpaid balance, and the logins that should hear about it. */
export interface FeeDueStudent {
  id: string
  name: string
  cls: string
  due: number
  dueDate?: string
  studentEmail?: string
  studentUserId?: string
  fatherEmail?: string
  fatherPhone?: string
  fatherUserId?: string
  parentEmail?: string
  parentPhone?: string
  parentUserId?: string
}

/** A class teacher's CRM login. `loggedIn` is false when they have signed out. */
export interface ClassTeacherLogin {
  name: string
  classLabel: string
  userId: string
  loggedIn: boolean
}

export interface PrincipalLogin {
  name: string
  userId: string
  loggedIn: boolean
}

export type FeeNoticeRole = 'class_teacher' | 'principal' | 'student' | 'father' | 'parent'

export interface PlannedFeeNotice {
  role: FeeNoticeRole
  /** CRM notices go to the login only (app). Family notices use email, SMS, and app. */
  appOnly: boolean
  studentName?: string
  cls?: string
  amount?: number
  dueDate?: string
  title: string
  body: string
  emails: string[]
  phones: string[]
  userId?: string
}

export function classKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^class\s+/, '')
}

function clean(value?: string | null): string {
  return (value ?? '').trim()
}

function emailOf(value?: string | null): string {
  const v = clean(value).toLowerCase()
  return v.includes('@') ? v : ''
}

function phoneOf(value?: string | null): string {
  const digits = clean(value).replace(/\D/g, '')
  return digits.length >= 10 ? digits : ''
}

function addsContact(usedEmails: Set<string>, usedPhones: Set<string>, emails: string[], phones: string[]): boolean {
  return emails.some((e) => !usedEmails.has(e)) || phones.some((p) => !usedPhones.has(p))
}

function familyLine(schoolName: string, name: string, cls: string, amount: string, dueDate?: string): string {
  const who = cls ? `${name} (${cls})` : name
  return `${schoolName}: A fee payment of ${amount} is due for ${who}${dueDate ? ` by ${dueDate}` : ''}. Please pay at the earliest to avoid late fees.`
}

/**
 * Unpaid-fee notices:
 * a logged-in class teacher gets only their class, a logged-in principal gets every class,
 * and the student, father, and parent each get only that student's amount.
 * A CRM login that is signed out is skipped. Family notices are not gated on login.
 */
export function planUnpaidFeeNotices(input: {
  schoolName: string
  currency?: string
  students: FeeDueStudent[]
  classTeachers: ClassTeacherLogin[]
  principals: PrincipalLogin[]
}): PlannedFeeNotice[] {
  const schoolName = input.schoolName.trim() || 'School'
  const dues = input.students.filter((s) => s.due > 0 && s.name.trim())
  const byClass = new Map<string, FeeDueStudent[]>()
  for (const s of dues) {
    const key = classKey(s.cls)
    const list = byClass.get(key) ?? []
    list.push(s)
    byClass.set(key, list)
  }

  const notices: PlannedFeeNotice[] = []

  const teacherSeen = new Set<string>()
  for (const teacher of input.classTeachers) {
    if (!teacher.loggedIn || !teacher.userId) continue
    const key = classKey(teacher.classLabel)
    const rows = byClass.get(key)
    if (!rows?.length || teacherSeen.has(teacher.userId + '|' + key)) continue
    teacherSeen.add(teacher.userId + '|' + key)
    const lines = rows.map((s) => `${s.name} — ${fmtMoney(s.due, input.currency)}`)
    const label = teacher.classLabel.trim() || rows[0].cls
    notices.push({
      role: 'class_teacher',
      appOnly: true,
      cls: label,
      title: `Unpaid fees — ${label}`,
      body: `${schoolName}: ${label} has ${rows.length} unpaid fee${rows.length === 1 ? '' : 's'}.\n${lines.join('\n')}`,
      emails: [],
      phones: [],
      userId: teacher.userId,
    })
  }

  const principalSeen = new Set<string>()
  for (const principal of input.principals) {
    if (!principal.loggedIn || !principal.userId || !dues.length || principalSeen.has(principal.userId)) continue
    principalSeen.add(principal.userId)
    const lines: string[] = []
    for (const [key, rows] of byClass) {
      const label = rows[0]?.cls || key
      lines.push(label)
      for (const s of rows) lines.push(`  ${s.name} — ${fmtMoney(s.due, input.currency)}`)
    }
    notices.push({
      role: 'principal',
      appOnly: true,
      title: 'Unpaid fees — all classes',
      body: `${schoolName}: Unpaid fees across ${byClass.size} class${byClass.size === 1 ? '' : 'es'}.\n${lines.join('\n')}`,
      emails: [],
      phones: [],
      userId: principal.userId,
    })
  }

  for (const s of dues) {
    const amount = fmtMoney(s.due, input.currency)
    const text = familyLine(schoolName, s.name, s.cls, amount, s.dueDate)
    const usedEmails = new Set<string>()
    const usedPhones = new Set<string>()
    const remember = (emails: string[], phones: string[]) => {
      emails.forEach((e) => usedEmails.add(e))
      phones.forEach((p) => usedPhones.add(p))
    }

    const studentEmails = emailOf(s.studentEmail) ? [emailOf(s.studentEmail)] : []
    if (studentEmails.length || s.studentUserId) {
      notices.push({
        role: 'student',
        appOnly: false,
        studentName: s.name,
        cls: s.cls,
        amount: s.due,
        dueDate: s.dueDate,
        title: `Fee reminder — ${s.name}`,
        body: text,
        emails: studentEmails,
        phones: [],
        userId: s.studentUserId,
      })
      remember(studentEmails, [])
    }

    const father = {
      emails: emailOf(s.fatherEmail) ? [emailOf(s.fatherEmail)] : [],
      phones: phoneOf(s.fatherPhone) ? [phoneOf(s.fatherPhone)] : [],
    }
    if ((father.emails.length || father.phones.length || s.fatherUserId) && (s.fatherUserId || addsContact(usedEmails, usedPhones, father.emails, father.phones))) {
      notices.push({
        role: 'father',
        appOnly: false,
        studentName: s.name,
        cls: s.cls,
        amount: s.due,
        dueDate: s.dueDate,
        title: `Fee reminder — ${s.name}`,
        body: text,
        emails: father.emails.filter((e) => !usedEmails.has(e)),
        phones: father.phones.filter((p) => !usedPhones.has(p)),
        userId: s.fatherUserId,
      })
      remember(father.emails, father.phones)
    }

    const parent = {
      emails: emailOf(s.parentEmail) ? [emailOf(s.parentEmail)] : [],
      phones: phoneOf(s.parentPhone) ? [phoneOf(s.parentPhone)] : [],
    }
    if ((parent.emails.length || parent.phones.length || s.parentUserId) && (s.parentUserId || addsContact(usedEmails, usedPhones, parent.emails, parent.phones))) {
      notices.push({
        role: 'parent',
        appOnly: false,
        studentName: s.name,
        cls: s.cls,
        amount: s.due,
        dueDate: s.dueDate,
        title: `Fee reminder — ${s.name}`,
        body: text,
        emails: parent.emails.filter((e) => !usedEmails.has(e)),
        phones: parent.phones.filter((p) => !usedPhones.has(p)),
        userId: s.parentUserId,
      })
    }
  }

  return notices
}
