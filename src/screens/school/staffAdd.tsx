/* ============================================================
   SchoolMate — Add / Edit Staff (full-page onboarding form).
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { tierIncludes } from '@/lib/gating'
import { TierGate } from '@/components/shell/gates'
import { useStaff, useStaffById } from '@/api/hooks/useStaff'
import { useCreateStaff, useUpdateStaff } from '@/api/hooks/useStaffMutations'
import { fetchStaffExtras, persistStaffExtras, mergeStaffExtras } from '@/api/staffExtras'
import { updateStaffPhoto } from '@/api/staff'
import { upsertSalaryProfile, type SalaryStructure } from '@/api/payroll'
import { toAmount, computeSalary } from '@/lib/payroll'
import { nextPersonCode, personCodePrefix } from '@/lib/personCodes'
import { PageHead, Card, CardHead, Btn, Badge, useFormKit, Spinner, Empty, Field, Input } from '@/components/ui'
import { depts } from '@/data/mockDb'
import { normalizeStaffCategory } from '@/lib/staffCategory'
import {
  required, validateAadhaar, validatePAN, validateIFSC, validateURL,
  validateEmail, validatePhone, validateFile, passwordsMatch,
  isDuplicateValue, normalizePhoneDigits, normalizeEmailKey,
} from '@/lib/validation'
import { properName, properPlace } from '@/lib/properCase'
import { toDateInputValue } from '@/lib/dateInput'
import { STAFF_ROLES as STAFF_ROLE_KEYS } from '@/lib/salaryRoles'
import { useSalaryStructures, useSalaryProfiles } from '@/api/hooks/usePayroll'
import { findSalaryProfile, findSalaryStructure, mergeSalaryDisplayFields, upsertInputFromForm } from '@/lib/salaryProfileForm'
import type { Staff } from '@/types'

/* ---------- option lists ---------- */
const SEL = (...vals: string[]) => ['', ...vals]
const GENDERS = [{ value: '', label: 'Select…' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]
const BLOOD_GROUPS = SEL('A+', 'A−', 'B+', 'B−', 'O+', 'O−', 'AB+', 'AB−')
const MARITAL = SEL('Single', 'Married', 'Divorced', 'Widowed')
const RELIGIONS = SEL('Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other')
const CATEGORIES = [
  { value: '', label: 'Select…' },
  { value: 'transport', label: 'Transport' },
  { value: 'security', label: 'Security' },
  { value: 'academic', label: 'Academic' },
  { value: 'admin', label: 'Admin' },
  { value: 'support', label: 'Support' },
]
const STAFF_ROLES = SEL(...STAFF_ROLE_KEYS)
const EMP_TYPES = SEL('Full-time', 'Part-time', 'Contract', 'Visiting', 'Intern')
const CONTRACT_TYPES = SEL('Permanent', 'Temporary', 'Probation', 'Fixed-term')
const SHIFTS = SEL('Morning', 'Day', 'Evening', 'Night', 'Rotational')
const STATUS_OPTS = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]

const REQUIRED_FIELDS = ['firstName', 'lastName', 'phone', 'email', 'role', 'category', 'department'] as const

type Form = Record<string, string>
type Files = Record<string, File | null>

const INITIAL_FORM: Form = {
  // personal
  staffId: '', firstName: '', lastName: '', gender: '', dob: '', bloodGroup: '', maritalStatus: '',
  phone: '', altPhone: '', email: '', fatherName: '', motherName: '', aadhaar: '', pan: '',
  nationality: 'Indian', religion: '', languages: '', permanentAddress: '', currentAddress: '',
  // employment
  role: '', category: '', department: '', employeeType: '', contractType: '', shift: '', workLocation: '',
  dateOfJoining: '', dateOfLeaving: '', status: 'active',
  basicSalary: '', hra: '', allowances: '', epf: '', profTax: '', otherDeductions: '', uan: '',
  // bank
  accHolder: '', accNumber: '', bankName: '', ifsc: '', branch: '',
  // emergency
  emPerson: '', emRelationship: '', emPhone: '',
  // transport
  route: '', vehicle: '', pickup: '', license: '', licenseExpiry: '',
  // social
  facebook: '', instagram: '', linkedin: '', youtube: '', twitter: '',
  // login
  username: '', password: '', confirmPassword: '',
  // additional
  notes: '', remarks: '',
}

const INITIAL_FILES: Files = {
  staffPhoto: null, resume: null, joiningLetter: null, aadhaarDoc: null, panDoc: null,
  experienceCert: null, educationCert: null, otherDoc: null, signature: null,
  licenseDoc: null, medicalCertDoc: null,
}

const STAFF_FILE_PICKS: Array<{ formKey: keyof typeof INITIAL_FILES; key: string; label: string }> = [
  { formKey: 'staffPhoto', key: 'photo', label: 'Staff photo' },
  { formKey: 'resume', key: 'resume', label: 'Resume' },
  { formKey: 'joiningLetter', key: 'joiningLetter', label: 'Joining letter' },
  { formKey: 'aadhaarDoc', key: 'aadhaar', label: 'Aadhaar card' },
  { formKey: 'panDoc', key: 'pan', label: 'PAN card' },
  { formKey: 'experienceCert', key: 'experienceCert', label: 'Experience certificate' },
  { formKey: 'educationCert', key: 'educationCert', label: 'Education certificate' },
  { formKey: 'otherDoc', key: 'other', label: 'Other documents' },
  { formKey: 'signature', key: 'signature', label: 'Digital signature' },
  { formKey: 'licenseDoc', key: 'license', label: 'Driving license' },
  { formKey: 'medicalCertDoc', key: 'medicalCert', label: 'Medical certificate' },
]

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { first: parts[0] || '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export function staffToForm(s: Staff): Form {
  const { first, last } = splitName(s.name)
  return {
    ...INITIAL_FORM,
    staffId: s.code ?? s.id,
    firstName: first,
    lastName: last,
    gender: s.gender,
    dob: toDateInputValue(s.dob),
    bloodGroup: s.bloodGroup ?? '',
    maritalStatus: s.maritalStatus ?? '',
    phone: s.phone ?? '',
    altPhone: s.altPhone ?? '',
    email: s.email ?? '',
    fatherName: s.fatherName ?? '',
    motherName: s.motherName ?? '',
    aadhaar: s.aadhaar ?? '',
    pan: s.pan ?? '',
    nationality: s.nationality ?? 'Indian',
    religion: s.religion ?? '',
    languages: s.languages ?? '',
    permanentAddress: s.permanentAddress ?? '',
    currentAddress: s.currentAddress ?? '',
    role: s.role ?? '',
    category: s.cat ?? '',
    department: s.dept ?? '',
    employeeType: s.employeeType ?? '',
    contractType: s.contractType ?? '',
    shift: s.shift ?? '',
    workLocation: s.workLocation ?? '',
    dateOfJoining: toDateInputValue(s.dateOfJoining),
    dateOfLeaving: toDateInputValue(s.dateOfLeaving),
    status: s.status === 'inactive' ? 'inactive' : 'active',
    basicSalary: s.basicSalary ?? '',
    hra: s.hra ?? '',
    allowances: s.allowances ?? '',
    epf: s.epf ?? '',
    profTax: s.profTax ?? '',
    otherDeductions: s.otherDeductions ?? '',
    uan: s.uan ?? '',
    accHolder: s.bank?.holder ?? '',
    accNumber: s.bank?.account ?? '',
    bankName: s.bank?.bank ?? '',
    ifsc: s.bank?.ifsc ?? '',
    branch: s.bank?.branch ?? '',
    emPerson: s.emergency?.person ?? '',
    emRelationship: s.emergency?.relationship ?? '',
    emPhone: s.emergency?.phone ?? '',
    route: s.transport?.route ?? s.route ?? '',
    vehicle: s.transport?.vehicle ?? '',
    pickup: s.transport?.pickup ?? '',
    license: s.transport?.license ?? '',
    licenseExpiry: toDateInputValue(s.transport?.licenseExpiry),
    facebook: s.social?.facebook ?? '',
    instagram: s.social?.instagram ?? '',
    linkedin: s.social?.linkedin ?? '',
    youtube: s.social?.youtube ?? '',
    twitter: s.social?.twitter ?? '',
    username: s.username ?? '',
    notes: s.notes ?? '',
    remarks: s.remarks ?? '',
  }
}

function StaffFormScreen({ mode }: { mode: 'add' | 'edit' }) {
  const app = useApp()
  const payrollEnabled = tierIncludes(app.plan, 'hr_payroll')
  const toast = useToast()
  const createStaff = useCreateStaff()
  const updateStaff = useUpdateStaff()
  const rosterQ = useStaff()
  const existingQ = useStaffById(mode === 'edit' ? app.focus : null)
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
  const structFor = (role: string): SalaryStructure | undefined => {
    const key = role.trim().toLowerCase()
    if (!key) return undefined
    return (structuresQ.data ?? []).find(
      (s) => s.personType === 'staff' && s.roleKey.trim().toLowerCase() === key,
    )
  }
  const applyStructure = () => {
    const s = structFor(f.role)
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
    const prefix = personCodePrefix(app.school.slug, 'STF')
    return nextPersonCode(prefix, (rosterQ.data ?? []).map((s) => s.code ?? s.id))
  }, [app.school.slug, rosterQ.data])

  useEffect(() => {
    // Always sync (never guard on "already set") — the field is read-only, so nothing the user
    // typed could ever be here to protect. Guarding used to stick the ID at its first guess
    // (computed before the roster query resolves) even after the real roster loaded and the
    // correct next number became known.
    if (mode !== 'add') return
    setForm((prev) => (prev.staffId === suggestedId ? prev : { ...prev, staffId: suggestedId }))
  }, [mode, suggestedId])

  useEffect(() => {
    if (mode !== 'edit' || !existing) return
    if (payrollEnabled && (profilesQ.isLoading || structuresQ.isLoading)) return

    const structure = payrollEnabled
      ? findSalaryStructure(structuresQ.data, 'staff', existing.role ?? '')
      : undefined
    const profile = payrollEnabled
      ? findSalaryProfile(profilesQ.data, 'staff', existing.id)
      : undefined
    const base = staffToForm(existing)
    const salaryFields = payrollEnabled
      ? mergeSalaryDisplayFields(profile, structure)
      : {}
    const form = payrollEnabled ? { ...base, ...salaryFields } : base

    setForm(form)
    let cancelled = false
    void fetchStaffExtras(existing.id)
      .then((ex) => {
        if (cancelled) return
        const withExtras = staffToForm(mergeStaffExtras({ ...existing }))
        setForm(payrollEnabled ? { ...withExtras, ...salaryFields } : withExtras)
        const next: Partial<Record<keyof typeof INITIAL_FILES, string>> = {}
        const map = Object.fromEntries(
          STAFF_FILE_PICKS.map((p) => [p.key, p.formKey]),
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

  const deptOptions = useMemo(
    () => [
      { value: '', label: 'Select…' },
      { value: 'Transport', label: 'Transport' },
      { value: 'Security', label: 'Security' },
      { value: 'Administration', label: 'Administration' },
      { value: 'Academic Support', label: 'Academic Support' },
      { value: 'General Support', label: 'General Support' },
      ...depts.map((d) => ({ value: d, label: d })),
    ],
    [],
  )

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
        || (isDuplicateValue(f.phone, roster.map((s) => ({ id: s.id, value: s.phone })), normalizePhoneDigits, existing?.id)
          ? 'Another staff member already uses this phone number' : null)],
      ['altPhone', validatePhone(f.altPhone)],
      ['email', e.email ? null : validateEmail(f.email)
        || (isDuplicateValue(f.email, roster.map((s) => ({ id: s.id, value: s.email })), normalizeEmailKey, existing?.id)
          ? 'Another staff member already uses this email' : null)],
      ['aadhaar', validateAadhaar(f.aadhaar)],
      ['pan', validatePAN(f.pan)],
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

  const orU = (v: string): string | undefined => v.trim() || undefined

  const buildStaff = (base?: Staff): Staff => {
    const firstName = properName(f.firstName)
    const lastName = properName(f.lastName)
    const name = `${firstName} ${lastName}`.trim()
    const inactive = f.status === 'inactive'
    return {
      id: base?.id || 'pending',
      code: f.staffId.trim() || suggestedId,
      name,
      gender: f.gender === 'F' ? 'F' : 'M',
      role: f.role.trim(),
      cat: f.category || normalizeStaffCategory('', f.department, f.role),
      dept: f.department,
      phone: f.phone.trim(),
      shift: f.shift || 'Day',
      route: orU(f.route) ?? null,
      attendance: base?.attendance ?? 0,
      status: inactive ? 'inactive' : 'active',
      avatarHue: base?.avatarHue ?? ((name.length * 47) % 360),
      dob: orU(f.dob), bloodGroup: orU(f.bloodGroup), maritalStatus: orU(f.maritalStatus),
      altPhone: orU(f.altPhone), email: orU(f.email),
      fatherName: properName(f.fatherName) || undefined,
      motherName: properName(f.motherName) || undefined,
      aadhaar: orU(f.aadhaar), pan: orU(f.pan), nationality: orU(f.nationality), religion: orU(f.religion),
      languages: orU(f.languages),
      permanentAddress: properPlace(f.permanentAddress) || undefined,
      currentAddress: properPlace(f.currentAddress) || undefined,
      photoName: files.staffPhoto?.name || base?.photoName,
      designation: orU(f.role), employeeType: orU(f.employeeType), contractType: orU(f.contractType),
      workLocation: orU(f.workLocation), dateOfJoining: orU(f.dateOfJoining), dateOfLeaving: orU(f.dateOfLeaving),
      basicSalary: orU(f.basicSalary), hra: orU(f.hra), allowances: orU(f.allowances),
      epf: orU(f.epf), profTax: orU(f.profTax), otherDeductions: orU(f.otherDeductions), uan: orU(f.uan),
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
      transport: {
        route: orU(f.route), vehicle: orU(f.vehicle), pickup: orU(f.pickup),
        license: orU(f.license), licenseExpiry: orU(f.licenseExpiry),
      },
      social: { facebook: orU(f.facebook), instagram: orU(f.instagram), linkedin: orU(f.linkedin), youtube: orU(f.youtube), twitter: orU(f.twitter) },
      documents: {
        resume: files.resume?.name || base?.documents?.resume,
        joiningLetter: files.joiningLetter?.name || base?.documents?.joiningLetter,
        aadhaar: files.aadhaarDoc?.name || base?.documents?.aadhaar,
        pan: files.panDoc?.name || base?.documents?.pan,
        experienceCert: files.experienceCert?.name || base?.documents?.experienceCert,
        educationCert: files.educationCert?.name || base?.documents?.educationCert,
        other: files.otherDoc?.name || base?.documents?.other,
        license: files.licenseDoc?.name || base?.documents?.license,
        medicalCert: files.medicalCertDoc?.name || base?.documents?.medicalCert,
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

    const staffMember = buildStaff(existing)
    const name = staffMember.name
    setSaving(true)

    const afterOk = (saved: Staff) => {
      const finish = async () => {
        if (payrollEnabled) {
          try {
            await upsertSalaryProfile('staff', saved.id, upsertInputFromForm(f, structFor(f.role)))
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
      // remembered the file name. A newly-invited staff member with no linked
      // Users row yet (409 no_linked_user) is expected, not an error.
      if (files.staffPhoto) {
        void (async () => {
          try {
            const { compressImageFile } = await import('@/lib/compressImage')
            const dataUrl = await compressImageFile(files.staffPhoto!, { maxEdge: 960, quality: 0.78 })
            await updateStaffPhoto(saved.id, dataUrl)
          } catch {
            /* best-effort; the staff member can also set their own photo once signed in */
          }
        })()
      }
      try {
        await persistStaffExtras(
          saved.id,
          { ...staffMember, id: saved.id },
          STAFF_FILE_PICKS.map((p) => ({ key: p.key, label: p.label, file: files[p.formKey] })),
        )
      } catch (err) {
        setSaving(false)
        toast.danger(
          'Staff saved, extras failed',
          err instanceof Error ? err.message : 'Onboarding details could not be saved to the server.',
        )
        if (mode === 'edit') app.go('school.staff', { focus: saved.id })
        else app.go('school.staff')
        return
      }
      setSaving(false)
      toast.success(mode === 'edit' ? 'Staff updated' : 'Staff added', `${name} · ${f.department}.`)
      if (mode === 'edit') app.go('school.staff', { focus: saved.id })
      else app.go('school.staff')
      }
      void finish()
    }

    if (mode === 'edit' && existing) {
      updateStaff.mutate({ id: existing.id, staff: staffMember }, {
        onSuccess: afterOk,
        onError: (err) => {
          setSaving(false)
          toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
        },
      })
      return
    }

    createStaff.mutate(staffMember, {
      onSuccess: afterOk,
      onError: (err) => {
        setSaving(false)
        toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  if (mode === 'edit' && existingQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 240 }}><Spinner size={28} /><div className="t-sm muted">Loading staff…</div></div>
  }
  if (mode === 'edit' && (existingQ.isError || !existing)) {
    return (
      <div>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.staff')}>Staff</Btn>
        <Empty icon="user" title="Staff member not found" body="Open a staff member from the list, then choose Edit." />
      </div>
    )
  }
  if (!hydrated) return null

  const back = () => {
    if (mode === 'edit' && existing) app.go('school.staff', { focus: existing.id })
    else app.go('school.staff')
  }

  return (
    <div>
      <div className="row ai-center gap12" style={{ marginBottom: 16 }}>
        <Btn variant="ghost" icon="arrowLeft" onClick={back}>Staff</Btn>
      </div>

      <PageHead
        title={mode === 'edit' ? 'Edit staff' : 'Onboard staff'}
        sub={`${mode === 'edit' ? 'Update profile' : 'Name, address & documents'} · ${app.school.name} — not a CRM login invite`}
      />

      <div className="col gap16">
        {/* ---- Personal ---- */}
        <Card>
          <CardHead title="Personal information" icon="user" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {mode === 'edit' ? (
              <Field label="Staff ID" hint="Fixed after create">
                <Input value={f.staffId} readOnly disabled aria-label="Staff ID" />
              </Field>
            ) : (
              txt('staffId', 'Staff ID', { ph: suggestedId || 'scc/STF/26/0001', readOnly: true })
            )}
            {txt('firstName', 'First name', { required: true, icon: 'user', ph: 'Suresh', case: 'name' })}
            {txt('lastName', 'Last name', { required: true, ph: 'Naidu', case: 'name' })}
            {sel('gender', 'Gender', GENDERS)}
            {txt('dob', 'Date of birth', { type: 'date' })}
            {sel('bloodGroup', 'Blood group', BLOOD_GROUPS)}
            {sel('maritalStatus', 'Marital status', MARITAL)}
            {txt('phone', 'Primary contact number', { required: true, icon: 'phone', ph: '10-digit mobile', digits: 10 })}
            {txt('altPhone', 'Alternate contact number', { icon: 'phone', ph: '10-digit mobile', digits: 10 })}
            {txt('email', 'Email address', { required: true, ph: 'staff@school.edu' })}
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
              {fileUpload('staffPhoto', 'Staff photo', { photo: true })}
            </div>
            <div className="sm-photo-id-docs">
              {txt('aadhaar', 'Aadhaar number', { ph: '12 digits' })}
              {fileUpload('aadhaarDoc', 'Aadhaar card')}
              <div className="t-xs muted">Photo shows on staff lists · Aadhaar is stored for the profile.</div>
            </div>
          </div>
        </Card>

        {/* ---- Employment ---- */}
        <Card>
          <CardHead title="Employment information" icon="briefcase" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {sel('role', 'Role', STAFF_ROLES, true)}
            {sel('category', 'Category', CATEGORIES, true)}
            {sel('department', 'Department', deptOptions, true)}
            {sel('employeeType', 'Employee type', EMP_TYPES)}
            {sel('contractType', 'Contract type', CONTRACT_TYPES)}
            {sel('shift', 'Shift', SHIFTS)}
            {txt('workLocation', 'Work location')}
            {txt('dateOfJoining', 'Date of joining', { type: 'date' })}
            {txt('dateOfLeaving', 'Date of leaving', { type: 'date' })}
            {sel('status', 'Status', STATUS_OPTS)}
            {txt('uan', 'UAN number')}
          </>)}</div>
        </Card>

        {/* ---- Salary components (Platinum) ---- */}
        {payrollEnabled && (
        <Card>
          <CardHead
            title="Salary components"
            icon="rupee"
            action={structFor(f.role)
              ? <Btn size="sm" variant="ghost" icon="layers" onClick={applyStructure}>Use {f.role} structure</Btn>
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
            {' '}· Leave blank to inherit the {f.role || 'role'} salary structure when payroll runs.
          </div>
        </Card>
        )}

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
              {txt('emPhone', 'Contact number', { icon: 'phone', ph: '10-digit mobile', digits: 10 })}
            </>)}</div>
          </Card>
        </div>

        {/* ---- Transport ---- */}
        <Card>
          <CardHead title="Transport information" icon="bus" />
          <div style={{ marginTop: 12 }}>{fieldGrid(<>
            {txt('route', 'Route')}
            {txt('vehicle', 'Vehicle number')}
            {txt('pickup', 'Pickup point')}
            {txt('license', 'Driving license number')}
            {txt('licenseExpiry', 'License expiry', { type: 'date' })}
          </>)}</div>
          <div className="sm-doc-grid" style={{ marginTop: 12 }}>
            {fileUpload('licenseDoc', 'Driving license')}
            {fileUpload('medicalCertDoc', 'Medical certificate')}
          </div>
        </Card>

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
          <div className="t-xs muted" style={{ marginTop: 10 }}>PDFs open with Open after pick · View / Download in the staff profile after save.</div>
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
        <Btn variant="primary" icon="check" onClick={save} disabled={saving || createStaff.isPending || updateStaff.isPending}>
          {saving || createStaff.isPending || updateStaff.isPending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save staff'}
        </Btn>
      </div>
    </div>
  )
}

function AddStaffScreen() {
  return (
    <TierGate feature="staff_support" title="Staff & support"
      blurb="Onboard non-teaching staff on the Platinum plan.">
      <StaffFormScreen mode="add" />
    </TierGate>
  )
}

function EditStaffScreen() {
  return (
    <TierGate feature="staff_support" title="Staff & support"
      blurb="Edit non-teaching staff on the Platinum plan.">
      <StaffFormScreen mode="edit" />
    </TierGate>
  )
}

export const staffAddScreens: Record<string, ComponentType> = {
  'school.staff.add': AddStaffScreen,
  'school.staff.edit': EditStaffScreen,
}
