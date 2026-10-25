import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as timetablePrint from '@/lib/timetablePrint'
import { render, fireEvent, within, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppProvider } from '@/context/AppProvider'
import { ToastProvider } from '@/context/ToastProvider'
import { academicsScreens } from './academics'
import { __resetTimetablePublishMemoryForTests } from '@/lib/academicsPublish'

const AcademicsScreen = academicsScreens['school.academics']

afterEach(cleanup)

beforeEach(() => {
  __resetTimetablePublishMemoryForTests()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], next_cursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
})

function renderScreen() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const u = render(
    <QueryClientProvider client={qc}>
      <AppProvider>
        <ToastProvider>
          <AcademicsScreen />
        </ToastProvider>
      </AppProvider>
    </QueryClientProvider>,
  )
  const tabBar = within(u.container.querySelector('.sm-tabs') as HTMLElement)
  const clickTab = (label: string) => fireEvent.click(tabBar.getByText(label))
  const seg = () => within(u.container.querySelector('.sm-seg') as HTMLElement)
  return { ...u, clickTab, seg }
}

describe('Timetable teacher/subject views', () => {
  it('offers Class / Teacher / Subject and shows the empty state before any class is built', async () => {
    const { container, clickTab, seg } = renderScreen()
    clickTab('Timetable')
    expect(seg().getByText('Class')).toBeInTheDocument()
    expect(seg().getByText('Teacher')).toBeInTheDocument()
    expect(seg().getByText('Subject')).toBeInTheDocument()
    fireEvent.click(seg().getByText('Teacher'))
    expect(await within(container).findByText(/Build class timetables in the Class view first/i)).toBeInTheDocument()
  })

  it('subject view also shows the empty state with nothing built', async () => {
    const { container, clickTab, seg } = renderScreen()
    clickTab('Timetable')
    fireEvent.click(seg().getByText('Subject'))
    expect(await within(container).findByText(/view them by subject/i)).toBeInTheDocument()
  })

  it('All classes overview shows the empty state with nothing built', async () => {
    const { container, clickTab, seg } = renderScreen()
    clickTab('Timetable')
    fireEvent.click(seg().getByText('All Classes'))
    expect(await within(container).findByText(/class-wise overview/i)).toBeInTheDocument()
  })

  it('opens a formatted print window for PDF export', async () => {
    const hasSpy = vi.spyOn(timetablePrint, 'hasPrintableTimetable').mockReturnValue(true)
    const exportSpy = vi.spyOn(timetablePrint, 'exportTimetablePdf').mockResolvedValue('printed')
    try {
      const { container, clickTab } = renderScreen()
      clickTab('Timetable')
      fireEvent.click(within(container).getByText('Save PDF'))
      expect(exportSpy).toHaveBeenCalledTimes(1)
      expect(exportSpy.mock.calls[0][0]).toMatchObject({ view: 'class' })
    } finally {
      hasSpy.mockRestore()
      exportSpy.mockRestore()
    }
  })

  it('shows a saved class timetable in Subject view instead of the empty state', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockImplementation((url: string) => {
      const u = String(url)
      const ok = { status: 200, headers: { 'Content-Type': 'application/json' } }
      if (u.includes('/timetable')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{
            id: 's1', day: 'Mon', period: 1, subject: 'Mathematics',
            class_name: 'IX-A', teacher_id: 't1', teacher_name: 'Meera Krishnan',
          }],
        }), ok))
      }
      if (u.includes('/classes')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{ id: 'c1', name: 'IX-A', grade: 'IX', section: 'A', teacher_id: 't1', students: 30, room: '1' }],
          next_cursor: null,
        }), ok))
      }
      if (u.includes('/subjects')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{ id: 'sub1', name: 'Mathematics' }],
          next_cursor: null,
        }), ok))
      }
      if (u.includes('/teachers')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [{ id: 't1', name: 'Meera Krishnan' }],
          next_cursor: null,
        }), ok))
      }
      return Promise.resolve(new Response(JSON.stringify({ data: [], next_cursor: null }), ok))
    })

    const { container, clickTab, seg } = renderScreen()
    clickTab('Timetable')
    fireEvent.click(seg().getByText('Subject'))
    expect(await within(container).findByText('IX-A', {}, { timeout: 20_000 })).toBeInTheDocument()
    expect(within(container).queryByText(/No timetables yet/i)).not.toBeInTheDocument()
  }, 25_000)
})
