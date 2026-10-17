/* ============================================================
   SchoolMate — Add / Edit Student enrolment form.
   Student + father/mother + documents. Core SIS fields go to
   the API; parent/docs extras stay in local device storage until
   a documents API exists.
   ============================================================ */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { tierIncludes } from '@/lib/gating'
import { useCreateStudent, useUpdateStudent } from '@/api/hooks/useStudentMutations'
import { useStudent, useStudents } from '@/api/hooks/useStudents'
import { nextPersonCode, personCodePrefix } from '@/lib/personCodes'
import {
  extrasFromStudent, fileToStoredDoc, fetchStudentExtras, mergeStudentExtras, saveStudentExtras,
  type StoredDoc,
} from '@/api/studentExtras'
import { parentMailFromStudent } from '@/api/students'
import { ApiError } from '@/api/ApiError'
import { PageHead, Card, CardHead, Btn, Badge, Icon, useFormKit, Spinner, Empty, Field, Input, Select, Checkbox } from '@/components/ui'
import { useClasses, useClassNames } from '@/api/hooks/useClasses'
import type { SchoolClass } from '@/api/classes'
import { listSchoolHouses } from '@/api/schoolHouses'
import { useTransportRoutes, useRouteStops, useStudentTransport, useSetStudentTransport } from '@/api/hooks/useOperations'
import { useFeeHeads } from '@/api/hooks/useFeeHeads'
import { validateStudentForm } from '@/lib/studentValidation'
import { properName, properPlace } from '@/lib/properCase'
import { toDateInputValue } from '@/lib/dateInput'
import { predictStudentRoll } from '@/lib/studentRoll'
import type { Student } from '@/types'

function classOptionValue(c: SchoolClass): string {
  return (c.name || `${c.grade}-${c.section}`).trim()
}

function resolveClass(classes: SchoolClass[], classKey: string): { grade: string; section: string; cls: string } {
  const key = classKey.trim()
  const match = classes.find((c) => classOptionValue(c) === key)
  if (match) {
    return {
      grade: match.grade || key,
      section: match.section || '',
      cls: match.name || `${match.grade}-${match.section}`,
    }
  }
  /* Fallback for older records if class was renamed/removed. */
  const dash = key.lastIndexOf('-')
  if (dash > 0) {
    return { grade: key.slice(0, dash), section: key.slice(dash + 1), cls: key }
  }
  return { grade: key, section: '', cls: key }
}

const ACADEMIC_YEARS = ['2026–27', '2025–26', '2027–28']
const BLOOD_GROUPS = ['', 'A+', 'A−', 'B+', 'B−', 'O+', 'O−', 'AB+', 'AB−']
const RELIGIONS = ['', 'Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other']
const CATEGORIES = ['', 'General', 'OBC', 'SC', 'ST', 'EWS']
const GENDERS = [{ value: '', label: 'Select…' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]
const STATUSES = [{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]

type Form = Record<string, string>
type Files = Record<string, File | null>

const INITIAL_FORM: Form = {
  academicYear: ACADEMIC_YEARS[0], adm: '', admissionDate: '', roll: '', status: 'active',
  firstName: '', lastName: '', cls: '', section: '', gender: '', dob: '',
  bloodGroup: '', house: '', religion: '', category: '', phone: '', email: '',
  caste: '', motherTongue: '', languages: '', lastSchool: '', address: '', aadhaar: '',
  fatherName: '', fatherEmail: '', fatherPhone: '', fatherOccupation: '', fatherAadhaar: '',
  motherName: '', motherEmail: '', motherPhone: '', motherOccupation: '',
  transportOptedIn: '', transportRouteId: '', transportStopId: '', transportFeeHeadId: '',
}

const INITIAL_FILES: Files = {
  studentPhoto: null, studentAadhaarDoc: null,
  fatherPhoto: null, fatherAadhaarDoc: null, motherPhoto: null,
  birthCert: null, transferCert: null,
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length <= 1) return { first: parts[0] || '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

export function studentToForm(s: Student): Form {
  const { first, last } = splitName(s.name)
  const classKey = s.cls || (s.grade && s.section ? `${s.grade}-${s.section}` : s.grade || '')
  return {
    ...INITIAL_FORM,
    academicYear: s.academicYear || ACADEMIC_YEARS[0],
    adm: s.adm || '',
    admissionDate: toDateInputValue(s.admissionDate),
    roll: s.roll ? String(s.roll) : '',
    status: s.status === 'inactive' ? 'inactive' : 'active',
    firstName: first,
    lastName: last,
    cls: classKey,
    section: s.section || '',
    gender: s.gender || '',
    dob: toDateInputValue(s.dob),
    bloodGroup: s.bloodGroup || '',
    house: s.house || '',
    religion: s.religion || '',
    category: s.category || '',
    phone: s.phone || '',
    email: s.email || '',
    caste: s.caste || '',
    motherTongue: s.motherTongue || '',
    languages: s.languages || '',
    lastSchool: s.lastSchool || '',
    address: s.address || '',
    aadhaar: s.aadhaar || '',
    fatherName: s.father?.name || s.guardian || '',
    fatherEmail: s.father?.email || s.guardianEmail || '',
    fatherPhone: s.father?.phone || s.phone || '',
    fatherOccupation: s.father?.occupation || '',
    fatherAadhaar: s.father?.aadhaar || '',
    motherName: s.mother?.name || '',
    motherEmail: s.mother?.email || '',
    motherPhone: s.mother?.phone || '',
    motherOccupation: s.mother?.occupation || '',
  }
}

function buildStudent(
  f: Form,
  files: Files,
  classInfo: { grade: string; section: string; cls: string },
  base?: Student,
): Student {
  const firstName = properName(f.firstName)
  const lastName = properName(f.lastName)
  const name = `${firstName} ${lastName}`.trim()
  const fatherName = properName(f.fatherName) || undefined
  const motherName = properName(f.motherName) || undefined
  const guardian = (fatherName || motherName || '').trim()
  const father = {
    name: fatherName, email: f.fatherEmail.trim() || undefined,
    phone: f.fatherPhone || undefined, occupation: f.fatherOccupation || undefined,
    aadhaar: f.fatherAadhaar || undefined,
    photoName: files.fatherPhoto?.name || base?.father?.photoName,
  }
  const mother = {
    name: motherName, email: f.motherEmail.trim() || undefined,
    phone: f.motherPhone || undefined, occupation: f.motherOccupation || undefined,
    photoName: files.motherPhoto?.name || base?.mother?.photoName,
  }
  return {
    id: base?.id || 'S' + Date.now().toString(36).toUpperCase(),
    adm: f.adm.trim(),
    name,
    gender: f.gender === 'F' ? 'F' : 'M',
    grade: classInfo.grade,
    section: classInfo.section,
    cls: classInfo.cls,
    roll: 0, /* server assigns A–Z by name within class */
    guardian,
    phone: f.phone.trim(),
    guardianEmail: parentMailFromStudent({ father, mother }) || undefined,
    attendance: base?.attendance ?? 0,
    feeStatus: base?.feeStatus ?? 'due',
    feeDue: base?.feeDue ?? 0,
    status: f.status === 'inactive' ? 'inactive' : 'active',
    house: f.house.trim(),
    avatarHue: base?.avatarHue ?? ((name.length * 47) % 360),
    academicYear: f.academicYear,
    admissionDate: f.admissionDate || undefined,
    dob: f.dob,
    bloodGroup: f.bloodGroup || undefined,
    religion: f.religion || undefined,
    category: f.category || undefined,
    caste: f.caste || undefined,
    motherTongue: f.motherTongue || undefined,
    languages: f.languages || undefined,
    lastSchool: properName(f.lastSchool) || undefined,
    address: properPlace(f.address) || undefined,
    email: f.email || undefined,
    aadhaar: f.aadhaar || undefined,
    photoName: files.studentPhoto?.name || base?.photoName,
    father,
    mother,
    documents: {
      birthCert: files.birthCert?.name || base?.documents?.birthCert,
      transferCert: files.transferCert?.name || base?.documents?.transferCert,
      studentAadhaar: files.studentAadhaarDoc?.name || base?.documents?.studentAadhaar,
      fatherAadhaar: files.fatherAadhaarDoc?.name || base?.documents?.fatherAadhaar,
    },
  }
}

async function persistExtras(studentId: string, student: Student, files: Files): Promise<void> {
  const prev = (await fetchStudentExtras(studentId).catch(() => null))?.files || []
  const byKey = new Map(prev.map((d) => [d.key, d]))
  const picks: Array<[StoredDoc['key'], File | null]> = [
    ['photo', files.studentPhoto],
    ['studentAadhaar', files.studentAadhaarDoc],
    ['fatherPhoto', files.fatherPhoto],
    ['fatherAadhaar', files.fatherAadhaarDoc],
    ['motherPhoto', files.motherPhoto],
    ['birthCert', files.birthCert],
    ['transferCert', files.transferCert],
  ]
  for (const [key, file] of picks) {
    const stored = await fileToStoredDoc(key, file)
    if (stored) byKey.set(key, stored)
  }
  await saveStudentExtras(studentId, extrasFromStudent(student, Array.from(byKey.values())))
}

function StudentFormScreen({ mode }: { mode: 'add' | 'edit' }) {
  const app = useApp()
  const toast = useToast()
  /** Transport is a Platinum-only surface — every hook it feeds (useTransportRoutes,
   *  useRouteStops, useStudentTransport, useSetStudentTransport's callers) must stay inert
   *  for non-Platinum tenants, matching every other transport surface in this codebase. */
  const opsEnabled = tierIncludes(app.plan, 'operations')
  const [f, setForm] = useState<Form>(INITIAL_FORM)
  const [files, setFiles] = useState<Files>(INITIAL_FILES)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(mode === 'add')
  const [saving, setSaving] = useState(false)
  /** Saved photo previews (data URLs) so edit form can show + Replace. */
  const [savedUrls, setSavedUrls] = useState<Partial<Record<keyof typeof INITIAL_FILES, string>>>({})

  const { txt, sel, area, upload, fieldGrid } = useFormKit(f, setForm, files, setFiles, errors)
  const createStudent = useCreateStudent()
  const updateStudent = useUpdateStudent()
  const existingQ = useStudent(mode === 'edit' ? app.focus : null)
  const existing = existingQ.data
  const rosterQ = useStudents()
  const classesQ = useClasses()
  const liveClasses = classesQ.data ?? []
  const classNames = useClassNames()
  const [houses, setHouses] = useState<string[]>([])

  const transportQ = useStudentTransport(mode === 'edit' && existing ? existing.id : null)
  /* Edit mode's transport checkbox starts at '' (falsy) and only gets its real value once
   * transportQ resolves. If Save fires before that, f.transportOptedIn is still falsy and a
   * real opted-in student would be sent optedIn:false — silently deleting their bus mapping.
   * transportHydrated gates both the Save button and the save flow's transport call so that
   * "we don't know yet" is never treated as "the admin chose No". Add mode has nothing to
   * hydrate, and a non-Platinum tenant never queries transport at all (the query is disabled),
   * so both count as immediately ready. */
  const transportHydrated = mode === 'add' || !opsEnabled || transportQ.isSuccess || transportQ.isError
  const feeHeadsQ = useFeeHeads()
  const routesQ = useTransportRoutes()
  const stopsQ = useRouteStops(f.transportRouteId || null)
  const setTransport = useSetStudentTransport()

  useEffect(() => {
    if (!transportQ.data) return
    setForm((prev) => ({
      ...prev,
      transportOptedIn: transportQ.data.optedIn ? 'yes' : 'no',
      transportRouteId: transportQ.data.routeId ?? '',
      transportStopId: transportQ.data.stopId ?? '',
      transportFeeHeadId: transportQ.data.feeHeadId ?? '',
    }))
  }, [transportQ.data])

  const transportFeeHeadOptions = useMemo(() => {
    const heads = (feeHeadsQ.data ?? []).filter((h) => h.isTransportFeeHead)
    return [
      { value: '', label: heads.length ? 'Select fee head…' : 'No transport fee head configured' },
      ...heads.map((h) => ({ value: h.id, label: h.name })),
    ]
  }, [feeHeadsQ.data])

  const transportRouteOptions = useMemo(() => [
    { value: '', label: 'Select route…' },
    ...(routesQ.data ?? []).map((r) => ({ value: r.id, label: r.name })),
  ], [routesQ.data])

  const transportStopOptions = useMemo(() => [
    { value: '', label: 'Select stop…' },
    ...(stopsQ.data ?? []).map((s) => ({ value: s.id, label: s.name })),
  ], [stopsQ.data])

  useEffect(() => {
    let cancelled = false
    const sync = () => {
      void listSchoolHouses()
        .then((list) => { if (!cancelled) setHouses(list) })
        .catch(() => { /* keep prior list */ })
    }
    sync()
    window.addEventListener('focus', sync)
    return () => {
      cancelled = true
      window.removeEventListener('focus', sync)
    }
  }, [])

  const suggestedAdm = useMemo(() => {
    const prefix = personCodePrefix(app.school.slug, 'STU')
    return nextPersonCode(prefix, (rosterQ.data ?? []).map((s) => s.adm))
  }, [app.school.slug, rosterQ.data])

  const selectedClass = useMemo(
    () => resolveClass(liveClasses, f.cls),
    [liveClasses, f.cls],
  )

  /** Live roll preview — same A–Z-by-name rules as SQL Student_RenumberClass. */
  const predictedRoll = useMemo(() => predictStudentRoll({
    name: `${f.firstName.trim()} ${f.lastName.trim()}`.trim(),
    adm: f.adm.trim() || suggestedAdm,
    selfId: mode === 'edit' && existing?.id ? existing.id : '__new__',
    classInfo: selectedClass,
    roster: rosterQ.data ?? [],
  }), [
    f.firstName, f.lastName, f.adm, selectedClass,
    mode, existing?.id, rosterQ.data, suggestedAdm,
  ])

  useEffect(() => {
    // Always sync (never guard on "already set") — the field is read-only, so nothing the user
    // typed could ever be here to protect. Guarding used to stick the ID at its first guess
    // (computed before the roster query resolves) even after the real roster loaded and the
    // correct next number became known.
    if (mode !== 'add') return
    setForm((prev) => (prev.adm === suggestedAdm ? prev : { ...prev, adm: suggestedAdm }))
  }, [mode, suggestedAdm])

  useEffect(() => {
    if (mode !== 'edit' || !existing) return
    let cancelled = false
    // studentToForm never touches transport* fields (they come from a separate query, not the
    // student record) — a plain replace here would race with the transport-loading effect above
    // and silently blank out whichever Route/Stop/Fee head it had just set, depending only on
    // which network call happened to resolve last. Always carry the current transport fields
    // forward instead of replacing them.
    setForm((prev) => ({
      ...studentToForm(existing),
      transportOptedIn: prev.transportOptedIn,
      transportRouteId: prev.transportRouteId,
      transportStopId: prev.transportStopId,
      transportFeeHeadId: prev.transportFeeHeadId,
    }))
    void fetchStudentExtras(existing.id)
      .then((ex) => {
        if (cancelled) return
        setForm((prev) => ({
          ...studentToForm(mergeStudentExtras({ ...existing })),
          transportOptedIn: prev.transportOptedIn,
          transportRouteId: prev.transportRouteId,
          transportStopId: prev.transportStopId,
          transportFeeHeadId: prev.transportFeeHeadId,
        }))
        const next: Partial<Record<keyof typeof INITIAL_FILES, string>> = {}
        const map: Record<string, keyof typeof INITIAL_FILES> = {
          photo: 'studentPhoto',
          fatherPhoto: 'fatherPhoto',
          motherPhoto: 'motherPhoto',
          studentAadhaar: 'studentAadhaarDoc',
          fatherAadhaar: 'fatherAadhaarDoc',
          birthCert: 'birthCert',
          transferCert: 'transferCert',
        }
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
  }, [mode, existing])

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

  const clsOptions = useMemo(() => {
    const roomByName = new Map(
      liveClasses.map((c) => [classOptionValue(c), c.room] as const).filter(([v]) => !!v),
    )
    const opts = classNames.map((value) => {
      const room = roomByName.get(value)
      const label = room && room !== '—' ? `${value} · Room ${room}` : value
      return { value, label }
    })
    /* Keep current class visible when editing if it was removed from Academics. */
    if (f.cls && !opts.some((o) => o.value === f.cls)) {
      opts.unshift({ value: f.cls, label: `${f.cls} (current)` })
    }
    return [{ value: '', label: 'Select class…' }, ...opts]
  }, [classNames, liveClasses, f.cls])

  const houseOptions = useMemo(() => {
    const opts = houses.map((h) => ({ value: h, label: h }))
    if (f.house && !houses.some((h) => h.toLowerCase() === f.house.toLowerCase())) {
      opts.unshift({ value: f.house, label: `${f.house} (current)` })
    }
    return [{ value: '', label: houses.length ? 'Select house…' : 'No houses — add in Academics' }, ...opts]
  }, [houses, f.house])

  const validate = (): Record<string, string> =>
    validateStudentForm({
      form: f,
      files,
      roster: (rosterQ.data ?? []).map((s) => ({ id: s.id, email: s.email, phone: s.phone })),
      existingId: existing?.id,
      transportEnabled: opsEnabled,
    })

  const save = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) {
      toast.danger('Check the form', 'Some fields need your attention before saving.')
      return
    }

    const student = buildStudent(f, files, selectedClass, existing)
    setSaving(true)

    const afterOk = async (saved: Student) => {
      try {
        await persistExtras(saved.id, { ...student, id: saved.id }, files)
      } catch (err) {
        toast.danger(
          'Student saved, extras failed',
          err instanceof Error ? err.message : 'Enrolment details could not be saved to the server.',
        )
        app.go('school.student', { focus: saved.id })
        return
      }

      if (opsEnabled) {
        if (mode === 'edit' && !transportHydrated) {
          // The Save button is disabled in this state (see below), so this branch is a
          // belt-and-suspenders guard, not the primary defence. We genuinely don't know the
          // student's prior transport status yet — sending optedIn:false here would silently
          // delete a real StudentBusAssignments row, so skip the call entirely and tell the admin.
          toast.danger(
            'Student saved, transport unchanged',
            'Could not confirm current transport status — please open Edit again to update transport.',
          )
        } else {
          try {
            const optedIn = f.transportOptedIn === 'yes'
            const result = await setTransport.mutateAsync({
              studentId: saved.id,
              input: {
                optedIn,
                routeId: optedIn ? f.transportRouteId || null : null,
                stopId: optedIn ? f.transportStopId || null : null,
                feeHeadId: optedIn ? f.transportFeeHeadId || null : null,
              },
            })
            if (optedIn && !result.assigned) {
              toast.info(
                'Student added. Bus assignment is pending.',
                result.pendingReason?.message ?? 'No bus currently has available capacity on this route.',
              )
            }
          } catch (err) {
            toast.danger(
              'Student saved, transport failed',
              err instanceof Error ? err.message : 'Transport mapping could not be saved to the server.',
            )
            app.go('school.student', { focus: saved.id })
            return
          }
        }
      }

      toast.success(
        mode === 'edit' ? 'Student updated' : 'Student added',
        saved.roll > 0
          ? `${saved.name} · ${saved.cls} · Roll ${saved.roll}`
          : `${saved.name} · ${saved.cls}.`,
      )
      app.go('school.student', { focus: saved.id })
    }

    if (mode === 'edit' && existing) {
      updateStudent.mutate({ id: existing.id, student }, {
        onSuccess: (saved) => { void afterOk(saved).finally(() => setSaving(false)) },
        onError: (err) => {
          setSaving(false)
          toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
        },
      })
      return
    }

    createStudent.mutate(student, {
      onSuccess: (saved) => { void afterOk(saved).finally(() => setSaving(false)) },
      onError: (err) => {
        setSaving(false)
        if (err instanceof ApiError && err.code === 'seat_limit_reached') {
          toast.danger(
            'Seat limit reached',
            `${err.message} Ask the SchoolMate team to increase your plan's seats.`,
          )
          return
        }
        toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  if (mode === 'edit' && existingQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 240 }}><Spinner size={28} /><div className="t-sm muted">Loading student…</div></div>
  }
  if (mode === 'edit' && (existingQ.isError || !existing)) {
    return (
      <div>
        <Btn variant="ghost" icon="arrowLeft" onClick={() => app.go('school.sis')}>Students</Btn>
        <Empty icon="user" title="Student not found" body="Open a student from the list, then choose Edit." />
      </div>
    )
  }
  if (!hydrated) return null

  const back = () => (mode === 'edit' && existing ? app.go('school.student', { focus: existing.id }) : app.go('school.sis'))

  return (
    <div>
      <div className="row ai-center gap12" style={{ marginBottom: 16 }}>
        <Btn variant="ghost" icon="arrowLeft" onClick={back}>{mode === 'edit' ? 'Profile' : 'Students'}</Btn>
      </div>

      <PageHead
        title={mode === 'edit' ? 'Edit student' : 'Add student'}
        sub={`${mode === 'edit' ? 'Update enrolment' : 'New enrolment'} · ${app.school.name}`}
      />

      <div className="col gap16">
        <Card>
          <CardHead title="Student details" icon="user" />
          <div style={{ marginTop: 12 }}>
            {fieldGrid(<>
              {txt('adm', 'Admission number', { ph: suggestedAdm || 'scc/STU/26/0001', readOnly: true })}
              {txt('admissionDate', 'Admission date', { type: 'date' })}
              {txt('firstName', 'First name', { required: true, icon: 'user', ph: 'Aarav', case: 'name' })}
              {txt('lastName', 'Last name', { required: true, ph: 'Sharma', case: 'name' })}
              {sel('cls', 'Class', clsOptions, true)}
              <Field label="Roll number" hint="Saved to the database · A–Z by name in this class">
                <Input
                  value={predictedRoll != null ? String(predictedRoll) : 'Select class first'}
                  readOnly
                  aria-label="Roll number preview"
                  style={{ fontWeight: 700 }}
                />
              </Field>
              {sel('house', 'House', houseOptions)}
              {sel('gender', 'Gender', GENDERS, true)}
              {txt('dob', 'Date of birth', { required: true, type: 'date' })}
              {sel('academicYear', 'Academic year', ACADEMIC_YEARS)}
              {sel('status', 'Status', STATUSES)}
              {sel('bloodGroup', 'Blood group', BLOOD_GROUPS)}
              {sel('religion', 'Religion', RELIGIONS)}
              {sel('category', 'Category', CATEGORIES)}
              {txt('phone', 'Primary contact number', { required: true, icon: 'phone', ph: '+91 9XXXXXXXXX' })}
              {txt('email', 'Email address', { required: true, ph: 'student@example.com' })}
              {txt('caste', 'Caste')}
              {txt('motherTongue', 'Mother tongue', { ph: 'e.g. Hindi' })}
              {txt('languages', 'Languages known', { ph: 'e.g. Hindi, English' })}
              {txt('lastSchool', 'Last school name', { icon: 'building', ph: 'Previous school attended', case: 'name' })}
              {area('address', 'Address', { ph: 'Residential address' })}
            </>)}
            <div className="t-xs muted" style={{ marginTop: 10 }}>
              {mode === 'edit'
                ? 'Admission number is auto-generated and fixed.'
                : 'Admission number is auto-generated · Class & house come from Academics · roll updates A–Z as you type name/class.'}
            </div>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Photo & ID"
            icon="user"
            action={<Badge tone="neutral">JPG / PNG / PDF · max 4 MB</Badge>}
          />
          <div className="sm-photo-id">
            <div className="sm-photo-id-photo">
              {fileUpload('studentPhoto', 'Student photo', { photo: true })}
            </div>
            <div className="sm-photo-id-docs">
              {txt('aadhaar', 'Aadhaar number', { ph: '12 digits' })}
              {fileUpload('studentAadhaarDoc', 'Aadhaar card')}
              <div className="t-xs muted">Photo shows on student lists · Aadhaar is stored for the profile.</div>
            </div>
          </div>
        </Card>

        <div className="sm-grid-2 gap16">
          <Card>
            <CardHead title="Father details" icon="user" />
            <div style={{ marginTop: 12 }}>
              {fieldGrid(<>
                {txt('fatherName', 'Father name', { icon: 'user', ph: 'Full name', required: true, case: 'name' })}
                {txt('fatherEmail', 'Father email', { ph: 'father@example.com' })}
                {txt('fatherPhone', 'Father phone number', { icon: 'phone', ph: '+91 9XXXXXXXXX' })}
                {txt('fatherOccupation', 'Father occupation')}
              </>)}
              <div className="sm-photo-id">
                <div className="sm-photo-id-photo">
                  {fileUpload('fatherPhoto', 'Father photo', { photo: true })}
                </div>
                <div className="sm-photo-id-docs">
                  {txt('fatherAadhaar', 'Father Aadhaar number', { ph: '12 digits' })}
                  {fileUpload('fatherAadhaarDoc', 'Father Aadhaar card')}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHead title="Mother details" icon="user" />
            <div style={{ marginTop: 12 }}>
              {fieldGrid(<>
                {txt('motherName', 'Mother name', { icon: 'user', ph: 'Full name', case: 'name' })}
                {txt('motherEmail', 'Mother email', { ph: 'mother@example.com' })}
                {txt('motherPhone', 'Mother phone number', { icon: 'phone', ph: '+91 9XXXXXXXXX' })}
                {txt('motherOccupation', 'Mother occupation')}
              </>)}
              <div style={{ marginTop: 14, maxWidth: 240 }}>
                {fileUpload('motherPhoto', 'Mother photo', { photo: true })}
              </div>
            </div>
          </Card>
        </div>

        <Card>
          <CardHead title="Documents" icon="doc" action={<Badge tone="neutral">PDF / JPG / PNG · max 4 MB</Badge>} />
          <div className="sm-doc-grid">
            {fileUpload('birthCert', 'Birth certificate')}
            {fileUpload('transferCert', 'Transfer certificate')}
          </div>
          <div className="row ai-center gap8 t-xs muted" style={{ marginTop: 12 }}>
            <Icon name="check" size={13} />
            Files are kept on this device for View / Download on the student profile.
          </div>
        </Card>

        {opsEnabled && (
          <Card>
            <CardHead title="Transport" icon="bus" />
            <div className="col gap12" style={{ marginTop: 12 }}>
              <Checkbox
                checked={f.transportOptedIn === 'yes'}
                onChange={(checked) => setForm((prev) => ({ ...prev, transportOptedIn: checked ? 'yes' : 'no' }))}
                label="Uses School Transport"
              />
              {f.transportOptedIn === 'yes' && (
                <>
                  <Field label="Transport Fee Head">
                    <Select
                      options={transportFeeHeadOptions}
                      value={f.transportFeeHeadId}
                      onChange={(e) => setForm((prev) => ({ ...prev, transportFeeHeadId: e.target.value }))}
                    />
                  </Field>
                  <Field label="Route" required error={errors.transportRouteId}>
                    <Select
                      options={transportRouteOptions}
                      value={f.transportRouteId}
                      onChange={(e) => setForm((prev) => ({ ...prev, transportRouteId: e.target.value, transportStopId: '' }))}
                    />
                  </Field>
                  <Field label="Pickup Stop">
                    <Select
                      options={transportStopOptions}
                      value={f.transportStopId}
                      onChange={(e) => setForm((prev) => ({ ...prev, transportStopId: e.target.value }))}
                      disabled={!f.transportRouteId}
                    />
                  </Field>
                </>
              )}
              {mode === 'edit' && !transportHydrated && (
                <div className="t-xs muted">Loading current transport status…</div>
              )}
            </div>
          </Card>
        )}
      </div>

      <div
        className="row ai-center jc-end gap8"
        style={{
          position: 'sticky', bottom: 0, marginTop: 16, padding: '12px 0',
          background: 'var(--bg)', borderTop: '1px solid var(--border)',
        }}
      >
        <Btn variant="ghost" onClick={back}>Cancel</Btn>
        <Btn
          variant="primary" icon="check"
          disabled={saving || (mode === 'edit' && opsEnabled && !transportHydrated)}
          onClick={() => { void save() }}
        >
          {saving
            ? 'Saving…'
            : mode === 'edit' && opsEnabled && !transportHydrated
              ? 'Loading transport status…'
              : mode === 'edit' ? 'Save changes' : 'Save student'}
        </Btn>
      </div>
    </div>
  )
}

function AddStudentScreen() {
  return <StudentFormScreen mode="add" />
}

function EditStudentScreen() {
  return <StudentFormScreen mode="edit" />
}

export const studentAddScreens: Record<string, ComponentType> = {
  'school.sis.add': AddStudentScreen,
  'school.sis.edit': EditStudentScreen,
}
