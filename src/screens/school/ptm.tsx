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
import { useClasses } from '@/api/hooks/useClasses'
import type { PtmItem, PtmStatus } from '@/api/ptm'

const STATUS_TONE: Record<PtmStatus, BadgeTone> = { pending: 'warning', confirmed: 'success' }
const STATUS_LABEL: Record<PtmStatus, string> = { pending: 'Pending', confirmed: 'Confirmed' }
const MODES = ['In person', 'Video call', 'Phone call']

type StatusFilter = 'all' | PtmStatus

type Scope = 'student' | 'section' | 'class' | 'all'
const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'student', label: 'One student' },
  { value: 'section', label: 'One class-section' },
  { value: 'class', label: 'Whole class (all sections)' },
  { value: 'all', label: 'All students' },
]

interface CreateForm {
  scope: Scope
  studentId: string
  grade: string
  section: string
  teacherId: string
  subject: string
  date: string
  time: string
  mode: string
  meetingLink: string
}

const EMPTY_FORM: CreateForm = {
  scope: 'student', studentId: '', grade: '', section: '',
  teacherId: '', subject: '', date: '', time: '', mode: MODES[0], meetingLink: '',
}

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
  const { data: roster } = useStudents()
  const { data: classes } = useClasses()
  const createPtm = useCreatePtm()
  const deletePtm = useDeletePtm()

  const teacherOptions = (teachers ?? []).map((t) => ({ value: t.id, label: t.name }))
  const studentOptions = (students ?? []).map((s) => ({ value: s.id, label: s.name }))

  // Grade/section with fallback to the class label (e.g. "IX-A") when the fields are blank.
  const gradeOf = (s: { grade?: string; cls?: string }) =>
    (s.grade || '').trim() || (s.cls || '').trim().split('-')[0] || ''
  const sectionOf = (s: { section?: string; cls?: string }) =>
    (s.section || '').trim() || (s.cls || '').trim().split('-').slice(1).join('-') || ''

  const activeRoster = useMemo(
    () => (roster ?? []).filter((s) => String(s.status ?? '').toLowerCase() !== 'inactive'),
    [roster],
  )
  // Grade/section options come from the classes CREATED in the school (Academics), so a class
  // with no students yet still appears. The bulk create still targets real students below.
  const classGradeOf = (c: { grade?: string; name?: string }) =>
    (c.grade || '').trim() || (c.name || '').trim().split('-')[0] || ''
  const classSectionOf = (c: { section?: string; name?: string }) =>
    (c.section || '').trim() || (c.name || '').trim().split('-').slice(1).join('-') || ''
  const gradeOptions = useMemo(
    () => [...new Set((classes ?? []).map(classGradeOf).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((g) => ({ value: g, label: g })),
    [classes],
  )
  const sectionOptions = useMemo(
    () => [...new Set((classes ?? []).filter((c) => classGradeOf(c) === form.grade).map(classSectionOf).filter(Boolean))]
      .sort()
      .map((sec) => ({ value: sec, label: sec })),
    [classes, form.grade],
  )
  /** Students the current scope will create a meeting for. */
  const scopeTargets = useMemo(() => {
    if (form.scope === 'all') return activeRoster
    if (form.scope === 'class') return form.grade ? activeRoster.filter((s) => gradeOf(s) === form.grade) : []
    if (form.scope === 'section') {
      if (!form.grade) return []
      const hasSections = sectionOptions.length > 0
      if (hasSections && !form.section) return []
      // When the class has no sections, section scope == the whole class.
      return activeRoster.filter((s) => gradeOf(s) === form.grade && (!hasSections || sectionOf(s) === form.section))
    }
    return []
  }, [form.scope, form.grade, form.section, activeRoster, sectionOptions])

  const openAdd = () => { setForm(EMPTY_FORM); setStudentQuery(''); setAddOpen(true) }

  const submit = () => {
    if (!form.teacherId) { toast.danger('Teacher required', 'Pick the teacher for this meeting.'); return }
    if (!form.date) { toast.danger('Date required', 'Pick a meeting date.'); return }
    if (!form.time) { toast.danger('Time required', 'Pick a meeting time.'); return }
    const isVideo = form.mode === 'Video call'
    if (isVideo && !form.meetingLink.trim()) { toast.danger('Meeting link required', 'Paste the video-call link for this meeting.'); return }

    // Resolve the student id(s) this schedule applies to, per the chosen scope.
    let targetIds: string[]
    if (form.scope === 'student') {
      if (!form.studentId) { toast.danger('Student required', 'Pick the student for this meeting.'); return }
      targetIds = [form.studentId]
    } else {
      if (form.scope !== 'all' && !form.grade) { toast.danger('Class required', 'Pick the class/grade.'); return }
      if (form.scope === 'section' && sectionOptions.length > 0 && !form.section) { toast.danger('Section required', 'Pick the section.'); return }
      targetIds = scopeTargets.map((s) => s.id)
      if (!targetIds.length) { toast.danger('No students', 'No active students match this selection.'); return }
    }

    const base = {
      teacherId: form.teacherId,
      subject: form.subject.trim() || undefined,
      date: form.date,
      time: form.time,
      mode: form.mode,
      meetingLink: isVideo ? form.meetingLink.trim() : undefined,
    }

    if (targetIds.length === 1) {
      createPtm.mutate(
        { ...base, studentId: targetIds[0] },
        {
          onSuccess: () => { toast.success('Meeting scheduled', 'Parents can confirm it in the app.'); setAddOpen(false) },
          onError: (err) => toast.danger('Could not schedule', err instanceof Error ? err.message : 'Please try again.'),
        },
      )
      return
    }

    // Bulk: one meeting per student, in parallel; report how many succeeded.
    void (async () => {
      const results = await Promise.allSettled(
        targetIds.map((studentId) => createPtm.mutateAsync({ ...base, studentId })),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      if (ok > 0) {
        toast.success('Meetings scheduled', `${ok} meeting(s) created${failed ? ` · ${failed} failed` : ''}. Parents can confirm in the app.`)
        setAddOpen(false)
      } else {
        toast.danger('Could not schedule', 'No meetings were created. Please try again.')
      }
    })()
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
    {
      key: 'mode', label: 'Mode', sortValue: (r) => r.mode,
      render: (r) => (
        <div>
          <div>{r.mode}</div>
          {r.meetingLink && (
            <a href={r.meetingLink} target="_blank" rel="noopener noreferrer" className="t-xs" style={{ color: 'var(--brand-600)' }}>
              Join link
            </a>
          )}
        </div>
      ),
    },
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
          <Field label="Schedule for">
            <Select
              value={form.scope}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as Scope }))}
              options={SCOPE_OPTIONS}
            />
          </Field>
          {form.scope === 'student' && (
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
          )}
          {(form.scope === 'section' || form.scope === 'class') && (
            <div className="sm-grid-2 gap16">
              <Field label="Class / grade" required>
                <Select
                  value={form.grade}
                  onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value, section: '' }))}
                  options={[{ value: '', label: 'Select class' }, ...gradeOptions]}
                />
              </Field>
              {form.scope === 'section' && sectionOptions.length > 0 && (
                <Field label="Section" required>
                  <Select
                    value={form.section}
                    onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
                    options={[{ value: '', label: 'Select section' }, ...sectionOptions]}
                  />
                </Field>
              )}
              {form.scope === 'section' && form.grade && sectionOptions.length === 0 && (
                <Field label="Section">
                  <div className="t-xs muted" style={{ paddingTop: 8 }}>This class has no sections — the whole class is selected.</div>
                </Field>
              )}
            </div>
          )}
          {form.scope !== 'student' && (
            <div className="t-xs muted">
              Creates one meeting for each of <span className="fw6">{scopeTargets.length}</span> active student{scopeTargets.length === 1 ? '' : 's'}
              {form.scope === 'all' ? ' (whole school)' : ''}.
            </div>
          )}
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
          {form.mode === 'Video call' && (
            <Field label="Meeting link" required hint="Paste the video-call link — parents/teacher see it in the app.">
              <Input
                value={form.meetingLink}
                placeholder="e.g. https://meet.google.com/abc-defg-hij"
                onChange={(e) => setForm((f) => ({ ...f, meetingLink: e.target.value }))}
              />
            </Field>
          )}
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
