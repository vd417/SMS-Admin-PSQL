/* ============================================================
   SchoolMate — Parent-Teacher Meetings (admin)
   Schedule, filter and cancel PTM meetings. GET/POST/DELETE /v1/ptm.
   ============================================================ */
import { useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can } from '@/lib/gating'
import {
  PageHead, Card, Btn, Badge, Select, Field, Input, Modal, Empty, DataTable,
  type Column, type BadgeTone,
} from '@/components/ui'
import { usePtm, useCreatePtm, useDeletePtm } from '@/api/hooks/usePtm'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStudents } from '@/api/hooks/useStudents'
import type { PtmItem, PtmStatus } from '@/api/ptm'

const STATUS_TONE: Record<PtmStatus, BadgeTone> = { pending: 'warning', confirmed: 'success' }
const STATUS_LABEL: Record<PtmStatus, string> = { pending: 'Pending', confirmed: 'Confirmed' }
const MODES = ['In person', 'Video call', 'Phone call']

type StatusFilter = 'all' | PtmStatus

interface CreateForm {
  studentId: string
  teacherId: string
  subject: string
  date: string
  time: string
  mode: string
}

const EMPTY_FORM: CreateForm = { studentId: '', teacherId: '', subject: '', date: '', time: '', mode: MODES[0] }

function PtmScreen() {
  const app = useApp()
  const toast = useToast()
  const editable = can(app.role, 'academics', 'E')

  const [status, setStatus] = useState<StatusFilter>('all')
  const [teacherId, setTeacherId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<PtmItem | null>(null)
  const [studentQuery, setStudentQuery] = useState('')

  const filters = useMemo(() => ({
    status: status === 'all' ? undefined : status,
    teacherId: teacherId || undefined,
    from: from || undefined,
    to: to || undefined,
  }), [status, teacherId, from, to])

  const { data: rows, isLoading, isError, error } = usePtm(filters)
  const { data: teachers } = useTeachers()
  const { data: students } = useStudents({ q: studentQuery })
  const createPtm = useCreatePtm()
  const deletePtm = useDeletePtm()

  const teacherOptions = (teachers ?? []).map((t) => ({ value: t.id, label: t.name }))
  const studentOptions = (students ?? []).map((s) => ({ value: s.id, label: s.name }))

  const openAdd = () => { setForm(EMPTY_FORM); setStudentQuery(''); setAddOpen(true) }

  const submit = () => {
    if (!form.studentId) { toast.danger('Student required', 'Pick the student for this meeting.'); return }
    if (!form.teacherId) { toast.danger('Teacher required', 'Pick the teacher for this meeting.'); return }
    if (!form.date) { toast.danger('Date required', 'Pick a meeting date.'); return }
    if (!form.time) { toast.danger('Time required', 'Pick a meeting time.'); return }
    createPtm.mutate(
      {
        studentId: form.studentId,
        teacherId: form.teacherId,
        subject: form.subject.trim() || undefined,
        date: form.date,
        time: form.time,
        mode: form.mode,
      },
      {
        onSuccess: () => { toast.success('Meeting scheduled', 'Parents can confirm it in the app.'); setAddOpen(false) },
        onError: (err) => toast.danger('Could not schedule', err instanceof Error ? err.message : 'Please try again.'),
      },
    )
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deletePtm.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success('Meeting cancelled', deleteTarget.studentName); setDeleteTarget(null) },
      onError: (err) => toast.danger('Could not cancel', err instanceof Error ? err.message : 'Please try again.'),
    })
  }

  const cols: Column<PtmItem>[] = [
    { key: 'date', label: 'Date', sortValue: (r) => r.date },
    { key: 'time', label: 'Time', sortValue: (r) => r.time },
    { key: 'studentName', label: 'Student', sortValue: (r) => r.studentName },
    { key: 'teacher', label: 'Teacher', sortValue: (r) => r.teacher },
    { key: 'subject', label: 'Subject', render: (r) => r.subject ?? '—' },
    { key: 'mode', label: 'Mode' },
    {
      key: 'status', label: 'Status',
      render: (r) => <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{STATUS_LABEL[r.status] ?? r.status}</Badge>,
    },
    ...(editable ? [{
      key: 'actions', label: '', align: 'right' as const,
      render: (r: PtmItem) => (
        <Btn size="sm" variant="ghost" icon="trash" aria-label="Cancel meeting" onClick={() => setDeleteTarget(r)} />
      ),
    }] : []),
  ]

  return (
    <div>
      <PageHead
        title="PTM"
        sub="Parent-teacher meetings across the school"
        actions={editable ? <Btn variant="primary" icon="plus" onClick={openAdd}>Schedule meeting</Btn> : undefined}
      />

      <Card style={{ marginBottom: 16 }}>
        <div className="row ai-center gap12 wrap">
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'confirmed', label: 'Confirmed' }]}
            />
          </Field>
          <Field label="Teacher">
            <Select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              options={[{ value: '', label: 'All teachers' }, ...teacherOptions]}
            />
          </Field>
          <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </Card>

      <Card pad={false}>
        <DataTable
          columns={cols}
          rows={rows ?? []}
          rowKey={(r) => r.id}
          empty={isLoading
            ? <Empty icon="users" title="Loading…" body="Fetching meetings." />
            : isError
              ? <Empty icon="alert" title="Could not load meetings" body={error instanceof Error ? error.message : 'Please try again.'} />
              : <Empty icon="users" title="No meetings" body="Nothing scheduled for these filters." />}
        />
      </Card>

      <Modal
        open={addOpen}
        onClose={() => { if (!createPtm.isPending) setAddOpen(false) }}
        size="sm"
        icon="users"
        title="Schedule meeting"
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" disabled={createPtm.isPending} onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" disabled={createPtm.isPending} onClick={submit}>
              {createPtm.isPending ? 'Scheduling…' : 'Schedule'}
            </Btn>
          </div>
        )}
      >
        <div className="col gap12">
          <Field label="Student" required>
            <Input
              placeholder="Search student…"
              value={studentQuery}
              onChange={(e) => setStudentQuery(e.target.value)}
            />
            <Select
              value={form.studentId}
              onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))}
              options={[{ value: '', label: 'Select student' }, ...studentOptions]}
            />
          </Field>
          <Field label="Teacher" required>
            <Select
              value={form.teacherId}
              onChange={(e) => setForm((f) => ({ ...f, teacherId: e.target.value }))}
              options={[{ value: '', label: 'Select teacher' }, ...teacherOptions]}
            />
          </Field>
          <Field label="Subject"><Input value={form.subject} placeholder="Optional" onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} /></Field>
          <div className="sm-grid-2 gap16">
            <Field label="Date" required><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Time" required><Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></Field>
          </div>
          <Field label="Mode">
            <Select value={form.mode} onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value }))} options={MODES} />
          </Field>
        </div>
      </Modal>

      {deleteTarget && (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          size="sm"
          icon="trash"
          title="Cancel this meeting?"
          sub={`${deleteTarget.studentName} · ${deleteTarget.teacher}`}
          footer={(
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={() => setDeleteTarget(null)}>Keep it</Btn>
              <Btn variant="danger" icon="trash" disabled={deletePtm.isPending} onClick={confirmDelete}>Cancel meeting</Btn>
            </div>
          )}
        >
          <div className="t-sm">This cannot be undone. The parent and teacher will no longer see this meeting.</div>
        </Modal>
      )}
    </div>
  )
}

export const ptmScreens: Record<string, ComponentType> = { 'school.ptm': PtmScreen }
