/* ============================================================
   SchoolMate — Domain types
   Derived from the prototype data model (data.jsx).
   ============================================================ */

export type Tier = 'silver' | 'gold' | 'platinum'
export type Role = 'owner' | 'admin' | 'principal' | 'vice_principal' | 'teacher' | 'staff'
/* Roles that appear in the permission matrix (everything except the owner alias).
   `owner` is intentionally excluded — it inherits the admin row via gating normalization. */
export type GateRole = Exclude<Role, 'owner'>
export type Cap = 'V' | 'E' | 'A'
export type ConsoleKind = 'owner' | 'school'

/* ---- Per-user permission overrides (Identity & access) ---- */
/* UI tri-state. 'inherit' is never stored in UserOverrides — it means "no override entry". */
export type CellState = 'inherit' | 'grant' | 'revoke'
/* module key -> cap -> explicit grant/revoke. Absent entry = inherit from role. */
export type UserOverrides = Record<string, Partial<Record<Cap, 'grant' | 'revoke'>>>

export type SchoolStatus = 'active' | 'trial' | 'past_due'
export type FeeStatus = 'paid' | 'partial' | 'due'
export type FeeType = 'academic' | 'transport' | 'other'

export interface FeeHead {
  id: string
  name: string
  code?: string
  active: boolean
  isSystem?: boolean
  isTransportFeeHead?: boolean
  description?: string
}

export interface FeeInvoiceLine {
  headId: string
  headName: string
  amount: number
  description?: string
}

export interface FeeInvoice {
  id: string
  studentId: string
  studentName: string
  /** Admission no. when API / join provides it. */
  studentAdm?: string
  cls: string
  grade: string
  academicYear: string
  term: string
  lines: FeeInvoiceLine[]
  total: number
  paid: number
  waived: number
  due: number
  status: FeeStatus
  dueDate?: string
  /** From Students join when list API enriches the invoice. */
  avatarHue?: number
  photoUrl?: string
}

export interface FeeCheque {
  number: string
  bank?: string
  date?: string
  status?: string
}

export interface FeeGateway {
  provider: 'razorpay'
  orderId?: string
  paymentId?: string
  signature?: string
}

export interface FeePayment {
  id: number
  invoiceId?: string
  studentId: string
  studentName: string
  cls: string
  /** @deprecated prefer headId */
  feeType?: FeeType | string
  headId?: string
  headName?: string
  amount: number
  mode: string
  ref: string
  date: string
  note?: string
  collectedBy?: string
  cheque?: FeeCheque
  gateway?: FeeGateway
  idempotencyKey?: string
}

export interface FeeReportSummary {
  collectedToday: number
  collectedTerm: number
  outstanding: number
  defaulters: number
  billedTerm: number
  pct: number
  byClass: { label: string; value: number; n: number }[]
  byMode: { label: string; value: number }[]
  latestPayment?: FeePayment | null
}

export interface SchoolEmailSettings {
  enabled: boolean
  fromName: string
  fromAddress: string
  replyTo?: string
  receiptTemplate?: string
  reminderTemplate?: string
}

export interface SchoolSmsSettings {
  enabled: boolean
  senderId: string
  receiptTemplate?: string
  reminderTemplate?: string
}

export type RazorpayStatus = 'not_configured' | 'configured' | 'invalid'

export interface SchoolRazorpaySettings {
  enabled: boolean
  keyId: string
  /** Never returned from GET; only sent on PUT when changing */
  keySecret?: string
  webhookSecret?: string
  mode: 'test' | 'live'
  status: RazorpayStatus
  keySecretSet?: boolean
  webhookSecretSet?: boolean
}

export interface SchoolIntegrations {
  email: SchoolEmailSettings
  sms: SchoolSmsSettings
  razorpay: SchoolRazorpaySettings
}
export type ActiveStatus = 'active' | 'inactive'
export type BusStatus = 'on_route' | 'at_stop' | 'delayed' | 'idle' | 'maintenance'

export interface TierMeta { label: string; color: string; bg: string }
export interface RoleMeta { label: string; short: string; desc: string }

export interface School {
  id: string
  name: string
  /** Human-readable school id (tenant slug), set when the school is created. */
  slug?: string
  city: string
  plan: Tier
  students: number
  staff: number
  status: SchoolStatus
  mrr: number
  attendance: number
  fees: number
  payroll: number
  currency: string
  tz: string
  /** Initials fallback when logoUrl is missing. */
  logo: string
  /** Uploaded / URL logo shown across CRM modules when set. */
  logoUrl?: string | null
  /** Campus / cover photo for dashboard & school profile. */
  imageUrl?: string | null
  color: string
}

/* Parent (father / mother) sub-record captured at enrolment. */
export interface ParentInfo {
  name?: string
  email?: string
  phone?: string
  occupation?: string
  aadhaar?: string
  photoName?: string
}

/* Uploaded document filenames (mock — files are not persisted). */
export interface StudentDocs {
  birthCert?: string
  transferCert?: string
  studentAadhaar?: string
  fatherAadhaar?: string
}

export interface Student {
  id: string
  adm: string
  name: string
  gender: 'M' | 'F'
  grade: string
  section: string
  cls: string
  roll: number
  guardian: string
  phone: string
  /** Parent / guardian login + mail. Distinct from the student's own `email`. */
  guardianEmail?: string
  /** Official period attendance % from API; null when no marked periods. */
  attendance: number | null
  feeStatus: FeeStatus
  feeDue: number
  status: ActiveStatus
  house: string
  avatarHue: number
  /* ---- optional enrolment detail (added via the Add Student form) ---- */
  academicYear?: string
  admissionDate?: string
  dob?: string
  bloodGroup?: string
  religion?: string
  category?: string
  caste?: string
  motherTongue?: string
  languages?: string
  lastSchool?: string
  address?: string
  email?: string
  aadhaar?: string
  photoName?: string
  father?: ParentInfo
  mother?: ParentInfo
  documents?: StudentDocs
}

/* ---- Teacher enrolment sub-records (optional, mock) ---- */
export interface BankInfo { holder?: string; account?: string; bank?: string; ifsc?: string; branch?: string }
export interface EmergencyInfo { person?: string; relationship?: string; phone?: string }
export interface TransportInfo {
  route?: string; vehicle?: string; pickup?: string
  license?: string; licenseExpiry?: string
}
export interface HostelInfo { hostel?: string; room?: string }
export interface SocialInfo { facebook?: string; instagram?: string; linkedin?: string; youtube?: string; twitter?: string }
export interface LeaveInfo { medical?: number; casual?: number; sick?: number; maternity?: number }
export interface TeacherDocs {
  resume?: string; joiningLetter?: string; aadhaar?: string; pan?: string
  experienceCert?: string; educationCert?: string; other?: string
}

export interface Teacher {
  id: string
  /** Human teacher id, e.g. scc-TCH-0001 (Guid stays in id for API). */
  code?: string
  /** Linked login account (Users.Id) — null until this teacher accepts their invite.
   *  Distinct from `id` (the Teachers row's own key): anything that authorizes against a
   *  real login (bus duty/traveling-teacher assignment, etc.) must use this, not `id`. */
  userId?: string | null
  name: string
  gender: 'M' | 'F'
  dept: string
  desig: string
  subjects: string[]
  classTeacher: string | null
  phone: string
  email: string
  exp: number
  rating: number
  attendance: number
  result: number
  load: number
  status: ActiveStatus
  avatarHue: number
  top: boolean
  /** Profile photo from linked Users row (shared across schools with same email). */
  photoUrl?: string | null
  /* ---- optional onboarding detail (added via the Add Teacher form) ---- */
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
  /** CRM access role shown on the Add Teacher form (Admin/Principal/Vice-Principal/Teacher/Staff).
   *  Stored for display only — it does not grant access; CRM access is still managed via Send invite. */
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
}

export interface StaffDocs {
  resume?: string; joiningLetter?: string; aadhaar?: string; pan?: string
  experienceCert?: string; educationCert?: string; other?: string
  license?: string; medicalCert?: string
}

export interface Staff {
  id: string
  /** Linked login Users.Id — required to assign a task to this person. Absent until they accept invite. */
  userId?: string
  /** Human staff id, e.g. scc-STF-0001 (Guid stays in id for API). */
  code?: string
  name: string
  gender: 'M' | 'F'
  role: string
  cat: string
  dept: string
  phone: string
  shift: string
  route: string | null
  attendance: number
  status: ActiveStatus
  avatarHue: number
  /** Profile photo from linked Users row (shared across schools with same email). */
  photoUrl?: string | null
  /* ---- optional onboarding detail (added via the Add Staff form) ---- */
  dob?: string
  bloodGroup?: string
  maritalStatus?: string
  altPhone?: string
  email?: string
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
  designation?: string
  employeeType?: string
  contractType?: string
  workLocation?: string
  dateOfJoining?: string
  dateOfLeaving?: string
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
  social?: SocialInfo
  documents?: StaffDocs
}

export interface Bus {
  id: string
  no: string
  label: string
  driver: string
  conductor: string
  route: string
  capacity: number
  students: number
  stops: number
  status: BusStatus
  speed: number
  eta: string
  fuel: number
  color: string
}

export type ExamStatus = 'scheduled' | 'completed' | 'marks_entry' | 'draft'
export interface Exam {
  id: string
  name: string
  type: string
  grades: string
  /** Class / section IDs included in this exam (shown on datesheet). */
  classIds?: string[]
  from: string
  to: string
  subjects: number
  status: ExamStatus
  marksEntered: number
  published: boolean
}

export interface PaperSlot {
  id: string
  classId?: string | null
  className?: string
  subject: string
  date: string        // yyyy-mm-dd
  start: string       // HH:MM (24h)
  duration: number    // minutes
  room: string
  inv1: string
  inv2: string
  /** Paper total marks (e.g. 70 or 100). Defaults to 100 when omitted. */
  maxMarks?: number
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Approval {
  id: string
  type: string
  module: string
  cap: Cap
  title: string
  detail: string
  requester: string
  role: string
  amount: number | null
  age: string
  priority: 'high' | 'medium' | 'low'
  forRoles: Role[]
  status: ApprovalStatus
  decidedNote?: string | null
  /** Display name of the principal/admin who approved or rejected. */
  decidedBy?: string | null
  appliedOn?: string | null
  attachmentUrls?: string[]
  /** Present only on a student leave (parent/student submitted). Resolved from the
   *  leave's ChildId → Student on the backend. Absent for teacher/staff self-leave. */
  student?: {
    id?: string
    name?: string
    cls?: string
    section?: string
    roll?: number
    adm?: string
  }
}

export interface AppNotification {
  id: number
  icon: string
  tone: string
  title: string
  body: string
  time: string
  unread: boolean
}

export type ComplaintStatus = 'open' | 'in_progress' | 'resolved'
export interface Complaint {
  id: string
  subject: string
  from: string
  cat: string
  priority: 'high' | 'medium' | 'low'
  status: ComplaintStatus
  age: string
  assignee: string
  body: string
}

export interface ThreadMsg { me: boolean; t: string; at: string }
export interface Thread {
  id: number
  parent: string
  student: string
  teacher: string
  unread: number
  last: string
  time: string
  hue: number
  msgs: ThreadMsg[]
}

/* ---- Academic computation ---- */
export interface ReportRow { subject: string; max: number; marks: number; grade: string; gpa: number; pass: boolean }
export interface Report {
  rows: ReportRow[]
  total: number
  maxTotal: number
  pct: number
  grade: string
  gpa: number
  result: 'PASS' | 'COMPARTMENT'
}
export interface RankInfo { rank: number; classSize: number }
export interface MonthValue { label: string; value: number }

/* ---- Query option shapes ---- */
export interface ListStudentsOpts {
  q?: string
  grade?: string
  status?: string
  fee?: string
  /** SQL page size. Omit for the full roster (mobile / screens that need every row). Max 100. */
  limit?: number
  cursor?: string
}
export interface ListTeachersOpts { q?: string; dept?: string; status?: string }
export interface ListStaffOpts { q?: string; cat?: string; enabled?: boolean }
