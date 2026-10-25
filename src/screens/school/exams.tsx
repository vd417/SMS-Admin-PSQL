/* ============================================================
   SchoolMate — Exams & grading
   Live exams · datesheet (API) · marks (API grades) · report cards
   Notify parents via Email · SMS · App (same path as announcements).
   ============================================================ */
import { useEffect, useMemo, useState, useRef, Fragment, memo, startTransition, type ComponentType } from 'react'
import { useQueryClient, useQueries } from '@tanstack/react-query'
import { useApp, useToast } from '@/lib/hooks'
import { useExams, useCreateExam, useUpdateExam } from '@/api/hooks/useExams'
import { useExamPapers } from '@/api/hooks/useExamPapers'
import { useGrades, useUpsertGrade, useExamMarksMap } from '@/api/hooks/useGrades'
import { useStudents } from '@/api/hooks/useStudents'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useClasses, useClassNames } from '@/api/hooks/useClasses'
import {
  listExamPaperAttendance,
  saveExamPaperAttendance,
} from '@/api/examAttendance'
import { paperToSlot, slotToCreateInput, slotToUpdateInput, createExamPaper, updateExamPaper, deleteExamPaper, listExamPapers, notifyExamMarksPublished } from '@/api/examPapers'
import { queryKeys } from '@/api/queryKeys'
import { getClassSubjects, listClassSubjects } from '@/api/classSubjects'
import { useClassSubjectsMap } from '@/api/hooks/useClassSubjects'
import { notifyExamAudience } from '@/lib/examNotify'
import { groupExamTimetable, printExamTimetable, autoBuildExamSlots, buildExamPeriodGrid, examSubjectStyle, orderSubjectsBy, shuffleWithSeed, clampExamMaxMarks } from '@/lib/examTimetable'
import { can } from '@/lib/gating'
import { endTime, findClashes, markKey, examWindowFit } from '@/lib/examData'
import { countRealExamPapers, isDummyExamPaper, isOrphanExamPaper, isPaperInExamScope } from '@/lib/examPaperScope'
import { reportFor, classRank, gradeFor } from '@/lib/format'
import {
  compareClassesAscending,
  gradeRank,
  DEFAULT_GRADES,
  EXAM_CURRICULUM_TYPES,
  formatExamGradesLabel,
  parseExamGrades,
} from '@/lib/defaultClasses'
import type { ExamPaper } from '@/api/examPapers'
import {
  PageHead, Tabs, Card, CardHead, Btn, Badge, Select, Field, Input, Segmented,
  Modal, Drawer, Icon, Empty, Progress, Spinner, DataTable,
  type Column, type BadgeTone,
} from '@/components/ui'
import type { Exam, Student, PaperSlot } from '@/types'
import type { SchoolClass } from '@/api/classes'
import { SchoolMark } from '@/components/SchoolMark'
import { printReportCard } from '@/lib/reportCardPrint'
import { properName, properPlace } from '@/lib/properCase'

const statusTone: Record<Exam['status'], BadgeTone> = {
  scheduled: 'info', completed: 'success', marks_entry: 'warning', draft: 'neutral',
}
const statusLabel: Record<Exam['status'], string> = {
  scheduled: 'Scheduled', completed: 'Completed', marks_entry: 'Marks Entry', draft: 'Draft',
}
const fmtDate = (iso: string): string =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'

/** Two-step “are you sure?” before destructive timetable actions (delete / publish). */
function TwoStepConfirmModal({
  open,
  step,
  icon = 'alert',
  tone = 'warning',
  step1Title,
  step1Body,
  step2Title,
  step2Body,
  bullets,
  chips,
  chipsLabel,
  nextLabel = 'Continue',
  confirmLabel = 'Confirm',
  busy = false,
  onCancel,
  onBack,
  onNext,
  onConfirm,
}: {
  open: boolean
  step: 1 | 2
  icon?: string
  tone?: 'warning' | 'danger' | 'brand'
  step1Title: string
  step1Body: string
  step2Title: string
  step2Body: string
  bullets?: string[]
  /** Classes / items shown in the confirm (e.g. last exam class list). */
  chips?: string[]
  chipsLabel?: string
  nextLabel?: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onBack: () => void
  onNext: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  const title = step === 1 ? step1Title : step2Title
  const body = step === 1 ? step1Body : step2Body
  const confirmVariant = tone === 'danger' ? 'danger' : 'primary'
  const chipList = chips?.filter(Boolean) ?? []
  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onCancel}
      icon={icon}
      size="sm"
      title={title}
      sub={`Step ${step} of 2 · ${step === 1 ? 'Review' : 'Final confirm'}`}
      footer={
        <div className="row gap8 jc-between" style={{ width: '100%' }}>
          <Btn variant="ghost" disabled={busy} onClick={step === 2 ? onBack : onCancel}>
            {step === 2 ? 'Back' : 'Cancel'}
          </Btn>
          {step === 1 ? (
            <Btn variant="primary" onClick={onNext}>{nextLabel}</Btn>
          ) : (
            <Btn variant={confirmVariant} disabled={busy} onClick={onConfirm}>
              {busy ? 'Working…' : confirmLabel}
            </Btn>
          )}
        </div>
      }
    >
      <div className="col gap12">
        <div className="sm-exam-confirm-steps" aria-hidden>
          <span className={`sm-exam-confirm-dot${step >= 1 ? ' on' : ''}`}>1</span>
          <span className={`sm-exam-confirm-line${step >= 2 ? ' on' : ''}`} />
          <span className={`sm-exam-confirm-dot${step >= 2 ? ' on' : ''}`}>2</span>
        </div>
        <p className="t-sm" style={{ margin: 0, lineHeight: 1.45 }}>{body}</p>
        {!!chipList.length && (
          <div className="sm-exam-confirm-classes">
            <div className="t-xs muted fw6" style={{ marginBottom: 6 }}>
              {chipsLabel ?? `Classes · ${chipList.length}`}
            </div>
            <div className="row gap6 wrap">
              {chipList.map((c) => (
                <Badge key={c} tone="brand" soft>{c}</Badge>
              ))}
            </div>
          </div>
        )}
        {!!bullets?.length && (
          <ul className="sm-exam-confirm-bullets">
            {bullets.map((b) => <li key={b}>{b}</li>)}
          </ul>
        )}
        <div className="row gap6 wrap">
          <Badge tone={step === 1 ? 'warning' : 'danger'} soft>
            {step === 1 ? 'Check details' : 'Cannot undo after confirm'}
          </Badge>
        </div>
      </div>
    </Modal>
  )
}
const gradeTone = (g: string): BadgeTone =>
  g === 'A1' || g === 'A2' ? 'success' : g === 'B1' || g === 'B2' ? 'brand'
    : g === 'C1' || g === 'C2' ? 'info' : g === 'D' ? 'warning' : 'danger'

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isTempId(id: string): boolean {
  return id.startsWith('new-')
}

function classLabel(c: SchoolClass): string {
  return (c.name || `${c.grade}-${c.section}`).trim()
}

/* ============================================================
   Channel toggles — Email · SMS · App
   ============================================================ */
function ChannelToggles({
  email, sms, app, onEmail, onSms, onApp,
}: {
  email: boolean; sms: boolean; app: boolean
  onEmail: (v: boolean) => void; onSms: (v: boolean) => void; onApp: (v: boolean) => void
}) {
  return (
    <div className="row gap8 wrap">
      <Btn size="sm" variant={email ? 'primary' : 'secondary'} icon="message" onClick={() => onEmail(!email)}>Email</Btn>
      <Btn size="sm" variant={sms ? 'primary' : 'secondary'} icon="phone" onClick={() => onSms(!sms)}>SMS</Btn>
      <Btn size="sm" variant={app ? 'primary' : 'secondary'} icon="bell" onClick={() => onApp(!app)}>App</Btn>
    </div>
  )
}

/* ============================================================
   Auto-generate exam timetable — time-period sessions
   ============================================================ */
interface ExamClassOpt {
  value: string
  label: string
  grade: string
  section: string
}

interface ExamAutoModalProps {
  open: boolean
  onClose: () => void
  /** Real classes only, Nursery→XII order. */
  classes: ExamClassOpt[]
  defaultStart: string
  /** Exam window from Create exam — datesheet must stay inside. */
  windowFrom?: string
  windowTo?: string
  /** When true (default), open with every class ticked. */
  selectAllOnOpen?: boolean
  /** Pre-tick these class ids when the modal opens (e.g. datesheet class filter). */
  preselectClassIds?: string[]
  /** Preferred subject order from datesheet (manual). */
  initialSubjectOrder?: string[]
  /** How many real papers already on the datesheet (triggers 2-step delete confirm when Replace is on). */
  existingPaperCount?: number
  onApply: (slots: PaperSlot[], replace: boolean) => void
}

function ExamAutoModal({
  open, onClose, classes, defaultStart, windowFrom, windowTo,
  selectAllOnOpen = true, preselectClassIds, initialSubjectOrder, existingPaperCount = 0, onApply,
}: ExamAutoModalProps) {
  const toast = useToast()
  const classSubjectsMap = useClassSubjectsMap()
  const oneDay = !!(windowFrom && windowTo && windowFrom === windowTo)
  const [startDate, setStartDate] = useState(defaultStart)
  const [sessionMode, setSessionMode] = useState<'one' | 'two'>('two')
  const [morning, setMorning] = useState('09:30')
  const [afternoon, setAfternoon] = useState('13:30')
  const [duration, setDuration] = useState(180)
  const [gapDays, setGapDays] = useState(0)
  const [skipSunday, setSkipSunday] = useState(true)
  const [skipSaturday, setSkipSaturday] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [room, setRoom] = useState('')
  const [replace, setReplace] = useState(true)
  const [orderMode, setOrderMode] = useState<'auto' | 'manual' | 'random'>('manual')
  const [subjectOrder, setSubjectOrder] = useState<string[]>([])
  const [shuffleSeed, setShuffleSeed] = useState(1)
  /* Which subjects to actually generate. Empty = "all subjects" (multi-day default). */
  const [subjectPick, setSubjectPick] = useState<Set<string>>(new Set())
  /** Per-subject max marks when generating (e.g. Drawing 70, Maths 100). */
  const [subjectMaxMarks, setSubjectMaxMarks] = useState<Record<string, number>>({})
  /** Which Nursery–XII grade is open to show A/B/C sections. */
  const [focusGrade, setFocusGrade] = useState<string>('')
  const [deleteConfirmStep, setDeleteConfirmStep] = useState<0 | 1 | 2>(0)

  /* Reset only when the modal opens (not on every classes refetch). */
  useEffect(() => {
    if (!open) return
    /* 1-day test → always open on the exam From date. */
    const start = oneDay && windowFrom
      ? windowFrom
      : (windowFrom || defaultStart)
    setStartDate(start)
    /* A 1-day test only fits its sessions — default to a single exam that day. */
    setSessionMode(oneDay ? 'one' : 'two')
    setMorning('09:30'); setAfternoon('13:30')
    setDuration(180); setGapDays(0)
    setSkipSunday(true); setSkipSaturday(false)
    const pre = (preselectClassIds ?? []).filter((id) => classes.some((c) => c.value === id))
    if (pre.length) {
      setSelected(new Set(pre))
      const g = classes.find((c) => c.value === pre[0])?.grade ?? ''
      setFocusGrade(g)
    } else {
      setSelected(selectAllOnOpen ? new Set(classes.map((c) => c.value)) : new Set())
      const firstGrade = [...classes]
        .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade))[0]?.grade ?? ''
      setFocusGrade(firstGrade)
    }
    setRoom(''); setReplace(true)
    /* Manual by default so you can switch which subject is held first before generate. */
    setOrderMode('manual')
    setSubjectOrder(initialSubjectOrder?.length ? [...initialSubjectOrder] : [])
    setShuffleSeed(1)
    setSubjectPick(new Set())
    setSubjectMaxMarks({})
    setDeleteConfirmStep(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /* If classes load after open and nothing is selected yet, apply Select-all default. */
  useEffect(() => {
    if (!open || !selectAllOnOpen || !classes.length) return
    if (preselectClassIds?.length) return
    setSelected((prev) => (prev.size ? prev : new Set(classes.map((c) => c.value))))
  }, [open, selectAllOnOpen, classes, preselectClassIds])

  const sessions = sessionMode === 'two'
    ? [{ start: morning, label: 'Morning' }, { start: afternoon, label: 'Afternoon' }]
    : [{ start: morning, label: 'Session' }]

  const gradeGroups = useMemo(() => {
    const map = new Map<string, ExamClassOpt[]>()
    for (const c of classes) {
      const g = c.grade || c.label.split('-')[0] || 'Other'
      const list = map.get(g) ?? []
      list.push(c)
      map.set(g, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }))
    }
    return [...map.entries()].sort((a, b) => gradeRank(a[0]) - gradeRank(b[0]))
  }, [classes])

  const focusSections = useMemo(
    () => (focusGrade ? (gradeGroups.find(([g]) => g === focusGrade)?.[1] ?? []) : []),
    [gradeGroups, focusGrade],
  )

  const allSelected = classes.length > 0 && selected.size === classes.length
  const toggleClass = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(classes.map((c) => c.value)))
  const toggleGrade = (grade: string) => {
    const ids = (gradeGroups.find(([g]) => g === grade)?.[1] ?? []).map((c) => c.value)
    setFocusGrade(grade)
    setSelected((prev) => {
      const next = new Set(prev)
      const allOn = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }
  const selectAllSectionsInFocus = () => {
    const ids = focusSections.map((c) => c.value)
    setSelected((prev) => {
      const next = new Set(prev)
      const allOn = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  /* One timetable per selected class — never invent papers without a class. */
  const targets = useMemo(
    () => classes.filter((c) => selected.has(c.value)),
    [classes, selected],
  )

  /* Each class uses only subjects mapped in Academics (real data). Never catalog. */
  const classSubjectsByValue = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const c of classes) {
      m.set(c.value, getClassSubjects(c.value, c.label))
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classes, classSubjectsMap])

  const targetSubjects = useMemo(
    () => targets.map((c) => ({
      cls: c,
      subjects: classSubjectsByValue.get(c.value) ?? [],
    })),
    [targets, classSubjectsByValue],
  )

  /* Union of every selected class's subjects, in first-seen order — the pool the
     user can reorder. Manual order applies the same priority to every class. */
  const unionSubjects = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const { subjects: cs } of targetSubjects) {
      for (const s of cs) {
        if (!seen.has(s)) { seen.add(s); out.push(s) }
      }
    }
    return out
  }, [targetSubjects])

  /* Keep the manual order in sync with the available subjects: preserve the
     user's ordering for subjects still present, append any newly added ones. */
  useEffect(() => {
    setSubjectOrder((prev) => {
      const present = new Set(unionSubjects)
      const kept = prev.filter((s) => present.has(s))
      const keptSet = new Set(kept)
      const added = unionSubjects.filter((s) => !keptSet.has(s))
      const next = [...kept, ...added]
      if (next.length === prev.length && next.every((s, i) => s === prev[i])) return prev
      return next
    })
  }, [unionSubjects])

  const moveSubject = (index: number, dir: -1 | 1) => {
    setSubjectOrder((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }
  const subjectToTop = (index: number) => {
    setSubjectOrder((prev) => {
      if (index <= 0 || index >= prev.length) return prev
      const next = [...prev]
      const [s] = next.splice(index, 1)
      next.unshift(s)
      return next
    })
  }

  /* Global priority list applied to every class: manual = user drag order,
     random = seeded shuffle of the union, auto = each class's own order. */
  const randomOrder = useMemo(
    () => shuffleWithSeed(unionSubjects, shuffleSeed),
    [unionSubjects, shuffleSeed],
  )

  /* A 1-day test can only hold as many papers as it has sessions that day. */
  const sessionsPerDay = sessionMode === 'two' ? 2 : 1
  const capacity = oneDay ? sessionsPerDay : Infinity
  const subjectPickRequired = oneDay || subjectPick.size > 0

  /* Keep the subject picks valid: prune removed subjects; for a 1-day test,
     default to (and cap at) the first `capacity` subjects. */
  useEffect(() => {
    setSubjectPick((prev) => {
      const present = unionSubjects.filter((s) => prev.has(s))
      if (oneDay) {
        const base = present.length ? present : unionSubjects
        const next = base.slice(0, capacity)
        if (next.length === prev.size && next.every((s) => prev.has(s))) return prev
        return new Set(next)
      }
      if (present.length === prev.size) return prev
      return new Set(present)
    })
  }, [unionSubjects, oneDay, capacity])

  const toggleSubjectPick = (s: string) => {
    setSubjectPick((prev) => {
      const next = new Set(prev)
      if (next.has(s)) {
        next.delete(s)
      } else {
        if (oneDay && next.size >= capacity) {
          /* At capacity for a 1-day test — swap out the oldest pick. */
          const first = [...next][0]
          if (first !== undefined) next.delete(first)
        }
        next.add(s)
      }
      return next
    })
  }

  const preview = useMemo(() => {
    if (!targetSubjects.length || !startDate) return []
    const common = {
      startDate, sessions, duration, gapDays, skipSunday, skipSaturday, room,
      maxMarksBySubject: subjectMaxMarks,
    }
    const priority = orderMode === 'manual' ? subjectOrder : orderMode === 'random' ? randomOrder : null
    const pick = subjectPickRequired ? subjectPick : null
    return targetSubjects.flatMap(({ cls, subjects: classSubjects }) => {
      const filtered = pick ? classSubjects.filter((s) => pick.has(s)) : classSubjects
      if (!filtered.length) return []
      const ordered = priority ? orderSubjectsBy(filtered, priority) : filtered
      return autoBuildExamSlots({ ...common, subjects: ordered, classId: cls.value, className: cls.label })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSubjects, startDate, sessionMode, morning, afternoon, duration, gapDays, skipSunday, skipSaturday, room, orderMode, subjectOrder, randomOrder, subjectPick, subjectPickRequired, subjectMaxMarks])

  const classCount = targets.length
  const subjectCounts = targetSubjects.map((t) => t.subjects.length)
  const minSubjects = subjectCounts.length ? Math.min(...subjectCounts) : 0
  const maxSubjects = subjectCounts.length ? Math.max(...subjectCounts) : 0
  const sameSubjectCount = minSubjects === maxSubjects
  const papersPerClassLabel = sameSubjectCount ? `${maxSubjects}` : `${minSubjects}–${maxSubjects}`
  const lastDate = preview.length ? preview.reduce((mx, s) => (s.date > mx ? s.date : mx), preview[0].date) : ''
  /* Live: do the generated papers overrun the exam window? Shown as a banner + reused by the Generate guard. */
  const windowOverflow = useMemo(() => {
    if (!windowTo || !preview.length || lastDate <= windowTo) return null
    return oneDay
      ? `This is a 1-day test on ${fmtDate(windowFrom!)}. Too many subjects for ${sessionMode === 'two' ? '2' : '1'} exam(s)/day — reduce subjects or extend the To date.`
      : `Papers run until ${fmtDate(lastDate)} but the exam ends ${fmtDate(windowTo)}. Use 2 exams/day, reduce subjects, or extend To.`
  }, [windowTo, windowFrom, preview.length, lastDate, oneDay, sessionMode])
  const maxMarksSubjects = subjectPickRequired
    ? [...subjectPick]
    : unionSubjects
  const setSubjectMax = (subject: string, raw: string) => {
    const n = clampExamMaxMarks(raw, 100)
    setSubjectMaxMarks((prev) => ({ ...prev, [subject]: n }))
  }
  const applyMaxToAll = (n: number) => {
    const max = clampExamMaxMarks(n, 100)
    setSubjectMaxMarks((prev) => {
      const next = { ...prev }
      for (const s of maxMarksSubjects) next[s] = max
      return next
    })
  }

  const commitGenerate = () => {
    const now = Date.now()
    const slots: PaperSlot[] = preview.map((s, i) => ({
      id: `new-${now}-${i}`,
      classId: s.classId ?? null,
      className: s.className,
      subject: s.subject,
      date: s.date,
      start: s.start,
      duration: s.duration,
      room: s.room,
      inv1: '',
      inv2: '',
      maxMarks: clampExamMaxMarks(s.maxMarks, 100),
    }))
    setDeleteConfirmStep(0)
    onApply(slots, replace)
    toast.success(
      'Timetable ready',
      replace && existingPaperCount
        ? `${slots.length} new papers · previous ${existingPaperCount} removed · Save or Publish & notify.`
        : `${slots.length} papers · review datesheet, then Save or Publish & notify.`,
    )
    onClose()
  }

  const apply = () => {
    if (!unionSubjects.length) {
      toast.danger('No class subjects', 'Map subjects under Academics → Classes for the selected sections.'); return
    }
    if (!startDate) { toast.danger('Pick a start date', 'Choose when the exam begins.'); return }
    if (windowFrom && startDate < windowFrom) {
      toast.danger('Before exam window', `Start date cannot be before ${fmtDate(windowFrom)}.`); return
    }
    if (windowTo && startDate > windowTo) {
      toast.danger('After exam window', `Start date cannot be after ${fmtDate(windowTo)}.`); return
    }
    if (!classCount) { toast.danger('Pick classes', 'Select Nursery–XII classes for this exam.'); return }
    if (oneDay && subjectPick.size === 0) {
      toast.danger('Pick a subject', `A 1-day test needs ${capacity === 2 ? '1 or 2 subjects' : '1 subject'}. Select which subject(s) to test.`); return
    }
    if (oneDay && subjectPick.size > capacity) {
      toast.danger('Too many subjects', `Only ${capacity} exam${capacity > 1 ? 's' : ''} fit in a 1-day test. Remove some or extend the To date.`); return
    }
    if (!morning.trim()) { toast.danger('Morning time', 'Set the morning exam start time.'); return }
    if (sessionMode === 'two') {
      if (!afternoon.trim()) { toast.danger('Afternoon time', 'Set the afternoon exam start time.'); return }
      const toMin = (t: string) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim())
        return m ? Number(m[1]) * 60 + Number(m[2]) : 0
      }
      if (toMin(afternoon) <= toMin(morning)) {
        toast.danger('Invalid times', 'Afternoon must start after the morning exam.'); return
      }
    }
    if (!preview.length) { toast.danger('Nothing generated', 'Check the start date and sessions.'); return }
    if (windowOverflow) {
      toast.danger('Outside exam window', windowOverflow)
      return
    }
    /* Replace deletes the current timetable — confirm in 2 steps before generating. */
    if (replace && existingPaperCount > 0) {
      setDeleteConfirmStep(1)
      return
    }
    commitGenerate()
  }

  return (
    <>
    <Modal
      open={open} onClose={onClose} icon="sparkle" size="lg"
      title="Build datesheet"
      sub="Nursery–XII → A/B/C sections → subjects → arrange → Generate → Publish"
      footer={
        <div className="row gap8 ai-center jc-between" style={{ width: '100%' }}>
          <span className="t-xs muted">
            {classCount
              ? `${classCount} × ${papersPerClassLabel} = ${preview.length} papers`
              : 'Select at least one class'}
          </span>
          <div className="row gap8">
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" icon="sparkle" disabled={!preview.length} onClick={apply}>
              Generate{preview.length ? ` (${preview.length})` : ''}
            </Btn>
          </div>
        </div>
      }
    >
      <div className="col gap16">
        <div className="sm-exam-steps">
          <span className="sm-exam-step on">1 · Nursery–XII</span>
          <span className="sm-exam-step on">2 · Sections A/B/C</span>
          <span className="sm-exam-step on">3 · Subjects</span>
          <span className="sm-exam-step">4 · Generate</span>
        </div>

        {classes.length > 0 ? (
          <Field
            label="1 · Grades · Nursery → XII"
            required
            hint="Click a grade to open its A/B/C sections. Select all Nursery–XII or pick what you need."
          >
            <div className="col gap10">
              <div className="row ai-center jc-between wrap gap8">
                <span className="t-xs muted">
                  {selected.size
                    ? `${selected.size} section${selected.size === 1 ? '' : 's'} selected · ${papersPerClassLabel} subject${maxSubjects === 1 ? '' : 's'} each`
                    : 'Pick grades / sections for this exam'}
                </span>
                <Btn size="sm" variant={allSelected ? 'primary' : 'secondary'} icon={allSelected ? 'check' : 'layers'} onClick={toggleAll}>
                  {allSelected ? 'Clear all' : 'Select all Nursery–XII'}
                </Btn>
              </div>
              <div className="row gap6 wrap">
                {gradeGroups.map(([grade, rows]) => {
                  const on = rows.every((c) => selected.has(c.value))
                  const some = rows.some((c) => selected.has(c.value))
                  const focused = focusGrade === grade
                  return (
                    <Btn
                      key={grade}
                      size="sm"
                      variant={focused ? 'primary' : on ? 'secondary' : some ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setFocusGrade(grade)
                        /* First click focuses; second click on same grade toggles all sections. */
                        if (focused) toggleGrade(grade)
                      }}
                      title={`${grade} · ${rows.map((r) => r.section || '?').join(', ')}`}
                    >
                      {grade}{rows.length > 1 ? ` · ${rows.filter((r) => selected.has(r.value)).length}/${rows.length}` : ''}
                    </Btn>
                  )
                })}
              </div>
            </div>
          </Field>
        ) : (
          <Empty icon="users" title="No classes yet" body="Add Nursery–XII · A/B/C in Academics, map subjects, then open datesheet." />
        )}

        {focusGrade && focusSections.length > 0 && (
          <Field
            label={`2 · Sections for ${focusGrade} (A / B / C)`}
            required
            hint="Tick the sections to include. Each section keeps its own subject list."
          >
            <div className="col gap10">
              <div className="row ai-center jc-between wrap gap8">
                <span className="t-xs muted">
                  {focusSections.filter((c) => selected.has(c.value)).length} of {focusSections.length} sections
                </span>
                <Btn size="sm" variant="secondary" onClick={selectAllSectionsInFocus}>
                  {focusSections.every((c) => selected.has(c.value)) ? `Clear ${focusGrade}` : `All ${focusGrade} sections`}
                </Btn>
              </div>
              <div className="sm-exam-class-grid">
                {focusSections.map((c) => {
                  const n = classSubjectsByValue.get(c.value)?.length ?? 0
                  const sec = c.section || c.label.split('-').slice(1).join('-') || c.label
                  return (
                    <button
                      key={c.value}
                      type="button"
                      className={`sm-exam-class-chip${selected.has(c.value) ? ' on' : ''}`}
                      onClick={() => toggleClass(c.value)}
                      title={`${c.label} · ${n} subject${n === 1 ? '' : 's'}`}
                    >
                      {focusGrade}-{sec}{n ? ` · ${n} subj` : ' · 0 subj'}
                    </button>
                  )
                })}
              </div>
            </div>
          </Field>
        )}

        {targets.length > 0 && (
          <Field
            label="3 · Subjects per section"
            hint="Mapped in Academics · Classes. Arrange order below, then Generate."
          >
            <div className="sm-exam-class-subj-list" style={{ maxHeight: 240 }}>
              {targets.map((c) => {
                const subs = classSubjectsByValue.get(c.value) ?? []
                return (
                  <div key={c.value} className="sm-exam-class-subj-row">
                    <span className="fw6 t-sm">{c.label}</span>
                    {subs.length ? (
                      <div className="row gap6 wrap" style={{ marginTop: 4 }}>
                        {subs.map((s) => (
                          <Badge key={s} tone="brand" soft>{s}</Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="t-xs muted">No subjects — map them in Academics → Classes → Edit</span>
                    )}
                  </div>
                )
              })}
            </div>
          </Field>
        )}

        <div className="sm-grid-2 gap16">
          <Field
            label="Start date"
            required
            hint={oneDay
              ? 'Locked to exam From date (1-day test)'
              : windowFrom && windowTo
                ? `Must stay inside ${fmtDate(windowFrom)} – ${fmtDate(windowTo)}`
                : undefined}
          >
            <Input
              type="date"
              value={startDate}
              min={windowFrom || undefined}
              max={windowTo || undefined}
              disabled={oneDay}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Exams per day" hint="Same for every selected section">
            <Segmented
              value={sessionMode}
              onChange={(v) => setSessionMode(v as 'one' | 'two')}
              options={[
                { value: 'one', label: '1 exam / day' },
                { value: 'two', label: '2 exams / day' },
              ]}
            />
          </Field>
        </div>

        <Field
          label="Day gap between exam days"
          hint={gapDays === 0
            ? 'No day gap — papers continue the next working day'
            : gapDays === 1
              ? 'One free day between exam days'
              : 'Two free days between exam days'}
        >
          <Segmented
            value={String(gapDays)}
            onChange={(v) => setGapDays(Number(v))}
            options={[
              { value: '0', label: 'No day gap' },
              { value: '1', label: '1 day off' },
              { value: '2', label: '2 days off' },
            ]}
          />
        </Field>

        {windowOverflow && (
          <div
            className="row ai-start gap8"
            style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--warning-soft, #fffbeb)', border: '1px solid var(--warning, #f59e0b)' }}
          >
            <Icon name="alert" size={15} />
            <span className="t-sm">{windowOverflow}</span>
          </div>
        )}

        {classes.length > 0 && selected.size > 0 && unionSubjects.length === 0 && (
          <Field label="Subjects">
            <div className="t-sm muted">
              Selected section{selected.size > 1 ? 's have' : ' has'} no subjects mapped. Add subjects under Academics → Classes.
            </div>
          </Field>
        )}

        {unionSubjects.length > 0 && (
          <Field
            label={oneDay ? 'Subjects to test' : 'Subjects to include'}
            required={oneDay}
            hint={oneDay
              ? `1-day test — pick ${capacity === 2 ? 'up to 2 subjects' : '1 subject'} (${sessionMode === 'two' ? '2 exams/day' : '1 exam/day'})`
              : 'Tick the subjects to generate; untick to skip some'}
          >
            <div className="col gap8">
              <div className="row ai-center jc-between wrap gap8">
                <span className="t-xs muted">
                  {oneDay
                    ? `${subjectPick.size} of ${capacity} selected`
                    : `${subjectPick.size || unionSubjects.length} of ${unionSubjects.length} selected`}
                </span>
                {!oneDay && (
                  <Btn size="sm" variant="ghost"
                    onClick={() => setSubjectPick(subjectPick.size ? new Set() : new Set(unionSubjects))}>
                    {subjectPick.size ? 'Include all' : 'Choose specific'}
                  </Btn>
                )}
              </div>
              <div className="row gap6 wrap">
                {unionSubjects.map((s) => {
                  const on = subjectPickRequired ? subjectPick.has(s) : true
                  const atCap = oneDay && !on && subjectPick.size >= capacity
                  return (
                    <button
                      key={s}
                      type="button"
                      className={`sm-exam-class-chip${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleSubjectPick(s)}
                      title={atCap ? `Replaces the first pick (max ${capacity})` : s}
                    >
                      {s}
                    </button>
                  )
                })}
              </div>
              {oneDay && (
                <div className="t-xs muted">
                  Only these {subjectPick.size === 1 ? 'exam runs' : 'exams run'} on {fmtDate(startDate)}. For all subjects, extend the exam To date.
                </div>
              )}
            </div>
          </Field>
        )}

        {maxMarksSubjects.length > 0 && (
          <Field
            label="Max marks per subject"
            hint="Some papers can be out of 70, others out of 100 — saved on each paper"
          >
            <div className="col gap10">
              <div className="row ai-center gap8 wrap">
                <span className="t-xs muted">Apply to all:</span>
                {[50, 70, 80, 100].map((n) => (
                  <Btn key={n} size="sm" variant="ghost" onClick={() => applyMaxToAll(n)}>{n}</Btn>
                ))}
              </div>
              <div className="col gap8">
                {maxMarksSubjects.map((s) => (
                  <div key={s} className="row ai-center gap12 jc-between wrap">
                    <span className="fw6 t-sm" style={{ minWidth: 120 }}>{s}</span>
                    <div className="row ai-center gap8">
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={String(subjectMaxMarks[s] ?? 100)}
                        onChange={(e) => setSubjectMax(s, e.target.value)}
                        style={{ width: 88, textAlign: 'center' }}
                        aria-label={`${s} max marks`}
                      />
                      <span className="t-xs muted">max</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Field>
        )}

        {unionSubjects.length > 0 && (
          <Field
            label="4 · Arrange subjects — which is held first"
            hint={orderMode === 'auto'
              ? 'Auto: each section uses its Academics subject order'
              : orderMode === 'manual'
                ? 'Use Up / Down / Set 1st — then Generate papers for every selected section'
                : 'Random: Shuffle again for a new mix'}
          >
            <div className="col gap10">
              <div className="row ai-center jc-between wrap gap8">
                <Segmented
                  value={orderMode}
                  onChange={(v) => setOrderMode(v as 'auto' | 'manual' | 'random')}
                  options={[
                    { value: 'auto', label: 'Auto order' },
                    { value: 'manual', label: 'Manual order' },
                    { value: 'random', label: 'Random' },
                  ]}
                />
                {orderMode === 'random' && (
                  <Btn size="sm" variant="secondary" icon="refresh"
                    onClick={() => setShuffleSeed((s) => s + 1)}>
                    Shuffle again
                  </Btn>
                )}
              </div>
              {orderMode === 'manual' && (
                <ol className="sm-exam-order-list">
                  {subjectOrder.map((s, i) => (
                    <li key={s} className="sm-exam-order-row">
                      <span className="sm-exam-order-num">{i === 0 ? '1st' : i + 1}</span>
                      <span className="sm-exam-order-name">{s}</span>
                      <span className="row gap4">
                        <Btn size="sm" variant="secondary" icon="chevUp" disabled={i === 0}
                          onClick={() => moveSubject(i, -1)} title="Move earlier">Up</Btn>
                        <Btn size="sm" variant="secondary" icon="chevDown" disabled={i === subjectOrder.length - 1}
                          onClick={() => moveSubject(i, 1)} title="Move later">Down</Btn>
                        <Btn size="sm" variant="primary" icon="arrowUp" disabled={i === 0}
                          onClick={() => subjectToTop(i)} title="Make this the first exam">Set 1st</Btn>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {orderMode === 'random' && (
                <ol className="sm-exam-order-list">
                  {randomOrder.map((s, i) => (
                    <li key={s} className="sm-exam-order-row">
                      <span className="sm-exam-order-num">{i + 1}</span>
                      <span className="sm-exam-order-name">{s}</span>
                    </li>
                  ))}
                </ol>
              )}
              {orderMode !== 'auto' && (
                <div className="t-xs muted">
                  Applies to every selected class. A class that doesn't teach a subject simply skips it.
                </div>
              )}
            </div>
          </Field>
        )}

        <div className="sm-grid-2 gap16">
          <Field label="Morning start" required={sessionMode === 'two'} hint={sessionMode === 'one' ? 'Only session today' : 'First exam of the day'}>
            <Input type="time" value={morning} onChange={(e) => setMorning(e.target.value)} />
          </Field>
          {sessionMode === 'two' ? (
            <Field label="Afternoon start" required hint="Second exam of the day (max 2)">
              <Input type="time" value={afternoon} onChange={(e) => setAfternoon(e.target.value)} />
            </Field>
          ) : (
            <div />
          )}
          <Field label="Duration (min)">
            <Input type="number" min={1} value={String(duration)} onChange={(e) => setDuration(Math.max(1, Math.round(Number(e.target.value) || 0)))} />
          </Field>
          <Field label="Room / hall (optional)">
            <Input value={room} placeholder="e.g. Exam Hall" onChange={(e) => setRoom(e.target.value)} />
          </Field>
        </div>

        <div className="row gap8 wrap">
          <Btn size="sm" variant={skipSunday ? 'primary' : 'secondary'} onClick={() => setSkipSunday(!skipSunday)}>Skip Sundays</Btn>
          <Btn size="sm" variant={skipSaturday ? 'primary' : 'secondary'} onClick={() => setSkipSaturday(!skipSaturday)}>Skip Saturdays</Btn>
          <Btn size="sm" variant={replace ? 'primary' : 'secondary'} onClick={() => setReplace(!replace)}>
            {replace ? 'Replace existing papers' : 'Append to existing'}
          </Btn>
        </div>

        <div className="sm-exam-auto-preview">
          <div>
            <div className="t-xs muted3">Preview</div>
            <div className="t-sm fw6">
              {preview.length
                ? `${classCount} classes · ${papersPerClassLabel} subjects · ${sessionMode === 'two' ? `2/day (${morning} + ${afternoon})` : `1/day (${morning})`} · ${gapDays === 0 ? 'no day gap' : `${gapDays} day${gapDays > 1 ? 's' : ''} off`} · ${fmtDate(startDate)} → ${fmtDate(lastDate)}`
                : 'Pick classes to preview the timetable'}
            </div>
          </div>
          <Badge tone={preview.length ? 'success' : 'neutral'} soft>{preview.length} papers</Badge>
        </div>
      </div>
    </Modal>

    <TwoStepConfirmModal
      open={deleteConfirmStep > 0}
      step={deleteConfirmStep === 2 ? 2 : 1}
      icon="trash"
      tone="danger"
      step1Title="Delete current timetable?"
      step1Body={`Replace will remove the current datesheet and build a new one (${preview.length} paper${preview.length === 1 ? '' : 's'}).`}
      step2Title="Confirm delete & generate"
      step2Body="Last chance — the existing papers will be cleared from this datesheet. Click Save afterwards to write the new timetable."
      bullets={[
        `Remove ${existingPaperCount} existing paper${existingPaperCount === 1 ? '' : 's'}`,
        `Generate ${preview.length} new paper${preview.length === 1 ? '' : 's'}`,
        'Save datesheet to keep changes',
      ]}
      nextLabel="Yes, continue"
      confirmLabel="Delete & generate"
      onCancel={() => setDeleteConfirmStep(0)}
      onBack={() => setDeleteConfirmStep(1)}
      onNext={() => setDeleteConfirmStep(2)}
      onConfirm={commitGenerate}
    />
    </>
  )
}

/* ============================================================
   Create exam
   ============================================================ */
const EXAM_TYPE_PRESETS = ['Term', 'Unit Test', 'Periodic', 'Board Prep', 'Custom'] as const
const GRADE_PRESETS: { label: string; grades: readonly string[] }[] = [
  { label: 'All Nursery–XII', grades: DEFAULT_GRADES },
  { label: 'Pre-primary', grades: ['Nursery', 'LKG', 'UKG'] },
  { label: 'I–V', grades: ['I', 'II', 'III', 'IV', 'V'] },
  { label: 'VI–VIII', grades: ['VI', 'VII', 'VIII'] },
  { label: 'IX–X', grades: ['IX', 'X'] },
  { label: 'XI–XII', grades: ['XI', 'XII'] },
]

function CreateExamModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated?: (exam: Exam) => void
}) {
  const toast = useToast()
  const createExam = useCreateExam()
  const classesQ = useClasses()
  const [name, setName] = useState('')
  const [typePreset, setTypePreset] = useState<string>('Term')
  const [customType, setCustomType] = useState('')
  const [curriculum, setCurriculum] = useState<string>('CBSE')
  const [grades, setGrades] = useState<Set<string>>(() => new Set(DEFAULT_GRADES))
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set())
  const [from, setFrom] = useState(todayIso())
  const [to, setTo] = useState(todayIso())

  const classOpts = useMemo(() => {
    return [...(classesQ.data ?? [])]
      .filter((c) => c.id)
      .sort(compareClassesAscending)
      .map((c) => {
        const label = classLabel(c)
        return {
          value: c.id!,
          label,
          grade: c.grade || label.split('-')[0] || '',
          section: c.section || label.split('-').slice(1).join('-') || '',
        }
      })
  }, [classesQ.data])

  const sectionsInGrades = useMemo(
    () => classOpts.filter((c) => grades.has(c.grade) || grades.has(c.label.split('-')[0] || '')),
    [classOpts, grades],
  )

  const sectionsByGrade = useMemo(() => {
    const map = new Map<string, typeof sectionsInGrades>()
    for (const c of sectionsInGrades) {
      const g = c.grade || 'Other'
      const list = map.get(g) ?? []
      list.push(c)
      map.set(g, list)
    }
    return [...map.entries()].sort((a, b) => gradeRank(a[0]) - gradeRank(b[0]))
  }, [sectionsInGrades])

  useEffect(() => {
    if (!open) return
    setName('')
    setTypePreset('Term')
    setCustomType('')
    setCurriculum('CBSE')
    setGrades(new Set(DEFAULT_GRADES))
    setSelectedClassIds(new Set())
    setFrom(todayIso())
    setTo(todayIso())
  }, [open])

  /* When grades change, select every matching section (user can untick). */
  useEffect(() => {
    if (!open) return
    setSelectedClassIds(new Set(sectionsInGrades.map((c) => c.value)))
  }, [open, sectionsInGrades])

  const oneDay = from === to

  /* Largest mapped-subject count among selected sections — that class needs the most exam days. */
  const classSubjectsMap = useClassSubjectsMap()
  const maxSubjects = useMemo(() => {
    let mx = 0
    for (const c of classOpts) {
      if (!selectedClassIds.has(c.value)) continue
      const subs = classSubjectsMap[c.value]?.length ? classSubjectsMap[c.value] : (classSubjectsMap[c.label] ?? [])
      if (subs.length > mx) mx = subs.length
    }
    return mx
  }, [classOpts, selectedClassIds, classSubjectsMap])
  /* Approximate (assumes 1 exam/day, weekends not skipped) — the exact check lives in Build datesheet. */
  const windowFit = useMemo(() => examWindowFit(from, to, maxSubjects, 1), [from, to, maxSubjects])

  const changeFrom = (v: string) => {
    setFrom(v)
    setTo((prevTo) => (prevTo === from || !prevTo || prevTo < v ? v : prevTo))
  }
  const changeTo = (v: string) => {
    setTo(v < from ? from : v)
  }

  const allGradesOn = grades.size === DEFAULT_GRADES.length
  const gradesLabel = formatExamGradesLabel(grades, curriculum)
  const resolvedType = typePreset === 'Custom' ? customType.trim() : typePreset
  const allSectionsOn = sectionsInGrades.length > 0
    && sectionsInGrades.every((c) => selectedClassIds.has(c.value))

  const toggleGrade = (g: string) => {
    setGrades((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g)
      else next.add(g)
      return next
    })
  }

  const applyGradePreset = (preset: readonly string[]) => {
    setGrades(new Set(preset))
  }

  const toggleAllGrades = () => {
    setGrades(allGradesOn ? new Set() : new Set(DEFAULT_GRADES))
  }

  const toggleClass = (id: string) => {
    setSelectedClassIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllSections = () => {
    setSelectedClassIds(allSectionsOn
      ? new Set()
      : new Set(sectionsInGrades.map((c) => c.value)))
  }

  const toggleGradeSections = (grade: string) => {
    const ids = (sectionsByGrade.find(([g]) => g === grade)?.[1] ?? []).map((c) => c.value)
    setSelectedClassIds((prev) => {
      const next = new Set(prev)
      const allOn = ids.length > 0 && ids.every((id) => next.has(id))
      for (const id of ids) {
        if (allOn) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  const submit = () => {
    if (!name.trim()) { toast.danger('Name required', 'Please enter an exam name.'); return }
    if (typePreset === 'Custom' && !customType.trim()) {
      toast.danger('Type required', 'Enter a custom exam type, or pick a preset.'); return
    }
    if (!grades.size) { toast.danger('Pick grades', 'Select at least one grade (Nursery–XII).'); return }
    if (!selectedClassIds.size) {
      toast.danger('Pick sections', 'Select at least one class section for the datesheet.')
      return
    }
    if (to < from) { toast.danger('Invalid dates', 'End date cannot be before the start date.'); return }
    const exam: Exam = {
      id: '',
      name: name.trim(),
      type: resolvedType,
      grades: gradesLabel,
      classIds: [...selectedClassIds],
      from,
      to,
      subjects: 0, /* papers added on datesheet — not catalog subject count */
      status: 'scheduled',
      marksEntered: 0,
      published: false,
    }
    createExam.mutate(exam, {
      onSuccess: (created) => {
        const withClasses = { ...created, classIds: created.classIds ?? [...selectedClassIds] }
        toast.success(
          'Exam created',
          `${name} · ${gradesLabel} · ${withClasses.classIds?.length ?? 0} section${(withClasses.classIds?.length ?? 0) === 1 ? '' : 's'}`,
        )
        onClose()
        onCreated?.(withClasses)
      },
      onError: (err) => toast.danger('Could not create exam', err instanceof Error ? err.message : 'Please try again.'),
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} icon="clipboard" size="lg"
      title="Create exam / test" sub="Pick grades → sections → those classes open on the datesheet"
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="check" disabled={createExam.isPending} onClick={submit}>
            {createExam.isPending ? 'Creating…' : 'Create exam'}
          </Btn>
        </div>
      }
    >
      <div className="col gap16">
        <Field label="Exam name" required>
          <Input icon="clipboard" value={name} placeholder="e.g. Term 2 Examination" onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="sm-grid-2 gap16">
          <Field label="Exam type">
            <Select
              options={[...EXAM_TYPE_PRESETS]}
              value={typePreset}
              onChange={(e) => setTypePreset(e.target.value)}
            />
          </Field>
          <Field label="Curriculum type" hint="Board / scheme (CBSE, ICSE, State Board…)">
            <Select
              options={[...EXAM_CURRICULUM_TYPES]}
              value={curriculum}
              onChange={(e) => setCurriculum(e.target.value)}
            />
          </Field>
        </div>
        {typePreset === 'Custom' && (
          <Field label="Custom type" required>
            <Input value={customType} placeholder="e.g. Mid-term · Pre-board" onChange={(e) => setCustomType(e.target.value)} />
          </Field>
        )}
        <Field label="1 · Grades · Nursery → XII" required>
          <div className="col gap10">
            <div className="row ai-center jc-between wrap gap8">
              <span className="t-xs muted">
                {grades.size
                  ? `${grades.size} of ${DEFAULT_GRADES.length} · ${gradesLabel}`
                  : 'Select grades for this exam'}
              </span>
              <Btn size="sm" variant={allGradesOn ? 'primary' : 'secondary'} icon={allGradesOn ? 'check' : 'layers'} onClick={toggleAllGrades}>
                {allGradesOn ? 'Clear all' : 'Select all Nursery–XII'}
              </Btn>
            </div>
            <div className="row wrap gap8">
              {GRADE_PRESETS.map((p) => (
                <Btn key={p.label} size="sm" variant="ghost" onClick={() => applyGradePreset(p.grades)}>
                  {p.label}
                </Btn>
              ))}
            </div>
            <div className="sm-exam-class-grid" role="group" aria-label="Select grades">
              {DEFAULT_GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`sm-exam-class-chip${grades.has(g) ? ' on' : ''}`}
                  aria-pressed={grades.has(g)}
                  onClick={() => toggleGrade(g)}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        </Field>

        <Field
          label="2 · Class sections"
          required
          hint="Only these sections appear on the datesheet"
        >
          {sectionsInGrades.length === 0 ? (
            <div className="t-sm muted">
              {grades.size
                ? 'No classes for the selected grades — add them in Academics → Classes.'
                : 'Pick grades first, then choose A / B / C sections.'}
            </div>
          ) : (
            <div className="col gap10">
              <div className="row ai-center jc-between wrap gap8">
                <span className="t-xs muted">
                  {selectedClassIds.size} of {sectionsInGrades.length} section{sectionsInGrades.length === 1 ? '' : 's'} selected
                </span>
                <Btn size="sm" variant={allSectionsOn ? 'primary' : 'secondary'} onClick={toggleAllSections}>
                  {allSectionsOn ? 'Clear sections' : 'All sections in grades'}
                </Btn>
              </div>
              <div className="sm-exam-create-sections">
                {sectionsByGrade.map(([grade, rows]) => {
                  const onN = rows.filter((c) => selectedClassIds.has(c.value)).length
                  return (
                    <div key={grade} className="sm-exam-datesheet-grade-block">
                      <div className="sm-exam-datesheet-grade-head">
                        <span className="fw6">{grade}</span>
                        <Btn size="sm" variant="ghost" onClick={() => toggleGradeSections(grade)}>
                          {onN === rows.length ? `Clear ${grade}` : `All ${grade}`}
                        </Btn>
                      </div>
                      <div className="row gap8 wrap">
                        {rows.map((c) => {
                          const on = selectedClassIds.has(c.value)
                          const sec = c.section || '?'
                          return (
                            <button
                              key={c.value}
                              type="button"
                              className={`sm-exam-section-chip${on ? ' on' : ''}`}
                              aria-pressed={on}
                              onClick={() => toggleClass(c.value)}
                            >
                              <span className="sm-exam-section-label">{sec}</span>
                              <span className="sm-exam-section-meta">{c.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </Field>

        <div className="sm-grid-2 gap16">
          <Field label="From" required hint="Exam / test start date — datesheet opens from here">
            <Input type="date" value={from} onChange={(e) => changeFrom(e.target.value)} />
          </Field>
          <Field
            label="To"
            required
            hint={oneDay ? 'Same as From → 1-day test' : 'Last exam day'}
          >
            <Input type="date" value={to} min={from} onChange={(e) => changeTo(e.target.value)} />
          </Field>
        </div>
        {maxSubjects > 0 && !windowFit.fits && (
          <div
            className="row ai-start gap8"
            style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--warning-soft, #fffbeb)', border: '1px solid var(--warning, #f59e0b)' }}
          >
            <Icon name="alert" size={15} />
            <span className="t-sm">
              Selected classes have up to <span className="fw6">{maxSubjects} subjects</span>.{' '}
              {oneDay ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`} ({windowFit.windowDays} day{windowFit.windowDays === 1 ? '' : 's'})
              {' '}fits ~{windowFit.windowDays} exam{windowFit.windowDays === 1 ? '' : 's'} at 1/day — extend{' '}
              <span className="fw6">To</span> to about <span className="fw6">{fmtDate(windowFit.suggestedTo)}</span>,
              or plan 2 exams/day when building the datesheet.
            </span>
          </div>
        )}
        {oneDay && (
          <div className="row ai-center gap8" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <Badge tone="brand" soft>1-day test</Badge>
            <span className="t-sm muted">
              Datesheet and exam times will open on <span className="fw6">{fmtDate(from)}</span> only.
            </span>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ============================================================
   Datesheet drawer — API papers + notify Email / SMS / App
   ============================================================ */

type SelectOpt = { value: string; label: string }

const DatesheetPaperCard = memo(function DatesheetPaperCard({
  slot: s,
  index,
  expanded,
  canEdit,
  subjectOpts,
  classOptions,
  invigOptions,
  classNameOf,
  dummy,
  onExpand,
  onChange,
  onRemove,
}: {
  slot: PaperSlot
  index: number
  expanded: boolean
  canEdit: boolean
  /** Real subjects mapped to this paper's class (plus current value if orphaned). */
  subjectOpts: string[]
  classOptions: SelectOpt[]
  invigOptions: SelectOpt[]
  classNameOf: (id?: string | null) => string
  dummy?: boolean
  onExpand: (id: string) => void
  onChange: (id: string, patch: Partial<PaperSlot>) => void
  onRemove: (id: string) => void
}) {
  const subjectSelectOpts = subjectOpts.includes(s.subject) || !s.subject
    ? subjectOpts
    : [s.subject, ...subjectOpts]
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: expanded ? 14 : '10px 14px', opacity: dummy ? 0.85 : 1 }}>
      <div className="row ai-center jc-between" style={{ marginBottom: expanded ? 10 : 0 }}>
        <button
          type="button"
          className="row ai-center gap10"
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0 }}
          onClick={() => onExpand(s.id)}
        >
          <span className="sm-card-ic"><Icon name="book" size={16} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="fw6">{s.subject || '—'}</div>
            <div className="t-xs muted">
              {s.className ?? classNameOf(s.classId)} · {s.date ? fmtDate(s.date) : '—'} · {s.start} – {endTime(s.start, s.duration)}
              {` · /${clampExamMaxMarks(s.maxMarks, 100)}`}
              {s.room ? ` · Room ${s.room}` : ''}
            </div>
          </div>
        </button>
        <div className="row ai-center gap8">
          {dummy && <Badge tone="warning" soft>Old catalog</Badge>}
          <Badge tone="neutral">Paper {index + 1}</Badge>
          {canEdit && !expanded && (
            <Btn variant="secondary" size="sm" onClick={() => onExpand(s.id)}>Edit</Btn>
          )}
          {canEdit && <Btn variant="ghost" size="sm" onClick={() => onRemove(s.id)}>Remove</Btn>}
        </div>
      </div>
      {expanded && (
        <div className="sm-grid-3 gap12">
          <Field label="Subject">
            <Select
              options={subjectSelectOpts.length ? subjectSelectOpts : [s.subject || '—']}
              value={s.subject}
              disabled={!canEdit || !subjectSelectOpts.length}
              onChange={(e) => onChange(s.id, { subject: e.target.value })}
            />
          </Field>
          <Field label="Class">
            <Select
              options={classOptions}
              value={s.classId ?? ''}
              disabled={!canEdit}
              onChange={(e) => onChange(s.id, { classId: e.target.value || null })}
            />
          </Field>
          <Field label="Date">
            <Input type="date" value={s.date} disabled={!canEdit} onChange={(e) => onChange(s.id, { date: e.target.value })} />
          </Field>
          <Field label="Start time">
            <Input type="time" value={s.start} disabled={!canEdit} onChange={(e) => onChange(s.id, { start: e.target.value })} />
          </Field>
          <Field label="Duration (min)">
            <Input type="number" min={0} value={String(s.duration)} disabled={!canEdit} onChange={(e) => onChange(s.id, { duration: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
          </Field>
          <Field label="Max marks">
            <Input
              type="number"
              min={1}
              max={999}
              value={String(clampExamMaxMarks(s.maxMarks, 100))}
              disabled={!canEdit}
              onChange={(e) => onChange(s.id, { maxMarks: clampExamMaxMarks(e.target.value, 100) })}
            />
          </Field>
          <Field label="End time">
            <Input value={endTime(s.start, s.duration)} disabled />
          </Field>
          <Field label="Room / hall">
            <Input value={s.room} placeholder="e.g. Hall 1" disabled={!canEdit} onChange={(e) => onChange(s.id, { room: e.target.value })} />
          </Field>
          <Field label="Invigilator 1">
            <Select options={invigOptions} value={s.inv1} disabled={!canEdit} onChange={(e) => onChange(s.id, { inv1: e.target.value })} />
          </Field>
          <Field label="Invigilator 2">
            <Select options={invigOptions} value={s.inv2} disabled={!canEdit} onChange={(e) => onChange(s.id, { inv2: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  )
})

function DatesheetDrawer({ exam, onClose }: { exam: Exam | null; onClose: () => void }) {
  const toast = useToast()
  const app = useApp()
  const canPublish = can(app.role, 'exams', 'A')
  const canEdit = can(app.role, 'exams', 'E')
  const classesQ = useClasses()
  const teachersQ = useTeachers()
  const qc = useQueryClient()
  const papersQ = useExamPapers(exam?.id ?? null)
  const updateExam = useUpdateExam()

  const [slots, setSlots] = useState<PaperSlot[]>([])
  const [email, setEmail] = useState(true)
  const [sms, setSms] = useState(true)
  const [appCh, setAppCh] = useState(true)
  const [busy, setBusy] = useState(false)
  const [savePct, setSavePct] = useState(0)
  const [saveLabel, setSaveLabel] = useState('')
  const [autoOpen, setAutoOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [viewClassId, setViewClassId] = useState<string>('')
  const [viewSubjectOrder, setViewSubjectOrder] = useState<string[]>([])
  const [publishConfirmStep, setPublishConfirmStep] = useState<0 | 1 | 2>(0)
  const [clearConfirmStep, setClearConfirmStep] = useState<0 | 1 | 2>(0)
  const autoOpenedRef = useRef(false)
  const syncedPaperCountRef = useRef<string | null>(null)
  const purgedOrphansRef = useRef<string | null>(null)
  const classSubjectsMap = useClassSubjectsMap()

  useEffect(() => {
    if (!exam) {
      autoOpenedRef.current = false
      setViewClassId('')
      setViewSubjectOrder([])
      syncedPaperCountRef.current = null
      purgedOrphansRef.current = null
      setPublishConfirmStep(0)
      setClearConfirmStep(0)
      return
    }
    if (papersQ.data) {
      purgedOrphansRef.current = null
      setSlots(papersQ.data.map((p) => {
        const slot = paperToSlot(p)
        return { ...slot, className: classNameOf(slot.classId) }
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam, papersQ.data, classesQ.data])

  /* After create → open datesheet: jump straight into class/subject/order builder. */
  useEffect(() => {
    if (!exam || !canEdit || papersQ.isLoading || autoOpenedRef.current) return
    if ((papersQ.data?.length ?? 0) === 0 && slots.length === 0) {
      autoOpenedRef.current = true
      setAutoOpen(true)
    }
  }, [exam, canEdit, papersQ.isLoading, papersQ.data, slots.length])

  const teacherNames = useMemo(
    () => (teachersQ.data ?? []).map((t) => t.name).filter(Boolean),
    [teachersQ.data],
  )
  const invigOptions = useMemo(
    () => ['', ...teacherNames].map((t) => ({ value: t, label: t || '— Select —' })),
    [teacherNames],
  )
  const sortedClasses = useMemo(
    () => [...(classesQ.data ?? [])].filter((c) => c.id).sort(compareClassesAscending),
    [classesQ.data],
  )
  const classPickList = useMemo(
    () => sortedClasses.map((c) => ({
      value: c.id!,
      label: classLabel(c),
      grade: c.grade || classLabel(c).split('-')[0] || '',
      section: c.section || classLabel(c).split('-').slice(1).join('-') || '',
    })),
    [sortedClasses],
  )
  const classOptions = useMemo(
    () => [{ value: '', label: 'All classes' }, ...classPickList.map(({ value, label }) => ({ value, label }))],
    [classPickList],
  )
  const classNameOf = (id?: string | null) =>
    id ? classOptions.find((c) => c.value === id)?.label ?? 'Selected class' : 'All classes'

  /* Always show classes for this exam: selected sections if set, else grade range. */
  const examGrades = useMemo(() => new Set(parseExamGrades(exam?.grades)), [exam?.grades])
  const examClassIdSet = useMemo(() => {
    return new Set(exam?.classIds?.filter(Boolean) ?? [])
  }, [exam?.classIds])
  const datesheetClassList = useMemo(() => {
    if (examClassIdSet.size) {
      return classPickList.filter((c) => examClassIdSet.has(c.value))
    }
    if (!examGrades.size) return classPickList
    return classPickList.filter((c) =>
      examGrades.has(c.grade) || examGrades.has(c.label.split('-')[0] || ''),
    )
  }, [classPickList, examGrades, examClassIdSet])

  /* Paper edit / add: only classes inside this exam's grade range. */
  const datesheetClassOptions = useMemo(
    () => [{ value: '', label: 'Pick class' }, ...datesheetClassList.map(({ value, label }) => ({ value, label }))],
    [datesheetClassList],
  )

  const classGradeById = useMemo(
    () => new Map(classPickList.map((c) => [c.value, c.grade])),
    [classPickList],
  )

  const examScope = useMemo(
    () => ({
      grades: exam?.grades,
      classIds: examClassIdSet.size ? [...examClassIdSet] : exam?.classIds,
      examId: exam?.id,
    }),
    [exam?.grades, exam?.classIds, exam?.id, examClassIdSet],
  )

  const isInExamGrade = (s: PaperSlot): boolean =>
    isPaperInExamScope(
      { classId: s.classId, className: s.className ?? classNameOf(s.classId), subject: s.subject },
      examScope,
      classGradeById,
    )

  const autoClasses = useMemo(
    () => datesheetClassList,
    [datesheetClassList],
  )

  const datesheetGradeGroups = useMemo(() => {
    const map = new Map<string, typeof datesheetClassList>()
    for (const c of datesheetClassList) {
      const g = c.grade || c.label.split('-')[0] || 'Other'
      const list = map.get(g) ?? []
      list.push(c)
      map.set(g, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.section || '').localeCompare(b.section || '', undefined, { numeric: true }))
    }
    return [...map.entries()].sort((a, b) => gradeRank(a[0]) - gradeRank(b[0]))
  }, [datesheetClassList])

  const classSubjectCount = (classId: string, label: string) => getClassSubjects(classId, label).length

  /* Drop selection if the class is outside this exam's grades. */
  useEffect(() => {
    if (!viewClassId) return
    if (!datesheetClassList.some((c) => c.value === viewClassId)) setViewClassId('')
  }, [viewClassId, datesheetClassList])

  const viewClass = viewClassId ? classPickList.find((c) => c.value === viewClassId) : null
  const viewSubjects = useMemo(() => {
    if (!viewClass) return []
    return getClassSubjects(viewClass.value, viewClass.label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewClass, classSubjectsMap])

  /* Keep arrange-list in sync with the class map; preserve user order when possible. */
  useEffect(() => {
    setViewSubjectOrder((prev) => {
      if (!viewSubjects.length) return []
      const present = new Set(viewSubjects)
      const kept = prev.filter((s) => present.has(s))
      const keptSet = new Set(kept)
      const added = viewSubjects.filter((s) => !keptSet.has(s))
      const next = [...kept, ...added]
      if (next.length === prev.length && next.every((s, i) => s === prev[i])) return prev
      return next
    })
  }, [viewSubjects])

  const moveViewSubject = (index: number, dir: -1 | 1) => {
    setViewSubjectOrder((prev) => {
      const next = [...prev]
      const j = index + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }
  const viewSubjectToTop = (index: number) => {
    setViewSubjectOrder((prev) => {
      if (index <= 0 || index >= prev.length) return prev
      const next = [...prev]
      const [s] = next.splice(index, 1)
      next.unshift(s)
      return next
    })
  }

  const isDummyPaper = (s: PaperSlot): boolean =>
    isDummyExamPaper({ classId: s.classId, className: s.className ?? classNameOf(s.classId), subject: s.subject })

  const isOrphanPaper = (s: PaperSlot): boolean =>
    isOrphanExamPaper(
      { classId: s.classId, className: s.className ?? classNameOf(s.classId), subject: s.subject },
      examScope,
      classGradeById,
    )

  const realSlots = useMemo(
    () => slots.filter((s) => !isOrphanPaper(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, classSubjectsMap, examScope, classGradeById],
  )
  const outOfGradeSlots = useMemo(
    () => slots.filter((s) => !isDummyPaper(s) && !isInExamGrade(s)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slots, classSubjectsMap, examScope, classGradeById],
  )
  const dummyCount = slots.filter((s) => isDummyPaper(s)).length
  const orphanCount = slots.length - realSlots.length
  const examGradesLabel = useMemo(() => {
    const base = exam?.grades?.split('·')[0]?.trim() || 'exam grades'
    if (examClassIdSet.size) return `${base} · ${examClassIdSet.size} section${examClassIdSet.size === 1 ? '' : 's'}`
    return base
  }, [exam?.grades, examClassIdSet])

  /* Drop dummy / wrong-grade papers from the working set when datesheet loads. */
  useEffect(() => {
    if (!exam?.id || papersQ.isLoading || !papersQ.isSuccess) return
    if (purgedOrphansRef.current === exam.id) return
    const orphans = slots.filter((s) => isOrphanPaper(s))
    if (!orphans.length) {
      purgedOrphansRef.current = exam.id
      return
    }
    purgedOrphansRef.current = exam.id
    const kept = slots.filter((s) => !isOrphanPaper(s))
    startTransition(() => {
      setSlots(kept)
      setExpandedId(null)
    })
    toast.info(
      'Dummy papers removed',
      `${orphans.length} paper${orphans.length === 1 ? '' : 's'} outside ${examGradesLabel} or not mapped — Save datesheet to delete them.`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam?.id, papersQ.isLoading, papersQ.isSuccess, slots.length, classSubjectsMap, examScope])

  /* Fix stale "Papers" count (was catalog size at create). Sync once papers load. */
  useEffect(() => {
    if (!exam?.id || papersQ.isLoading || !papersQ.isSuccess) return
    const key = `${exam.id}:${realSlots.length}`
    if (syncedPaperCountRef.current === key) return
    if (exam.subjects === realSlots.length) {
      syncedPaperCountRef.current = key
      return
    }
    syncedPaperCountRef.current = key
    updateExam.mutate({ id: exam.id, patch: { subjects: realSlots.length } })
  }, [exam?.id, exam?.subjects, papersQ.isLoading, papersQ.isSuccess, realSlots.length, updateExam])

  const datesheetStats = useMemo(() => {
    let withSubjects = 0
    let withPapers = 0
    for (const c of datesheetClassList) {
      if (classSubjectCount(c.value, c.label) > 0) withSubjects += 1
      if (realSlots.some((s) => s.classId === c.value)) withPapers += 1
    }
    return { total: datesheetClassList.length, withSubjects, withPapers }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesheetClassList, realSlots, classSubjectsMap])

  const visibleSlots = useMemo(() => {
    return viewClassId ? realSlots.filter((s) => s.classId === viewClassId) : realSlots
  }, [realSlots, viewClassId])

  /* Classes that will be published (last exam class list with real papers). */
  const publishClassLabels = useMemo(() => {
    const ids = new Set(realSlots.map((s) => s.classId).filter(Boolean) as string[])
    const fromPapers = datesheetClassList.filter((c) => ids.has(c.value)).map((c) => c.label)
    if (fromPapers.length) return fromPapers
    return datesheetClassList.map((c) => c.label)
  }, [realSlots, datesheetClassList])

  const clearOrphanPapers = () => {
    const kept = slots.filter((s) => !isOrphanPaper(s))
    const removed = slots.length - kept.length
    if (!removed) {
      toast.info('Nothing to clear', `All papers are inside ${examGradesLabel} with mapped subjects.`)
      return
    }
    setClearConfirmStep(0)
    startTransition(() => {
      setSlots(kept)
      setExpandedId(null)
    })
    const outN = outOfGradeSlots.length
    toast.success(
      'Extra papers cleared',
      outN
        ? `${removed} removed (${outN} outside ${examGradesLabel}) — Save to persist.`
        : `${removed} paper${removed === 1 ? '' : 's'} cleared — Save to persist.`,
    )
  }

  const requestClearOrphans = () => {
    const n = slots.filter((s) => isOrphanPaper(s)).length
    if (!n) {
      toast.info('Nothing to clear', `All papers are inside ${examGradesLabel} with mapped subjects.`)
      return
    }
    setClearConfirmStep(1)
  }

  /* Refresh real subjects for the focused class (and any with papers) from API. */
  useEffect(() => {
    if (!exam) return
    const ids = new Set<string>()
    if (viewClassId) ids.add(viewClassId)
    for (const s of slots) if (s.classId) ids.add(s.classId)
    if (!ids.size) {
      for (const c of datesheetClassList.slice(0, 12)) ids.add(c.value)
    }
    let cancelled = false
    void (async () => {
      for (const id of ids) {
        if (cancelled) return
        try { await listClassSubjects(id) } catch { /* local map */ }
      }
    })()
    return () => { cancelled = true }
  }, [exam?.id, viewClassId, slots, datesheetClassList])

  const subjectsForPaper = (s: PaperSlot): string[] => {
    const mapped = getClassSubjects(s.classId, s.className ?? classNameOf(s.classId))
    if (mapped.length) return mapped
    return s.subject ? [s.subject] : []
  }

  const setSlot = (id: string, patch: Partial<PaperSlot>) =>
    startTransition(() => {
      setSlots((ss) => ss.map((s) => {
        if (s.id !== id) return s
        const next = {
          ...s,
          ...patch,
          className: patch.classId !== undefined ? classNameOf(patch.classId) : s.className,
        }
        /* When class changes, keep subject only if it belongs to the new class map. */
        if (patch.classId !== undefined) {
          const allowed = getClassSubjects(next.classId, next.className ?? '')
          if (allowed.length && next.subject && !allowed.includes(next.subject)) {
            next.subject = allowed[0]
          }
        }
        return next
      }))
    })
  const removePaper = (id: string) =>
    startTransition(() => {
      setSlots((ss) => ss.filter((s) => s.id !== id))
      setExpandedId((cur) => (cur === id ? null : cur))
    })
  const addPaper = () => {
    const id = `new-${Date.now()}`
    const oneDayExam = !!(exam?.from && exam.from === exam.to)
    const inList = viewClassId && datesheetClassList.some((c) => c.value === viewClassId)
    const classId = (inList ? viewClassId : null) || datesheetClassList[0]?.value || null
    const className = classId ? classNameOf(classId) : (datesheetClassList[0]?.label ?? '')
    const mapped = getClassSubjects(classId, className)
    if (!mapped.length) {
      toast.danger('No subjects for class', `Map subjects to ${className || 'a ' + examGradesLabel + ' class'} in Academics → Classes first.`)
      return
    }
    startTransition(() => {
      setSlots((ss) => {
        const last = ss.filter((p) => !classId || p.classId === classId).at(-1) ?? ss[ss.length - 1]
        const used = new Set(ss.filter((p) => p.classId === classId).map((p) => p.subject))
        const subj = mapped.find((s) => !used.has(s)) ?? mapped[0]
        const date = oneDayExam
          ? (exam!.from)
          : (last?.date ?? (exam?.from ?? todayIso()))
        return [...ss, {
          id,
          classId,
          className,
          subject: subj,
          date,
          start: '09:30',
          duration: 180,
          room: '',
          inv1: '',
          inv2: '',
          maxMarks: 100,
        }]
      })
      setExpandedId(id)
      if (classId) setViewClassId(classId)
    })
  }

  const applyAuto = (generated: PaperSlot[], replace: boolean) => {
    /* Never keep papers for classes outside this exam's grades. */
    const allowed = new Set(datesheetClassList.map((c) => c.value))
    const inRange = generated.filter((s) => !s.classId || allowed.has(s.classId))
    startTransition(() => {
      setSlots((ss) => (replace ? inRange : [...ss.filter((s) => !isOrphanPaper(s)), ...inRange]))
      setExpandedId(null)
    })
  }

  const clashes = useMemo(() => findClashes(realSlots), [realSlots])

  const persistSlots = async (): Promise<boolean> => {
    if (!exam || clashes.length) return false
    const existingIds = [...(papersQ.data ?? []).map((p) => p.id)]
    const keepIds = new Set(realSlots.filter((s) => !isTempId(s.id)).map((s) => s.id))
    const toDelete = existingIds.filter((id) => !keepIds.has(id))
    const total = toDelete.length + realSlots.length + 1 // +1 for exam patch
    let done = 0
    const tick = (label: string) => {
      done += 1
      setSaveLabel(label)
      setSavePct(Math.min(100, Math.round((100 * done) / Math.max(1, total))))
    }
    try {
      setSavePct(0)
      setSaveLabel('Preparing…')
      for (const id of toDelete) {
        await deleteExamPaper(id)
        tick(`Removing old papers… ${done}/${total}`)
      }
      for (let i = 0; i < realSlots.length; i++) {
        const s = realSlots[i]
        const n = i + 1
        if (isTempId(s.id)) {
          await createExamPaper(slotToCreateInput(exam.id, s))
          tick(`Saving papers… ${n}/${realSlots.length}`)
        } else {
          const current = (papersQ.data ?? []).find((p) => p.id === s.id)
          if ((current?.classId ?? null) !== (s.classId ?? null)) {
            await deleteExamPaper(s.id)
            await createExamPaper(slotToCreateInput(exam.id, s))
            tick(`Saving papers… ${n}/${realSlots.length}`)
          } else {
            await updateExamPaper(s.id, slotToUpdateInput(s))
            tick(`Updating papers… ${n}/${realSlots.length}`)
          }
        }
      }
      await updateExam.mutateAsync({
        id: exam.id,
        patch: { subjects: realSlots.length, status: 'scheduled' },
      })
      tick('Finishing…')
      await qc.invalidateQueries({ queryKey: queryKeys.exams.papers(exam.id) })
      await qc.invalidateQueries({ queryKey: queryKeys.exams.all })
      setSavePct(100)
      setSaveLabel('Done')
      return true
    } catch (err) {
      toast.danger('Could not save datesheet', err instanceof Error ? err.message : 'Please try again.')
      return false
    }
  }

  const save = async () => {
    if (!exam || clashes.length) return
    setBusy(true)
    const ok = await persistSlots()
    setBusy(false)
    setSavePct(0)
    setSaveLabel('')
    if (ok) toast.success('Datesheet saved', `${exam.name} · ${realSlots.length} real papers`)
  }

  const publish = async () => {
    if (!exam || clashes.length) return
    if (!email && !sms && !appCh) {
      toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.')
      return
    }
    setPublishConfirmStep(0)
    setBusy(true)
    const ok = await persistSlots()
    if (!ok) {
      setBusy(false)
      setSavePct(0)
      setSaveLabel('')
      return
    }
    try {
      setSaveLabel('Marking published…')
      setSavePct(96)
      await updateExam.mutateAsync({
        id: exam.id,
        patch: { published: true, status: 'scheduled', subjects: realSlots.length },
      })
      setSaveLabel('Notifying parents…')
      setSavePct(98)
      const res = await notifyExamAudience(
        exam, app.school.name, 'datesheet',
        { email, sms, app: appCh },
        'parents',
        { classLabels: publishClassLabels },
      )
      const bits = [
        email ? `${res.emails} email` : '',
        sms ? `${res.phones} SMS` : '',
        appCh ? 'app' : '',
      ].filter(Boolean)
      toast.success(
        'Datesheet published',
        `${exam.name} · ${publishClassLabels.length} class${publishClassLabels.length === 1 ? '' : 'es'} → ${bits.join(' · ')}`,
      )
      onClose()
    } catch (err) {
      toast.danger('Saved, but notify failed', err instanceof Error ? err.message : 'Try again from Publish.')
    } finally {
      setBusy(false)
      setSavePct(0)
      setSaveLabel('')
    }
  }

  const requestPublish = () => {
    if (!exam || clashes.length || busy) return
    if (!email && !sms && !appCh) {
      toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.')
      return
    }
    if (!realSlots.length) {
      toast.danger('No papers', 'Generate or add papers before publishing the timetable.')
      return
    }
    setPublishConfirmStep(1)
  }

  return (
    <Drawer
      open={!!exam} onClose={onClose} width={680} icon="calendar"
      title="Datesheet" sub={exam ? `${exam.name} · ${exam.grades} · ${realSlots.length} real papers` : ''}
      footer={
        <div className="col gap10" style={{ width: '100%' }}>
          <div className="row ai-center jc-between wrap gap8">
            <span className="t-xs muted">Notify on publish</span>
            <ChannelToggles email={email} sms={sms} app={appCh} onEmail={setEmail} onSms={setSms} onApp={setAppCh} />
          </div>
          <div className="row gap8 jc-between ai-center">
            <span className="t-xs muted">{clashes.length ? `${clashes.length} clash(es) to resolve` : 'No clashes'}</span>
            <div className="row gap8">
              <Btn variant="ghost" onClick={onClose} disabled={busy}>Close</Btn>
              {canEdit && (
                <Btn variant="secondary" icon="check" disabled={clashes.length > 0 || busy} onClick={() => void save()}>
                  {busy && savePct < 100 ? `Saving ${savePct}%` : 'Save'}
                </Btn>
              )}
              {canPublish && (
                <Btn variant="primary" icon="bell" disabled={clashes.length > 0 || busy} onClick={requestPublish}>
                  {busy ? (savePct >= 98 ? 'Sending…' : `Saving ${savePct}%`) : 'Publish & notify'}
                </Btn>
              )}
            </div>
          </div>
          {busy && (
            <div className="col gap6" style={{ width: '100%' }}>
              <div className="row ai-center jc-between">
                <span className="t-xs muted">{saveLabel || 'Working…'}</span>
                <span className="t-xs fw6">{savePct}%</span>
              </div>
              <Progress value={savePct} color="var(--brand-600)" height={8} />
            </div>
          )}
        </div>
      }
    >
      {busy && (
        <div className="sm-exam-save-overlay" aria-live="polite">
          <div className="sm-exam-save-card">
            <Spinner size={22} />
            <div className="t-sm fw6" style={{ marginTop: 10 }}>{saveLabel || 'Saving datesheet…'}</div>
            <div className="t-xs muted" style={{ marginTop: 4 }}>{savePct}% complete</div>
            <div style={{ width: '100%', marginTop: 12 }}><Progress value={savePct} height={10} /></div>
          </div>
        </div>
      )}
      {papersQ.isLoading && <div className="t-sm muted" style={{ marginBottom: 12 }}>Loading papers…</div>}
      {outOfGradeSlots.length > 0 && (
        <div className="row ai-start jc-between wrap gap8" style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'var(--warning-bg, rgba(217,119,6,.1))', color: 'var(--warning, #b45309)', border: '1px solid var(--warning, #f59e0b)' }}>
          <div className="row ai-start gap8">
            <Icon name="alert" size={16} />
            <span className="t-sm fw6">
              {outOfGradeSlots.length} paper{outOfGradeSlots.length === 1 ? '' : 's'} outside {examGradesLabel}
              {' '}(e.g. I / IV) — this exam only uses {examGradesLabel} classes
            </span>
          </div>
          {canEdit && (
            <Btn size="sm" variant="secondary" onClick={requestClearOrphans}>Clear extras</Btn>
          )}
        </div>
      )}
      {clashes.length > 0 && (
        <div className="row ai-start gap8" style={{ padding: '10px 12px', borderRadius: 10, marginBottom: 14, background: 'var(--danger-bg, rgba(220,38,38,.1))', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
          <Icon name="alert" size={16} />
          <span className="t-sm fw6">{clashes.join(' · ')}</span>
        </div>
      )}

      <div className="col gap12" style={{ marginBottom: 14 }}>
        <div className="row ai-center jc-between wrap gap8">
          <div>
            <div className="fw6">Classes</div>
            <div className="t-xs muted">
              {examGradesLabel} only · all sections open · {datesheetStats.withSubjects} ready
              {datesheetStats.withPapers ? ` · ${datesheetStats.withPapers} with papers` : ''}
              {datesheetStats.total - datesheetStats.withSubjects
                ? ` · ${datesheetStats.total - datesheetStats.withSubjects} need subjects in Academics`
                : ''}
            </div>
          </div>
          {canEdit && (
            <div className="row gap8 wrap">
              <Btn variant="primary" size="sm" icon="sparkle" disabled={busy} onClick={() => setAutoOpen(true)}>
                Auto generate
              </Btn>
              <Btn variant="secondary" size="sm" icon="plus" disabled={busy} onClick={addPaper}>
                Manual add
              </Btn>
            </div>
          )}
        </div>

        {datesheetClassList.length > 0 ? (
          <div className="sm-exam-datesheet-classes">
            <div className="sm-exam-datesheet-toolbar">
              <button
                type="button"
                className={`sm-exam-datesheet-all${!viewClassId ? ' on' : ''}`}
                onClick={() => setViewClassId('')}
              >
                <span className="fw6">All papers</span>
                <span className="sm-exam-datesheet-meta">{realSlots.length}</span>
              </button>
            </div>

            <div className="sm-exam-datesheet-all-grades">
              {datesheetGradeGroups.map(([grade, rows]) => {
                const ready = rows.filter((c) => classSubjectCount(c.value, c.label) > 0).length
                return (
                  <div key={grade} className="sm-exam-datesheet-grade-block">
                    <div className="sm-exam-datesheet-grade-head">
                      <span className="fw6">{grade}</span>
                      <span className="t-xs muted">
                        {ready}/{rows.length} ready
                      </span>
                    </div>
                    <div className="row gap8 wrap">
                      {rows.map((c) => {
                        const subjN = classSubjectCount(c.value, c.label)
                        const paperN = realSlots.filter((s) => s.classId === c.value).length
                        const sec = c.section || c.label.split('-').slice(1).join('-') || c.label
                        const on = viewClassId === c.value
                        return (
                          <button
                            key={c.value}
                            type="button"
                            className={`sm-exam-section-chip${on ? ' on' : ''}${subjN ? ' ready' : ' empty'}`}
                            onClick={() => setViewClassId(c.value)}
                            title={`${c.label}${subjN ? ` · ${subjN} subjects` : ' · map subjects in Academics'}${paperN ? ` · ${paperN} papers` : ''}`}
                          >
                            <span className="sm-exam-section-label">{sec}</span>
                            {subjN > 0 ? (
                              <span className="sm-exam-section-meta">{subjN} subj{paperN ? ` · ${paperN}p` : ''}</span>
                            ) : (
                              <span className="sm-exam-section-meta muted">no subjects</span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="t-sm muted">No classes yet — add Nursery–XII · A/B/C in Academics.</div>
        )}

        {viewClass && (
          <div className="sm-exam-class-subj-list">
            <div className="row ai-center jc-between wrap gap8" style={{ marginBottom: 6 }}>
              <div>
                <div className="fw6 t-sm">{viewClass.label} · subjects</div>
                <div className="t-xs muted">
                  Real subjects from Academics · #1 is held first · then Generate
                </div>
              </div>
              {canEdit && viewSubjectOrder.length > 0 && (
                <Btn size="sm" variant="primary" icon="sparkle" onClick={() => setAutoOpen(true)}>
                  Generate with this order
                </Btn>
              )}
            </div>
            {viewSubjectOrder.length ? (
              <ol className="sm-exam-order-list">
                {viewSubjectOrder.map((s, i) => (
                  <li key={s} className="sm-exam-order-row">
                    <span className="sm-exam-order-num">{i === 0 ? '1st' : i + 1}</span>
                    <span className="sm-exam-order-name">{s}</span>
                    {canEdit && (
                      <span className="row gap4">
                        <Btn size="sm" variant="secondary" icon="chevUp" disabled={i === 0}
                          onClick={() => moveViewSubject(i, -1)} title="Move earlier">Up</Btn>
                        <Btn size="sm" variant="secondary" icon="chevDown" disabled={i === viewSubjectOrder.length - 1}
                          onClick={() => moveViewSubject(i, 1)} title="Move later">Down</Btn>
                        <Btn size="sm" variant="primary" icon="arrowUp" disabled={i === 0}
                          onClick={() => viewSubjectToTop(i)} title="Hold first">Set 1st</Btn>
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <span className="t-xs muted">No subjects mapped for this class — edit in Academics → Classes.</span>
            )}
          </div>
        )}
      </div>

      <div className="row ai-center jc-between" style={{ marginBottom: 12 }}>
        <span className="t-sm muted">
          {viewClassId
            ? `${visibleSlots.length} paper${visibleSlots.length === 1 ? '' : 's'} · ${viewClass?.label ?? ''}`
            : `${realSlots.length} real paper${realSlots.length === 1 ? '' : 's'} · pick a class above to filter`}
        </span>
      </div>

      {!realSlots.length && !papersQ.isLoading ? (
        <Empty
          icon="calendar"
          title={orphanCount ? 'No papers for this exam range' : 'Build the datesheet'}
          body={outOfGradeSlots.length
            ? `${outOfGradeSlots.length} paper${outOfGradeSlots.length === 1 ? '' : 's'} are for other grades. Clear them, then Auto generate for ${examGradesLabel}.`
            : dummyCount
              ? 'Old catalog papers are ignored. Map subjects to VI–X classes in Academics, then Auto generate.'
              : `Open Auto generate → pick ${examGradesLabel} sections → subjects → arrange → Generate.`}
          action={canEdit ? (
            <div className="row gap8 jc-center wrap">
              <Btn variant="primary" icon="sparkle" onClick={() => setAutoOpen(true)}>Auto generate</Btn>
              {orphanCount > 0 && <Btn variant="secondary" onClick={requestClearOrphans}>Clear extras</Btn>}
              <Btn variant="secondary" icon="plus" onClick={addPaper}>Manual add</Btn>
            </div>
          ) : undefined}
        />
      ) : !visibleSlots.length ? (
        <Empty
          icon="book"
          title={viewClass ? `No papers for ${viewClass.label}` : 'No papers'}
          body={`Only ${examGradesLabel} classes count. Map subjects in Academics, then Auto generate.`}
          action={canEdit ? (
            <div className="row gap8 jc-center wrap">
              {orphanCount > 0 && (
                <Btn variant="secondary" onClick={requestClearOrphans}>Clear extras</Btn>
              )}
              <Btn variant="primary" icon="sparkle" onClick={() => setAutoOpen(true)}>Auto generate</Btn>
            </div>
          ) : undefined}
        />
      ) : (
        <div className="col gap12">
          {visibleSlots.map((s, i) => (
            <DatesheetPaperCard
              key={s.id}
              slot={s}
              index={i}
              expanded={expandedId === s.id || (visibleSlots.length === 1 && expandedId === null)}
              canEdit={canEdit}
              subjectOpts={subjectsForPaper(s)}
              classOptions={datesheetClassOptions}
              invigOptions={invigOptions}
              classNameOf={classNameOf}
              dummy={isDummyPaper(s)}
              onExpand={setExpandedId}
              onChange={setSlot}
              onRemove={removePaper}
            />
          ))}
        </div>
      )}

      {autoOpen && (
        <ExamAutoModal
          open={autoOpen}
          onClose={() => setAutoOpen(false)}
          classes={autoClasses}
          defaultStart={exam?.from || slots[0]?.date || todayIso()}
          windowFrom={exam?.from || undefined}
          windowTo={exam?.to || undefined}
          selectAllOnOpen={false}
          preselectClassIds={viewClassId ? [viewClassId] : undefined}
          initialSubjectOrder={viewClassId ? viewSubjectOrder : undefined}
          existingPaperCount={realSlots.length}
          onApply={applyAuto}
        />
      )}

      <TwoStepConfirmModal
        open={publishConfirmStep > 0}
        step={publishConfirmStep === 2 ? 2 : 1}
        icon="bell"
        tone="brand"
        step1Title="Publish exam timetable?"
        step1Body={`Parents will receive the datesheet for ${exam?.name ?? 'this exam'}. Review the class list below.`}
        step2Title="Confirm publish & notify"
        step2Body="Final step — save papers, mark published, and notify parents for these classes."
        chips={publishClassLabels}
        chipsLabel={`Classes to publish · ${publishClassLabels.length}`}
        bullets={[
          `Save ${realSlots.length} paper${realSlots.length === 1 ? '' : 's'}`,
          `Notify via ${[email && 'Email', sms && 'SMS', appCh && 'App'].filter(Boolean).join(' · ') || 'no channel'}`,
          `${publishClassLabels.length} class${publishClassLabels.length === 1 ? '' : 'es'} on this exam`,
        ]}
        nextLabel="Yes, continue"
        confirmLabel="Publish & notify"
        busy={busy}
        onCancel={() => setPublishConfirmStep(0)}
        onBack={() => setPublishConfirmStep(1)}
        onNext={() => setPublishConfirmStep(2)}
        onConfirm={() => void publish()}
      />

      <TwoStepConfirmModal
        open={clearConfirmStep > 0}
        step={clearConfirmStep === 2 ? 2 : 1}
        icon="trash"
        tone="danger"
        step1Title="Clear dummy / extra papers?"
        step1Body={`${orphanCount} paper${orphanCount === 1 ? '' : 's'} are outside ${examGradesLabel} or not mapped to class subjects.`}
        step2Title="Confirm clear extras"
        step2Body="They will be removed from this datesheet. Save to delete them permanently."
        bullets={[
          `${orphanCount} paper${orphanCount === 1 ? '' : 's'} will be removed`,
          'Real in-scope papers stay',
          'Save datesheet to persist',
        ]}
        nextLabel="Yes, continue"
        confirmLabel="Clear extras"
        onCancel={() => setClearConfirmStep(0)}
        onBack={() => setClearConfirmStep(1)}
        onNext={() => setClearConfirmStep(2)}
        onConfirm={clearOrphanPapers}
      />
    </Drawer>
  )
}

/* ============================================================
   Tab 1 — Exams list
   ============================================================ */
function ExamsListTab({ onDatesheet, onPublish }: { onDatesheet: (e: Exam) => void; onPublish: (e: Exam) => void }) {
  const app = useApp()
  const { data: examsData, isLoading } = useExams()
  const exams = examsData ?? []
  const [createOpen, setCreateOpen] = useState(false)
  const editable = can(app.role, 'exams', 'E') || can(app.role, 'exams', 'A')
  const classesQ = useClasses()
  const updateExam = useUpdateExam()
  const classSubjectsMap = useClassSubjectsMap()

  const classLabelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of classesQ.data ?? []) {
      if (!c.id) continue
      m.set(c.id, classLabel(c))
    }
    return m
  }, [classesQ.data])

  const classGradeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of classesQ.data ?? []) {
      if (!c.id) continue
      const label = classLabel(c)
      m.set(c.id, c.grade || label.split('-')[0] || '')
    }
    return m
  }, [classesQ.data])

  const paperQueries = useQueries({
    queries: exams.map((e) => ({
      queryKey: queryKeys.exams.papers(e.id),
      queryFn: () => listExamPapers(e.id),
      enabled: !!e.id,
      staleTime: 30_000,
    })),
  })

  const realPaperCountByExam = useMemo(() => {
    const out: Record<string, number> = {}
    exams.forEach((e, i) => {
      const papers = paperQueries[i]?.data
      if (!papers) return
      out[e.id] = countRealExamPapers(
        papers.map((p) => ({
          classId: p.classId,
          className: p.classId ? (classLabelById.get(p.classId) ?? '') : '',
          subject: p.subject,
        })),
        { grades: e.grades, classIds: e.classIds, examId: e.id },
        classGradeById,
      )
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exams, paperQueries, classGradeById, classLabelById, classSubjectsMap])

  /* Sync stale subject_count (catalog "14") to real datesheet papers. */
  const syncedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const e of exams) {
      const real = realPaperCountByExam[e.id]
      if (real === undefined) continue
      const key = `${e.id}:${real}`
      if (syncedRef.current.has(key)) continue
      if (e.subjects === real) {
        syncedRef.current.add(key)
        continue
      }
      syncedRef.current.add(key)
      updateExam.mutate({ id: e.id, patch: { subjects: real } })
    }
  }, [exams, realPaperCountByExam, updateExam])

  const paperCountOf = (e: Exam) =>
    realPaperCountByExam[e.id] !== undefined ? realPaperCountByExam[e.id] : e.subjects

  const columns: Column<Exam>[] = [
    {
      key: 'name', label: 'Exam', sortValue: (e) => e.name,
      render: (e) => (
        <div>
          <div className="fw6">{e.name}</div>
          <div className="t-xs muted">{e.grades}</div>
        </div>
      ),
    },
    { key: 'type', label: 'Type', sortValue: (e) => e.type, render: (e) => <Badge tone="brand">{e.type}</Badge> },
    {
      key: 'dates', label: 'Dates', sortValue: (e) => e.from,
      render: (e) => <span className="t-sm">{fmtDate(e.from)} – {fmtDate(e.to)}</span>,
    },
    { key: 'subjects', label: 'Papers', align: 'center', sortValue: (e) => paperCountOf(e),
      render: (e) => {
        const n = paperCountOf(e)
        const loading = realPaperCountByExam[e.id] === undefined && paperQueries.some((q, i) => exams[i]?.id === e.id && q.isLoading)
        return (
          <span className={n ? 'fw6' : 't-sm muted'} title="Real datesheet papers (dummy / wrong-grade ignored)">
            {loading ? '…' : (n || '—')}
          </span>
        )
      },
    },
    {
      key: 'marks', label: 'Marks entered', sortValue: (e) => e.marksEntered,
      render: (e) => (
        <div className="row ai-center gap8" style={{ minWidth: 130 }}>
          <div style={{ flex: 1 }}><Progress value={e.marksEntered} color={e.marksEntered >= 90 ? 'var(--success)' : e.marksEntered > 0 ? 'var(--warning)' : 'var(--border)'} /></div>
          <span className="t-sm fw6" style={{ width: 36 }}>{e.marksEntered}%</span>
        </div>
      ),
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (e) => e.status,
      render: (e) => <Badge tone={statusTone[e.status]} dot>{statusLabel[e.status]}</Badge>,
    },
    {
      key: 'published', label: 'Published', align: 'center', sortValue: (e) => (e.published ? 1 : 0),
      render: (e) => <Badge tone={e.published ? 'success' : 'neutral'}>{e.published ? 'Published' : 'Pending'}</Badge>,
    },
    {
      key: 'actions', label: '',
      render: (e) => (
        <div className="row gap8 jc-end" onClick={(ev) => ev.stopPropagation()}>
          <Btn variant="secondary" size="sm" icon="calendar" onClick={() => onDatesheet(e)}>Datesheet</Btn>
          <Btn variant={e.published ? 'ghost' : 'primary'} size="sm" icon="bell" onClick={() => onPublish(e)}>
            {e.published ? 'Notify again' : 'Publish'}
          </Btn>
        </div>
      ),
    },
  ]

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <CardHead title="Exam & test schedule" sub={isLoading ? 'Loading…' : `${exams.length} examinations`} icon="clipboard" />
        {editable
          ? <Btn variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>Create exam</Btn>
          : <Badge tone="neutral" icon="eye">View only</Badge>}
      </div>
      <DataTable<Exam>
        columns={columns}
        rows={exams}
        pageSize={10}
        rowKey={(e) => e.id}
        initialSort={{ key: 'dates', dir: 'asc' }}
        onRowClick={(e) => onDatesheet(e)}
        empty={<Empty icon="clipboard" title="No exams yet" body="Create an exam, then add its datesheet and notify parents." />}
      />
      <CreateExamModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(exam) => {
          setCreateOpen(false)
          onDatesheet(exam)
        }}
      />
    </Card>
  )
}

/* ============================================================
   Tab 2 — Marks entry (API grades) — class-wise for teacher / CRM
   ============================================================ */
function MarksEntryTab() {
  const app = useApp()
  const toast = useToast()
  const updateExam = useUpdateExam()
  const upsertGrade = useUpsertGrade()
  const editable = can(app.role, 'exams', 'E')
  const classesQ = useClasses()
  const classList = useClassNames()
  const studentsQ = useStudents()
  const { data: examsData } = useExams()
  const exams = examsData ?? []

  const [examId, setExamId] = useState('')
  const [cls, setCls] = useState('')
  const [paperId, setPaperId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!examId && exams[0]) setExamId(exams[0].id)
  }, [exams, examId])

  const papersQ = useExamPapers(examId || null)

  /* Prefer classes that have papers on this exam (same as timetable). */
  const classesWithPapers = useMemo(() => {
    const ids = new Set((papersQ.data ?? []).map((p) => p.classId).filter(Boolean) as string[])
    const fromPapers = [...(classesQ.data ?? [])]
      .filter((c) => c.id && ids.has(c.id))
      .sort(compareClassesAscending)
      .map((c) => classLabel(c))
    if (fromPapers.length) return fromPapers
    /* Legacy papers without classId — fall back to full class list. */
    return classList
  }, [papersQ.data, classesQ.data, classList])

  useEffect(() => {
    if (!classesWithPapers.length) { setCls(''); return }
    if (!cls || !classesWithPapers.includes(cls)) setCls(classesWithPapers[0])
  }, [classesWithPapers, cls, examId])

  const selectedClassId = useMemo(
    () => (classesQ.data ?? []).find((c) => classLabel(c) === cls)?.id ?? null,
    [classesQ.data, cls],
  )
  const classNameById = (id?: string | null) => {
    const c = (classesQ.data ?? []).find((row) => row.id === id)
    return c ? classLabel(c) : 'Selected class'
  }
  const papers = useMemo(
    () => (papersQ.data ?? []).filter((p) => !p.classId || !selectedClassId || p.classId === selectedClassId),
    [papersQ.data, selectedClassId],
  )
  useEffect(() => {
    if (!paperId && papers[0]) setPaperId(papers[0].id)
    else if (paperId && papers.length && !papers.some((p) => p.id === paperId)) setPaperId(papers[0]?.id ?? '')
    else if (paperId && !papers.length) setPaperId('')
  }, [papers, paperId])

  const paper = papers.find((p) => p.id === paperId)
  const paperMax = clampExamMaxMarks(paper?.maxMarks, 100)
  const gradesQ = useGrades(paperId || null)
  const gradesByStudent = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of gradesQ.data ?? []) m.set(g.studentId, g.marks)
    return m
  }, [gradesQ.data])

  const roster = useMemo(
    () => (studentsQ.data ?? []).filter((s) => s.cls === cls).sort((a, b) => a.roll - b.roll),
    [studentsQ.data, cls],
  )

  const [marks, setMarks] = useState<Record<string, number>>({})
  useEffect(() => {
    const out: Record<string, number> = {}
    roster.forEach((s) => { out[s.id] = gradesByStudent.get(s.id) ?? 0 })
    setMarks(out)
  }, [roster, gradesByStudent])

  const setMark = (id: string, raw: string) => {
    const n = Math.max(0, Math.min(paperMax, Math.round(Number(raw) || 0)))
    setMarks((m) => ({ ...m, [id]: n }))
  }

  const entered = roster.map((s) => marks[s.id] ?? 0)
  const pctOf = (raw: number) => (paperMax > 0 ? (raw / paperMax) * 100 : 0)
  const avgPct = entered.length
    ? +(entered.reduce((a, b) => a + pctOf(b), 0) / entered.length).toFixed(1)
    : 0
  const passCount = entered.filter((v) => pctOf(v) >= 33).length
  const exam = exams.find((e) => e.id === examId)

  const save = async () => {
    if (!exam || !paper) { toast.danger('Pick exam & paper', 'Select an exam and a datesheet paper first.'); return }
    setSaving(true)
    try {
      for (const s of roster) {
        await upsertGrade.mutateAsync({
          studentId: s.id,
          studentName: s.name,
          examPaperId: paper.id,
          marks: marks[s.id] ?? 0,
        })
      }
      const progress = Math.max(exam.marksEntered, Math.round((100 * 1) / Math.max(1, papers.length || exam.subjects)))
      await updateExam.mutateAsync({ id: examId, patch: { status: 'marks_entry', marksEntered: Math.min(100, progress) } })
      let notifyBit = 'CRM updated'
      try {
        const res = await notifyExamMarksPublished(paper.id)
        const reach = Math.max(res.parentReach, res.studentReach, res.emailsSent)
        notifyBit = `${res.emailsSent} email · parent + student app · ${reach} reached`
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'notify failed'
        toast.info('Marks saved · parent notify failed', reason)
        notifyBit = 'saved · email/app notify failed'
      }
      toast.success('Marks published', `${roster.length} · ${cls} · ${paper.subject} · ${notifyBit}`)
    } catch (err) {
      toast.danger('Could not save marks', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <CardHead title="Marks entry" sub={`${cls || '—'} · ${paper?.subject ?? '—'} · ${roster.length} students · class-wise`} icon="edit" />
        <div className="row gap8 ai-center wrap" style={{ marginLeft: 'auto' }}>
          <Select
            options={exams.map((e) => ({ value: e.id, label: e.name }))}
            value={examId}
            onChange={(e) => { setExamId(e.target.value); setPaperId(''); setCls('') }}
          />
          <Select
            options={(classesWithPapers.length ? classesWithPapers : ['']).map((v) => ({
              value: v,
              label: v || 'No classes with papers',
            }))}
            value={cls}
            onChange={(e) => setCls(e.target.value)}
          />
          <Select
            options={papers.map((p) => ({
              value: p.id,
              label: `${p.subject || p.name || p.id}${p.classId ? ` · ${classNameById(p.classId)}` : ''} · /${clampExamMaxMarks(p.maxMarks, 100)}`,
            }))}
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
          />
        </div>
      </div>

      {!classesWithPapers.length ? (
        <Empty icon="users" title="No classes with papers" body="Add datesheet papers for class sections first." />
      ) : !papers.length ? (
        <Empty icon="calendar" title="No papers for this class" body="Pick another class or open Datesheet and add papers." />
      ) : roster.length === 0 ? (
        <Empty icon="users" title="No students in this class" body="Pick another class or enrol students in People." />
      ) : (
        <>
          <div className="row ai-center gap20 wrap" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="t-sm">Class average <span className="fw7">{avgPct}%</span> · Grade <Badge tone={gradeTone(gradeFor(avgPct))}>{gradeFor(avgPct)}</Badge></span>
            <span className="t-sm">Passing <span className="fw7">{passCount}/{roster.length}</span></span>
            <span className="t-xs muted">Paper max {paperMax} · Save sends parent email + student/parent app for this class</span>
          </div>
          <table className="sm-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Roll</th>
                <th>Student</th>
                <th className="ta-center" style={{ width: 140 }}>Marks /{paperMax}</th>
                <th className="ta-center" style={{ width: 90 }}>Grade</th>
                <th className="ta-center" style={{ width: 90 }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((s) => {
                const m = marks[s.id] ?? 0
                const pct = pctOf(m)
                const g = gradeFor(pct)
                return (
                  <tr key={s.id}>
                    <td className="muted">{s.roll}</td>
                    <td className="fw6">{s.name}</td>
                    <td className="ta-center">
                      <Input type="number" min={0} max={paperMax} value={String(m)} disabled={!editable}
                        style={{ width: 80, textAlign: 'center' }}
                        onChange={(e) => setMark(s.id, e.target.value)} />
                    </td>
                    <td className="ta-center"><Badge tone={gradeTone(g)}>{g}</Badge></td>
                    <td className="ta-center"><Badge tone={pct >= 33 ? 'success' : 'danger'}>{pct >= 33 ? 'Pass' : 'Fail'}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            {editable ? (
              <span className="t-sm muted">Parents get <span className="fw6">email</span> · parent + student <span className="fw6">app</span> on save.</span>
            ) : <span />}
            {editable
              ? <Btn variant="primary" icon="check" disabled={saving || upsertGrade.isPending} onClick={() => void save()}>
                  {saving || upsertGrade.isPending ? 'Publishing…' : 'Save & notify parents'}
                </Btn>
              : <Badge tone="neutral" icon="eye">View only</Badge>}
          </div>
        </>
      )}
    </Card>
  )
}

/* ============================================================
   Tab — Exam attendance (class-wise · API + local · parent notify)
   ============================================================ */
function ExamAttendanceTab() {
  const toast = useToast()
  const app = useApp()
  const editable = can(app.role, 'exams', 'E')
  const classesQ = useClasses()
  const classList = useClassNames()
  const studentsQ = useStudents()
  const { data: examsData } = useExams()
  const exams = examsData ?? []

  const [examId, setExamId] = useState('')
  const [cls, setCls] = useState('')
  const [paperId, setPaperId] = useState('')
  const [notifyParents, setNotifyParents] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingAtt, setLoadingAtt] = useState(false)

  useEffect(() => {
    if (!examId && exams[0]) setExamId(exams[0].id)
  }, [exams, examId])

  const papersQ = useExamPapers(examId || null)

  const classesWithPapers = useMemo(() => {
    const ids = new Set((papersQ.data ?? []).map((p) => p.classId).filter(Boolean) as string[])
    const fromPapers = [...(classesQ.data ?? [])]
      .filter((c) => c.id && ids.has(c.id))
      .sort(compareClassesAscending)
      .map((c) => classLabel(c))
    if (fromPapers.length) return fromPapers
    return classList
  }, [papersQ.data, classesQ.data, classList])

  useEffect(() => {
    if (!classesWithPapers.length) { setCls(''); return }
    if (!cls || !classesWithPapers.includes(cls)) setCls(classesWithPapers[0])
  }, [classesWithPapers, cls, examId])

  const selectedClassId = useMemo(
    () => (classesQ.data ?? []).find((c) => classLabel(c) === cls)?.id ?? null,
    [classesQ.data, cls],
  )
  const classNameById = (id?: string | null) => {
    const c = (classesQ.data ?? []).find((row) => row.id === id)
    return c ? classLabel(c) : 'Selected class'
  }
  const papers = useMemo(
    () => (papersQ.data ?? []).filter((p) => !p.classId || !selectedClassId || p.classId === selectedClassId),
    [papersQ.data, selectedClassId],
  )
  useEffect(() => {
    if (!paperId && papers[0]) setPaperId(papers[0].id)
    else if (paperId && papers.length && !papers.some((p) => p.id === paperId)) setPaperId(papers[0]?.id ?? '')
    else if (paperId && !papers.length) setPaperId('')
  }, [papers, paperId])

  const paper = papers.find((p) => p.id === paperId)
  const date = paper?.date || todayIso()
  const subject = paper?.subject || ''

  const roster = useMemo(
    () => (studentsQ.data ?? []).filter((s) => s.cls === cls).sort((a, b) => a.roll - b.roll),
    [studentsQ.data, cls],
  )

  const [att, setAtt] = useState<Record<string, 'present' | 'absent'>>({})
  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!examId || !paper?.id || !subject) { setAtt({}); return }
      setLoadingAtt(true)
      try {
        let saved: Record<string, 'present' | 'absent'> = {}
        try {
          saved = await listExamPaperAttendance(paper.id)
        } catch {
          /* fail closed — never hydrate from browser SoT */
          saved = {}
        }
        if (cancelled) return
        const out: Record<string, 'present' | 'absent'> = {}
        roster.forEach((s) => { out[s.id] = saved[s.id] ?? 'present' })
        setAtt(out)
      } finally {
        if (!cancelled) setLoadingAtt(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [roster, examId, paper?.id, subject, date])

  const present = roster.filter((s) => (att[s.id] ?? 'present') === 'present').length
  const absent = roster.length - present
  const exam = exams.find((e) => e.id === examId)

  const save = async () => {
    if (!exam || !paper?.id || !subject) return
    setSaving(true)
    try {
      const entries: Record<string, 'present' | 'absent'> = {}
      roster.forEach((s) => { entries[s.id] = att[s.id] ?? 'present' })
      await saveExamPaperAttendance(paper.id, examId, subject, date, entries)
      let notifyBit = 'synced'
      if (notifyParents) {
        try {
          const res = await notifyExamAudience(
            exam,
            app.school.name,
            'attendance',
            { email: false, sms: false, app: true },
            'parents',
            { classLabel: cls, subject, paperDate: date, present, absent },
          )
          notifyBit += ` · notified ${res.reach || res.phones || res.emails || 0} parents (app)`
        } catch (err) {
          const reason = err instanceof Error ? err.message : 'notify failed'
          toast.info('Attendance saved · parent notify failed', reason)
          notifyBit += ' · parent notify failed'
        }
      }
      toast.success('Attendance saved', `${present} present · ${absent} absent · ${cls} · ${subject} · ${notifyBit}`)
    } catch (err) {
      toast.danger('Could not save attendance', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <CardHead title="Exam attendance" sub={`${cls || '—'} · ${subject || '—'} · ${roster.length} students · class-wise`} icon="calendar" />
        <div className="row gap8 ai-center wrap" style={{ marginLeft: 'auto' }}>
          <Select options={exams.map((e) => ({ value: e.id, label: e.name }))} value={examId} onChange={(e) => { setExamId(e.target.value); setPaperId(''); setCls('') }} />
          <Select
            options={(classesWithPapers.length ? classesWithPapers : ['']).map((v) => ({
              value: v,
              label: v || 'No classes with papers',
            }))}
            value={cls}
            onChange={(e) => setCls(e.target.value)}
          />
          <Select
            options={papers.map((p) => ({ value: p.id, label: `${p.subject || p.name || p.id}${p.classId ? ` · ${classNameById(p.classId)}` : ''}` }))}
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
          />
        </div>
      </div>

      {!classesWithPapers.length ? (
        <Empty icon="users" title="No classes with papers" body="Add datesheet papers for class sections first." />
      ) : !papers.length ? (
        <Empty icon="calendar" title="No papers for this class" body="Pick another class or add papers on the datesheet." />
      ) : roster.length === 0 ? (
        <Empty icon="users" title="No students in this class" body="Pick another class." />
      ) : (
        <>
          <div className="row ai-center gap20 wrap" style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <span className="t-sm">Present <span className="fw7" style={{ color: 'var(--success)' }}>{present}</span></span>
            <span className="t-sm">Absent <span className="fw7" style={{ color: 'var(--danger)' }}>{absent}</span></span>
            <span className="t-sm muted">{exam?.name} · {fmtDate(date)}{loadingAtt ? ' · loading…' : ''}</span>
          </div>
          <table className="sm-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Roll</th>
                <th>Student</th>
                <th className="ta-center" style={{ width: 200 }}>Attendance</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((s) => {
                const v = att[s.id] ?? 'present'
                return (
                  <tr key={s.id}>
                    <td className="muted">{s.roll}</td>
                    <td className="fw6">{s.name}</td>
                    <td className="ta-center">
                      <div className="row gap6 jc-center">
                        <Btn variant={v === 'present' ? 'primary' : 'secondary'} size="sm" disabled={!editable}
                          onClick={() => setAtt((m) => ({ ...m, [s.id]: 'present' }))}>Present</Btn>
                        <Btn variant={v === 'absent' ? 'primary' : 'secondary'} size="sm" disabled={!editable}
                          onClick={() => setAtt((m) => ({ ...m, [s.id]: 'absent' }))}>Absent</Btn>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
            {editable ? (
              <label className="row ai-center gap8 t-sm" style={{ cursor: 'pointer', flex: '1 1 auto', minWidth: 180 }}>
                <input
                  type="checkbox"
                  checked={notifyParents}
                  onChange={(e) => setNotifyParents(e.target.checked)}
                  style={{ width: 16, height: 16, flexShrink: 0 }}
                />
                <span>Notify class parents on app</span>
              </label>
            ) : <span />}
            {editable
              ? <Btn variant="primary" icon="check" disabled={saving} onClick={() => void save()}>
                  {saving ? 'Saving…' : 'Save attendance'}
                </Btn>
              : <Badge tone="neutral" icon="eye">View only</Badge>}
          </div>
        </>
      )}
    </Card>
  )
}

/* ============================================================
   Report card modal
   ============================================================ */
function ReportCardModal({ student, examId, examName, getMark, subjects, peers, onClose }: {
  student: Student | null
  examId?: string
  examName?: string
  getMark?: (studentId: string, subject: string) => number | undefined
  subjects: string[]
  peers: Student[]
  onClose: () => void
}) {
  const app = useApp()
  if (!student) return null
  const live = { liveOnly: true as const }
  const report = reportFor(student, examId, getMark, subjects, live)
  const rank = classRank(student, examId, getMark, peers, subjects, live)
  const hasMarks = report.rows.length > 0
  const school = app.school
  const logoSrc = school.logoUrl?.trim() || school.imageUrl?.trim() || ''
  const brand = school.color || 'var(--brand-600)'
  const schoolDisplay = properName(school.name)
  const cityDisplay = properPlace(school.city)
  const studentDisplay = properName(student.name)
  const guardianDisplay = properName(student.guardian)
  const examDisplay = properName(examName)
  const schoolForMark = {
    ...school,
    name: schoolDisplay,
    logo: (school.logo || schoolDisplay.slice(0, 2)).toUpperCase(),
  }

  const doPrint = () => {
    if (!hasMarks) return
    printReportCard({
      schoolName: schoolDisplay,
      schoolCity: cityDisplay,
      schoolSlug: school.slug,
      schoolLogoInitials: schoolForMark.logo,
      schoolLogoUrl: school.logoUrl,
      schoolImageUrl: school.imageUrl,
      schoolBrandColor: school.color,
      examName: examDisplay || examName,
      student: {
        ...student,
        name: studentDisplay,
        guardian: guardianDisplay,
      },
      report,
      rank: rank.rank,
      classSize: rank.classSize,
    })
  }

  return (
    <Modal
      open={!!student} onClose={onClose} size="lg" icon="clipboard"
      title="Report card" sub={`${studentDisplay} · ${student.cls}`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn variant="primary" icon="download" disabled={!hasMarks} onClick={doPrint}>Print / PDF</Btn>
        </div>
      }
    >
      {!hasMarks ? (
        <Empty
          icon="clipboard"
          title="No marks entered"
          body="Enter marks for this class under Marks entry first. Dummy / sample scores are not shown on report cards."
        />
      ) : (
      <div className="sm-report-card" style={{ ['--sm-report-brand' as string]: brand }}>
        <div className="sm-report-card-watermark" aria-hidden>
          {logoSrc ? (
            <img className="sm-report-card-watermark-mark" src={logoSrc} alt="" />
          ) : (
            <div className="sm-report-card-watermark-text">
              {schoolForMark.logo}
            </div>
          )}
        </div>

        <div className="sm-report-card-header">
          <div className="sm-report-card-brand">
            <SchoolMark school={schoolForMark} size={72} round style={{ boxShadow: '0 2px 10px rgba(0,0,0,.08)' }} />
            <div className="sm-report-card-brand-text">
              <div className="sm-report-card-school">{schoolDisplay}</div>
              {(cityDisplay || school.slug) && (
                <div className="sm-report-card-meta">
                  {[cityDisplay, school.slug].filter(Boolean).join(' · ')}
                </div>
              )}
              <div className="sm-report-card-title">
                {examDisplay ? `${examDisplay} · Report Card` : 'Academic Year · Term Report Card'}
              </div>
            </div>
          </div>
          <Badge tone={report.result === 'PASS' ? 'success' : 'danger'} solid>{report.result}</Badge>
        </div>

        <div className="sm-grid-3 gap12 sm-report-card-body">
          <div><div className="t-xs muted">Student</div><div className="fw6">{studentDisplay}</div></div>
          <div><div className="t-xs muted">Student ID</div><div className="fw6">{student.adm}</div></div>
          <div><div className="t-xs muted">Class · Roll</div><div className="fw6">{student.cls} · {student.roll}</div></div>
          <div><div className="t-xs muted">Guardian</div><div className="fw6">{guardianDisplay || '—'}</div></div>
          <div><div className="t-xs muted">Attendance</div><div className="fw6">{student.attendance}%</div></div>
          <div><div className="t-xs muted">Class rank</div><div className="fw6">{rank.rank} / {rank.classSize}</div></div>
        </div>

        <table className="sm-table sm-report-card-table">
          <thead>
            <tr>
              <th>Subject</th>
              <th className="ta-right">Marks</th>
              <th className="ta-right">Max</th>
              <th className="ta-center">Grade</th>
              <th className="ta-center">GPA</th>
              <th className="ta-center">Result</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.subject}>
                <td className="fw6">{r.subject}</td>
                <td className="ta-right">{r.marks}</td>
                <td className="ta-right muted">{r.max}</td>
                <td className="ta-center"><Badge tone={gradeTone(r.grade)}>{r.grade}</Badge></td>
                <td className="ta-center">{r.gpa}</td>
                <td className="ta-center"><Badge tone={r.pass ? 'success' : 'danger'}>{r.pass ? 'Pass' : 'Fail'}</Badge></td>
              </tr>
            ))}
            <tr>
              <td className="fw7">Total</td>
              <td className="ta-right fw7">{report.total}</td>
              <td className="ta-right muted">{report.maxTotal}</td>
              <td className="ta-center fw7">{report.grade}</td>
              <td className="ta-center fw7">{report.gpa}</td>
              <td className="ta-center fw7">{report.pct}%</td>
            </tr>
          </tbody>
        </table>

        <div className="row ai-center jc-between wrap gap16 sm-report-card-footer">
          <div className="row gap20 wrap">
            <div><div className="t-xs muted">Percentage</div><div className="fw7 t-lg">{report.pct}%</div></div>
            <div><div className="t-xs muted">Overall grade</div><div className="fw7 t-lg">{report.grade}</div></div>
            <div><div className="t-xs muted">GPA</div><div className="fw7 t-lg">{report.gpa}</div></div>
            <div><div className="t-xs muted">Result</div><div className="fw7 t-lg">{report.result}</div></div>
          </div>
        </div>

        <div className="sm-report-card-signs">
          <div className="sm-report-card-sign">
            <div className="sm-report-card-sign-line" />
            <div className="sm-report-card-sign-lab">Subject teacher</div>
          </div>
          <div className="sm-report-card-sign">
            <div className="sm-report-card-sign-line" />
            <div className="sm-report-card-sign-lab">Class teacher</div>
          </div>
          <div className="sm-report-card-sign">
            <div className="sm-report-card-sign-line" />
            <div className="sm-report-card-sign-lab">Principal</div>
          </div>
        </div>
      </div>
      )}
    </Modal>
  )
}

/* ============================================================
   Tab 3 — Report cards
   ============================================================ */
function ReportCardsTab() {
  const classesQ = useClasses()
  const classList = useClassNames()
  const studentsQ = useStudents()
  const { data: examsData } = useExams()
  const exams = examsData ?? []
  const [examId, setExamId] = useState('')
  const [cls, setCls] = useState('')
  const [open, setOpen] = useState<Student | null>(null)
  const live = { liveOnly: true as const }

  useEffect(() => {
    if (!examId && exams[0]) setExamId(exams[0].id)
  }, [exams, examId])

  const papersQ = useExamPapers(examId || null)

  const classesWithPapers = useMemo(() => {
    const ids = new Set((papersQ.data ?? []).map((p) => p.classId).filter(Boolean) as string[])
    const fromPapers = [...(classesQ.data ?? [])]
      .filter((c) => c.id && ids.has(c.id))
      .sort(compareClassesAscending)
      .map((c) => classLabel(c))
    if (fromPapers.length) return fromPapers
    return classList
  }, [papersQ.data, classesQ.data, classList])

  useEffect(() => {
    if (!classesWithPapers.length) { setCls(''); return }
    if (!cls || !classesWithPapers.includes(cls)) setCls(classesWithPapers[0])
  }, [classesWithPapers, cls, examId])

  const selectedClassId = useMemo(
    () => (classesQ.data ?? []).find((c) => classLabel(c) === cls)?.id ?? null,
    [classesQ.data, cls],
  )
  const classPapers = useMemo(
    () => (papersQ.data ?? []).filter((p) => !p.classId || !selectedClassId || p.classId === selectedClassId),
    [papersQ.data, selectedClassId],
  )
  const subjects = useMemo(
    () => [...new Set(classPapers.map((p) => p.subject).filter(Boolean))],
    [classPapers],
  )
  const marksQ = useExamMarksMap(examId || null)
  const getMark = (sid: string, subject: string) => marksQ.data?.[markKey(examId, sid, subject)]
  const examName = exams.find((e) => e.id === examId)?.name

  const roster = useMemo(
    () => (studentsQ.data ?? []).filter((s) => s.cls === cls).sort((a, b) => a.roll - b.roll),
    [studentsQ.data, cls],
  )
  const scoredRoster = useMemo(
    () => roster.filter((s) => reportFor(s, examId, getMark, subjects, live).rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roster, examId, subjects, marksQ.data],
  )

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <CardHead title="Report cards" sub={`${cls || '—'} · ${scoredRoster.length} with marks · live only`} icon="clipboard" />
        <div className="row gap8 ai-center" style={{ marginLeft: 'auto' }}>
          <Select options={exams.map((e) => ({ value: e.id, label: e.name }))} value={examId} onChange={(e) => { setExamId(e.target.value); setCls('') }} />
          <Select
            options={(classesWithPapers.length ? classesWithPapers : ['']).map((v) => ({
              value: v,
              label: v || 'No classes with papers',
            }))}
            value={cls}
            onChange={(e) => setCls(e.target.value)}
          />
        </div>
      </div>

      {!subjects.length ? (
        <Empty icon="calendar" title="No papers / marks yet" body="Add a datesheet and enter marks first." />
      ) : roster.length === 0 ? (
        <Empty icon="users" title="No students in this class" body="Pick another class." />
      ) : !scoredRoster.length ? (
        <Empty icon="clipboard" title="No marks entered for this class" body="Open Marks entry, save real scores, then come back. Sample / dummy marks are never shown." />
      ) : (
        <div className="sm-grid-3 gap12" style={{ padding: 16 }}>
          {scoredRoster.map((s) => {
            const report = reportFor(s, examId, getMark, subjects, live)
            const rank = classRank(s, examId, getMark, roster, subjects, live)
            return (
              <Card key={s.id} hover onClick={() => setOpen(s)}>
                <div className="row ai-center jc-between">
                  <div>
                    <div className="fw6">{properName(s.name)}</div>
                    <div className="t-xs muted">Roll {s.roll} · Rank {rank.rank}/{rank.classSize}</div>
                  </div>
                  <Badge tone={report.result === 'PASS' ? 'success' : 'danger'}>{report.result}</Badge>
                </div>
                <div className="row ai-center jc-between" style={{ marginTop: 12 }}>
                  <span className="t-sm">{report.pct}% · <span className="fw6">{report.grade}</span></span>
                  <span className="t-xs muted">GPA {report.gpa}</span>
                </div>
                <div style={{ marginTop: 8 }}><Progress value={report.pct} color={report.pct >= 60 ? 'var(--success)' : 'var(--warning)'} /></div>
              </Card>
            )
          })}
        </div>
      )}
      <ReportCardModal
        student={open}
        examId={examId}
        examName={examName}
        getMark={getMark}
        subjects={subjects}
        peers={roster}
        onClose={() => setOpen(null)}
      />
    </Card>
  )
}

/* ============================================================
   Tab — Exam timetable (class-wise from datesheet)
   ============================================================ */
function ExamPeriodGridView({
  flatPapers,
  footnote,
}: {
  flatPapers: Array<{
    id: string
    classId?: string | null
    className?: string
    subject: string
    date: string
    start: string
    duration: number
    room: string
    inv1: string
    inv2: string
  }>
  footnote?: string
}) {
  const periodGrid = useMemo(() => buildExamPeriodGrid(flatPapers), [flatPapers])
  if (!flatPapers.length) {
    return <div className="t-sm muted" style={{ padding: 12 }}>No papers for this class.</div>
  }
  return (
    <div className="sm-exam-tt-grid-wrap">
      <div
        className="sm-exam-tt-grid"
        style={{
          gridTemplateColumns: `88px repeat(${Math.max(1, periodGrid.dates.length)}, minmax(100px, 1fr))`,
        }}
      >
        <div />
        {periodGrid.dayCols.map((col) => (
          <div key={col.date} className={`sm-exam-tt-colhead${col.hasExam ? '' : ' gap'}`}>
            <div className="fw7 t-sm">
              {new Date(col.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}
            </div>
            <div className="t-xs muted3">{fmtDate(col.date)}</div>
            <div className={`sm-exam-tt-day-flag ${col.hasExam ? 'exam' : 'gap'}`}>
              {col.hasExam ? 'Exam' : 'Gap'}
            </div>
          </div>
        ))}
        {periodGrid.sessions.map((sess) => {
          const sample = flatPapers.find((p) => p.start === sess.start)
          const timeSub = sample
            ? `${sess.start} – ${endTime(sess.start, sample.duration)}`
            : sess.start
          return (
            <Fragment key={sess.start}>
              <div className="sm-exam-tt-rowhead">
                <div className="fw7 t-sm">{sess.label}</div>
                <div className="t-xs muted3">{timeSub}</div>
              </div>
              {periodGrid.dayCols.map((col) => {
                const list = periodGrid.cell(col.date, sess.start)
                if (!list.length) {
                  return (
                    <div
                      key={`${col.date}-${sess.start}`}
                      className={`sm-exam-tt-cell empty${col.hasExam ? '' : ' gap'}`}
                    >
                      {col.hasExam ? '—' : 'Gap'}
                    </div>
                  )
                }
                const st = examSubjectStyle(list[0].subject)
                return (
                  <div
                    key={`${col.date}-${sess.start}`}
                    className="sm-exam-tt-cell"
                    style={{ background: st.bg, borderColor: st.bd, color: st.fg }}
                  >
                    {list.map((p) => {
                      const inv = [p.inv1, p.inv2].filter(Boolean).join(' · ')
                      const timeLine = p.start
                        ? `${p.start} – ${endTime(p.start, p.duration)}`
                        : `${p.duration} min`
                      const roomLine = p.room ? `Room ${p.room}` : ''
                      return (
                        <div key={p.id} className="sm-exam-tt-cell-block">
                          <div className="fw7 t-sm" style={{ color: st.fg }}>{p.subject}</div>
                          <div className="t-xs fw6" style={{ color: 'var(--text-1)' }}>{timeLine}</div>
                          {roomLine && (
                            <div className="t-xs fw6" style={{ color: 'var(--text-1)' }}>{roomLine}</div>
                          )}
                          {inv ? (
                            <div className="t-xs" style={{ color: 'var(--text-2)' }}>{inv}</div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </Fragment>
          )
        })}
      </div>
      {footnote && <div className="t-xs muted" style={{ marginTop: 10 }}>{footnote}</div>}
    </div>
  )
}

function ExamTimetableTab({ onEditDatesheet }: { onEditDatesheet: (e: Exam) => void }) {
  const app = useApp()
  const toast = useToast()
  const canNotify = can(app.role, 'exams', 'A') || can(app.role, 'exams', 'E')
  const classesQ = useClasses()
  const { data: examsData, isLoading: examsLoading } = useExams()
  const exams = examsData ?? []
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [email, setEmail] = useState(true)
  const [sms, setSms] = useState(true)
  const [appCh, setAppCh] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!examId && exams[0]) setExamId(exams[0].id)
  }, [exams, examId])

  const exam = exams.find((e) => e.id === examId) ?? null
  const papersQ = useExamPapers(examId || null)

  const classNameOf = (id?: string | null) => {
    if (!id) return ''
    const c = (classesQ.data ?? []).find((x) => x.id === id)
    return c ? classLabel(c) : 'Selected class'
  }
  const classRoomOf = (id?: string | null) => {
    if (!id) return ''
    const c = (classesQ.data ?? []).find((x) => x.id === id)
    const room = c?.room?.trim()
    return room && room !== '—' ? room : ''
  }

  /* Only classes that have papers on this exam — class-wise timetable. */
  const classesWithPapers = useMemo(() => {
    const ids = new Set((papersQ.data ?? []).map((p) => p.classId).filter(Boolean) as string[])
    return [...(classesQ.data ?? [])]
      .filter((c) => c.id && ids.has(c.id))
      .sort(compareClassesAscending)
      .map((c) => ({ value: c.id!, label: classLabel(c) }))
  }, [papersQ.data, classesQ.data])

  const classOptions = useMemo(
    () => [
      ...(classesWithPapers.length > 1 ? [{ value: '', label: 'All classes (one by one)' }] : []),
      ...classesWithPapers,
    ],
    [classesWithPapers],
  )

  /* Default to first class with papers — never mix all classes in one grid. */
  useEffect(() => {
    if (!classesWithPapers.length) {
      setClassId('')
      return
    }
    if (!classId || !classesWithPapers.some((c) => c.value === classId)) {
      setClassId(classesWithPapers[0].value)
    }
  }, [classesWithPapers, classId, examId])

  const toFlat = (list: ExamPaper[]) => list.map((p) => ({
    id: p.id,
    classId: p.classId,
    className: classNameOf(p.classId),
    subject: p.subject,
    date: p.date,
    start: p.start,
    duration: p.duration,
    room: (p.room?.trim() || classRoomOf(p.classId)),
    inv1: p.inv1,
    inv2: p.inv2,
    maxMarks: p.maxMarks,
  }))

  const papers = useMemo(
    () => (papersQ.data ?? []).filter((p) => !classId || !p.classId || p.classId === classId),
    [papersQ.data, classId],
  )

  const flatPapers = useMemo(
    () => toFlat(papers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [papers, classesQ.data],
  )

  const classSections = useMemo(() => {
    if (classId) return [{ id: classId, label: classNameOf(classId), papers: flatPapers }]
    return classesWithPapers.map((c) => ({
      id: c.value,
      label: c.label,
      papers: toFlat((papersQ.data ?? []).filter((p) => p.classId === c.value)),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, flatPapers, classesWithPapers, papersQ.data, classesQ.data])

  const days = useMemo(() => groupExamTimetable(flatPapers), [flatPapers])
  const periodGrid = useMemo(() => buildExamPeriodGrid(flatPapers), [flatPapers])
  const paperCount = flatPapers.length
  const clashes = useMemo(
    () => findClashes(papers.map((p) => ({
      id: p.id, subject: p.subject, date: p.date, start: p.start,
      duration: p.duration, room: p.room, inv1: p.inv1, inv2: p.inv2,
      classId: p.classId, className: classNameOf(p.classId),
    }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [papers],
  )

  const doPrint = () => {
    if (!exam) return
    const targets = classId
      ? [{ label: classNameOf(classId), papers: flatPapers }]
      : classSections.map((s) => ({ label: s.label, papers: s.papers }))
    const printable = targets.filter((t) => t.papers.length && t.papers.every((p) => p.start && p.date))
    if (!printable.length) {
      toast.danger('Nothing to print', 'Pick a class with dated papers, or save the datesheet first.')
      return
    }
    if (!classId && printable.length > 1) {
      /* Print first class; ask user to pick one class for a single PDF. */
      toast.info('Class-wise PDF', 'Pick one class in the dropdown to print that class timetable.')
    }
    const first = printable[0]
    const ok = printExamTimetable({
      schoolName: app.school.name,
      examName: exam.name,
      grades: first.label,
      from: exam.from,
      to: exam.to,
      days: groupExamTimetable(first.papers),
      papers: first.papers,
      schoolLogoInitials: app.school.logo,
      schoolLogoUrl: app.school.logoUrl,
      schoolImageUrl: app.school.imageUrl,
      schoolBrandColor: app.school.color,
      schoolCity: app.school.city,
      autoPrint: true,
    })
    if (!ok) toast.danger('Pop-up blocked', 'Allow pop-ups, then click Save PDF again.')
    else toast.success('Print ready', `${first.label} timetable · choose Save as PDF in the dialog.`)
  }

  const notify = async (forClassId?: string) => {
    if (!exam) return
    if (!email && !sms && !appCh) {
      toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.')
      return
    }
    const targetId = forClassId || classId
    if (!targetId) {
      toast.danger('Pick a class', 'Send timetable class-wise so parents only get their class schedule.')
      return
    }
    const label = classNameOf(targetId)
    const targetPapers = forClassId
      ? toFlat((papersQ.data ?? []).filter((p) => p.classId === forClassId))
      : flatPapers
    if (!targetPapers.length) {
      toast.danger('No papers', `No timetable papers for ${label}.`)
      return
    }
    setBusy(true)
    try {
      const res = await notifyExamAudience(
        exam, app.school.name, 'datesheet',
        { email, sms, app: appCh },
        'parents',
        { classLabel: label },
      )
      const bits = [
        email ? `${res.emails} email` : '',
        sms ? `${res.phones} SMS` : '',
        appCh ? 'app' : '',
      ].filter(Boolean)
      toast.success('Timetable sent', `${exam.name} · ${label} → ${bits.join(' · ')}`)
    } catch (err) {
      toast.danger('Could not notify', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <CardHead
          title="Exam timetable"
          sub={exam
            ? `${exam.name} · ${classId ? classNameOf(classId) : `${classesWithPapers.length} classes`} · ${paperCount} papers · ${days.length} day${days.length === 1 ? '' : 's'}`
            : 'Pick an exam'}
          icon="calendar"
        />
        <div className="row gap8 ai-center wrap" style={{ marginLeft: 'auto' }}>
          <Select
            options={exams.map((e) => ({ value: e.id, label: e.name }))}
            value={examId}
            onChange={(e) => { setExamId(e.target.value); setClassId('') }}
          />
          <Select
            options={classOptions.length ? classOptions : [{ value: '', label: 'No classes with papers' }]}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          />
          {exam && (
            <Btn variant="secondary" size="sm" icon="edit" onClick={() => onEditDatesheet(exam)}>
              Edit datesheet
            </Btn>
          )}
          <Btn variant="secondary" size="sm" icon="download" disabled={!paperCount && !classSections.some((s) => s.papers.length)} onClick={doPrint}>
            Save PDF
          </Btn>
        </div>
      </div>

      {examsLoading || papersQ.isLoading ? (
        <div style={{ padding: 24 }}><span className="t-sm muted">Loading timetable…</span></div>
      ) : !exam ? (
        <Empty icon="clipboard" title="No exams yet" body="Create an exam, then add papers on the datesheet." />
      ) : !classesWithPapers.length ? (
        <Empty
          icon="calendar"
          title="No class timetable yet"
          body="Add class-wise papers on the datesheet first — then pick a class to view and send to parents."
          action={<Btn variant="primary" icon="plus" onClick={() => onEditDatesheet(exam)}>Open datesheet</Btn>}
        />
      ) : (
        <>
          <div className="sm-exam-tt-hero">
            <div className="sm-exam-tt-kpis">
              <div>
                <div className="sm-exam-tt-val">{classId ? periodGrid.dayCols.filter((d) => d.hasExam).length : classesWithPapers.length}</div>
                <div className="t-sm muted">{classId ? 'Exam days' : 'Classes'}</div>
              </div>
              <div className="sm-exam-tt-stat">
                <div className="t-lg fw7">{classId ? periodGrid.dayCols.filter((d) => !d.hasExam).length : paperCount}</div>
                <div className="t-xs muted3">{classId ? 'Gap days' : 'Papers (view)'}</div>
              </div>
              <div className="sm-exam-tt-stat">
                <div className="t-lg fw7">{paperCount}</div>
                <div className="t-xs muted3">Papers</div>
              </div>
              <div className="sm-exam-tt-stat">
                <div className="t-lg fw7">{fmtDate(exam.from)} – {fmtDate(exam.to)}</div>
                <div className="t-xs muted3">Window</div>
              </div>
              <div className="sm-exam-tt-stat">
                <div className="t-lg fw7" style={{ color: clashes.length ? 'var(--danger)' : 'var(--success)' }}>
                  {clashes.length || 0}
                </div>
                <div className="t-xs muted3">Clashes</div>
              </div>
            </div>
            {canNotify && (
              <div className="row ai-center gap10 wrap">
                <span className="t-xs muted">
                  {classId ? `Notify parents · ${classNameOf(classId)}` : 'Pick a class to notify'}
                </span>
                <ChannelToggles email={email} sms={sms} app={appCh} onEmail={setEmail} onSms={setSms} onApp={setAppCh} />
                <Btn variant="primary" size="sm" icon="bell" disabled={busy || !classId} onClick={() => void notify()}>
                  {busy ? 'Sending…' : 'Send timetable'}
                </Btn>
              </div>
            )}
          </div>

          {clashes.length > 0 && (
            <div className="row ai-start gap8" style={{ margin: '0 16px 12px', padding: '10px 12px', borderRadius: 10, background: 'var(--danger-bg, rgba(220,38,38,.1))', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
              <Icon name="alert" size={16} />
              <span className="t-sm fw6">{clashes.join(' · ')}</span>
            </div>
          )}

          {classId ? (
            <ExamPeriodGridView
              flatPapers={flatPapers}
              footnote={`${classNameOf(classId)} only · parents receive this class schedule in the app when you Send timetable.`}
            />
          ) : (
            <div className="col gap16" style={{ padding: '0 16px 16px' }}>
              <div className="t-xs muted">Class-wise view — each section has its own timetable (not mixed).</div>
              {classSections.map((sec) => (
                <div key={sec.id} className="sm-exam-tt-class-block">
                  <div className="row ai-center jc-between wrap gap8" style={{ marginBottom: 8 }}>
                    <div className="fw7">{sec.label}</div>
                    <div className="row gap8">
                      <Btn size="sm" variant="secondary" onClick={() => setClassId(sec.id)}>Open</Btn>
                      <Btn
                        size="sm"
                        variant="primary"
                        icon="bell"
                        disabled={busy || !canNotify}
                        onClick={() => void notify(sec.id)}
                      >
                        Send
                      </Btn>
                    </div>
                  </div>
                  <ExamPeriodGridView flatPapers={sec.papers} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/* ============================================================
   Publish results — Email · SMS · App
   ============================================================ */
function PublishResultsModal({ exam, onClose }: { exam: Exam | null; onClose: () => void }) {
  const app = useApp()
  const toast = useToast()
  const updateExam = useUpdateExam()
  const canPublish = can(app.role, 'exams', 'A')
  const studentsQ = useStudents()
  const classesQ = useClasses()
  const [email, setEmail] = useState(true)
  const [sms, setSms] = useState(true)
  const [appCh, setAppCh] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmStep, setConfirmStep] = useState<0 | 1 | 2>(0)
  const [previewClass, setPreviewClass] = useState('')

  const papersQ = useExamPapers(exam?.id ?? null)
  const subjects = useMemo(
    () => [...new Set((papersQ.data ?? []).map((p) => p.subject).filter(Boolean))],
    [papersQ.data],
  )
  const marksQ = useExamMarksMap(exam?.id ?? null)
  const getMark = (sid: string, subject: string) =>
    exam ? marksQ.data?.[markKey(exam.id, sid, subject)] : undefined

  const examClassRows = useMemo(() => {
    const all = [...(classesQ.data ?? [])].filter((c) => c.id).sort(compareClassesAscending)
    const byId = new Map(all.map((c) => [c.id!, classLabel(c)]))
    const paperIds = new Set((papersQ.data ?? []).map((p) => p.classId).filter(Boolean) as string[])
    const selected = exam?.classIds?.length ? exam.classIds : []
    const ids = selected.length ? selected : [...paperIds]
    const rows = ids
      .map((id) => ({ id, label: byId.get(id) ?? id }))
      .filter((r) => r.label)
    if (rows.length) return rows
    return [...paperIds].map((id) => ({ id, label: byId.get(id) ?? id }))
  }, [classesQ.data, papersQ.data, exam?.classIds, exam?.id])

  const examClassLabels = useMemo(() => examClassRows.map((r) => r.label), [examClassRows])

  useEffect(() => {
    if (!exam) {
      setConfirmStep(0)
      setPreviewClass('')
      return
    }
    setConfirmStep(0)
  }, [exam])

  useEffect(() => {
    if (!examClassRows.length) return
    if (!previewClass || !examClassRows.some((r) => r.label === previewClass)) {
      setPreviewClass(examClassRows[0].label)
    }
  }, [examClassRows, previewClass])

  if (!exam) return null

  const cls = previewClass
  const roster = (studentsQ.data ?? []).filter((s) => s.cls === cls).sort((a, b) => a.roll - b.roll)
  const live = { liveOnly: true as const }
  const withMarks = roster.filter((s) => reportFor(s, exam.id, getMark, subjects, live).rows.length > 0)
  const sample = withMarks[0]
  const report = sample && subjects.length ? reportFor(sample, exam.id, getMark, subjects, live) : null
  const classAvg = withMarks.length && subjects.length
    ? +(withMarks.reduce((a, s) => a + reportFor(s, exam.id, getMark, subjects, live).pct, 0) / withMarks.length).toFixed(1)
    : 0
  const classPass = subjects.length
    ? withMarks.filter((s) => reportFor(s, exam.id, getMark, subjects, live).result === 'PASS').length
    : 0

  const publish = async () => {
    if (!email && !sms && !appCh) {
      toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.')
      return
    }
    setConfirmStep(0)
    setBusy(true)
    try {
      await updateExam.mutateAsync({ id: exam.id, patch: { published: true, status: 'completed' } })
      const res = await notifyExamAudience(
        exam, app.school.name, 'results',
        { email, sms, app: appCh },
        'parents',
        { classLabels: examClassLabels },
      )
      const bits = [
        email ? `${res.emails} email` : '',
        sms ? `${res.phones} SMS` : '',
        appCh ? 'app' : '',
      ].filter(Boolean)
      toast.success(
        'Results published',
        `${exam.name} · ${examClassLabels.length || 'all'} class${examClassLabels.length === 1 ? '' : 'es'} → ${bits.join(' · ')}`,
      )
      onClose()
    } catch (err) {
      toast.danger('Could not publish', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const requestPublish = () => {
    if (!email && !sms && !appCh) {
      toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.')
      return
    }
    setConfirmStep(1)
  }

  return (
    <>
    <Modal
      open={!!exam} onClose={onClose} size="lg" icon="bell"
      title={exam.published ? 'Notify again' : 'Publish results'}
      sub={`${exam.name} · ${exam.grades}${examClassLabels.length ? ` · ${examClassLabels.length} classes` : ''}`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          {canPublish && (
            <Btn variant="primary" icon="bell" disabled={busy} onClick={requestPublish}>
              {busy ? 'Sending…' : exam.published ? 'Send notify' : 'Publish & notify'}
            </Btn>
          )}
        </div>
      }
    >
      <div className="col gap16">
        <div>
          <div className="t-sm muted" style={{ marginBottom: 8 }}>Send via</div>
          <ChannelToggles email={email} sms={sms} app={appCh} onEmail={setEmail} onSms={setSms} onApp={setAppCh} />
          <div className="t-xs muted" style={{ marginTop: 8 }}>
            Uses parent / guardian emails & mobiles from People · same delivery as Announcements.
          </div>
        </div>

        <div className="sm-exam-confirm-classes">
          <div className="t-xs muted fw6" style={{ marginBottom: 6 }}>
            Classes on this exam · {examClassLabels.length || 0}
          </div>
          {examClassLabels.length ? (
            <div className="row gap6 wrap">
              {examClassLabels.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`sm-exam-class-chip${previewClass === c ? ' on' : ''}`}
                  onClick={() => setPreviewClass(c)}
                  title={`Preview ${c}`}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <div className="t-sm muted">No class list yet — open Datesheet and generate papers first.</div>
          )}
        </div>

        <Card>
          <CardHead title="Class preview" sub={cls || 'Pick a class above'} icon="cap" />
          <div className="row gap20 wrap" style={{ marginTop: 8 }}>
            <div><div className="t-xs muted">Class average</div><div className="fw7 t-lg">{classAvg}%</div></div>
            <div><div className="t-xs muted">Passing</div><div className="fw7 t-lg">{classPass}/{withMarks.length || roster.length}</div></div>
          </div>
        </Card>

        <Card>
          <CardHead title="Sample report" sub={sample ? `${sample.name} · ${cls}` : cls || '—'} icon="user" />
          {report ? (
            <div className="row ai-center jc-between wrap gap16" style={{ marginTop: 8 }}>
              <div className="row gap20 wrap">
                <div><div className="t-xs muted">Percentage</div><div className="fw7 t-lg">{report.pct}%</div></div>
                <div><div className="t-xs muted">Grade</div><div className="fw7 t-lg">{report.grade}</div></div>
                <div><div className="t-xs muted">Result</div><div className="fw7 t-lg">{report.result}</div></div>
              </div>
              <Badge tone={report.result === 'PASS' ? 'success' : 'danger'} solid>{report.result}</Badge>
            </div>
          ) : <Empty icon="clipboard" title="No live marks" body="Enter marks for this class first. Dummy scores are not previewed." />}
        </Card>
      </div>
    </Modal>

    <TwoStepConfirmModal
      open={confirmStep > 0}
      step={confirmStep === 2 ? 2 : 1}
      icon="bell"
      tone="brand"
      step1Title={exam.published ? 'Send results notify again?' : 'Publish exam results?'}
      step1Body={`Parents will be notified about ${exam.name}. Review the class list.`}
      step2Title="Confirm publish & notify"
      step2Body="Final step — mark the exam published and send notifications for these classes."
      chips={examClassLabels}
      chipsLabel={`Classes to publish · ${examClassLabels.length}`}
      bullets={[
        exam.published ? 'Send notify again' : 'Mark exam as published',
        `Notify via ${[email && 'Email', sms && 'SMS', appCh && 'App'].filter(Boolean).join(' · ') || 'no channel'}`,
        `${subjects.length || 0} subject${subjects.length === 1 ? '' : 's'} · ${examClassLabels.length} class${examClassLabels.length === 1 ? '' : 'es'}`,
      ]}
      nextLabel="Yes, continue"
      confirmLabel={exam.published ? 'Send notify' : 'Publish & notify'}
      busy={busy}
      onCancel={() => setConfirmStep(0)}
      onBack={() => setConfirmStep(1)}
      onNext={() => setConfirmStep(2)}
      onConfirm={() => void publish()}
    />
    </>
  )
}

/* ============================================================
   Screen
   ============================================================ */
function ExamsScreen() {
  const app = useApp()
  const [tab, setTab] = useState('exams')
  const [datesheetExam, setDatesheetExam] = useState<Exam | null>(null)
  const [publishExam, setPublishExam] = useState<Exam | null>(null)

  const tabs = [
    { value: 'exams', label: 'Exams & Tests', icon: 'clipboard' },
    { value: 'timetable', label: 'Exam Timetable', icon: 'calendar' },
    { value: 'marks', label: 'Marks Entry', icon: 'edit' },
    { value: 'attendance', label: 'Exam Attendance', icon: 'clock' },
    { value: 'reports', label: 'Report Cards', icon: 'cap' },
  ]

  return (
    <div>
      <PageHead title="Exams & Grading" sub={`Live schedule · timetable · marks · notify Email / SMS / App · ${app.school.name}`} />
      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} tabs={tabs} />
      </div>

      {tab === 'exams' && <ExamsListTab onDatesheet={setDatesheetExam} onPublish={setPublishExam} />}
      {tab === 'timetable' && <ExamTimetableTab onEditDatesheet={setDatesheetExam} />}
      {tab === 'marks' && <MarksEntryTab />}
      {tab === 'attendance' && <ExamAttendanceTab />}
      {tab === 'reports' && <ReportCardsTab />}

      <DatesheetDrawer exam={datesheetExam} onClose={() => setDatesheetExam(null)} />
      <PublishResultsModal exam={publishExam} onClose={() => setPublishExam(null)} />
    </div>
  )
}

export const examsScreens: Record<string, ComponentType> = { 'school.exams': ExamsScreen }
