import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, fireEvent, within, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { examsScreens } from './exams'
import { exams as mockExams } from '@/data/mockDb'

const ExamsScreen = examsScreens['school.exams']

afterEach(cleanup)

// Map mock exams to wire shape (marksEntered → marks_entered_pct)
const wireExams = mockExams.map(({ marksEntered, ...rest }) => ({
  ...rest,
  marks_entered_pct: marksEntered,
}))

const wireExamSingle = { ...wireExams[0] }

// A live class + roster + teachers so the Marks entry / Exam attendance /
// Datesheet / Publish tabs have real data to render against (they all
// gate on classesQ/studentsQ/exam-papers being non-empty).
const wireClasses = [
  { id: 'c1', name: 'X-A', grade: 'X', section: 'A', subjects: ['English', 'Math'], room: '101' },
]
const wireTeachers = [
  { id: 't1', name: 'Ravi Sharma', department: 'Science', designation: 'Teacher', attendance_pct: 96 },
  { id: 't2', name: 'Meera Krishnan', department: 'English', designation: 'Teacher', attendance_pct: 97 },
]
const wireStudents = [
  { id: 's1', admission_no: 'A1', name: 'Aarav Shah', class_label: 'X-A', grade: 'X', section: 'A', roll: 1, gender: 'M' },
  { id: 's2', admission_no: 'A2', name: 'Diya Iyer', class_label: 'X-A', grade: 'X', section: 'A', roll: 2, gender: 'F' },
]

function examPaper(id: string, examId: string, subject: string, date: string) {
  return {
    id,
    exam_id: examId,
    class_id: 'c1',
    subject,
    date,
    start_time: '09:00',
    duration_min: 120,
    max_marks: 100,
    room: '101',
    invigilator_1: 't1',
    invigilator_2: 't2',
    status: 'scheduled',
  }
}
// Papers are scoped per-exam (isPaperInExamScope checks examId) — return the
// same 2-paper, 2-subject fixture for whichever exam is being queried.
function papersForExam(examId: string) {
  return [
    examPaper('p1', examId, 'English', '2026-09-08'),
    examPaper('p2', examId, 'Math', '2026-09-09'),
  ]
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function makeFetch() {
  return vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const method = (init?.method ?? (typeof input === 'string' ? 'GET' : (input as Request).method) ?? 'GET').toUpperCase()

    if (url.includes('/exam-papers') && /\/grades\b/.test(url)) {
      return Promise.resolve(jsonOk({ data: [], next_cursor: null }))
    }
    if (url.includes('/exam-papers') && /\/attendance\b/.test(url)) {
      if (method === 'POST') return Promise.resolve(jsonOk({ data: {} }))
      return Promise.resolve(jsonOk({ data: [] }))
    }
    if (url.includes('/exam-papers') && /\/notify-marks\b/.test(url)) {
      return Promise.resolve(jsonOk({ data: { parent_reach: 0, student_reach: 0, emails_sent: 0 } }))
    }
    if (url.includes('/exam-papers')) {
      // GET /exam-papers?exam_id=... (list) or POST /exam-papers (create) or PATCH /exam-papers/:id
      if (method === 'GET') {
        const examId = new URL(url, 'http://x').searchParams.get('exam_id') ?? wireExamSingle.id
        return Promise.resolve(jsonOk({ data: papersForExam(examId), next_cursor: null }))
      }
      return Promise.resolve(jsonOk({ data: papersForExam(wireExamSingle.id)[0] }))
    }
    if (url.includes('/grades')) {
      return Promise.resolve(jsonOk({ data: {} }))
    }
    if (/\/classes\/[^/?]+\/subjects/.test(url)) {
      return Promise.resolve(jsonOk({ data: { subjects: wireClasses[0].subjects } }))
    }
    if (url.includes('/classes')) {
      return Promise.resolve(jsonOk({ data: wireClasses, next_cursor: null }))
    }
    if (url.includes('/teachers')) {
      return Promise.resolve(jsonOk({ data: wireTeachers, next_cursor: null }))
    }
    if (url.includes('/students')) {
      return Promise.resolve(jsonOk({ data: wireStudents, next_cursor: null }))
    }
    if (url.includes('/exams') && !url.match(/\/exams\/[^?]+/)) {
      // GET /exams or POST /exams (collection endpoint)
      if (method === 'POST') {
        return Promise.resolve(jsonOk({ data: wireExamSingle }))
      }
      return Promise.resolve(jsonOk({ data: wireExams, next_cursor: null }))
    }
    if (url.includes('/exams/')) {
      // PATCH/PUT /exams/:id — return wrapped data
      return Promise.resolve(jsonOk({ data: wireExamSingle }))
    }
    // Safe default for anything else (announcements, notify, etc.) — never
    // the wrong shape for a list endpoint.
    return Promise.resolve(jsonOk({ data: [], next_cursor: null }))
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', makeFetch())
})

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const u = render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <ExamsScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
  const root = within(u.container)
  // Scope tab clicks to the tab bar: some labels (e.g. "Marks entry") also
  // appear as an exam status badge in the list.
  const tabBar = within(u.container.querySelector('.sm-tabs') as HTMLElement)
  const clickTab = (label: string) => fireEvent.click(tabBar.getByText(label))
  return { ...u, root, clickTab }
}

describe('Exam lifecycle', () => {
  it('creates an exam and fires a POST to /exams', async () => {
    const { container } = renderScreen()
    fireEvent.click(within(container).getByText('Create exam'))
    const dialog = within(container).getByRole('dialog')
    const nameInput = within(dialog).getByPlaceholderText(/Term 2 Examination/i)
    fireEvent.change(nameInput, { target: { value: 'Quarterly Test 2026' } })
    // Wait for classes to load — sections auto-select once classesQ resolves.
    await within(dialog).findByText('X-A')
    fireEvent.click(within(dialog).getByText('Create exam'))
    await waitFor(() => {
      const fetchMock = vi.mocked(globalThis.fetch)
      const calls = fetchMock.mock.calls
      const postCall = calls.find((args) => {
        const req = args[0]
        const init = args[1] as RequestInit | undefined
        const url = typeof req === 'string' ? req : req instanceof URL ? req.href : (req as Request).url
        const method = (init?.method ?? (typeof req === 'string' ? 'GET' : (req as Request).method) ?? 'GET').toUpperCase()
        return url.includes('/exams') && method === 'POST'
      })
      expect(postCall).toBeDefined()
    })
  })

  it('renders an exam selector on the Marks entry tab', async () => {
    const { root, clickTab } = renderScreen()
    clickTab('Marks Entry')
    await root.findByText('Save & notify parents')
    // Exam / Class / Paper selectors (marks themselves are number inputs, not selects).
    expect(root.getAllByRole('combobox').length).toBeGreaterThanOrEqual(3)
  })

  it('toggles and saves exam attendance', async () => {
    const { container, root, clickTab } = renderScreen()
    clickTab('Exam Attendance')
    await root.findByText('Save attendance')
    fireEvent.click(root.getAllByText('Absent')[0])
    fireEvent.click(root.getByText('Save attendance'))
    // Missing guardian contacts also raise an info toast ("... parent notify
    // failed"), so more than one element can match — assert at least one.
    await waitFor(() => {
      expect(within(container).getAllByText(/Attendance saved/i).length).toBeGreaterThan(0)
    })
  })

  it('publishes an exam and shows the send-via channels', async () => {
    // Default role is admin (E cap only) → the modal shows the channel
    // toggles and preview but not the A-gated "Publish & notify" action.
    const { container, root } = renderScreen()
    // Wait for the async exam list to load before clicking Publish
    const publishBtns = await root.findAllByText('Publish')
    fireEvent.click(publishBtns[0])
    const dialog = within(container).getByRole('dialog')
    expect(within(dialog).getByText(/Publish results|Send notify/i)).toBeInTheDocument()
    expect(within(dialog).getByText('Send via')).toBeInTheDocument()
    expect(within(dialog).getByText('Email')).toBeInTheDocument()
    expect(within(dialog).getByText('SMS')).toBeInTheDocument()
    expect(within(dialog).getByText('App')).toBeInTheDocument()
  })

  it('flags a duplicate subject in the datesheet and disables Save', async () => {
    const { container } = renderScreen()
    // Wait for the async exam list to load before clicking Datesheet
    const datesheetBtns = await within(container).findAllByText('Datesheet')
    // open the first exam's datesheet
    fireEvent.click(datesheetBtns[0])
    const dialog = within(container).getByRole('dialog')

    // Papers render collapsed; only one can be expanded at a time via "Edit".
    // Expand paper 1 to read its subject.
    await within(dialog).findAllByText('Edit')
    fireEvent.click(within(dialog).getAllByText('Edit')[0])
    const firstCombos = within(dialog).getAllByRole('combobox') as HTMLSelectElement[]
    const firstSubject = firstCombos[0].value

    // Expand paper 2 (expanding it collapses paper 1 — expandedId is single-valued)
    // and set its subject to match paper 1's → duplicate for the same class.
    fireEvent.click(within(dialog).getAllByText('Edit')[0])
    const secondCombos = within(dialog).getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(secondCombos[0], { target: { value: firstSubject } })

    expect(within(dialog).getByText(/allocated to two papers/i)).toBeInTheDocument()
    const saveBtn = within(dialog).getByText('Save').closest('button')
    expect(saveBtn).toBeDisabled()
  })
})
