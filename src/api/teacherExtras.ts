/* Teacher onboarding extras — GET/PUT /v1/teachers/{id}/extras. */
import {
  fetchPersonExtrasJson, putPersonExtrasJson, loadCachedOrLegacyJson,
} from './personExtrasApi'
import { fileToStoredDoc, type StoredDoc } from './studentExtras'
import type {
  Teacher,
  TeacherDocs,
  BankInfo,
  EmergencyInfo,
  TransportInfo,
  HostelInfo,
  SocialInfo,
  LeaveInfo,
} from '@/types'

export interface TeacherExtras {
  dob?: string
  bloodGroup?: string
  maritalStatus?: string
  altPhone?: string
  fatherName?: string
  motherName?: string
  aadhaar?: string
  pan?: string
  nationality?: string
  religion?: string
  languages?: string
  permanentAddress?: string
  currentAddress?: string
  photoName?: string
  qualification?: string
  specialization?: string
  prevSchool?: string
  prevSchoolAddress?: string
  prevSchoolPhone?: string
  dateOfJoining?: string
  dateOfLeaving?: string
  role?: string
  employeeType?: string
  contractType?: string
  workShift?: string
  workLocation?: string
  basicSalary?: string
  hra?: string
  allowances?: string
  epf?: string
  profTax?: string
  otherDeductions?: string
  uan?: string
  username?: string
  notes?: string
  remarks?: string
  signatureName?: string
  bank?: BankInfo
  emergency?: EmergencyInfo
  transport?: TransportInfo
  hostel?: HostelInfo
  social?: SocialInfo
  leaves?: LeaveInfo
  documents?: TeacherDocs
  files?: StoredDoc[]
}

function parseExtras(raw: string | null): TeacherExtras | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as TeacherExtras
  } catch {
    return null
  }
}

export function loadTeacherExtras(teacherId: string): TeacherExtras | null {
  return parseExtras(loadCachedOrLegacyJson('teacher', teacherId))
}

export async function fetchTeacherExtras(teacherId: string): Promise<TeacherExtras | null> {
  return parseExtras(await fetchPersonExtrasJson('teacher', teacherId))
}

export async function saveTeacherExtras(teacherId: string, extras: TeacherExtras): Promise<void> {
  try {
    await putPersonExtrasJson('teacher', teacherId, JSON.stringify(extras))
  } catch {
    const slim: TeacherExtras = {
      ...extras,
      files: (extras.files || []).map(({ dataUrl: _d, ...meta }) => meta),
    }
    await putPersonExtrasJson('teacher', teacherId, JSON.stringify(slim))
  }
}

export function listTeacherDocs(teacherId: string): StoredDoc[] {
  return loadTeacherExtras(teacherId)?.files ?? []
}

export function mergeTeacherExtras(t: Teacher): Teacher {
  const ex = loadTeacherExtras(t.id)
  if (!ex) return t
  return {
    ...t,
    dob: ex.dob ?? t.dob,
    bloodGroup: ex.bloodGroup ?? t.bloodGroup,
    maritalStatus: ex.maritalStatus ?? t.maritalStatus,
    altPhone: ex.altPhone ?? t.altPhone,
    fatherName: ex.fatherName ?? t.fatherName,
    motherName: ex.motherName ?? t.motherName,
    aadhaar: ex.aadhaar ?? t.aadhaar,
    pan: ex.pan ?? t.pan,
    nationality: ex.nationality ?? t.nationality,
    religion: ex.religion ?? t.religion,
    languages: ex.languages ?? t.languages,
    permanentAddress: ex.permanentAddress ?? t.permanentAddress,
    currentAddress: ex.currentAddress ?? t.currentAddress,
    photoName: ex.photoName ?? t.photoName,
    qualification: ex.qualification ?? t.qualification,
    specialization: ex.specialization ?? t.specialization,
    prevSchool: ex.prevSchool ?? t.prevSchool,
    prevSchoolAddress: ex.prevSchoolAddress ?? t.prevSchoolAddress,
    prevSchoolPhone: ex.prevSchoolPhone ?? t.prevSchoolPhone,
    dateOfJoining: ex.dateOfJoining ?? t.dateOfJoining,
    dateOfLeaving: ex.dateOfLeaving ?? t.dateOfLeaving,
    role: ex.role ?? t.role,
    employeeType: ex.employeeType ?? t.employeeType,
    contractType: ex.contractType ?? t.contractType,
    workShift: ex.workShift ?? t.workShift,
    workLocation: ex.workLocation ?? t.workLocation,
    basicSalary: ex.basicSalary ?? t.basicSalary,
    hra: ex.hra ?? t.hra,
    allowances: ex.allowances ?? t.allowances,
    epf: ex.epf ?? t.epf,
    profTax: ex.profTax ?? t.profTax,
    otherDeductions: ex.otherDeductions ?? t.otherDeductions,
    uan: ex.uan ?? t.uan,
    username: ex.username ?? t.username,
    notes: ex.notes ?? t.notes,
    remarks: ex.remarks ?? t.remarks,
    signatureName: ex.signatureName ?? t.signatureName,
    bank: ex.bank ?? t.bank,
    emergency: ex.emergency ?? t.emergency,
    transport: ex.transport ?? t.transport,
    hostel: ex.hostel ?? t.hostel,
    social: ex.social ?? t.social,
    leaves: ex.leaves ?? t.leaves,
    documents: ex.documents ?? t.documents,
  }
}

export function extrasFromTeacher(t: Teacher, files: StoredDoc[] = []): TeacherExtras {
  return {
    dob: t.dob,
    bloodGroup: t.bloodGroup,
    maritalStatus: t.maritalStatus,
    altPhone: t.altPhone,
    fatherName: t.fatherName,
    motherName: t.motherName,
    aadhaar: t.aadhaar,
    pan: t.pan,
    nationality: t.nationality,
    religion: t.religion,
    languages: t.languages,
    permanentAddress: t.permanentAddress,
    currentAddress: t.currentAddress,
    photoName: t.photoName,
    qualification: t.qualification,
    specialization: t.specialization,
    prevSchool: t.prevSchool,
    prevSchoolAddress: t.prevSchoolAddress,
    prevSchoolPhone: t.prevSchoolPhone,
    dateOfJoining: t.dateOfJoining,
    dateOfLeaving: t.dateOfLeaving,
    role: t.role,
    employeeType: t.employeeType,
    contractType: t.contractType,
    workShift: t.workShift,
    workLocation: t.workLocation,
    basicSalary: t.basicSalary,
    hra: t.hra,
    allowances: t.allowances,
    epf: t.epf,
    profTax: t.profTax,
    otherDeductions: t.otherDeductions,
    uan: t.uan,
    username: t.username,
    notes: t.notes,
    remarks: t.remarks,
    signatureName: t.signatureName,
    bank: t.bank,
    emergency: t.emergency,
    transport: t.transport,
    hostel: t.hostel,
    social: t.social,
    leaves: t.leaves,
    documents: t.documents,
    files,
  }
}

/** Persist field extras and uploaded files for a teacher id (merge with prior uploads). */
export async function persistTeacherExtras(
  teacherId: string,
  teacher: Teacher,
  picks: Array<{ key: string; label: string; file: File | null }>,
): Promise<void> {
  const prev = (await fetchTeacherExtras(teacherId).catch(() => loadTeacherExtras(teacherId))) ?? undefined
  const byKey = new Map((prev?.files ?? []).map((d) => [d.key, d]))
  for (const p of picks) {
    const stored = await fileToStoredDoc(p.key, p.file, p.label)
    if (stored) byKey.set(p.key, stored)
  }
  await saveTeacherExtras(teacherId, extrasFromTeacher(teacher, Array.from(byKey.values())))
}
