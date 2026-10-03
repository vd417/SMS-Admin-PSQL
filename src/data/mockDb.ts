/* ============================================================
   SchoolMate — Mock dataset (deterministic, seeded)
   Typed port of the prototype's data.jsx. The seeded RNG keeps
   generated records stable across runs so tests are reliable.
   ============================================================ */
import type {
  Tier, Role, GateRole, Cap, TierMeta, RoleMeta,
  School, Student, Teacher, Staff, Exam, Approval, AppNotification,
  Complaint, Thread,
} from '@/types'

/* ---------- Tiers ---------- */
export const TIERS: Tier[] = ['silver', 'gold', 'platinum']
export const TIER_META: Record<Tier, TierMeta> = {
  silver: { label: 'Silver', color: 'var(--silver)', bg: 'var(--silver-bg)' },
  gold: { label: 'Gold', color: 'var(--gold)', bg: 'var(--gold-bg)' },
  platinum: { label: 'Platinum', color: 'var(--platinum)', bg: 'var(--platinum-bg)' },
}
export const FEATURE_TIER: Record<string, Tier> = {
  sis: 'silver', academics: 'silver', attendance: 'silver',
  exams: 'silver', fees: 'silver', communication: 'silver',
  operations: 'platinum', library: 'platinum', transport: 'platinum',
  hostel: 'platinum', sports: 'platinum',
  'analytics.weak_students': 'gold', 'reporting.advanced': 'gold',
  hr_payroll: 'platinum', staff_support: 'platinum',
  'attendance.geofence': 'platinum', 'transport.gps': 'platinum', 'support.dedicated': 'platinum',
  ai_search: 'platinum',
}

/* ---------- Roles & permission matrix ---------- */
export const ROLES: GateRole[] = ['admin', 'principal', 'vice_principal', 'teacher', 'staff']
export const ROLE_META: Record<Role, RoleMeta> = {
  owner: { label: 'Owner', short: 'OW', desc: 'School owner — full control; only an owner can assign this role' },
  admin: { label: 'Admin', short: 'AD', desc: 'School admin — setup, users & day-to-day operations' },
  principal: { label: 'Principal', short: 'PR', desc: 'Principal — academics, approvals & reports' },
  vice_principal: { label: 'Vice-Principal', short: 'VP', desc: 'Academic lead (maps to Principal on invite)' },
  teacher: { label: 'Teacher', short: 'TE', desc: 'Teacher — marks, attendance & homework for own classes' },
  staff: { label: 'Staff', short: 'ST', desc: 'Non-teaching staff — office, transport, library, etc.' },
}
export const PERMS: Record<string, Record<GateRole, Cap[]>> = {
  setup: { admin: ['E'], principal: ['V', 'E'], vice_principal: ['V'], teacher: [], staff: [] },
  dashboard: { admin: ['V'], principal: ['V'], vice_principal: ['V'], teacher: ['V'], staff: ['V'] },
  identity: { admin: ['E'], principal: ['V', 'E'], vice_principal: ['V'], teacher: [], staff: [] },
  sis: { admin: ['E'], principal: ['V', 'E'], vice_principal: ['V', 'E'], teacher: ['V'], staff: ['V'] },
  academics: { admin: ['E'], principal: ['V', 'A'], vice_principal: ['E', 'A'], teacher: ['V', 'E'], staff: [] },
  /* Owner inherits admin. Leadership sees everyone (students + teachers + staff). */
  attendance: { admin: ['V', 'E', 'A'], principal: ['V', 'E', 'A'], vice_principal: ['V', 'E', 'A'], teacher: ['V', 'E'], staff: ['V'] },
  exams: { admin: ['E'], principal: ['A'], vice_principal: ['A'], teacher: ['V', 'E'], staff: [] },
  fees: { admin: ['E'], principal: ['V', 'E', 'A'], vice_principal: ['V'], teacher: [], staff: ['V'] },
  hr: { admin: ['E'], principal: ['A'], vice_principal: ['A'], teacher: [], staff: ['V'] },
  communication: { admin: ['E'], principal: ['E', 'A'], vice_principal: ['E'], teacher: ['E'], staff: ['V', 'E'] },
  operations: { admin: ['E'], principal: ['V'], vice_principal: ['V'], teacher: [], staff: ['V', 'E'] },
  settings: { admin: ['E'], principal: ['V'], vice_principal: ['V'], teacher: [], staff: [] },
  issues: { admin: ['V', 'E'], principal: ['V', 'E'], vice_principal: ['V', 'E'], teacher: [], staff: [] },
  staffTasks: { admin: ['V', 'E'], principal: ['V', 'E'], vice_principal: ['V', 'E'], teacher: [], staff: [] },
}

/* ---------- Schools (tenants) ---------- */
export const schools: School[] = [
  { id: 'grv', name: 'Greenwood Valley School', city: 'Bengaluru', plan: 'platinum', students: 2148, staff: 184, status: 'active', mrr: 289000, attendance: 94.2, fees: 88, payroll: 42.8, currency: '₹', tz: 'Asia/Kolkata', logo: 'GV', color: '#16a34a' },
  { id: 'stx', name: 'St. Xavier’s High School', city: 'Mumbai', plan: 'gold', students: 1672, staff: 142, status: 'active', mrr: 172000, attendance: 91.0, fees: 79, payroll: 33.1, currency: '₹', tz: 'Asia/Kolkata', logo: 'SX', color: '#4f46e5' },
  { id: 'dps', name: 'Delhi Public Academy', city: 'New Delhi', plan: 'gold', students: 2890, staff: 233, status: 'active', mrr: 214000, attendance: 89.6, fees: 73, payroll: 51.0, currency: '₹', tz: 'Asia/Kolkata', logo: 'DP', color: '#0ea5e9' },
  { id: 'srt', name: 'Sunrise International', city: 'Hyderabad', plan: 'silver', students: 864, staff: 71, status: 'active', mrr: 64000, attendance: 92.7, fees: 81, payroll: 0, currency: '₹', tz: 'Asia/Kolkata', logo: 'SI', color: '#f59e0b' },
  { id: 'lts', name: 'Lotus Montessori', city: 'Pune', plan: 'silver', students: 412, staff: 39, status: 'trial', mrr: 0, attendance: 95.1, fees: 69, payroll: 0, currency: '₹', tz: 'Asia/Kolkata', logo: 'LM', color: '#ec4899' },
  { id: 'amn', name: 'Al-Manar Academy', city: 'Dubai', plan: 'platinum', students: 1320, staff: 118, status: 'active', mrr: 412000, attendance: 93.3, fees: 90, payroll: 61.2, currency: 'AED', tz: 'Asia/Dubai', logo: 'AM', color: '#0d9488' },
  { id: 'hzn', name: 'Horizon World School', city: 'Chennai', plan: 'gold', students: 1985, staff: 166, status: 'past_due', mrr: 188000, attendance: 87.4, fees: 62, payroll: 44.7, currency: '₹', tz: 'Asia/Kolkata', logo: 'HW', color: '#dc2626' },
]

/* ---------- Seeded RNG ---------- */
function rng(seed: number) { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff }
const rand = rng(42)
function pick<T>(a: T[]): T { return a[Math.floor(rand() * a.length)] }

const firstM = ['Aarav', 'Vivaan', 'Aditya', 'Reyansh', 'Arjun', 'Sai', 'Krishna', 'Ishaan', 'Rohan', 'Kabir', 'Dhruv', 'Ayaan', 'Atharv', 'Vihaan', 'Ansh']
const firstF = ['Aanya', 'Diya', 'Saanvi', 'Aadhya', 'Pari', 'Anika', 'Myra', 'Sara', 'Ira', 'Kiara', 'Riya', 'Navya', 'Aarohi', 'Anvi', 'Tara']
const last = ['Sharma', 'Iyer', 'Reddy', 'Khan', 'Patel', 'Nair', 'Gupta', 'Menon', 'Verma', 'Das', 'Rao', 'Bose', 'Shetty', 'Joshi', 'Pillai']
export const sections = ['A', 'B', 'C']
export const grades = ['Nursery', 'LKG', 'UKG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
export const subjects = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies', 'Computer']

/* ---------- Students ---------- */
export const students: Student[] = []
for (let i = 0; i < 240; i++) {
  const male = rand() > 0.5
  const fn = male ? pick(firstM) : pick(firstF)
  const ln = pick(last)
  const grade = pick(grades.slice(4))
  const sec = pick(sections)
  const fee = Math.floor(rand() * 100)
  students.push({
    id: 'S' + (10240 + i),
    adm: 'ADM' + (2026000 + i),
    name: fn + ' ' + ln,
    gender: male ? 'M' : 'F',
    grade, section: sec, cls: grade + '-' + sec,
    roll: 1 + Math.floor(rand() * 48),
    guardian: (rand() > .5 ? pick(firstM) : pick(firstF)) + ' ' + ln,
    phone: '+91 9' + String(Math.floor(rand() * 900000000 + 100000000)),
    attendance: 72 + Math.floor(rand() * 28),
    feeStatus: fee > 70 ? 'paid' : fee > 35 ? 'partial' : 'due',
    feeDue: fee > 70 ? 0 : Math.floor(rand() * 48 + 8) * 1000,
    status: rand() > 0.04 ? 'active' : 'inactive',
    house: pick(['Ruby', 'Emerald', 'Sapphire', 'Topaz']),
    avatarHue: Math.floor(rand() * 360),
  })
}

/* ---------- Teachers ---------- */
export const depts = [
  'Mathematics',
  'Science',
  'English',
  'Hindi',
  'Social Studies',
  'Computer',
  'Physical Education',
  'Arts',
]
/** Empty — CRM uses live GET /teachers. Keep export for legacy screens until they migrate. */
export const teachers: Teacher[] = []

/* ---------- Non-teaching staff ---------- */
/** Empty — CRM uses live GET /staff. */
export const staff: Staff[] = []

/* ---------- Exams ---------- */
export const exams: Exam[] = [
  { id: 'EX-T1-26', name: 'Term 1 Examination', type: 'Term', grades: 'VI–XII', from: '2026-09-08', to: '2026-09-20', subjects: 6, status: 'scheduled', marksEntered: 0, published: false },
  { id: 'EX-UT1-26', name: 'Unit Test 1', type: 'Unit Test', grades: 'VI–X', from: '2026-07-14', to: '2026-07-18', subjects: 5, status: 'completed', marksEntered: 92, published: true },
  { id: 'EX-UT2-26', name: 'Unit Test 2', type: 'Unit Test', grades: 'VI–X', from: '2026-08-11', to: '2026-08-14', subjects: 5, status: 'marks_entry', marksEntered: 64, published: false },
  { id: 'EX-MID-26', name: 'Mid-Term Examination', type: 'Term', grades: 'VI–XII', from: '2026-11-03', to: '2026-11-15', subjects: 6, status: 'draft', marksEntered: 0, published: false },
  { id: 'EX-PRE-26', name: 'Pre-Board (XII)', type: 'Board Prep', grades: 'XII', from: '2026-12-01', to: '2026-12-12', subjects: 6, status: 'draft', marksEntered: 0, published: false },
  { id: 'EX-PT1-26', name: 'Periodic Test 1', type: 'Periodic', grades: 'I–V', from: '2026-07-21', to: '2026-07-23', subjects: 4, status: 'completed', marksEntered: 100, published: true },
]

/* ---------- Approvals ---------- */
export const approvals: Approval[] = [
  { id: 'AP-3041', type: 'Report Card Publish', module: 'exams', cap: 'A', title: 'Publish Term-1 results — Grade X', detail: 'Grade X (4 sections · 168 students) Term 1 report cards ready to publish.', requester: 'Meera Krishnan', role: 'Class Teacher', amount: null, age: '2h', priority: 'high', forRoles: ['principal', 'vice_principal'], status: 'pending' },
  { id: 'AP-3038', type: 'Fee Waiver', module: 'fees', cap: 'A', title: 'Fee waiver — Kabir Sharma (Grade VIII-B)', detail: 'Hardship waiver request: ₹24,000 of Term-2 tuition. Counsellor recommended.', requester: 'Front Office', role: 'Accountant', amount: 24000, age: '4h', priority: 'medium', forRoles: ['principal'], status: 'pending' },
  { id: 'AP-3035', type: 'Leave Request', module: 'hr', cap: 'A', title: 'Leave — Rajesh Kumar (Mathematics)', detail: 'Casual leave 3 days (12–14 Jun). Substitute arranged.', requester: 'Rajesh Kumar', role: 'Teacher', amount: null, age: '5h', priority: 'low', forRoles: ['principal', 'vice_principal'], status: 'pending' },
  { id: 'AP-3030', type: 'Payroll Run', module: 'hr', cap: 'A', title: 'Approve payroll — May 2026', detail: '184 staff · gross ₹1.32 Cr · net ₹1.08 Cr. Prepared by Admin office.', requester: 'Admin Office', role: 'Administrator', amount: 13200000, age: '1d', priority: 'high', forRoles: ['principal'], status: 'pending' },
  { id: 'AP-3028', type: 'Attendance Correction', module: 'attendance', cap: 'A', title: 'Attendance correction — Grade IX-A (3 Jun)', detail: 'Mark 6 students present (late bus). Submitted by class teacher.', requester: 'Sunita Rao', role: 'Class Teacher', amount: null, age: '1d', priority: 'medium', forRoles: ['principal', 'vice_principal'], status: 'pending' },
  { id: 'AP-3024', type: 'Syllabus Change', module: 'academics', cap: 'A', title: 'Syllabus revision — Grade XII Physics', detail: 'Add Unit 9 (Modern Physics) to Term-2 plan.', requester: 'A. Banerjee', role: 'HOD Science', amount: null, age: '2d', priority: 'low', forRoles: ['vice_principal', 'principal'], status: 'pending' },
]

/* ---------- Notifications ---------- */
export const notifications: AppNotification[] = [
  { id: 1, icon: 'rupee', tone: 'success', title: 'Payment received', body: '₹48,000 — Aarav Sharma (Grade X-A)', time: 'just now', unread: true },
  { id: 2, icon: 'check', tone: 'brand', title: 'Attendance submitted', body: 'Grade VII-B marked by S. Rao · 41/44 present', time: '3m', unread: true },
  { id: 3, icon: 'alert', tone: 'warning', title: 'Fee dues reminder sent', body: '128 parents notified via SMS + push', time: '18m', unread: true },
  { id: 4, icon: 'inbox', tone: 'brand', title: 'New approval', body: 'Report-card publish awaiting your action', time: '2h', unread: false },
  { id: 5, icon: 'bus', tone: 'info', title: 'Bus 12 departed', body: 'Route R-04 · ETA first stop 7:42 AM', time: '2h', unread: false },
]

/* ---------- Complaints / messenger ---------- */
export const complaints: Complaint[] = [
  { id: 'CMP-204', subject: 'Bus 9 arriving late repeatedly', from: 'Mr. Sharma (parent)', cat: 'Transport', priority: 'high', status: 'open', age: '2h', assignee: 'Transport Dept', body: 'Bus 9 on route Marathahalli has been 20+ minutes late for 4 consecutive days. Children reach school after assembly.' },
  { id: 'CMP-201', subject: 'Cafeteria food quality concern', from: 'Mrs. Reddy (parent)', cat: 'Facilities', priority: 'medium', status: 'open', age: '5h', assignee: 'Admin', body: 'Requesting review of lunch menu hygiene and variety for primary section.' },
  { id: 'CMP-198', subject: 'Homework load too heavy — Grade VIII', from: 'Parent group', cat: 'Academics', priority: 'medium', status: 'in_progress', age: '1d', assignee: 'VP Academics', body: 'Several parents report 3+ hours of homework nightly. Requesting review of allocation policy.' },
  { id: 'CMP-195', subject: 'Request for additional bus stop', from: 'Mr. Iyer (parent)', cat: 'Transport', priority: 'low', status: 'in_progress', age: '2d', assignee: 'Transport Dept', body: 'Requesting a new pickup point near Sunrise Apartments on route R-02.' },
  { id: 'CMP-189', subject: 'Lost ID card replacement delay', from: 'Ms. Khan (parent)', cat: 'Administration', priority: 'low', status: 'resolved', age: '4d', assignee: 'Front Office', body: 'ID replacement took 2 weeks. Resolved — new card issued.' },
  { id: 'CMP-184', subject: 'Classroom projector not working', from: 'R. Kumar (teacher)', cat: 'Facilities', priority: 'high', status: 'resolved', age: '5d', assignee: 'IT Support', body: 'Projector in Room 204 fixed and tested.' },
]

export const threads: Thread[] = [
  { id: 1, parent: 'Anita Sharma', student: 'Aarav Sharma · X-A', teacher: 'R. Kumar (Maths)', unread: 2, last: 'Thank you, I will ensure he revises.', time: '9:24 AM', hue: 210,
    msgs: [{ me: false, t: 'Good morning, Aarav has been struggling with quadratic equations. Could you share extra practice?', at: '9:02 AM' },
      { me: true, t: 'Good morning! Yes, I’ll send a worksheet today. He’s improving in class.', at: '9:15 AM' },
      { me: false, t: 'Thank you, I will ensure he revises.', at: '9:24 AM' }] },
  { id: 2, parent: 'Vikram Menon', student: 'Diya Menon · VIII-B', teacher: 'S. Rao (English)', unread: 0, last: 'Noted, see you at the PTM.', time: 'Yesterday', hue: 140,
    msgs: [{ me: false, t: 'Will the PTM be on Saturday?', at: 'Yest 4:10 PM' }, { me: true, t: 'Yes, 10 AM–1 PM. Slot booked for you at 10:30.', at: 'Yest 4:30 PM' }, { me: false, t: 'Noted, see you at the PTM.', at: 'Yest 4:32 PM' }] },
  { id: 3, parent: 'Fatima Khan', student: 'Sara Khan · VII-C', teacher: 'Class Teacher', unread: 1, last: 'She’ll be absent tomorrow for a doctor visit.', time: 'Yesterday', hue: 300,
    msgs: [{ me: false, t: 'She’ll be absent tomorrow for a doctor visit.', at: 'Yest 6:00 PM' }] },
]
