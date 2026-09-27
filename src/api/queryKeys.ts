import { tokenStore } from './auth/tokenStore'
import type { ListStudentsOpts, ListTeachersOpts, ListStaffOpts } from '@/types'

/** JWT / X-Tenant-Id scope — keeps React Query caches per school after switch-school. */
function tenantScope(): string {
  return tokenStore.getTenantId() ?? 'none'
}

export const queryKeys = {
  students: {
    all: ['students'] as const,
    list: (opts: ListStudentsOpts = {}) => ['students', 'list', tenantScope(), opts] as const,
    page: (opts: ListStudentsOpts = {}) => ['students', 'page', tenantScope(), opts] as const,
    detail: (id: string) => ['students', 'detail', tenantScope(), id] as const,
  },
  teachers: {
    all: ['teachers'] as const,
    list: (opts: ListTeachersOpts = {}) => ['teachers', 'list', tenantScope(), opts] as const,
    detail: (id: string) => ['teachers', 'detail', tenantScope(), id] as const,
  },
  staff: {
    all: ['staff'] as const,
    list: (opts: ListStaffOpts = {}) => ['staff', 'list', tenantScope(), opts] as const,
    detail: (id: string) => ['staff', 'detail', tenantScope(), id] as const,
  },
  notifications: {
    all: ['notifications'] as const,
  },
  approvals: {
    all: ['approvals'] as const,
    list: (status = 'pending') => ['approvals', 'list', status] as const,
  },
  users: {
    all: ['users'] as const,
  },
  invitations: {
    all: ['invitations'] as const,
  },
  roleTemplate: {
    all: ['roleTemplate'] as const,
  },
  audit: {
    list: (params: import('./audit').AuditParams = {}) => ['audit', 'list', params] as const,
  },
  schoolHouses: {
    all: ['schoolHouses'] as const,
  },
  classes: {
    all: ['classes'] as const,
    subjects: (classId: string) => ['classes', 'subjects', classId] as const,
  },
  timetable: {
    all: () => ['timetable', tenantScope()] as const,
  },
  subjects: {
    all: ['subjects'] as const,
  },
  attendance: {
    forClass: (classId: string, date = '') => ['attendance', classId, date] as const,
    rollCall: (classId: string, date = '') => ['attendance', 'rollCall', classId, date] as const,
    dayTimetable: (classId: string, date = '') => ['attendance', 'dayTimetable', classId, date] as const,
    period: (classId: string, date = '', period = 0, subject = '') =>
      ['attendance', 'period', classId, date, period, subject] as const,
    principal: (date = '') => ['attendance', 'principal', tenantScope(), date] as const,
    schoolLocation: ['attendance', 'schoolLocation', tenantScope()] as const,
    studentMonths: (studentId: string, classId = '') => ['attendance', 'studentMonths', studentId, classId] as const,
    advanced: (filters: import('./periodAttendanceAdvanced').PeriodAttendanceAdvancedFilters = {}) =>
      ['attendance', 'advanced', tenantScope(), filters] as const,
    classDaySummary: (classId: string, date: string) =>
      ['attendance', 'advancedClassDaySummary', tenantScope(), classId, date] as const,
    subjectSummaries: (classId: string, filters: { preset?: string; from?: string; to?: string } = {}) =>
      ['attendance', 'advancedSubjectSummaries', tenantScope(), classId, filters] as const,
    classStudents: (classId: string, filters: { from?: string; to?: string } = {}) =>
      ['attendance', 'advancedClassStudents', tenantScope(), classId, filters] as const,
    teacherSummaries: (filters: { preset?: string; from?: string; to?: string } = {}) =>
      ['attendance', 'advancedTeacherSummaries', tenantScope(), filters] as const,
    rangeSummary: (filters: import('./periodAttendanceAdvanced').PeriodAttendanceRangeFilters = {}) =>
      ['attendance', 'advancedRangeSummary', tenantScope(), filters] as const,
    dashboardTrend: (day: string) => ['attendance', 'dashboardTrend', tenantScope(), day] as const,
    audit: (recordId: string) => ['attendance', 'advancedAudit', tenantScope(), recordId] as const,
  },
  exams: {
    all: ['exams'] as const,
    papers: (examId: string) => ['exams', 'papers', examId] as const,
    grades: (paperId: string) => ['exams', 'grades', paperId] as const,
    studentGrades: (studentId: string) => ['exams', 'studentGrades', tenantScope(), studentId] as const,
    dashboardBands: (examId: string) => ['exams', 'dashboardBands', tenantScope(), examId] as const,
    letterGrades: (examId: string) => ['exams', 'letterGrades', tenantScope(), examId] as const,
  },
  crm: {
    peopleSnapshot: () => ['crm', 'dashboardPeople', tenantScope()] as const,
  },
  complaints: {
    all: ['complaints'] as const,
  },
  ptm: {
    all: ['ptm'] as const,
    list: (filters: import('./ptm').PtmFilters = {}) => ['ptm', 'list', tenantScope(), filters] as const,
  },
  issues: {
    all: ['issues'] as const,
    list: (status?: string) => ['issues', 'list', status ?? 'all'] as const,
    detail: (id: string) => ['issues', 'detail', id] as const,
  },
  tasks: {
    all: ['tasks'] as const,
    list: (filter: object = {}) => ['tasks', 'list', tenantScope(), filter] as const,
    pages: (filter: object = {}) => ['tasks', 'pages', tenantScope(), filter] as const,
    people: () => ['tasks', 'people', tenantScope()] as const,
    roles: () => ['tasks', 'roles', tenantScope()] as const,
  },
  threads: {
    all: ['threads'] as const,
    messages: (threadId: string) => ['threads', 'messages', threadId] as const,
  },
  announcements: {
    all: ['announcements'] as const,
  },
  assignments: {
    all: ['assignments'] as const,
  },
  feePayments: {
    all: ['feePayments'] as const,
  },
  feeHeads: { all: ['feeHeads'] as const },
  feeStructure: {
    all: ['feeStructure'] as const,
    history: ['feeStructure', 'history'] as const,
    version: (id: string) => ['feeStructure', 'version', id] as const,
  },
  feeInvoices: {
    all: ['feeInvoices'] as const,
    list: (opts: Record<string, string> = {}) => ['feeInvoices', 'list', opts] as const,
  },
  feeReports: {
    summary: ['feeReports', 'summary'] as const,
  },
  payroll: {
    salaryProfiles: ['payroll', 'salaryProfiles'] as const,
    salaryStructures: ['payroll', 'salaryStructures'] as const,
    runAll: ['payroll', 'run'] as const,
    run: (period: string) => ['payroll', 'run', period] as const,
    preview: (period: string) => ['payroll', 'preview', period] as const,
  },
  school: {
    integrations: ['school', 'integrations'] as const,
  },
  operations: {
    librarySummary: ['operations', 'library', 'summary'] as const,
    transportSummary: ['operations', 'transport', 'summary'] as const,
    transportFleet: ['operations', 'transport', 'fleet'] as const,
    transportBuses: ['operations', 'transport', 'buses'] as const,
    transportRoutes: ['operations', 'transport', 'routes'] as const,
    busStudents: (busId: string) => ['operations', 'transport', 'busStudents', busId] as const,
    travelingTeachers: (busId: string) => ['operations', 'transport', 'travelingTeachers', busId] as const,
    transportRouteStops: (routeId: string) => ['operations', 'transport', 'routeStops', routeId] as const,
    transportRouteGeometry: (routeId: string) => ['operations', 'transport', 'routeGeometry', routeId] as const,
    studentTransport: (studentId: string) => ['operations', 'transport', 'studentTransport', studentId] as const,
    transportStudentsList: (filters: import('./transport').TransportStudentsFilter = {}) =>
      ['operations', 'transport', 'studentsList', filters] as const,
    hostelSummary: ['operations', 'hostel', 'summary'] as const,
    hostelBlocks: ['operations', 'hostel', 'blocks'] as const,
    hostelRooms: ['operations', 'hostel', 'rooms'] as const,
    hostelResidents: ['operations', 'hostel', 'residents'] as const,
    sportsSummary: ['operations', 'sports', 'summary'] as const,
    sportsTeams: ['operations', 'sports', 'teams'] as const,
    sportsEvents: ['operations', 'sports', 'events'] as const,
    sportsMedals: ['operations', 'sports', 'medals'] as const,
  },
  owner: {
    dashboard: ['owner', 'dashboard'] as const,
    clients: (params: { status?: string; q?: string } = {}) => ['owner', 'clients', params] as const,
    mySchools: ['owner', 'mySchools'] as const,
    feeSummary: (params: { from?: string; to?: string } = {}) => ['owner', 'feeSummary', params] as const,
    plans: (isPlatform: boolean) => ['owner', 'plans', isPlatform] as const,
    upgradeRequests: ['owner', 'upgradeRequests'] as const,
  },
}
