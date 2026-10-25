/* ============================================================
   SchoolMate — App state: auth, console/role, current school,
   plan, language, view navigation.
   ============================================================ */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, setOnAuthFailure } from '@/api/client'
import { login as passwordLogin, me as fetchMe, logout as apiLogout, refresh as refreshSession } from '@/api/auth'
import { listMySchools, switchSchool } from '@/api/mySchools'
import { clientToSchool } from '@/api/ownerMap'
import { tokenStore } from '@/api/auth/tokenStore'
import type { ConsoleKind, Exam, FeePayment, PaperSlot, Role, School, Staff, Student, Teacher, Tier } from '@/types'
import { students as seedStudents, exams as seedExams } from '@/data/mockDb'

const isTenantGuid = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

export interface DemoAccount {
  email: string
  phone: string
  name: string
  role: Role
  console: ConsoleKind
  hue: number
}

/* Five role-locked demo accounts (per the design). Console routing is now
   driven by the backend is_platform claim (see applySession), not the email
   domain; the `console` field here is descriptive demo metadata only. */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  { email: 'anil@schoolmate.io', phone: '+91 98100 10001', name: 'Anil Mehta', role: 'admin', console: 'owner', hue: 250 },
  { email: 'admin@greenwood.edu', phone: '+91 98100 10002', name: 'Ravi Menon', role: 'admin', console: 'school', hue: 200 },
  { email: 'principal@greenwood.edu', phone: '+91 98100 10003', name: 'Sunita Rao', role: 'principal', console: 'school', hue: 330 },
  { email: 'vp@greenwood.edu', phone: '+91 98100 10004', name: 'Arjun Banerjee', role: 'vice_principal', console: 'school', hue: 150 },
  { email: 'teacher@greenwood.edu', phone: '+91 98100 10005', name: 'Meera Krishnan', role: 'teacher', console: 'school', hue: 20 },
]

export interface AppUser { name: string; email: string; role: Role; hue: number }

interface AppState {
  loggedIn: boolean
  user: AppUser | null
  consoleKind: ConsoleKind
  role: Role
  isPlatform: boolean
  schoolId: string
  ownerViewingSchool: boolean
  lang: string
  dir: 'ltr' | 'rtl'
  view: string
  mobileNav: boolean
  /* cross-screen navigation payload */
  focus: string | null
  intent: string | null
  /* derived */
  school: School
  plan: Tier
  /* student roster (seeded, with in-session additions) */
  students: Student[]
  addStudent: (student: Student) => void
  /* teacher roster (seeded, with in-session additions) */
  teachers: Teacher[]
  addTeacher: (teacher: Teacher) => void
  /* non-teaching staff roster (seeded, with in-session additions) */
  staff: Staff[]
  addStaff: (staff: Staff) => void
  /* exams + per-exam marks & attendance (in-session) */
  exams: Exam[]
  addExam: (exam: Exam) => void
  updateExam: (id: string, patch: Partial<Exam>) => void
  examMarks: Record<string, number>
  saveExamMarks: (entries: Record<string, number>) => void
  examAttendance: Record<string, 'present' | 'absent'>
  saveExamAttendance: (entries: Record<string, 'present' | 'absent'>) => void
  /* per-exam datesheets (in-session) */
  datesheets: Record<string, PaperSlot[]>
  saveDatesheet: (examId: string, slots: PaperSlot[]) => void
  /* fee payment history (in-session) */
  feePayments: FeePayment[]
  addFeePayment: (p: FeePayment) => void
  /* configurable fee heads + per-grade fee structure (in-session) */
  feeHeads: string[]
  feeStructure: Record<string, Record<string, number>>
  saveFeeStructure: (heads: string[], structure: Record<string, Record<string, number>>) => void
  /* actions */
  authBusy: boolean
  /** True while bootstrap tries refresh token after page reload. */
  sessionRestoring: boolean
  authError: string | null
  clearAuthError: () => void
  loginWithPassword: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  go: (view: string, opts?: { focus?: string; intent?: string }) => void
  clearIntent: () => void
  setSchoolId: (id: string) => void
  /** Open school console. Pass `profile` (from portfolio) so plan/features match the subscription tier.
   *  Returns false when the school is still on trial (waiting for Catre activation). */
  enterSchool: (id: string, profile?: School) => Promise<boolean>
  /** Merge updated school branding into the live portfolio (after Edit school). */
  rememberSchool: (school: School) => void
  /** Live portfolio schools when known; otherwise mock demo tenants. */
  schoolChoices: School[]
  exitToOwner: () => void
  upgrade: (tier: Tier) => void
  setLang: (lang: string) => void
  setMobileNav: (open: boolean) => void
}

const RTL_LANGS = ['ar', 'ur']
const AppCtx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState(false)
  const [user, setUser] = useState<AppUser | null>(null)
  const [consoleKind, setConsoleKind] = useState<ConsoleKind>('school')
  const [role, setRole] = useState<Role>('admin')
  const [isPlatform, setIsPlatform] = useState(false)
  const [schoolId, setSchoolId] = useState<string>('grv')
  const [ownerViewingSchool, setOwnerViewing] = useState(false)
  const [lang, setLangState] = useState('en')
  const [view, setView] = useState('school.dashboard')
  const [focus, setFocus] = useState<string | null>(null)
  const [intent, setIntent] = useState<string | null>(null)
  const [mobileNav, setMobileNav] = useState(false)
  /* plan overrides allow live "upgrade" without mutating the dataset */
  const [planOverride, setPlanOverride] = useState<Record<string, Tier>>({})
  /* Real tenants from /me/schools or /clients — drives plan gating (silver/gold/platinum). */
  const [liveSchools, setLiveSchools] = useState<Record<string, School>>({})
  /* roster: seeded data plus students enrolled this session (newest first) */
  const [students, setStudents] = useState<Student[]>(seedStudents)
  const addStudent = (student: Student) => setStudents((list) => [student, ...list])
  /* Do not seed mock teachers — People / Academics use live GET /teachers. */
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const addTeacher = (teacher: Teacher) => setTeachers((list) => [teacher, ...list])
  /* Do not seed mock staff — People uses live GET /staff. */
  const [staff, setStaff] = useState<Staff[]>([])
  const addStaff = (s: Staff) => setStaff((list) => [s, ...list])
  const [exams, setExams] = useState<Exam[]>(seedExams)
  const addExam = (exam: Exam) => setExams((list) => [exam, ...list])
  const updateExam = (id: string, patch: Partial<Exam>) =>
    setExams((list) => list.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  const [examMarks, setExamMarks] = useState<Record<string, number>>({})
  const saveExamMarks = (entries: Record<string, number>) =>
    setExamMarks((m) => ({ ...m, ...entries }))
  const [examAttendance, setExamAttendance] = useState<Record<string, 'present' | 'absent'>>({})
  const saveExamAttendance = (entries: Record<string, 'present' | 'absent'>) =>
    setExamAttendance((m) => ({ ...m, ...entries }))
  const [datesheets, setDatesheets] = useState<Record<string, PaperSlot[]>>({})
  const saveDatesheet = (examId: string, slots: PaperSlot[]) =>
    setDatesheets((m) => ({ ...m, [examId]: slots }))
  const [feePayments, setFeePayments] = useState<FeePayment[]>([])
  const addFeePayment = (p: FeePayment) => setFeePayments((list) => [p, ...list])
  const [feeHeads, setFeeHeads] = useState<string[]>(['Academic', 'Transport', 'Other'])
  const [feeStructure, setFeeStructureState] = useState<Record<string, Record<string, number>>>({})
  const saveFeeStructure = (heads: string[], structure: Record<string, Record<string, number>>) => {
    setFeeHeads(heads)
    setFeeStructureState(structure)
  }
  const [authBusy, setAuthBusy] = useState(false)
  const [sessionRestoring, setSessionRestoring] = useState(() => tokenStore.hasSession())
  const [authError, setAuthError] = useState<string | null>(null)
  const clearAuthError = () => setAuthError(null)

  const persistUi = (
    next?: Partial<{ view: string; consoleKind: ConsoleKind; schoolId: string; ownerViewingSchool: boolean }>,
  ) => {
    tokenStore.setUi({
      view: next?.view ?? view,
      consoleKind: next?.consoleKind ?? consoleKind,
      schoolId: next?.schoolId ?? schoolId,
      ownerViewingSchool: next?.ownerViewingSchool ?? ownerViewingSchool,
    })
  }

  const rememberSchools = (list: School[]) => {
    if (list.length === 0) return
    setLiveSchools((prev) => {
      const next = { ...prev }
      for (const s of list) next[s.id] = s
      return next
    })
  }

  const hydrateLiveSchools = async () => {
    try {
      const res = await listMySchools()
      const mapped = (res.data ?? []).map(clientToSchool)
      setLiveSchools((prev) => {
        const next: Record<string, School> = {}
        for (const s of mapped) next[s.id] = s
        /* Merge remembered branding if the latest API row omitted heavy image fields. */
        for (const [id, s] of Object.entries(prev)) {
          if (!next[id]) continue
          const api = next[id]
          next[id] = {
            ...s,
            ...api,
            logoUrl: api.logoUrl || s.logoUrl || null,
            imageUrl: api.imageUrl || s.imageUrl || null,
          }
        }
        return next
      })
    } catch {
      /* Do not fall back to mock tenants — SaaS isolation. */
      setLiveSchools({})
    }
  }

  /** SaaS: only schools mapped to this login (JWT membership). Never demo schools. */
  const schoolChoices = useMemo(() => Object.values(liveSchools), [liveSchools])

  const school = useMemo(() => {
    if (liveSchools[schoolId]) return liveSchools[schoolId]
    if (schoolChoices[0]) return schoolChoices[0]
    /* Placeholder until /me/schools loads — not another client's school. */
    return {
      id: schoolId || 'none',
      name: 'No school',
      city: '—',
      plan: 'gold' as Tier,
      students: 0,
      staff: 0,
      status: 'trial' as const,
      mrr: 0,
      attendance: 0,
      fees: 0,
      payroll: 0,
      currency: 'INR',
      tz: 'Asia/Kolkata',
      logo: '—',
      logoUrl: null,
      imageUrl: null,
      color: '#64748b',
    }
  }, [schoolId, liveSchools, schoolChoices])
  /** Subscription tier for TierGate: live API plan unless a session upgrade override is set. */
  const plan: Tier = planOverride[schoolId] ?? school.plan
  const dir: 'ltr' | 'rtl' = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr'

  /** Apply the identity from /auth/me to console/role/view state.
   *  Platform operators and school founders (role owner) land on Owner Console. */
  const applySession = (
    email: string,
    role: Role,
    isPlatformUser: boolean,
    opts?: { restoreUi?: boolean },
    identity?: { name?: string | null; email?: string | null },
  ) => {
    const ownerConsole = isPlatformUser || role === 'owner'
    const saved = opts?.restoreUi ? tokenStore.getUi() : null
    // Prefer the real name/email from /auth/me; only fall back to the email prefix
    // when the backend sends no name (e.g. a bare login identifier).
    const displayName = identity?.name?.trim() || email.split('@')[0]
    const displayEmail = identity?.email?.trim() || email
    setUser({ name: displayName, email: displayEmail, role, hue: isPlatformUser ? 250 : 210 })
    setIsPlatform(isPlatformUser)
    setRole(role)
    setLoggedIn(true)

    // Never trust a persisted owner-console view/consoleKind for a non-owner role —
    // sessionStorage can go stale (or be tampered with) independently of the freshly
    // fetched role, and that's the one thing gating the Owner Console.
    if (saved?.view && (ownerConsole || !saved.view.startsWith('owner.'))) {
      setConsoleKind(ownerConsole ? (saved.consoleKind ?? 'owner') : 'school')
      setOwnerViewing(ownerConsole && !!saved.ownerViewingSchool)
      setView(saved.view)
      if (saved.schoolId) setSchoolId(saved.schoolId)
    } else {
      setConsoleKind(ownerConsole ? 'owner' : 'school')
      setOwnerViewing(false)
      setView(ownerConsole ? 'owner.dashboard' : 'school.dashboard')
    }
    tokenStore.setEmail(email)
  }

  /* Map the backend role string (e.g. "school.owner") to a frontend Role. Unknown
     roles fall back to 'admin' so ROLE_META lookups never crash. */
  const ROLE_MAP: Record<string, Role> = {
    'school.owner': 'owner', 'school.admin': 'admin',
    'school.principal': 'principal', 'school.teacher': 'teacher',
    staff: 'staff',
    owner: 'owner', admin: 'admin', principal: 'principal',
    vice_principal: 'vice_principal', teacher: 'teacher',
  }

  /* When an account holds several roles (e.g. an Owner who is also admin), resolve to the
     highest-privilege one — Owner must win over admin so the founder lands on Owner Console. */
  const ROLE_PRIORITY: Role[] = ['owner', 'admin', 'principal', 'vice_principal', 'teacher', 'staff']

  const finishLogin = async (email: string, opts?: { restoreUi?: boolean }) => {
    const profile = await fetchMe()
    const mapped = (profile.roles ?? []).map((r) => ROLE_MAP[r]).filter(Boolean) as Role[]
    const role = ROLE_PRIORITY.find((r) => mapped.includes(r)) ?? 'admin'
    const platform = profile.is_platform === true
    applySession(email, role, platform, opts, { name: profile.name, email: profile.email })
    // Load real tenant plan so school console gates match silver/gold/platinum.
    if (!platform) {
      await hydrateLiveSchools()
      const saved = opts?.restoreUi ? tokenStore.getUi() : null
      const savedSchool = saved?.schoolId
      if (savedSchool && isTenantGuid(savedSchool)) {
        setSchoolId(savedSchool)
        // Reload can restore SCC in the UI while the JWT still points at another owned school.
        if (saved?.ownerViewingSchool && savedSchool !== profile.tenant_id) {
          try {
            await switchSchool(savedSchool)
          } catch {
            /* Roster APIs stay on the JWT tenant until the owner re-enters the school. */
          }
        }
      } else if (profile.tenant_id && isTenantGuid(profile.tenant_id)) {
        setSchoolId(profile.tenant_id)
      }
    }
  }

  /** Shared busy/error wrapper for the auth flows. */
  const runAuth = async (fn: () => Promise<void>, fallback: string) => {
    setAuthBusy(true); setAuthError(null)
    try {
      await fn()
    } catch (e) {
      setAuthError(e instanceof ApiError ? e.message : fallback)
    } finally {
      setAuthBusy(false)
    }
  }

  const loginWithPassword = (email: string, password: string) =>
    runAuth(async () => {
      tokenStore.setUi(null)
      await passwordLogin(email, password)
      tokenStore.setEmail(email.trim())
      await finishLogin(email.trim())
    }, 'Sign-in failed. Please try again.')

  const logout = async () => {
    tokenStore.setSchoolBrand(null)
    try { await apiLogout() } finally {
      setLoggedIn(false)
      setUser(null)
      setOwnerViewing(false)
      setLiveSchools({})
      setPlanOverride({})
      setSchoolId('')
      setView('school.dashboard')
      setMobileNav(false)
      tokenStore.setUi(null)
    }
  }

  const go = (v: string, opts?: { focus?: string; intent?: string }) => {
    setView(v)
    setFocus(opts?.focus ?? null)
    setIntent(opts?.intent ?? null)
    setMobileNav(false)
    persistUi({ view: v })
    // Push a history entry so the clean URL reflects the view and back/forward works.
    try { window.history.pushState(null, '', '/' + v.replace(/\./g, '/')) } catch { /* ignore */ }
  }
  const clearIntent = () => setIntent(null)

  // Keep the URL PATH matching the current view (covers programmatic nav like login/restore).
  // The query (e.g. ?tab=…) is a screen's own concern, so a view change resets it.
  useEffect(() => {
    const want = '/' + view.replace(/\./g, '/')
    if (window.location.pathname !== want) {
      try { window.history.replaceState(null, '', want) } catch { /* ignore */ }
    }
  }, [view])

  // Back/forward or a manual URL edit navigates the CRM (path only; query ignored).
  useEffect(() => {
    const onNav = () => {
      const h = window.location.pathname.replace(/^\/+/, '').replace(/\//g, '.').trim()
      if (h) setView((prev) => (h !== prev ? h : prev))
    }
    window.addEventListener('popstate', onNav)
    return () => window.removeEventListener('popstate', onNav)
  }, [])

  const enterSchool = async (id: string, profile?: School): Promise<boolean> => {
    let mapped: Record<string, School> = { ...liveSchools }

    const haveProfile = !!(profile && isTenantGuid(id) && profile.id === id)
    if (haveProfile) {
      rememberSchools([profile!])
      mapped[id] = profile!
    }

    /* Refresh portfolio so logo/cover photos land on the school dashboard. When the caller
       already handed us this school's profile we have everything needed to enter, so we do
       this refresh in the background (don't block opening on it) and let logos/covers update
       a moment later. Only block when we have no profile and must fetch to validate access. */
    if (isTenantGuid(id) && !isPlatform) {
      if (haveProfile) {
        void listMySchools()
          .then((res) => { rememberSchools((res.data ?? []).map(clientToSchool)) })
          .catch(() => {})
      } else {
        try {
          const res = await listMySchools()
          const list = (res.data ?? []).map(clientToSchool)
          rememberSchools(list)
          mapped = { ...mapped, ...Object.fromEntries(list.map((s) => [s.id, s])) }
        } catch {
          if (!mapped[id]) return false
        }
      }
    }

    /* Reject schools not mapped to this login — never another client's tenant. */
    if (!isPlatform && isTenantGuid(id) && !mapped[id]) return false

    const status = profile?.status ?? mapped[id]?.status
    if (!isPlatform && status !== 'active') return false

    /* Real tenant UUIDs need a token switch — fail closed so JWT matches UI school. */
    if (isTenantGuid(id)) {
      if (!isPlatform) {
        try {
          await switchSchool(id)
        } catch {
          return false
        }
      } else {
        tokenStore.setTenantId(id)
      }
    }
    setSchoolId(id)
    setConsoleKind('school')
    setOwnerViewing(true)
    setView('school.dashboard')
    persistUi({ schoolId: id, consoleKind: 'school', ownerViewingSchool: true, view: 'school.dashboard' })
    return true
  }
  const rememberSchool = (next: School) => {
    rememberSchools([next])
  }

  const exitToOwner = () => {
    setConsoleKind('owner')
    setOwnerViewing(false)
    setView('owner.schools')
    persistUi({ consoleKind: 'owner', ownerViewingSchool: false, view: 'owner.schools' })
  }
  const upgrade = (_tier: Tier) => {
    /* Real upgrades go through Owner Billing → Razorpay/offline → Catre approve. */
    go('owner.billing')
  }
  const setLang = (l: string) => {
    setLangState(l)
    document.documentElement.setAttribute('dir', RTL_LANGS.includes(l) ? 'rtl' : 'ltr')
    document.documentElement.setAttribute('lang', l)
  }

  useEffect(() => { setOnAuthFailure(() => { tokenStore.clear(); void logout() }) }, [])

  /* Reload / refresh: keep session via refresh token (do not bounce to login). */
  useEffect(() => {
    let cancelled = false
    const restore = async () => {
      if (!tokenStore.hasSession()) {
        setSessionRestoring(false)
        return
      }
      try {
        await refreshSession()
        const email = tokenStore.getEmail() || 'user'
        if (!cancelled) await finishLogin(email, { restoreUi: true })
      } catch {
        tokenStore.clear()
        if (!cancelled) setLoggedIn(false)
      } finally {
        if (!cancelled) setSessionRestoring(false)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [])

  const value: AppState = {
    loggedIn, user, consoleKind, role, isPlatform, schoolId, ownerViewingSchool, lang, dir, view, mobileNav,
    focus, intent, sessionRestoring,
    school, plan,
    students, addStudent,
    teachers, addTeacher,
    staff, addStaff,
    exams, addExam, updateExam, examMarks, saveExamMarks, examAttendance, saveExamAttendance,
    datesheets, saveDatesheet,
    feePayments, addFeePayment,
    feeHeads, feeStructure, saveFeeStructure,
    authBusy, authError, clearAuthError, loginWithPassword,
    logout, go, clearIntent, setSchoolId, enterSchool, rememberSchool, schoolChoices, exitToOwner, upgrade, setLang, setMobileNav,
  }

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(AppCtx)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
