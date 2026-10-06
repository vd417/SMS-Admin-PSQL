import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApprovalCard } from './dashboard'
import type { Approval } from '@/types'

const base: Approval = {
  id: 'SL', type: 'Leave Request', module: 'hr', cap: 'A',
  title: 'Leave — Asha (sick)', detail: 'Fever', requester: 'Asha (parent)',
  role: 'parent', amount: null, age: '2h', priority: 'medium',
  forRoles: ['admin', 'principal', 'vice_principal', 'teacher'], status: 'pending',
  student: { id: 'stu-1', name: 'Rahul Sharma', cls: 'Grade 5', section: 'A', roll: 12, adm: 'ADM-012' },
}

function noop() {}

describe('ApprovalCard student row', () => {
  it('shows the student name, class-section, roll and admission', () => {
    render(<ApprovalCard a={base} currency="INR" showActions={false}
      onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={noop} />)
    expect(screen.getByText(/Rahul Sharma/)).toBeInTheDocument()
    expect(screen.getByText(/Grade 5/)).toBeInTheDocument()
    expect(screen.getByText(/ADM-012/)).toBeInTheDocument()
  })

  it('opens the SIS profile when the student row is clicked', async () => {
    const onOpenStudent = vi.fn()
    render(<ApprovalCard a={base} currency="INR" showActions={false}
      onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={onOpenStudent} />)
    await userEvent.click(screen.getByRole('button', { name: /Rahul Sharma/ }))
    expect(onOpenStudent).toHaveBeenCalledWith('stu-1')
  })

  it('shows student text but no link when the viewer lacks SIS access', () => {
    render(<ApprovalCard a={base} currency="INR" showActions={false}
      onApprove={noop} onReject={noop} canOpenStudent={false} onOpenStudent={noop} />)
    expect(screen.getByText(/Rahul Sharma/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rahul Sharma/ })).toBeNull()
  })

  it('renders no student row for a staff self-leave', () => {
    const staff: Approval = { ...base, id: 'TL', student: undefined, title: 'Leave — Rajesh (casual)', requester: 'Rajesh' }
    render(<ApprovalCard a={staff} currency="INR" showActions={false}
      onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={noop} />)
    expect(screen.queryByText(/Roll/)).toBeNull()
    expect(screen.queryByText(/For student/)).toBeNull()
  })

  it('renders a clickable fallback label for a partial student', async () => {
    const onOpenStudent = vi.fn()
    const partial: Approval = { ...base, student: { id: 'stu-9' } }
    render(<ApprovalCard a={partial} currency="INR" showActions={false}
      onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={onOpenStudent} />)
    const btn = screen.getByRole('button', { name: /Student/ })
    expect(btn).toBeInTheDocument()
    await userEvent.click(btn)
    expect(onOpenStudent).toHaveBeenCalledWith('stu-9')
  })
})
