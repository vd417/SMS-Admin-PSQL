/* ============================================================
   SchoolMate — Add / Edit Teacher (full-page onboarding form).
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { tierIncludes } from '@/lib/gating'
import { useCreateTeacher, useUpdateTeacher } from '@/api/hooks/useTeacherMutations'
import { useTeacher, useTeachers } from '@/api/hooks/useTeachers'
import { fetchTeacherExtras, persistTeacherExtras, mergeTeacherExtras } from '@/api/teacherExtras'
import { updateTeacherPhoto } from '@/api/teachers'
import { upsertSalaryProfile, type SalaryStructure } from '@/api/payroll'
import { toAmount, computeSalary } from '@/lib/payroll'
import { nextPersonCode, personCodePrefix } from '@/lib/personCodes'
import { PageHead, Card, CardHead, Btn, Badge, useFormKit, Spinner, Empty, Field, Input, Select, Checkbox } from '@/components/ui'
import { depts } from '@/data/mockDb'
import { useClassNames } from '@/api/hooks/useClasses'
import { useSubjectNames } from '@/api/hooks/useSubjects'
import {
  required, validateAadhaar, validatePAN, validateIFSC, validateURL,
  validateEmail, validatePhone, validateFile, passwordsMatch,
  isDuplicateValue, normalizePhoneDigits, normalizeEmailKey,
} from '@/lib/validation'
import { properName, properPlace } from '@/lib/properCase'
import { toDateInputValue } from '@/lib/dateInput'
import { TEACHER_DESIGNATIONS } from '@/lib/salaryRoles'
import { useSalaryStructures, useSalaryProfiles } from '@/api/hooks/usePayroll'
import { findSalaryProfile, findSalaryStructure, mergeSalaryDisplayFields, upsertInputFromForm } from '@/lib/salaryProfileForm'
import type { Teacher } from '@/types'

/* ---------- option lists ---------- */
const SEL = (...vals: string[]) => ['', ...vals]
const GENDERS = [{ value: '', label: 'Select…' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]
const BLOOD_GROUPS = SEL('A+', 'A−', 'B+', 'B−', 'O+', 'O−', 'AB+', 'AB−')
const MARITAL = SEL('Single', 'Married', 'Divorced', 'Widowed')
const RELIGIONS = SEL('Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other')
const DESIGNATIONS = SEL(...TEACHER_DESIGNATIONS)
const EMP_TYPES = SEL('Full-time', 'Part-time', 'Contract', 'Visiting', 'Intern')
const CONTRACT_TYPES = SEL('Permanent', 'Temporary', 'Probation', 'Fixed-term')
const SHIFTS = SEL('Morning', 'Day', 'Evening', 'Rotational')
// CRM access role, stored for display only (see Teacher.role). Distinct from Designation (job
// title) and Department (org unit). Access itself is still granted via the Send-invite screen.
const ROLES = SEL('Admin', 'Principal', 'Vice-Principal', 'Teacher', 'Staff')
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]

const REQUIRED_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'department', 'designation'] as const

type Form = Record<string, string>
type Files = Record<string, File | null>

const INITIAL_FORM: Form = {
  // personal
  teacherId: '', firstName: '', lastName: '', gender: '', dob: '', bloodGroup: '', maritalStatus: '',
  phone: '', altPhone: '', email: '', fatherName: '', motherName: '', aadhaar: '', pan: '',
  nationality: 'Indian', religion: '', languages: '', permanentAddress: '', currentAddress: '',
  // academic
  class: '', subject: '', qualification: '', specialization: '', experience: '',
  prevSchool: '', prevSchoolAddress: '', prevSchoolPhone: '', dateOfJoining: '', dateOfLeaving: '', status: 'active',
  // employment
  role: 'Teacher', employeeType: '', department: '', designation: '', contractType: '', workShift: '', workLocation: '',
  basicSalary: '', hra: '', allowances: '', epf: '', profTax: '', otherDeductions: '', uan: '',
  // leave
  medical: '', casual: '', sick: '', maternity: '',
  // bank
  accHolder: '', accNumber: '', bankName: '', ifsc: '', branch: '',
  // emergency
  emPerson: '', emRelationship: '', emPhone: '',
  // transport
  route: '', vehicle: '', pickup: '',
  // hostel
  hostelName: '', roomNumber: '',
  // social
  facebook: '', instagram: '', linkedin: '', youtube: '', twitter: '',
  // login
  username: '', password: '', confirmPassword: '',
  // additional
  notes: '', remarks: '', profileStatus: 'active',
}

const INITIAL_FILES: Files = {
  teacherPhoto: null, resume: null, joiningLetter: null, aadhaarDoc: null, panDoc: null,
  experienceCert: null, educationCert: null, otherDoc: null, signature: null,
}

const TEACHER_FILE_PICKS: Array<{ formKey: keyof typeof INITIAL_FILES; key: string; label: string }> = [
  { formKey: 'teacherPhoto', key: 'photo', label: 'Teacher photo' },
  { formKey: 'resume', key: 'resume', label: 'Resume' },
  { formKey: 'joiningLetter', key: 'joiningLetter', label: 'Joining letter' },
  { formKey: 'aadhaarDoc', key: 'aadhaar', label: 'Aadhaar card' },
  { formKey: 'panDoc', key: 'pan', label: 'PAN card' },
  { formKey: 'experienceCert', key: 'experienceCert', label: 'Experience certificate' },
  { formKey: 'educationCert', key: 'educationCert', label: 'Education certificate' },
  { formKey: 'otherDoc', key: 'other', label: 'Other documents' },
  { formKey: 'signature', key: 'signature', label: 'Digital signature' },
]

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { first: parts[0] || '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export function teacherToForm(t: Teacher): Form {
  const { first, last } = splitName(t.name)
  return {
    ...INITIAL_FORM,
    teacherId: t.code ?? t.id,
    firstName: first,
    lastName: last,
    gender: t.gender,
    dob: toDateInputValue(t.dob),
    bloodGroup: t.bloodGroup ?? '',
    maritalStatus: t.maritalStatus ?? '',
    phone: t.phone ?? '',
    altPhone: t.altPhone ?? '',
    email: t.email ?? '',
    fatherName: t.fatherName ?? '',
    motherName: t.motherName ?? '',
    aadhaar: t.aadhaar ?? '',
    pan: t.pan ?? '',
    nationality: t.nationality ?? 'Indian',
    religion: t.religion ?? '',
    languages: t.languages ?? '',
    permanentAddress: t.permanentAddress ?? '',
    currentAddress: t.currentAddress ?? '',
    class: t.classTeacher ?? '',
    subject: (t.subjects ?? []).join(', '),
    qualification: t.qualification ?? '',
    specialization: t.specialization ?? '',
    experience: String(t.exp ?? ''),
    prevSchool: t.prevSchool ?? '',
    prevSchoolAddress: t.prevSchoolAddress ?? '',
    prevSchoolPhone: t.prevSchoolPhone ?? '',
    dateOfJoining: toDateInputValue(t.dateOfJoining),
    dateOfLeaving: toDateInputValue(t.dateOfLeaving),
    status: t.status === 'inactive' ? 'inactive' : 'active',
    role: t.role ?? INITIAL_FORM.role,
    employeeType: t.employeeType ?? '',
    department: t.dept ?? '',
    designation: t.desig ?? '',
    contractType: t.contractType ?? '',
    workShift: t.workShift ?? '',
    workLocation: t.workLocation ?? '',
    basicSalary: t.basicSalary ?? '',
    hra: t.hra ?? '',
    allowances: t.allowances ?? '',
    epf: t.epf ?? '',
    profTax: t.profTax ?? '',
    otherDeductions: t.otherDeductions ?? '',
    uan: t.uan ?? '',
    medical: t.leaves?.medical != null ? String(t.leaves.medical) : '',
    casual: t.leaves?.casual != null ? String(t.leaves.casual) : '',
    sick: t.leaves?.sick != null ? String(t.leaves.sick) : '',
    maternity: t.leaves?.maternity != null ? String(t.leaves.maternity) : '',
    accHolder: t.bank?.holder ?? '',
    accNumber: t.bank?.account ?? '',
    bankName: t.bank?.bank ?? '',
    ifsc: t.bank?.ifsc ?? '',
    branch: t.bank?.branch ?? '',
    emPerson: t.emergency?.person ?? '',
    emRelationship: t.emergency?.relationship ?? '',
    emPhone: t.emergency?.phone ?? '',
    route: t.transport?.route ?? '',
    vehicle: t.transport?.vehicle ?? '',
    pickup: t.transport?.pickup ?? '',
    hostelName: t.hostel?.hostel ?? '',
    roomNumber: t.hostel?.room ?? '',
    facebook: t.social?.facebook ?? '',
    instagram: t.social?.instagram ?? '',
    linkedin: t.social?.linkedin ?? '',
    youtube: t.social?.youtube ?? '',
    twitter: t.social?.twitter ?? '',
    username: t.username ?? '',
    notes: t.notes ?? '',
    remarks: t.remarks ?? '',
    profileStatus: t.status === 'inactive' ? 'inactive' : 'active',
  }
}

function TeacherFormScreen({ mode }: { mode: 'add' | 'edit' }) {
  const app = useApp()
  const payrollEnabled = tierIncludes(app.plan, 'hr_payroll')
  const toast = useToast()
  const createTeacher = useCreateTeacher()
  const updateTeacher = useUpdateTeacher()
  const rosterQ = useTeachers()
  const existingQ = useTeacher(mode === 'edit' ? app.focus : null)
  const existing = existingQ.data
  const [f, setForm] = useState<Form>(INITIAL_FORM)
  const [files, setFiles] = useState<Files>(INITIAL_FILES)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(mode === 'add')
  const [saving, setSaving] = useState(false)
  const [savedUrls, setSavedUrls] = useState<Partial<Record<keyof typeof INITIAL_FILES, string>>>({})

  const { txt, sel, area, upload, fieldGrid } = useFormKit(f, setForm, files, setFiles, errors)

  const structuresQ = useSalaryStructures()
  const profilesQ = useSalaryProfiles(payrollEnabled)
  const structFor = (designation: string): SalaryStructure | undefined => {
    const key = designation.trim().toLowerCase()
    if (!key) return undefined
    return (structuresQ.data ?? []).find(
      (s) => s.personType === 'teacher' && s.roleKey.trim().toLowerCase() === key,
    )
  }
  const applyStructure = () => {
    const s = structFor(f.designation)
    if (!s) return
    const val = (n: number) => (n ? String(n) : '')
    setForm((prev) => ({
      ...prev,
      basicSalary: val(s.basic), hra: val(s.hra), allowances: val(s.allowances),
      epf: val(s.epf), profTax: val(s.profTax), otherDeductions: val(s.otherDeductions),
    }))
  }
  const netMonthly = computeSalary({
    basic: toAmount(f.basicSalary), hra: toAmount(f.hra), allowances: toAmount(f.allowances),
    epf: toAmount(f.epf), profTax: toAmount(f.profTax), otherDeductions: toAmount(f.otherDeductions),
  }).net

  const clearSaved = (key: keyof typeof INITIAL_FILES) => {
    setSavedUrls((prev) => {
      if (!prev[key]) return prev
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
  }

  const fileUpload = (key: keyof typeof INITIAL_FILES, label: string, opts?: { photo?: boolean }) =>
    upload(key, label, {
      photoPreview: !!opts?.photo,
      existingUrl: savedUrls[key],
      existingLabel: label,
      onClearExisting: () => clearSaved(key),
    })

  const suggestedId = useMemo(() => {
    const prefix = personCodePrefix(app.school.slug, 'TCH')
    return nextPersonCode(prefix, (rosterQ.data ?? []).map((t) => t.code ?? t.id))
  }, [app.school.slug, rosterQ.data])

  useEffect(() => {
    // Always sync (never guard on "already set") — the field is read-only, so nothing the user
    // typed could ever be here to protect. Guarding used to stick the ID at its first guess
    // (computed before the roster query resolves) even after the real roster loaded and the
    // correct next number became known.
    if (mode !== 'add') return
    setForm((prev) => (prev.teacherId === suggestedId ? prev : { ...prev, teacherId: suggestedId }))
  }, [mode, suggestedId])

  useEffect(() => {
    if (mode !== 'edit' || !existing) return
    if (payrollEnabled && (profilesQ.isLoading || structuresQ.isLoading)) return

    const structure = payrollEnabled
      ? findSalaryStructure(structuresQ.data, 'teacher', existing.desig ?? '')
      : undefined
    const profile = payrollEnabled
      ? findSalaryProfile(profilesQ.data, 'teacher', existing.id)
      : undefined
    const base = teacherToForm(existing)
    const salaryFields = payrollEnabled
      ? mergeSalaryDisplayFields(profile, structure)
      : {}
    const form = payrollEnabled ? { ...base, ...salaryFields } : base

    setForm(form)
    let cancelled = false
    void fetchTeacherExtras(existing.id)
      .then((ex) => {
        if (cancelled) return
        const withExtras = teacherToForm(mergeTeacherExtras({ ...existing }))
        setForm(payrollEnabled ? { ...withExtras, ...salaryFields } : withExtras)
        const next: Partial<Record<keyof typeof INITIAL_FILES, string>> = {}
        const map = Object.fromEntries(
          TEACHER_FILE_PICKS.map((p) => [p.key, p.formKey]),
        ) as Record<string, keyof typeof INITIAL_FILES>
        for (const d of ex?.files ?? []) {
          if (!d.dataUrl) continue
          const formKey = map[d.key]
          if (formKey) next[formKey] = d.dataUrl
        }
        setSavedUrls(next)
        setHydrated(true)
      })
      .catch(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => { cancelled = true }
  }, [mode, existing, payrollEnabled, profilesQ.data, profilesQ.isLoading, structuresQ.data, structuresQ.isLoading])

  const classNames = useClassNames()
  const subjectOptions = useSubjectNames(f.subject)
  const selectedSubjects = useMemo(
    () => new Set(f.subject.split(',').map((s) => s.trim()).filter(Boolean)),
    [f.subject],
  )
  const toggleSubject = (name: string) => {
    const next = new Set(selectedSubjects)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setForm((prev) => ({ ...prev, subject: [...next].join(', ') }))
  }

  /** Who is already class teacher of each class (exclude current teacher when editing). */
  const ctByClass = useMemo(() => {
    const m = new Map<string, Teacher>()
    for (const t of rosterQ.data ?? []) {
      if (mode === 'edit' && existing && t.id === existing.id) continue
      const key = (t.classTeacher ?? '').trim()
      if (key) m.set(key, t)
    }
    return m
  }, [rosterQ.data, mode, existing])

  const freeClassCount = useMemo(
    () => classNames.filter((n) => !ctByClass.has(n)).length,
    [classNames, ctByClass],
  )

  const classOptions = useMemo(() => {
    const opts = classNames.map((n) => {
      const holder = ctByClass.get(n)
      if (holder) {
        const short = holder.name.split(/\s+/)[0]
        return { value: n, label: `${n} · ${short}` }
      }
      return { value: n, label: n }
    })
    if (f.class && !opts.some((o) => o.value === f.class)) {
      opts.unshift({ value: f.class, label: f.class })
    }
    return [
      { value: '', label: 'Not a class teacher' },
      ...opts,
    ]
  }, [classNames, f.class, ctByClass])
  const deptOptions = useMemo(() => [{ value: '', label: 'Select…' }, ...depts.map((d) => ({ value: d, label: d }))], [])

  /* ---------- validation ---------- */
  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {}
    for (const key of REQUIRED_FIELDS) {
      const msg = required(f[key])
      if (msg) e[key] = msg
    }
    const roster = rosterQ.data ?? []
    const checks: [string, string | null][] = [
      ['phone', e.phone ? null : validatePhone(f.phone)
        || (isDuplicateValue(f.phone, roster.map((t) => ({ id: t.id, value: t.phone })), normalizePhoneDigits, existing?.id)
          ? 'Another teacher already uses this phone number' : null)],
      ['altPhone', validatePhone(f.altPhone)],
      ['email', e.email ? null : validateEmail(f.email)
        || (isDuplicateValue(f.email, roster.map((t) => ({ id: t.id, value: t.email })), normalizeEmailKey, existing?.id)
          ? 'Another teacher already uses this email' : null)],
      ['aadhaar', validateAadhaar(f.aadhaar)],
      ['pan', validatePAN(f.pan)],
      ['prevSchoolPhone', validatePhone(f.prevSchoolPhone)],
      ['ifsc', validateIFSC(f.ifsc)],
      ['emPhone', validatePhone(f.emPhone)],
      ['facebook', validateURL(f.facebook)],
      ['instagram', validateURL(f.instagram)],
      ['linkedin', validateURL(f.linkedin)],
      ['youtube', validateURL(f.youtube)],
      ['twitter', validateURL(f.twitter)],
      ['confirmPassword', passwordsMatch(f.password, f.confirmPassword)],
    ]
    for (const [key, msg] of checks) if (msg) e[key] = msg
    for (const key of Object.keys(files)) {
      const msg = validateFile(files[key])
      if (msg) e[key] = msg
    }
    return e
  }

  const num = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v))
  const orU = (v: string): string | undefined => v.trim() || undefined

  const buildTeacher = (base?: Teacher): Teacher => {
    const firstName = properName(f.firstName)
    const lastName = properName(f.lastName)
    const name = `${firstName} ${lastName}`.trim()
    const inactive = f.profileStatus === 'inactive' || f.status === 'inactive'
    return {
      id: base?.id || 'pending',
      code: f.teacherId.trim() || suggestedId,
      name,
      gender: f.gender === 'F' ? 'F' : 'M',
      dept: f.department,
      desig: f.designation,
      role: orU(f.role),
      subjects: f.subject.split(',').map((s) => s.trim()).filter(Boolean),
      classTeacher: f.class || null,
      phone: f.phone.trim(),
      email: f.email.trim(),
      exp: Number(f.experience) || 0,
      rating: base?.rating ?? 0,
      attendance: base?.attendance ?? 0,
      result: base?.result ?? 0,
      load: base?.load ?? 0,
      status: inactive ? 'inactive' : 'active',
      avatarHue: base?.avatarHue ?? ((name.length * 47) % 360),
      top: base?.top ?? false,
      dob: orU(f.dob), bloodGroup: orU(f.bloodGroup), maritalStatus: orU(f.maritalStatus),
      altPhone: orU(f.altPhone),
      fatherName: properName(f.fatherName) || undefined,
      motherName: properName(f.motherName) || undefined,
      aadhaar: orU(f.aadhaar), pan: orU(f.pan), nationality: orU(f.nationality), religion: orU(f.religion),
      languages: orU(f.languages),
      permanentAddress: properPlace(f.permanentAddress) || undefined,
      currentAddress: properPlace(f.currentAddress) || undefined,
      photoName: files.teacherPhoto?.name || base?.photoName,
      qualification: orU(f.qualification), specialization: orU(f.specialization),
      prevSchool: properName(f.prevSchool) || undefined,
      prevSchoolAddress: properPlace(f.prevSchoolAddress) || undefined,
      prevSchoolPhone: orU(f.prevSchoolPhone),
      dateOfJoining: orU(f.dateOfJoining), dateOfLeaving: orU(f.dateOfLeaving),
      employeeType: orU(f.employeeType), contractType: orU(f.contractType), workShift: orU(f.workShift),
      workLocation: orU(f.workLocation), basicSalary: orU(f.basicSalary),
      hra: orU(f.hra), allowances: orU(f.allowances), epf: orU(f.epf),
      profTax: orU(f.profTax), otherDeductions: orU(f.otherDeductions), uan: orU(f.uan),
      username: orU(f.username), notes: orU(f.notes), remarks: orU(f.remarks),
      signatureName: files.signature?.name || base?.signatureName,
      bank: {
        holder: properName(f.accHolder) || undefined,
        account: orU(f.accNumber),
        bank: properName(f.bankName) || undefined,
        ifsc: orU(f.ifsc),
        branch: properName(f.branch) || undefined,
      },
      emergency: {
        person: properName(f.emPerson) || undefined,
        relationship: orU(f.emRelationship),
        phone: orU(f.emPhone),
      },
      transport: { route: orU(f.route), vehicle: orU(f.vehicle), pickup: orU(f.pickup) },
      hostel: { hostel: properName(f.hostelName) || undefined, room: orU(f.roomNumber) },
      social: { facebook: orU(f.facebook), instagram: orU(f.instagram), linkedin: orU(f.linkedin), youtube: orU(f.youtube), twitter: orU(f.twitter) },
      leaves: { medical: num(f.medical), casual: num(f.casual), sick: num(f.sick), maternity: num(f.maternity) },
      documents: {
        resume: files.resume?.name || base?.documents?.resume,
        joiningLetter: files.joiningLetter?.name || base?.documents?.joiningLetter,
        aadhaar: files.aadhaarDoc?.name || base?.documents?.aadhaar,
        pan: files.panDoc?.name || base?.documents?.pan,
        experienceCert: files.experienceCert?.name || base?.documents?.experienceCert,
        educationCert: files.educationCert?.name || base?.documents?.educationCert,
        other: files.otherDoc?.name || base?.documents?.other,
      },
    }
  }

  const save = () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      toast.danger('Check the form', 'Some fields need your attention before saving.')
      return
    }

    const teacher = buildTeacher(existing)
    const name = teacher.name
    setSaving(true)

    const classKey = (teacher.classTeacher ?? '').trim()
    const previousHolders = classKey
      ? (rosterQ.data ?? []).filter((t) =>
        (t.classTeacher ?? '').trim() === classKey
        && t.id !== (mode === 'edit' && existing ? existing.id : ''))
      : []

    const afterOk = (saved: Teacher) => {
      const finish = async () => {
        if (payrollEnabled) {
          try {
            await upsertSalaryProfile('teacher', saved.id, upsertInputFromForm(f, structFor(f.designation)))
          } catch (err) {
            setSaving(false)
            toast.danger(
              'Salary not saved',
              err instanceof Error ? err.message : 'Payroll profile could not be saved. Try again.',
            )
            return
          }
        }
        // Photo goes to the real Users.PhotoUrl field (what the teacher app
        // reads) — not the extras/localStorage mock below, which only ever
        // remembered the file name. A newly-invited teacher with no linked
        // Users row yet (409 no_linked_user) is expected, not an error.
        if (files.teacherPhoto) {
          void (async () => {
            try {
              const { compressImageFile } = await import('@/lib/compressImage')
              const dataUrl = await compressImageFile(files.teacherPhoto!, { maxEdge: 960, quality: 0.78 })
              await updateTeacherPhoto(saved.id, dataUrl)
            } catch {
              /* best-effort; the teacher can also set their own photo once signed in */
            }
          })()
        }
        try {
          await persistTeacherExtras(
            saved.id,
            { ...teacher, id: saved.id },
            TEACHER_FILE_PICKS.map((p) => ({ key: p.key, label: p.label, file: files[p.formKey] })),
          )
        } catch (err) {
          setSaving(false)
          toast.danger(
            'Teacher saved, extras failed',
            err instanceof Error ? err.message : 'Onboarding details could not be saved to the server.',
          )
          if (mode === 'edit') app.go('school.teachers', { focus: saved.id })
          else app.go('school.teachers')
          return
        }
        setSaving(false)
        const replaced = previousHolders.length
          ? ` · replaced CT on ${classKey}`
          : classKey
            ? ` · class teacher of ${classKey}`
            : ''
        toast.success(mode === 'edit' ? 'Teacher updated' : 'Teacher added', `${name} · ${f.department}${replaced}.`)
        if (mode === 'edit') app.go('school.teachers', { focus: saved.id })
        else app.go('school.teachers')
      }
      /* Clear other teachers who held this class so only one CT per class. */
      if (previousHolders.length === 0) {
        void finish()
        return
      }
      let left = previousHolders.length
      for (const prev of previousHolders) {
        updateTeacher.mutate(
          { id: prev.id, teacher: { ...prev, classTeacher: null } },
          {
            onSettled: () => {
              left -= 1
              if (left <= 0) finish()
            },
          },
        )
      }
    }

    if (mode === 'edit' && existing) {
      updateTeacher.mutate({ id: existing.id, teacher }, {
        onSuccess: afterOk,
        onError: (err) => {
          setSaving(false)
          toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
        },
      })
      return
    }

    createTeacher.mutate(teacher, {
      onSuccess: afterOk,
      onError: (err) => {
        setSaving(false)
        toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  if (mode === 'edit' && existingQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 240 }}><Spinner size={28} /><div className="t-sm muted">Loading teacher…</div></div>
  }
  if (mode === 'edit' && (existingQ.isError || !existing)) {
    return (
      <div>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.teachers')}>Teachers</Btn>
        <Empty icon="user" title="Teacher not found" body="Open a teacher from the list, then choose Edit." />
      </div>
    )
  }
  if (!hydrated) return null

  const back = () => {
    if (mode === 'edit' && existing) app.go('school.teachers', { focus: existing.id })
    else app.go('school.teachers')
  }

  return (
    <div>
      <div className="row ai-center gap12" style={{ marginBottom: 16 }}>
        <Btn variant="ghost" icon="arrowLeft" onClick={back}>{mode === 'edit' ? 'Teachers' : 'Teachers'}</Btn>
      </div>

      <PageHead
        title={mode === 'edit' ? 'Edit teacher' : 'Onboard teacher'}
        sub={`${mode === 'edit' ? 'Update profile' : 'Name, address & documents'} · ${app.school.name}`}
      />

      <div className="col gap16">
        {/* ---- Personal ---- */}
        <Card>
          <CardHead title="Personal information" icon="user" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {mode === 'edit' ? (
              <Field label="Teacher ID" hint="Fixed after create">
                <Input value={f.teacherId} readOnly disabled aria-label="Teacher ID" />
              </Field>
            ) : (
              txt('teacherId', 'Teacher ID', { ph: suggestedId || 'scc/TCH/26/0001', readOnly: true })
            )}
            {txt('firstName', 'First name', { required: true, icon: 'user', ph: 'Rajesh', case: 'name' })}
            {txt('lastName', 'Last name', { required: true, ph: 'Kumar', case: 'name' })}
            {sel('gender', 'Gender', GENDERS)}
            {txt('dob', 'Date of birth', { type: 'date' })}
            {sel('bloodGroup', 'Blood group', BLOOD_GROUPS)}
            {sel('maritalStatus', 'Marital status', MARITAL)}
            {txt('phone', 'Primary contact number', { required: true, icon: 'phone', ph: '+91 9XXXXXXXXX' })}
            {txt('altPhone', 'Alternate contact number', { icon: 'phone' })}
            {txt('email', 'Email address', { required: true, ph: 'teacher@school.edu' })}
            {txt('fatherName', "Father's name", { case: 'name' })}
            {txt('motherName', "Mother's name", { case: 'name' })}
            {txt('pan', 'PAN number', { ph: 'ABCDE1234F' })}
            {txt('nationality', 'Nationality')}
            {sel('religion', 'Religion', RELIGIONS)}
            {txt('languages', 'Languages known', { ph: 'e.g. Hindi, English' })}
            {area('permanentAddress', 'Permanent address')}
            {area('currentAddress', 'Current address')}
          </>)}</div>
        </Card>

        <Card>
          <CardHead
            title="Photo & ID"
            icon="user"
            action={<Badge tone="neutral">JPG / PNG / PDF · max 4 MB</Badge>}
          />
          <div className="sm-photo-id">
            <div className="sm-photo-id-photo">
              {fileUpload('teacherPhoto', 'Teacher photo', { photo: true })}
            </div>
            <div className="sm-photo-id-docs">
              {txt('aadhaar', 'Aadhaar number', { ph: '12 digits' })}
              {fileUpload('aadhaarDoc', 'Aadhaar card')}
              <div className="t-xs muted">Photo shows on teacher lists · Aadhaar is stored for the profile.</div>
            </div>
          </div>
        </Card>

        {/* ---- Academic ---- */}
        <Card>
          <CardHead title="Academic information" icon="cap" />
          <div className="sm-academic-form">
            <div className="sm-academic-form__block">
              <Field
                label="Class teacher of"
                hint={
                  freeClassCount === 0 && classNames.length > 0
                    ? 'Every class already has a class teacher. Pick one only to replace them.'
                    : 'Optional. Leave as “Not a class teacher” for subject-only teachers.'
                }
                error={errors.class}
              >
                <Select options={classOptions} value={f.class} onChange={(e) => setForm((prev) => ({ ...prev, class: e.target.value }))} />
              </Field>
            </div>

            <div className="sm-academic-form__block">
              <Field
                label="Subjects"
                hint={subjectOptions.length ? 'Tick every subject this teacher can teach' : undefined}
              >
                {subjectOptions.length === 0 ? (
                  <div className="t-sm muted" style={{ padding: '10px 0' }}>Add subjects under Academics → Subjects first.</div>
                ) : (
                  <div className="sm-subject-picks">
                    {subjectOptions.map((name) => (
                      <Checkbox
                        key={name}
                        label={name}
                        checked={selectedSubjects.has(name)}
                        onChange={() => toggleSubject(name)}
                      />
                    ))}
                  </div>
                )}
              </Field>
            </div>

            <div className="sm-grid-3 gap14">
              {txt('qualification', 'Qualification', { ph: 'e.g. M.Sc, B.Ed' })}
              {txt('specialization', 'Specialization')}
              {txt('experience', 'Experience (years)', { type: 'number', ph: '0' })}
            </div>

            <div className="sm-form-panel">
              <div className="sm-form-panel__head">Previous school</div>
              <div className="sm-form-panel__body">
                <div className="sm-grid-2 gap14">
                  {txt('prevSchool', 'School name', { ph: 'e.g. Delhi Public School', case: 'name' })}
                  {txt('prevSchoolPhone', 'School phone', { icon: 'phone' })}
                </div>
                {area('prevSchoolAddress', 'School address')}
              </div>
            </div>

            <div className="sm-grid-3 gap14">
              {txt('dateOfJoining', 'Date of joining', { type: 'date' })}
              {txt('dateOfLeaving', 'Date of leaving', { type: 'date' })}
              {sel('status', 'Status', STATUS_OPTS)}
            </div>
          </div>
        </Card>

        <div className="sm-grid-2 gap16">
          {/* ---- Employment ---- */}
          <Card>
            <CardHead title="Employment information" icon="briefcase" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {sel('role', 'Role', ROLES)}
              {sel('employeeType', 'Employee type', EMP_TYPES)}
              {sel('department', 'Department', deptOptions, true)}
              {sel('designation', 'Designation', DESIGNATIONS, true)}
              {sel('contractType', 'Contract type', CONTRACT_TYPES)}
              {sel('workShift', 'Work shift', SHIFTS)}
              {txt('workLocation', 'Work location')}
              {txt('uan', 'UAN number')}
            </>)}</div>
          </Card>

          {/* ---- Salary components (Platinum) ---- */}
          {payrollEnabled && (
          <Card>
            <CardHead
              title="Salary components"
              icon="rupee"
              action={structFor(f.designation)
                ? <Btn size="sm" variant="ghost" icon="layers" onClick={applyStructure}>Use {f.designation} structure</Btn>
                : undefined}
            />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('basicSalary', 'Basic salary (₹/mo)', { type: 'number', icon: 'rupee' })}
              {txt('hra', 'HRA (₹/mo)', { type: 'number', icon: 'rupee' })}
              {txt('allowances', 'Allowances (₹/mo)', { type: 'number', icon: 'rupee' })}
              {txt('epf', 'EPF deduction (₹/mo)', { type: 'number', icon: 'rupee' })}
              {txt('profTax', 'Professional tax (₹/mo)', { type: 'number', icon: 'rupee' })}
              {txt('otherDeductions', 'Other deductions (₹/mo)', { type: 'number', icon: 'rupee' })}
            </>)}</div>
            <div className="t-xs muted" style={{ marginTop: 8 }}>
              Net / month: <span className="fw6">₹ {netMonthly.toLocaleString('en-IN')}</span>
              {' '}· Leave blank to inherit the {f.designation || 'role'} salary structure when payroll runs.
            </div>
          </Card>
          )}

          {/* ---- Leave ---- */}
          <Card>
            <CardHead title="Leave information" icon="calendar" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('medical', 'Medical leaves', { type: 'number', ph: '0' })}
              {txt('casual', 'Casual leaves', { type: 'number', ph: '0' })}
              {txt('sick', 'Sick leaves', { type: 'number', ph: '0' })}
              {txt('maternity', 'Maternity leaves', { type: 'number', ph: '0' })}
            </>)}</div>
          </Card>
        </div>

        <div className="sm-grid-2 gap16">
          {/* ---- Bank ---- */}
          <Card>
            <CardHead title="Bank details" icon="wallet" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('accHolder', 'Account holder name', { case: 'name' })}
              {txt('accNumber', 'Account number')}
              {txt('bankName', 'Bank name', { case: 'name' })}
              {txt('ifsc', 'IFSC code', { ph: 'SBIN0001234' })}
              {txt('branch', 'Branch name', { case: 'name' })}
            </>)}</div>
          </Card>

          {/* ---- Emergency ---- */}
          <Card>
            <CardHead title="Emergency contact" icon="alert" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('emPerson', 'Contact person', { icon: 'user', case: 'name' })}
              {txt('emRelationship', 'Relationship')}
              {txt('emPhone', 'Contact number', { icon: 'phone' })}
            </>)}</div>
          </Card>
        </div>

        <div className="sm-grid-2 gap16">
          {/* ---- Transport ---- */}
          <Card>
            <CardHead title="Transport information" icon="bus" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('route', 'Route')}
              {txt('vehicle', 'Vehicle number')}
              {txt('pickup', 'Pickup point')}
            </>)}</div>
          </Card>

          {/* ---- Hostel ---- */}
          <Card>
            <CardHead title="Hostel information" icon="building" />
            <div style={{ marginTop: 12 }}>{fieldGrid(<>
              {txt('hostelName', 'Hostel name', { case: 'name' })}
              {txt('roomNumber', 'Room number')}
            </>)}</div>
          </Card>
        </div>

        {/* ---- Social ---- */}
        <Card>
          <CardHead title="Social media" icon="globe" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {txt('facebook', 'Facebook URL', { ph: 'https://…' })}
            {txt('instagram', 'Instagram URL', { ph: 'https://…' })}
            {txt('linkedin', 'LinkedIn URL', { ph: 'https://…' })}
            {txt('youtube', 'YouTube URL', { ph: 'https://…' })}
            {txt('twitter', 'Twitter / X URL', { ph: 'https://…' })}
          </>)}</div>
        </Card>

        {/* ---- Documents ---- */}
        <Card>
          <CardHead title="Documents" icon="doc" action={<Badge tone="neutral">PDF / JPG / PNG · max 4 MB</Badge>} />
          <div className="sm-doc-grid">
            {fileUpload('resume', 'Resume')}
            {fileUpload('joiningLetter', 'Joining letter')}
            {fileUpload('panDoc', 'PAN card')}
            {fileUpload('experienceCert', 'Experience certificate')}
            {fileUpload('educationCert', 'Education certificate')}
            {fileUpload('otherDoc', 'Other documents')}
          </div>
          <div className="t-xs muted" style={{ marginTop: 10 }}>PDFs open with Open after pick · View / Download in the teacher profile after save.</div>
        </Card>

        {/* ---- Login ---- */}
        <Card>
          <CardHead title="Login information" icon="key" action={<Badge tone="neutral" icon="lock">Password is not stored (demo)</Badge>} />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {txt('username', 'Username', { icon: 'user' })}
            {txt('password', 'Password', { type: 'password', icon: 'lock' })}
            {txt('confirmPassword', 'Confirm password', { type: 'password', icon: 'lock' })}
          </>)}</div>
        </Card>

        {/* ---- Additional ---- */}
        <Card>
          <CardHead title="Additional information" icon="list" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {area('notes', 'Notes')}
            {area('remarks', 'Remarks')}
            <div style={{ gridColumn: '1 / -1', maxWidth: 280 }}>{fileUpload('signature', 'Digital signature', { photo: true })}</div>
            {sel('profileStatus', 'Profile status', STATUS_OPTS)}
          </>)}</div>
        </Card>
      </div>

      {/* ---- sticky action bar ---- */}
      <div
        className="row ai-center jc-end gap8"
        style={{
          position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 0',
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
        }}
      >
        <Btn variant="ghost" onClick={back}>Cancel</Btn>
        <Btn variant="primary" icon="check" onClick={save} disabled={saving || createTeacher.isPending || updateTeacher.isPending}>
          {saving || createTeacher.isPending || updateTeacher.isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save teacher'}
        </Btn>
      </div>
    </div>
  )
}

function AddTeacherScreen() {
  return <TeacherFormScreen mode="add" />
}

function EditTeacherScreen() {
  return <TeacherFormScreen mode="edit" />
}

export const teacherAddScreens: Record<string, ComponentType> = {
  'school.teachers.add': AddTeacherScreen,
  'school.teachers.edit': EditTeacherScreen,
}
