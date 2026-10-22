/* ============================================================
   SchoolMate — Academics hub
   Tabs: Classes & sections · Timetable builder · Periods ·
   Subjects · Homework. Timetable is interactive; homework is live API.
   ============================================================ */
import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type Dispatch, type SetStateAction, type ReactNode } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can } from '@/lib/gating'
import {
  PageHead, Tabs, Segmented, Card, CardHead, Btn, Badge, Select, Field, Input,
  Modal, Icon, Empty, DataTable, Checkbox, type Column, type BadgeTone,
} from '@/components/ui'
import type { Teacher } from '@/types'
import { useClasses, useClassNames, useCreateClass, useUpdateClass, useEnsureDefaultClasses } from '@/api/hooks/useClasses'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useUpdateTeacher } from '@/api/hooks/useTeacherMutations'
import { useSubjects, useCreateSubject, useUpdateSubject, useDeleteSubject, useEnsureDefaultSubjects, useSubjectNames } from '@/api/hooks/useSubjects'
import { addSchoolHouse, listSchoolHouses, removeSchoolHouse, renameSchoolHouse } from '@/api/schoolHouses'
import { getClassSubjects, saveClassSubjects, teachingPeriodCount, subjectsMatchPeriodsHint, effectiveClassPeriods, periodChoicesForSchool, suggestedClassPeriods } from '@/api/classSubjects'
import { useClassSubjects, useClassSubjectsMap, useClassPeriodOverrides, useListClassSubjects, useSaveClassPeriodOverride } from '@/api/hooks/useClassSubjects'
import { DEFAULT_GRADES, DEFAULT_SECTIONS } from '@/lib/defaultClasses'
import { cellKey, clashingClass, clashingClasses, pickTeacher, conflictsFor, teacherLoads, clashingTeachers, teacherSchedule, subjectSchedule, planTimetableSync, bellTimesFromPeriodRows, gridsFromRemoteSlots, hasFilledGrid, generateAutoTimetableGrid, classTimetableMode, subjectsInGrids, clipGridToPeriods, DEFAULT_CLASS_BELL_TIMES, type Cell, type Grid } from '@/lib/timetable'
import { exportTimetablePdf, hasPrintableTimetable, type TimetablePrintView } from '@/lib/timetablePrint'
import { listTimetable, listTimetableHistory, replaceTimetableSlots, type TimetableHistoryEntry } from '@/api/timetable'
import { ensureSubjectsNamed, ensureDefaultSubjects } from '@/api/subjects'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
import {
  activeSnapshot, fetchPublishEnvelope, loadPublishEnvelope, publishSnapshot, publishStatusOf, saveDraftSnapshot,
  statusLabel, statusTone, publishMetaLine, formatPublishTime, showPublishButton, type PublishEnvelope, type PublishStatus,
} from '@/lib/academicsPublish'
import { useAssignments, useCreateAssignment } from '@/api/hooks/useAssignments'
import { homeworkStatusLabel } from '@/api/assignments'
import { AcademicsActionsProvider, useAcademicsActions } from './academicsActions'
import { subjStyle } from '@/lib/subjectStyle'

/* ---------- shared helpers / constants ---------- */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PERIODS = 8                 // teaching periods per day (P1..P8)
const LUNCH_AFTER = 4             // lunch break shown after period 4
const TOTAL_SLOTS = PERIODS * DAYS.length   // 48 teaching slots / week (Mon–Sat)
const ERASE = '__erase'

const LiveTeachersCtx = createContext<Teacher[]>([])
function useLiveTeachersPool(): Teacher[] {
  return useContext(LiveTeachersCtx)
}

function teacherName(pool: Teacher[], id: string): string {
  return pool.find((t) => t.id === id)?.name ?? '—'
}

function teacherOptsOf(pool: Teacher[]): { value: string; label: string }[] {
  return pool.map((t) => ({ value: t.id, label: `${t.name} · ${t.dept}` }))
}

/* teachers qualified to teach a subject (fall back to all) */
function qualified(pool: Teacher[], subject: string): Teacher[] {
  const key = subject.trim().toLowerCase()
  return pool.filter((t) => t.subjects.some((s) => s.trim().toLowerCase() === key))
}

/* ============================================================
   1 · Classes & sections
   ============================================================ */
interface ClassRow {
  id?: string
  name: string
  grade: string
  section: string
  teacherId: string
  students: number
  room: string
}

function ClassesTab({ editable }: { editable: boolean }) {
  const toast = useToast()

  const { data: classesData } = useClasses()
  const teachersQ = useTeachers()
  const liveTeachers = teachersQ.data ?? []
  const catalogSubjects = useSubjectNames()
  const periodTarget = teachingPeriodCount(PERIODS)
  const updateTeacher = useUpdateTeacher()
  const createClass = useCreateClass()
  const updateClassMut = useUpdateClass()
  const seedDefaults = useEnsureDefaultClasses()
  const [pick, setPick] = useState<ClassRow | null>(null)
  const [pickSel, setPickSel] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [aGrade, setAGrade] = useState('')
  const [aSec, setASec] = useState('')
  const [aRoom, setARoom] = useState('')
  const [aSubjects, setASubjects] = useState<string[]>([])
  const [editRow, setEditRow] = useState<ClassRow | null>(null)
  const [eGrade, setEGrade] = useState('')
  const [eSec, setESec] = useState('')
  const [eRoom, setERoom] = useState('')
  const [eSubjects, setESubjects] = useState<string[]>([])
  const [eOverride, setEOverride] = useState(false)
  const [ePeriods, setEPeriods] = useState(8)
  const periodOverridesQ = useClassPeriodOverrides()
  const periodOverrides = periodOverridesQ.data ?? {}
  const savePeriodOverride = useSaveClassPeriodOverride()
  const periodChoices = periodChoicesForSchool(periodTarget)
  const editPeriods = eOverride ? effectiveClassPeriods(periodTarget, ePeriods) : periodTarget
  const classSubjectsMap = useClassSubjectsMap()
  const subjTick = Object.keys(classSubjectsMap).length

  /** Class name → teacher id from Teachers.classTeacher (set on teacher create/edit). */
  const classTeacherByClass = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of liveTeachers) {
      const key = (t.classTeacher ?? '').trim()
      if (key) m[key] = t.id
    }
    return m
  }, [liveTeachers])

  const liveTeacherName = (id: string): string =>
    liveTeachers.find((t) => t.id === id)?.name ?? '—'

  const liveTeacherOpts = useMemo(
    () => liveTeachers.map((t) => ({
      value: t.id,
      label: `${t.name} · ${t.desig || t.dept}${(t.classTeacher ? ` · CT ${t.classTeacher}` : '')}`,
    })),
    [liveTeachers],
  )

  const rows: ClassRow[] = useMemo(() => {
    return (classesData ?? []).map((c) => {
      const name = c.name || `${c.grade}-${c.section}`
      const fromTeacher = classTeacherByClass[name]
        || classTeacherByClass[`${c.grade}-${c.section}`]
        || ''
      return {
        id: c.id,
        name,
        grade: c.grade,
        section: c.section,
        teacherId: fromTeacher || c.teacherId || '',
        students: c.students,
        room: c.room,
      }
    })
  }, [classesData, classTeacherByClass])

  const openEdit = (r: ClassRow) => {
    setEditRow(r)
    setEGrade(r.grade)
    setESec(r.section)
    setERoom(r.room === '—' ? '' : r.room)
    setESubjects(getClassSubjects(r.id, r.name))
    const saved = r.id ? periodOverrides[r.id] : undefined
    setEOverride(saved != null)
    setEPeriods(saved != null ? effectiveClassPeriods(periodTarget, saved) : suggestedClassPeriods(r.grade, periodTarget))
  }

  const saveEdit = () => {
    if (!editRow?.id) {
      toast.danger('Cannot edit', 'This class has no id yet — refresh and try again.')
      return
    }
    const grade = eGrade.trim()
    const section = eSec.trim()
    if (!grade) { toast.danger('Grade required', 'Enter a grade.'); return }
    const name = section ? `${grade}-${section}` : grade
    const clash = rows.some((r) => r.id !== editRow.id && (r.name === name || (`${r.grade}-${r.section}` === name)))
    if (clash) {
      toast.danger('Class exists', `${name} is already in the list.`)
      return
    }
    const room = eRoom.trim() || '—'
    updateClassMut.mutate(
      { id: editRow.id, patch: { name, grade, section, room, subjects: eSubjects } },
      {
        onSuccess: () => {
          void saveClassSubjects(editRow.id!, name, eSubjects).then(
            async () => {
              await savePeriodOverride.mutateAsync({
                classId: editRow.id!,
                periodCount: eOverride ? ePeriods : null,
              })
              const subLabel = eSubjects.length ? ` · ${eSubjects.length} subjects` : ''
              const periodLabel = eOverride ? ` · ${ePeriods} periods` : ''
              toast.success('Class updated', `${name}${room !== '—' ? ` · Room ${room}` : ''}${subLabel}${periodLabel}.`)
              setEditRow(null)
            },
            (err) => {
              toast.danger(
                'Class saved, subjects not stored',
                err instanceof Error ? err.message : 'Could not save subjects to the server.',
              )
            },
          )
          /* If class was renamed, keep class-teacher link in sync on teachers. */
          if (name !== editRow.name && editRow.teacherId) {
            const t = liveTeachers.find((x) => x.id === editRow.teacherId)
            if (t) {
              updateTeacher.mutate({ id: t.id, teacher: { ...t, classTeacher: name } })
            }
          }
        },
        onError: (err) => {
          toast.danger('Could not update class', err instanceof Error ? err.message : 'Please try again.')
        },
      },
    )
  }

  const gradeSuggestions = useMemo(() => {
    const fromLive = rows.map((r) => r.grade).filter(Boolean)
    return [...new Set([...DEFAULT_GRADES, ...fromLive])]
  }, [rows])
  const sectionSuggestions = useMemo(() => {
    const fromLive = rows.map((r) => r.section).filter(Boolean)
    return [...new Set([...DEFAULT_SECTIONS, ...fromLive])]
  }, [rows])

  const runSeedDefaults = () => {
    if (seedDefaults.isPending) return
    seedDefaults.mutate(classesData, {
      onSuccess: (n) => {
        if (n === 0) toast.info('Already complete', 'Nursery–XII · A/B/C are already present.')
        else toast.success('Default classes added', `${n} classes · Nursery–XII · sections A, B, C.`)
      },
      onError: (err) => {
        toast.danger('Could not add defaults', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  /* Defaults are opt-in via “Add defaults” — so a single added class shows clearly. */

  const openPicker = (r: ClassRow) => {
    setPick(r)
    setPickSel(r.teacherId || liveTeachers[0]?.id || '')
  }

  const assign = () => {
    if (!pick || !pickSel) {
      toast.danger('Pick a teacher', 'Select a teacher to assign as class teacher.')
      return
    }
    const next = liveTeachers.find((t) => t.id === pickSel)
    if (!next) {
      toast.danger('Teacher not found', 'Refresh and try again.')
      return
    }
    const previous = liveTeachers.filter((t) => t.classTeacher === pick.name && t.id !== pickSel)
    const saveOne = (t: Teacher, classTeacher: string | null) =>
      new Promise<void>((resolve, reject) => {
        updateTeacher.mutate(
          { id: t.id, teacher: { ...t, classTeacher } },
          { onSuccess: () => resolve(), onError: (e) => reject(e) },
        )
      })

    void (async () => {
      try {
        for (const t of previous) await saveOne(t, null)
        await saveOne(next, pick.name)
        toast.success('Class teacher assigned', `${next.name} → ${pick.name}.`)
        setPick(null)
      } catch (err) {
        toast.danger('Could not assign', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }
  const addClass = () => {
    const grade = aGrade.trim()
    const section = aSec.trim()
    if (!grade) { toast.danger('Grade required', 'Enter a grade (e.g. VI, 10, Nursery).'); return }
    const name = section ? `${grade}-${section}` : grade
    if (rows.some((r) => r.name === name || (`${r.grade}-${r.section}` === name))) {
      toast.danger('Class exists', `${name} is already in the list.`)
      return
    }
    createClass.mutate(
      { name, grade, section, teacherId: '', students: 0, room: aRoom.trim() || '—', subjects: aSubjects },
      {
        onSuccess: (created) => {
          void saveClassSubjects(created.id ?? '', name, aSubjects).then(
            () => {
              const subLabel = aSubjects.length ? ` · ${aSubjects.length} subjects for timetable` : ''
              toast.success('Class added', `${name} created${subLabel}.`)
              setAddOpen(false)
              setAGrade('')
              setASec('')
              setARoom('')
              setASubjects([])
            },
            (err) => {
              toast.danger(
                'Class created, subjects not stored',
                err instanceof Error ? err.message : 'Could not save subjects to the server.',
              )
            },
          )
        },
        onError: (err) => { toast.danger('Could not add class', err instanceof Error ? err.message : 'Please try again.') },
      },
    )
  }

  const toggleSubject = (list: string[], name: string, set: (next: string[]) => void) => {
    const next = new Set(list)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    set([...next])
  }

  const cols: Column<ClassRow>[] = [
    { key: 'name', label: 'Class', sortValue: (r) => r.name, render: (r) => (
      <div className="row ai-center gap10">
        <span className="sm-card-ic"><Icon name="grid" size={15} /></span>
        <div><div className="fw6">{r.name}</div><div className="t-xs muted">Grade {r.grade}{r.section ? ` · Sec ${r.section}` : ''} · {effectiveClassPeriods(periodTarget, r.id ? periodOverrides[r.id] : null)} periods{r.id && periodOverrides[r.id] != null ? ' · override' : ''}</div></div>
      </div>
    ) },
    { key: 'teacher', label: 'Class teacher', sortValue: (r) => liveTeacherName(r.teacherId), render: (r) => (
      r.teacherId
        ? <Badge tone="brand" icon="user">{liveTeacherName(r.teacherId)}</Badge>
        : editable
          ? <Btn size="sm" variant="secondary" icon="plus" onClick={() => openPicker(r)}>Assign</Btn>
          : <span className="muted t-sm">Unassigned</span>
    ) },
    {
      key: 'subjects', label: 'Subjects',
      sortValue: (r) => getClassSubjects(r.id, r.name).length + subjTick * 0,
      render: (r) => {
        const subs = getClassSubjects(r.id, r.name)
        if (!subs.length) return <span className="muted t-sm">Not mapped</span>
        return (
          <div className="sm-subject-chips" title={subs.join(', ')}>
            {subs.slice(0, 3).map((s) => <Badge key={s} tone="brand" soft>{s}</Badge>)}
            {subs.length > 3 && <Badge tone="neutral" soft>+{subs.length - 3}</Badge>}
          </div>
        )
      },
    },
    { key: 'students', label: 'Students', align: 'center', sortValue: (r) => r.students, render: (r) => <span className="fw6">{r.students}</span> },
    { key: 'room', label: 'Room', sortValue: (r) => r.room, render: (r) => (
      <span className={r.room && r.room !== '—' ? 'fw6' : 'muted'}>{r.room || '—'}</span>
    ) },
    { key: 'act', label: '', render: (r) => editable
      ? (
        <div className="row ai-center gap6 jc-end">
          <Btn size="sm" variant="secondary" icon="edit" onClick={() => openEdit(r)}>Edit</Btn>
          <Btn size="sm" variant="ghost" icon="user" onClick={() => openPicker(r)}>Class teacher</Btn>
        </div>
      )
      : null },
  ]

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="fw6">Classes & sections</div>
          <div className="t-sm muted">
            {rows.length === 0
              ? 'Add a class to show it across CRM · optional Add defaults for Nursery–XII'
              : `${rows.length} class${rows.length === 1 ? '' : 'es'} · subjects feed the timetable`}
          </div>
        </div>
        {editable && (
          <div className="row ai-center gap8 wrap">
            <Btn
              variant="secondary"
              icon="sparkle"
              disabled={seedDefaults.isPending}
              onClick={runSeedDefaults}
            >
              {seedDefaults.isPending ? 'Adding…' : 'Add defaults'}
            </Btn>
            <Btn variant="primary" icon="plus" onClick={() => setAddOpen(true)}>Add class</Btn>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <Empty
          icon="grid"
          title={seedDefaults.isPending ? 'Adding default classes…' : 'No classes yet'}
          body="Add one class to display it across CRM and Timetable — or click Add defaults for Nursery–XII · A/B/C."
        />
      ) : (
        <DataTable<ClassRow> columns={cols} rows={rows} rowKey={(r) => r.name} pageSize={20} initialSort={{ key: 'name', dir: 'asc' }} />
      )}

      {/* assign class-teacher picker */}
      <Modal open={!!pick} onClose={() => setPick(null)} icon="user" title="Assign class teacher" sub={pick ? `Class ${pick.name}` : ''}
        footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={() => setPick(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={assign} disabled={updateTeacher.isPending || !liveTeacherOpts.length}>{updateTeacher.isPending ? 'Saving…' : 'Assign'}</Btn></div>}>
        {liveTeacherOpts.length === 0
          ? <Empty icon="users" title="No teachers yet" body="Onboard a teacher first, then assign them as class teacher." />
          : <Field label="Teacher" hint="Same as Class field on Add / Edit teacher"><Select options={liveTeacherOpts} value={pickSel} onChange={(e) => setPickSel(e.target.value)} /></Field>}
      </Modal>

      {/* add class — grade & section are free text (custom) with suggestions */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} icon="plus" title="Add class"
        footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={addClass}>Add class</Btn></div>}>
        <div className="sm-grid-2 gap12">
          <Field label="Grade" required hint="Custom OK — e.g. VI, 10, Nursery">
            <Input
              list="academics-grade-suggestions"
              icon="cap"
              value={aGrade}
              placeholder="e.g. VI or 10"
              onChange={(e) => setAGrade(e.target.value)}
            />
            <datalist id="academics-grade-suggestions">
              {gradeSuggestions.map((g) => <option key={g} value={g} />)}
            </datalist>
          </Field>
          <Field label="Section" hint="Optional — leave blank if the school has no sections">
            <Input
              list="academics-section-suggestions"
              value={aSec}
              placeholder="e.g. A or Alpha"
              onChange={(e) => setASec(e.target.value)}
            />
            <datalist id="academics-section-suggestions">
              {sectionSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>
        </div>
        <div className="t-xs muted" style={{ marginTop: 4 }}>
          Class name will be <span className="fw6">{aGrade.trim() ? (aSec.trim() ? `${aGrade.trim()}-${aSec.trim()}` : aGrade.trim()) : 'Grade'}</span>
        </div>
        <Field label="Room" hint="Optional — e.g. Room 204"><Input icon="building" value={aRoom} placeholder="Room…" onChange={(e) => setARoom(e.target.value)} /></Field>
        <Field
          label="Subjects"
          hint={subjectsMatchPeriodsHint(aSubjects.length, periodTarget)}
        >
          <div className="row ai-center gap8 wrap" style={{ marginBottom: 8 }}>
            <Badge tone={aSubjects.length === periodTarget ? 'success' : aSubjects.length === 0 ? 'neutral' : 'warning'}>
              {aSubjects.length} / {periodTarget} subjects
            </Badge>
            <span className="t-xs muted">Match Academics → Periods (Class slots). Used when generating the timetable.</span>
          </div>
          {catalogSubjects.length === 0 ? (
            <div className="t-sm muted">No subjects in catalog yet — add them under Academics → Subjects.</div>
          ) : (
            <div className="sm-subject-picks">
              {catalogSubjects.map((name) => (
                <Checkbox
                  key={name}
                  label={name}
                  checked={aSubjects.includes(name)}
                  onChange={() => toggleSubject(aSubjects, name, setASubjects)}
                />
              ))}
            </div>
          )}
        </Field>
      </Modal>

      {/* edit class — set classroom / room, rename grade·section */}
      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        icon="edit"
        title="Edit class"
        sub={editRow ? editRow.name : ''}
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={saveEdit} disabled={updateClassMut.isPending}>
              {updateClassMut.isPending ? 'Saving…' : 'Save'}
            </Btn>
          </div>
        )}
      >
        <div className="sm-grid-2 gap12">
          <Field label="Grade" required>
            <Input
              list="academics-edit-grade-suggestions"
              icon="cap"
              value={eGrade}
              placeholder="e.g. VI or 10"
              onChange={(e) => setEGrade(e.target.value)}
            />
            <datalist id="academics-edit-grade-suggestions">
              {gradeSuggestions.map((g) => <option key={g} value={g} />)}
            </datalist>
          </Field>
          <Field label="Section" hint="Optional — leave blank if the school has no sections">
            <Input
              list="academics-edit-section-suggestions"
              value={eSec}
              placeholder="e.g. A or Alpha"
              onChange={(e) => setESec(e.target.value)}
            />
            <datalist id="academics-edit-section-suggestions">
              {sectionSuggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          </Field>
        </div>
        <div className="t-xs muted" style={{ marginTop: 4 }}>
          Class name will be <span className="fw6">{eGrade.trim() ? (eSec.trim() ? `${eGrade.trim()}-${eSec.trim()}` : eGrade.trim()) : 'Grade'}</span>
        </div>
        <Field label="Classroom / room" hint="e.g. Room 204, Lab 1, Block B-12">
          <Input icon="building" value={eRoom} placeholder="Room number or name…" onChange={(e) => setERoom(e.target.value)} />
        </Field>
        <Field
          label="Periods per day"
          hint={eOverride
            ? `This class uses Periods 1–${editPeriods} from the school bell. Later periods are not generated.`
            : `Uses the full school bell (${periodTarget} teaching periods). Turn on override for a shorter day.`}
        >
          <Checkbox
            label="Override periods"
            checked={eOverride}
            onChange={() => {
              setEOverride((on) => {
                if (!on) setEPeriods(suggestedClassPeriods(eGrade, periodTarget))
                return !on
              })
            }}
          />
          {eOverride && periodChoices.length > 0 && (
            <div style={{ marginTop: 8, maxWidth: 220 }}>
              <Select
                value={String(editPeriods)}
                options={periodChoices.map((n) => ({ value: String(n), label: `${n} periods (P1–P${n})` }))}
                onChange={(e) => setEPeriods(Number(e.target.value))}
              />
            </div>
          )}
        </Field>
        <Field
          label="Subjects"
          hint={subjectsMatchPeriodsHint(eSubjects.length, editPeriods)}
        >
          <div className="row ai-center gap8 wrap" style={{ marginBottom: 8 }}>
            <Badge tone={eSubjects.length === editPeriods ? 'success' : eSubjects.length === 0 ? 'neutral' : 'warning'}>
              {eSubjects.length} / {editPeriods} subjects
            </Badge>
            <span className="t-xs muted">Same count as this class’s periods → clean auto-generate.</span>
          </div>
          {catalogSubjects.length === 0 ? (
            <div className="t-sm muted">No subjects in catalog yet.</div>
          ) : (
            <div className="sm-subject-picks">
              {catalogSubjects.map((name) => (
                <Checkbox
                  key={name}
                  label={name}
                  checked={eSubjects.includes(name)}
                  onChange={() => toggleSubject(eSubjects, name, setESubjects)}
                />
              ))}
            </div>
          )}
        </Field>
      </Modal>
    </Card>
  )
}

/* ============================================================
   2 · Timetable builder (centerpiece)
   ============================================================ */
function TeacherChips({ subject, ids, onChange, editable }: {
  subject: string; ids: string[]; onChange: (ids: string[]) => void; editable: boolean
}) {
  const teachers = useLiveTeachersPool()
  const pool = qualified(teachers, subject)
  const avail = pool.filter((t) => !ids.includes(t.id))
  return (
    <div className="row ai-center gap6 wrap">
      {ids.map((id) => (
        <span key={id} className="sm-badge soft sm-badge-brand" style={{ gap: 4 }}>
          <Icon name="user" size={11} />{teacherName(teachers, id)}
          {editable && ids.length > 1 && (
            <button onClick={() => onChange(ids.filter((x) => x !== id))} aria-label="Remove"
              style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', padding: 0, marginLeft: 2 }}>
              <Icon name="x" size={11} />
            </button>
          )}
        </span>
      ))}
      {editable && ids.length < 3 && avail.length > 0 && (
        <Select style={{ minWidth: 130, height: 30 }} value=""
          options={[{ value: '', label: '+ Add teacher' }, ...avail.map((t) => ({ value: t.id, label: t.name }))]}
          onChange={(e) => { if (e.target.value) onChange([...ids, e.target.value]) }} />
      )}
      {pool.length === 0 && ids.length === 0 && (
        <span className="t-xs muted3">No teacher for this subject — assign it on the teacher’s profile.</span>
      )}
    </div>
  )
}

/* ---- Pivot views (teacher-wise / subject-wise) over the class grids ---- */
type GridsState = Record<string, Grid>
interface ViewProps { grids: GridsState; setGrids: Dispatch<SetStateAction<GridsState>>; editable: boolean }
interface PivotEdit { cls: string; d: number; p: number; subject: string; current: string }

function PivotGrid({
  renderCell,
  bellTimes,
}: {
  renderCell: (d: number, p: number) => ReactNode
  bellTimes?: typeof DEFAULT_CLASS_BELL_TIMES
}) {
  const rowsDesc: ({ type: 'period'; p: number } | { type: 'lunch' })[] = []
  for (let p = 0; p < PERIODS; p++) { rowsDesc.push({ type: 'period', p }); if (p === LUNCH_AFTER - 1) rowsDesc.push({ type: 'lunch' }) }
  return (
    <Card style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${DAYS.length}, minmax(88px, 1fr))`, gap: 6, minWidth: 700 }}>
        <div />
        {DAYS.map((d) => <div key={d} className="t-xs fw6 ta-center muted" style={{ padding: '4px 0' }}>{d}</div>)}
        {rowsDesc.map((rd, ri) => rd.type === 'lunch' ? (
          <Fragment key={`lunch-${ri}`}>
            <div className="t-xs muted" style={{ display: 'flex', justifyContent: 'center' }}><Icon name="clock" size={13} /></div>
            <div className="t-xs fw6 muted" style={{ gridColumn: `2 / span ${DAYS.length}`, textAlign: 'center', padding: '6px 0', background: 'var(--surface-2)', borderRadius: 8 }}>Lunch break</div>
          </Fragment>
        ) : (
          <Fragment key={`p-${rd.p}`}>
            <div className="t-xs fw6 muted" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15, gap: 1 }}>
              <span>P{rd.p + 1}</span>
              {bellTimes?.[rd.p + 1] ? (
                <span className="t-xs muted3" style={{ fontWeight: 500, fontSize: 9 }}>
                  {bellTimes[rd.p + 1].start}
                </span>
              ) : null}
            </div>
            {DAYS.map((_d, di) => <Fragment key={di}>{renderCell(di, rd.p)}</Fragment>)}
          </Fragment>
        ))}
      </div>
    </Card>
  )
}

function PivotCellEditor({ edit, grids, setGrids, onClose }: { edit: PivotEdit | null; grids: GridsState; setGrids: Dispatch<SetStateAction<GridsState>>; onClose: () => void }) {
  const [tid, setTid] = useState('')
  useEffect(() => { setTid(edit?.current ?? '') }, [edit])
  if (!edit) return null
  const e = edit
  const save = () => {
    setGrids((prev) => ({ ...prev, [e.cls]: { ...(prev[e.cls] ?? {}), [cellKey(e.d, e.p)]: { subject: e.subject, teacherId: tid } } }))
    onClose()
  }
  const clear = () => {
    setGrids((prev) => ({ ...prev, [e.cls]: { ...(prev[e.cls] ?? {}), [cellKey(e.d, e.p)]: null } }))
    onClose()
  }
  return (
    <Modal open={!!edit} onClose={onClose} size="sm" icon="user"
      title="Edit slot" sub={`${e.subject} · ${e.cls} · ${DAYS[e.d]} P${e.p + 1}`}
      footer={
        <div className="row ai-center jc-between" style={{ width: '100%' }}>
          <Btn variant="danger" icon="trash" onClick={clear}>Clear slot</Btn>
          <div className="row gap8"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" icon="check" onClick={save}>Save</Btn></div>
        </div>
      }>
      <PivotTeacherPicker subject={e.subject} grids={grids} cls={e.cls} d={e.d} p={e.p} tid={tid} setTid={setTid} />
    </Modal>
  )
}

function PivotTeacherPicker({ subject, grids, cls, d, p, tid, setTid }: {
  subject: string; grids: GridsState; cls: string; d: number; p: number; tid: string; setTid: (id: string) => void
}) {
  const teachers = useLiveTeachersPool()
  return (
    <div className="col gap8">
      {qualified(teachers, subject).length === 0 && (
        <Empty icon="users" title="No teachers yet" body="Onboard teachers first, then assign them to timetable slots." />
      )}
      {qualified(teachers, subject).map((t) => {
        const busy = clashingClass(grids, t.id, d, p, cls)
        const sel = tid === t.id
        return (
          <button key={t.id} onClick={() => setTid(t.id)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%',
              border: `1px solid ${sel ? (busy ? 'var(--danger)' : 'var(--brand-600)') : 'var(--border)'}`, borderRadius: 10, padding: '9px 11px',
              background: sel ? (busy ? 'var(--danger-bg)' : 'var(--brand-50)') : 'var(--surface)', textAlign: 'left', cursor: 'pointer' }}>
            <div className="row ai-center gap8" style={{ minWidth: 0 }}>
              <Icon name={sel ? 'checkCircle' : 'user'} size={15} />
              <div style={{ minWidth: 0 }}><div className="fw6 t-sm">{t.name}</div><div className="t-xs muted3">{t.dept}</div></div>
            </div>
            {busy ? <Badge tone="danger" icon="alert">busy in {busy}</Badge> : <Badge tone="success">free</Badge>}
          </button>
        )
      })}
    </div>
  )
}

function hasAnyGrid(grids: GridsState): boolean {
  return Object.values(grids).some((g) => Object.values(g).some((c) => !!c))
}

function TeacherView({ grids, setGrids, editable, onTeacherChange }: ViewProps & { onTeacherChange?: (id: string) => void }) {
  const teachers = useLiveTeachersPool()
  const opts = teacherOptsOf(teachers)
  const [tid, setTid] = useState('')
  useEffect(() => {
    if (!tid && teachers[0]) setTid(teachers[0].id)
    else if (tid && teachers.length && !teachers.some((t) => t.id === tid)) setTid(teachers[0]?.id ?? '')
  }, [teachers, tid])
  useEffect(() => { if (tid) onTeacherChange?.(tid) }, [tid, onTeacherChange])
  const [edit, setEdit] = useState<PivotEdit | null>(null)
  const sched = useMemo(() => teacherSchedule(grids, tid), [grids, tid])

  if (!hasAnyGrid(grids)) return <Empty icon="calendar" title="No timetables yet" body="Build class timetables in the Class view first, then view them by teacher." />
  if (!teachers.length) return <Empty icon="users" title="No teachers yet" body="Onboard teachers in People, then view their timetable here." />

  return (
    <div className="col gap12">
      <Card><div className="row ai-center gap12 wrap"><Field label="Teacher"><Select style={{ minWidth: 200 }} options={opts} value={tid} onChange={(e) => setTid(e.target.value)} /></Field></div></Card>
      <PivotGrid renderCell={(d, p) => {
        const entries = sched[cellKey(d, p)] ?? []
        if (!entries.length) return <div style={{ minHeight: 56, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
        const clash = entries.length > 1
        const st = subjStyle(entries[0].subject)
        const first = entries[0]
        return (
          <button onClick={() => { if (editable) setEdit({ cls: first.cls, d, p, subject: first.subject, current: tid }) }} disabled={!editable}
            style={{ minHeight: 56, borderRadius: 8, padding: 6, textAlign: 'left', cursor: editable ? 'pointer' : 'default',
              border: `${clash ? '2px' : '1px'} solid ${clash ? 'var(--danger)' : st.bd}`, background: st.bg, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
            {entries.map((en, i) => (
              <span key={i} className="t-xs" style={{ color: clash ? 'var(--danger)' : st.fg, display: 'flex', alignItems: 'center', gap: 3 }}>
                {clash && i === 0 && <Icon name="alert" size={11} />}<span className="fw6">{en.cls}</span> · {en.subject}
              </span>
            ))}
          </button>
        )
      }} />
      <PivotCellEditor edit={edit} grids={grids} setGrids={setGrids} onClose={() => setEdit(null)} />
    </div>
  )
}

function SubjectView({ grids, setGrids, editable, subjectNames, onSubjectChange }: ViewProps & { subjectNames: string[]; onSubjectChange?: (name: string) => void }) {
  const teachers = useLiveTeachersPool()
  const [subj, setSubj] = useState(subjectNames[0] ?? '')
  const [edit, setEdit] = useState<PivotEdit | null>(null)
  const sched = useMemo(() => subjectSchedule(grids, subj), [grids, subj])

  useEffect(() => {
    if (!subj && subjectNames[0]) setSubj(subjectNames[0])
    else if (subj && subjectNames.length && !subjectNames.includes(subj)) setSubj(subjectNames[0])
  }, [subjectNames, subj])

  useEffect(() => { if (subj) onSubjectChange?.(subj) }, [subj, onSubjectChange])

  if (!subjectNames.length) {
    return <Empty icon="book" title="No subjects yet" body="Add subjects under Academics → Subjects first." />
  }
  if (!hasAnyGrid(grids)) return <Empty icon="calendar" title="No timetables yet" body="Build class timetables in the Class view first, then view them by subject." />

  const st = subjStyle(subj)
  return (
    <div className="col gap12">
      <Card><div className="row ai-center gap12 wrap"><Field label="Subject"><Select style={{ minWidth: 200 }} options={subjectNames} value={subj} onChange={(e) => setSubj(e.target.value)} /></Field></div></Card>
      <PivotGrid renderCell={(d, p) => {
        const entries = sched[cellKey(d, p)] ?? []
        if (!entries.length) return <div style={{ minHeight: 56, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
        const clash = entries.length > 1
        const first = entries[0]
        return (
          <button onClick={() => { if (editable) setEdit({ cls: first.cls, d, p, subject: subj, current: first.teacherId }) }} disabled={!editable}
            style={{ minHeight: 56, borderRadius: 8, padding: 6, textAlign: 'left', cursor: editable ? 'pointer' : 'default',
              border: `${clash ? '2px' : '1px'} solid ${clash ? 'var(--danger)' : st.bd}`, background: st.bg, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
            {entries.map((en, i) => (
              <span key={i} className="t-xs" style={{ color: clash ? 'var(--danger)' : st.fg, display: 'flex', alignItems: 'center', gap: 3 }}>
                {clash && i === 0 && <Icon name="alert" size={11} />}<span className="fw6">{en.cls}</span> · {teacherName(teachers, en.teacherId)}
              </span>
            ))}
          </button>
        )
      }} />
      <PivotCellEditor edit={edit} grids={grids} setGrids={setGrids} onClose={() => setEdit(null)} />
    </div>
  )
}

function ClassOverview({ grids, classList }: { grids: GridsState; classList: string[] }) {
  const teachers = useLiveTeachersPool()
  const built = classList.filter((c) => grids[c] && Object.values(grids[c]).some(Boolean))
  if (built.length === 0) return <Empty icon="calendar" title="No timetables yet" body="Build class timetables in the Class view first to see the class-wise overview." />
  return (
    <div className="col gap16">
      {built.map((cls) => {
        const grid = grids[cls] ?? {}
        const conflicts = conflictsFor(grids, cls)
        return (
          <div key={cls} className="col gap8">
            <div className="row ai-center jc-between">
              <div className="fw6">{cls}</div>
              {conflicts.size > 0
                ? <Badge tone="danger" icon="alert">{conflicts.size} clash{conflicts.size > 1 ? 'es' : ''}</Badge>
                : <Badge tone="success" icon="checkCircle">No clashes</Badge>}
            </div>
            <PivotGrid renderCell={(d, p) => {
              const key = cellKey(d, p)
              const cell = grid[key]
              if (!cell) return <div style={{ minHeight: 56, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)' }} />
              const isClash = conflicts.has(key)
              const st = subjStyle(cell.subject)
              return (
                <div style={{ minHeight: 56, borderRadius: 8, padding: 6,
                  border: `${isClash ? '2px' : '1px'} solid ${isClash ? 'var(--danger)' : st.bd}`, background: st.bg,
                  display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
                  <span className="fw6 t-xs" style={{ color: st.fg }}>{cell.subject}</span>
                  <span className="t-xs" style={{ display: 'flex', alignItems: 'center', gap: 3, color: isClash ? 'var(--danger)' : 'var(--text-2)' }}>
                    {isClash && <Icon name="alert" size={11} />}{teacherName(teachers, cell.teacherId)}
                  </span>
                </div>
              )
            }} />
          </div>
        )
      })}
    </div>
  )
}

/* Per-class timetable publish status — compares one class's current grid against its
   last published baseline (hydrated from live slots). Replaces the old whole-school
   status that flagged every class 'published' whenever any slot row existed anywhere. */
function canonicalClassGrid(grid: Grid | undefined): string {
  if (!grid) return ''
  const keys = Object.keys(grid).filter((k) => grid[k]).sort()
  if (!keys.length) return ''
  return JSON.stringify(keys.map((k) => { const c = grid[k] as Cell; return [k, c.subject, c.teacherId] }))
}
function timetableHistorySummary(snapshotJson: string | null): string {
  if (!snapshotJson) return 'Empty timetable'
  try {
    const snap = JSON.parse(snapshotJson) as { grids?: Record<string, Grid> }
    const classes = Object.entries(snap.grids ?? {}).filter(([, grid]) => Object.values(grid ?? {}).some(Boolean))
    if (!classes.length) return 'Empty timetable'
    const periods = classes.reduce((n, [, grid]) => n + Object.values(grid).filter(Boolean).length, 0)
    const names = classes.map(([name]) => name)
    const shown = names.slice(0, 3).join(', ')
    const extra = names.length > 3 ? ` +${names.length - 3}` : ''
    return `${shown}${extra} · ${periods} period${periods === 1 ? '' : 's'}`
  } catch {
    return 'Saved timetable'
  }
}

function timetableClassStatus(published: Grid | undefined, current: Grid | undefined): PublishStatus {
  const pub = canonicalClassGrid(published)
  const cur = canonicalClassGrid(current)
  if (!pub && !cur) return 'empty'
  if (!pub) return 'draft'
  if (pub === cur) return 'published'
  return 'unpublished'
}

function TimetableTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const app = useApp()
  const qc = useQueryClient()
  const { register } = useAcademicsActions()
  const classList = useClassNames()
  const { data: classesData } = useClasses()
  const catalogSubjects = useSubjectNames()
  const teachers = useLiveTeachersPool()
  const teacherOpts = teacherOptsOf(teachers)
  type TimetableSnap = { grids: Record<string, Grid>; mode: Record<string, 'choice' | 'build'> }
  const [pubMeta, setPubMeta] = useState(() => loadPublishEnvelope<TimetableSnap>('timetable'))
  const initialSnap = activeSnapshot(pubMeta, editable, { grids: {}, mode: {} } as TimetableSnap)
  const [cls, setCls] = useState('')
  const [view, setView] = useState<'class' | 'teacher' | 'subject' | 'overview'>('class')
  const [grids, setGrids] = useState<Record<string, Grid>>(() => initialSnap.grids ?? {})
  const [mode, setMode] = useState<Record<string, 'choice' | 'build'>>(() => initialSnap.mode ?? {})
  const [classTeachers, setClassTeachers] = useState<Record<string, string>>({})
  const [bellTimes, setBellTimes] = useState(DEFAULT_CLASS_BELL_TIMES)
  const [liveReady, setLiveReady] = useState(() => hasFilledGrid(initialSnap.grids ?? {}))
  const [history, setHistory] = useState<TimetableHistoryEntry[]>([])
  const teachersRef = useRef(teachers)
  teachersRef.current = teachers

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const periodsEnv = await fetchPublishEnvelope<PeriodRow[]>('periods')
        if (cancelled) return
        const periodRows = activeSnapshot(periodsEnv, true, DEFAULT_PERIODS)
        const fromPeriods = bellTimesFromPeriodRows(periodRows)
        if (Object.keys(fromPeriods).length) setBellTimes(fromPeriods)
      } catch {
        /* keep DEFAULT_CLASS_BELL_TIMES */
      }
    })()
    return () => { cancelled = true }
  }, [])

  const selectedClassRow = useMemo(
    () => (classesData ?? []).find((c) => (c.name || `${c.grade}-${c.section}`) === cls),
    [classesData, cls],
  )
  const assignedSubjects = useClassSubjects(selectedClassRow?.id, cls)
  const { data: periodOverrides = {} } = useClassPeriodOverrides()
  const schoolPeriods = teachingPeriodCount(PERIODS)
  const classPeriods = effectiveClassPeriods(schoolPeriods, selectedClassRow?.id ? periodOverrides[selectedClassRow.id] : null)
  const periodTarget = classPeriods
  const totalSlots = classPeriods * DAYS.length
  /* Only the class's own mapped subjects drive generate/palette — NO generic-catalog
     fallback. A class with no mapped subjects cannot generate/build a timetable; the
     empty-state below tells the admin to map subjects first. */
  const subjectNames = assignedSubjects
  const subjectsAligned = assignedSubjects.length > 0 && assignedSubjects.length === periodTarget

  useEffect(() => {
    setClassTeachers((prev) => {
      const m = { ...prev }
      for (const t of teachers) {
        if (t.classTeacher && !m[t.classTeacher]) m[t.classTeacher] = t.id
      }
      return m
    })
  }, [teachers])

  useEffect(() => {
    if (!cls && classList.length) setCls(classList[0])
    else if (cls && classList.length && !classList.includes(cls)) setCls(classList[0])
  }, [classList, cls])

  /* per-subject teacher roster (1–3), shared by palette + auto config */
  const [subjTeachers, setSubjTeachers] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!subjectNames.length) {
      setSubjTeachers({})
      return
    }
    setSubjTeachers((prev) => {
      const next: Record<string, string[]> = {}
      for (const s of subjectNames) {
        const cur = prev[s] ?? []
        if (cur.length) next[s] = cur
        else {
          const first = qualified(teachers, s)[0]
          next[s] = first ? [first.id] : []
        }
      }
      return next
    })
  }, [teachers, subjectNames])

  /* per-subject periods-per-week for the generator */
  const [ppw, setPpw] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!subjectNames.length) {
      setPpw({})
      return
    }
    /* When subjects match periods, give each subject one slot per weekday (fills the week). */
    if (subjectNames.length === periodTarget) {
      setPpw(Object.fromEntries(subjectNames.map((s) => [s, DAYS.length])))
      return
    }
    const base = Math.floor(totalSlots / subjectNames.length)
    let extra = totalSlots - base * subjectNames.length
    setPpw(Object.fromEntries(subjectNames.map((s) => [s, base + (extra-- > 0 ? 1 : 0)])))
  }, [subjectNames, periodTarget])
  const [brush, setBrush] = useState('')
  const [viewTeacherId, setViewTeacherId] = useState('')
  const [viewSubjectName, setViewSubjectName] = useState('')
  const [placeCounts, setPlaceCounts] = useState<Record<string, number>>({})
  const [cfgOpen, setCfgOpen] = useState(false)
  /* per-cell teacher override (works on auto-generated routines too) */
  const [editCell, setEditCell] = useState<{ key: string; d: number; p: number; subject: string; current: string } | null>(null)
  const [editTid, setEditTid] = useState('')
  /* clash confirmation popup when a manual placement would double-book a teacher */
  const [clashPrompt, setClashPrompt] = useState<{ d: number; p: number; subject: string; tid: string; others: string[]; onConfirm: () => void } | null>(null)

  const g = clipGridToPeriods(grids[cls] ?? {}, classPeriods)
  const m = classTimetableMode(mode[cls], g)
  const conflicts = useMemo(() => conflictsFor(grids, cls), [grids, cls])
  const loads = useMemo(() => teacherLoads(grids), [grids])
  const clashers = useMemo(() => clashingTeachers(grids), [grids])
  const filled = Object.values(g).filter((c): c is Cell => !!c).length
  const ctId = classTeachers[cls] ?? ''
  const pivotSubjects = useMemo(() => {
    const placed = subjectsInGrids(grids)
    return [...new Set([...catalogSubjects, ...placed])]
  }, [catalogSubjects, grids])

  const snap: TimetableSnap = useMemo(() => ({ grids, mode }), [grids, mode])
  /* Per-class status: compare THIS class's grid to its published baseline (not a global flag). */
  const publishedGrids = (pubMeta.published as TimetableSnap | null)?.grids ?? {}
  const status = timetableClassStatus(publishedGrids[cls], grids[cls])
  const showPublishClass = status === 'draft' || status === 'unpublished'
  const anyClash = useMemo(() => {
    for (const c of Object.keys(grids)) {
      if (conflictsFor(grids, c).size > 0) return true
    }
    return false
  }, [grids])

  const saveDraft = () => {
    void (async () => {
      try {
        const next = await saveDraftSnapshot('timetable', snap)
        setPubMeta(next)
        setHistory(await listTimetableHistory())
        const n = conflicts.size
        if (n > 0) toast.danger('Draft saved with clashes', `${cls} draft (${filled}/${totalSlots}) · ${n} clash${n > 1 ? 'es' : ''} — resolve before publishing.`)
        else toast.success('Draft saved', `${cls} routine saved as draft (${filled}/${totalSlots} periods).`)
      } catch (err) {
        toast.danger('Could not save draft', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }
  const [publishing, setPublishing] = useState(false)
  const publish = () => {
    if (anyClash || publishing) {
      if (anyClash) toast.danger('Cannot publish', 'Resolve all teacher clashes before publishing the timetable.')
      return
    }
    void (async () => {
      setPublishing(true)
      try {
        const { slotCount, subjectsCreated } = await syncTimetableToBackend()
        const next = await publishSnapshot('timetable', snap)
        setPubMeta(next)
        setHistory(await listTimetableHistory())
        void qc.invalidateQueries({ queryKey: queryKeys.subjects.all })
        void qc.invalidateQueries({ queryKey: queryKeys.timetable.all() })
        toast.success(
          'Timetable published',
          `${slotCount} periods saved with bell times` +
            (subjectsCreated > 0 ? ` · ${subjectsCreated} subjects added to catalog` : '') +
            ' · all apps notified.',
        )
      } catch (err) {
        toast.danger(
          'Publish failed',
          err instanceof Error ? err.message : 'Could not save timetable to the server. Draft is unchanged — retry when online.',
        )
      } finally {
        setPublishing(false)
      }
    })()
  }

  /** Persist subjects + published slots to SQL. Throws on failure — caller must not toast success. */
  const syncTimetableToBackend = async (): Promise<{ slotCount: number; subjectsCreated: number }> => {
    const classIdFor = (className: string) => {
      const row = (classesData ?? []).find((c) => (c.name || `${c.grade}-${c.section}`) === className)
      return row?.id ?? null
    }
    const unresolved = Object.keys(grids).filter((name) => hasFilledGrid({ [name]: grids[name] ?? {} }) && !classIdFor(name))
    if (unresolved.length) {
      throw new Error(
        `Class name(s) not found in Classes: ${unresolved.join(', ')}. Rename the grid to match People → Classes exactly.`,
      )
    }

    const usedSubjects = new Set<string>()
    for (const grid of Object.values(grids)) {
      for (const cell of Object.values(grid)) {
        if (cell?.subject?.trim()) usedSubjects.add(cell.subject.trim())
      }
    }
    // Seed defaults once, then ensure every grid subject exists in /subjects.
    await ensureDefaultSubjects()
    const { created: subjectsCreated } = await ensureSubjectsNamed([...usedSubjects])

    const remote = await listTimetable()
    let bell = DEFAULT_CLASS_BELL_TIMES
    try {
      const periodsEnv = await fetchPublishEnvelope<PeriodRow[]>('periods')
      const periodRows = activeSnapshot(periodsEnv, true, DEFAULT_PERIODS)
      const fromPeriods = bellTimesFromPeriodRows(periodRows)
      if (Object.keys(fromPeriods).length) bell = fromPeriods
    } catch {
      /* use DEFAULT_CLASS_BELL_TIMES */
    }
    const periodsForClass = (className: string) => {
      const row = (classesData ?? []).find((c) => (c.name || `${c.grade}-${c.section}`) === className)
      return effectiveClassPeriods(schoolPeriods, row?.id ? periodOverrides[row.id] : null)
    }
    const clippedGrids = Object.fromEntries(
      Object.entries(grids).map(([name, grid]) => [name, clipGridToPeriods(grid, periodsForClass(name))]),
    )
    const plan = planTimetableSync(
      clippedGrids,
      DAYS,
      classIdFor,
      remote.map((r) => ({ id: r.id, day: r.day, period: r.period, classId: r.classId })),
      bell,
    )
    if (plan.ownedClassIds.length === 0) {
      throw new Error('No classes to publish. Build at least one class timetable first.')
    }
    if (plan.toCreate.length === 0) {
      throw new Error('Timetable grids are empty. Place periods before publishing.')
    }
    const missingBell = plan.toCreate.filter((t) => !t.startTime || !t.endTime)
    if (missingBell.length) {
      throw new Error(
        `${missingBell.length} periods have no bell time. Publish Periods first, or use the default Class schedule (P1–P8).`,
      )
    }
    await replaceTimetableSlots({
      classIds: plan.ownedClassIds,
      slots: plan.toCreate.map((t) => ({
        day: t.day,
        period: t.period,
        subject: t.subject,
        classId: t.classId,
        className: t.className,
        teacherId: t.teacherId,
        startTime: t.startTime,
        endTime: t.endTime,
      })),
    })
    return { slotCount: plan.toCreate.length, subjectsCreated }
  }

  /* Hydrate editor from the saved draft/published envelope, else from live GET /timetable
     (schools that published slots before the envelope existed). */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const env = await fetchPublishEnvelope<TimetableSnap>('timetable')
        if (cancelled) return
        setPubMeta(env)
        try { setHistory(await listTimetableHistory()) } catch { /* history is optional beside the grid */ }
        const snap = activeSnapshot(env, editable, { grids: {}, mode: {} } as TimetableSnap)
        const hasEnvelope = env.draft != null || env.published != null
        if (hasFilledGrid(snap.grids ?? {}) || hasEnvelope) {
          const gridsSnap = snap.grids ?? {}
          setGrids(gridsSnap)
          const modeMap = { ...(snap.mode ?? {}) }
          for (const [name, grid] of Object.entries(gridsSnap)) {
            if (Object.values(grid).some(Boolean)) modeMap[name] = 'build'
          }
          setMode(modeMap)
          return
        }
        const remote = await listTimetable()
        if (cancelled || !remote.length) return
        const hydrated = gridsFromRemoteSlots(remote, DAYS, (name) => {
          const t = teachersRef.current.find((x) => x.name === name)
          return t?.id ?? null
        })
        if (!hasFilledGrid(hydrated)) return
        const modeMap = Object.fromEntries(Object.keys(hydrated).map((c) => [c, 'build' as const]))
        setGrids(hydrated)
        setMode(modeMap)
        setPubMeta({
          draft: null,
          published: { grids: hydrated, mode: modeMap },
          draftSavedAt: null,
          publishedAt: new Date().toISOString(),
        })
      } catch {
        /* leave empty grids — admin can still build */
      } finally {
        if (!cancelled) setLiveReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [editable])

  useEffect(() => {
    if (!editable) { register('timetable', null); return }
    register('timetable', {
      saveDraft,
      publish,
      status,
      canPublish: !anyClash && !publishing && subjectNames.length > 0,
      showPublish: showPublishClass,
      draftSavedAt: pubMeta.draftSavedAt,
      publishedAt: pubMeta.publishedAt,
    })
    return () => register('timetable', null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, status, snap, anyClash, publishing, pubMeta.draftSavedAt, pubMeta.publishedAt, subjectNames.length])

  const setSubjTeam = (s: string, ids: string[]) => setSubjTeachers((p) => ({ ...p, [s]: ids }))

  /* ---- manual click-to-place ---- */
  const place = (d: number, p: number) => {
    if (!editable || m !== 'build') return
    const key = cellKey(d, p)
    if (!brush) {
      const existing = g[key]
      if (existing) { setEditCell({ key, d, p, subject: existing.subject, current: existing.teacherId }); setEditTid(existing.teacherId) }
      else toast.info('Pick a subject', 'Choose a subject from the palette (or Erase) first — or tap a filled cell to change its teacher.')
      return
    }
    if (brush === ERASE) { setGrids((prev) => ({ ...prev, [cls]: { ...(prev[cls] ?? {}), [key]: null } })); return }
    const team = subjTeachers[brush] ?? []
    const c = placeCounts[brush] ?? 0
    const tid = team.length ? team[c % team.length] : ''
    const others = tid ? clashingClasses(grids, tid, d, p, cls) : []
    if (others.length) { setClashPrompt({ d, p, subject: brush, tid, others, onConfirm: () => doPlace(key, brush, tid) }); return }
    doPlace(key, brush, tid)
  }

  /* commit a placement + advance the subject's teacher rotation */
  const doPlace = (key: string, subject: string, tid: string) => {
    setGrids((prev) => ({ ...prev, [cls]: { ...(prev[cls] ?? {}), [key]: { subject, teacherId: tid } } }))
    setPlaceCounts((prev) => ({ ...prev, [subject]: (prev[subject] ?? 0) + 1 }))
  }

  const applyTeacher = () => {
    if (!editCell) return
    const ec = editCell
    const commit = () => setGrids((prev) => ({ ...prev, [cls]: { ...(prev[cls] ?? {}), [ec.key]: { subject: ec.subject, teacherId: editTid } } }))
    const others = editTid ? clashingClasses(grids, editTid, ec.d, ec.p, cls) : []
    setEditCell(null)
    if (others.length) { setClashPrompt({ d: ec.d, p: ec.p, subject: ec.subject, tid: editTid, others, onConfirm: commit }); return }
    commit()
  }

  const startManual = () => { setGrids((p) => ({ ...p, [cls]: {} })); setMode((p) => ({ ...p, [cls]: 'build' })) }
  const clearGrid = () => { setGrids((p) => ({ ...p, [cls]: {} })); setPlaceCounts({}) }
  const restart = () => { setMode((p) => ({ ...p, [cls]: 'choice' })); setGrids((p) => ({ ...p, [cls]: {} })); setPlaceCounts({}) }

  /* ---- auto generate: diagonal walk so periods don't repeat the same day-row ---- */
  const cfgTotal = Object.values(ppw).reduce((a, b) => a + b, 0)
  const generate = () => {
    const next = generateAutoTimetableGrid(DAYS.length, classPeriods, subjectNames, ppw)
    const rot: Record<string, number> = {}
    for (const [key, cell] of Object.entries(next)) {
      if (!cell) continue
      const [d, p] = key.split('-').map(Number)
      const team = subjTeachers[cell.subject] ?? []
      const tid = pickTeacher(grids, team, d, p, cls, rot[cell.subject] ?? 0)
      rot[cell.subject] = (rot[cell.subject] ?? 0) + 1
      cell.teacherId = tid
    }
    const nextGrids = { ...grids, [cls]: next }
    const nextMode = { ...mode, [cls]: 'build' as const }
    setGrids(nextGrids)
    setMode(nextMode)
    setPlaceCounts({})
    setCfgOpen(false)
    void saveDraftSnapshot('timetable', { grids: nextGrids, mode: nextMode })
      .then((env) => {
        setPubMeta(env)
        return listTimetableHistory().then(setHistory)
      })
      .catch(() => { /* keep generated grid even if draft persist fails */ })
    const clashCount = conflictsFor({ ...grids, [cls]: next }, cls).size
    const filledCount = Object.values(next).filter(Boolean).length
    toast.success('Timetable generated', `${filledCount} periods placed for ${cls} · ${clashCount === 0 ? '0 clashes' : `${clashCount} clash${clashCount > 1 ? 'es' : ''} to review`}.`)
  }

  /* grid rows incl. fixed lunch break — only this class's teaching periods */
  const rowsDesc: ({ type: 'period'; p: number } | { type: 'lunch' })[] = []
  for (let p = 0; p < classPeriods; p++) { rowsDesc.push({ type: 'period', p }); if (p === LUNCH_AFTER - 1) rowsDesc.push({ type: 'lunch' }) }

  const printView: TimetablePrintView = view === 'overview' ? 'overview' : view === 'teacher' ? 'teacher' : view === 'subject' ? 'subject' : 'class'
  const handlePrintPdf = () => {
    type TimetableSnap = { grids: Record<string, Grid>; mode: Record<string, 'choice' | 'build'> }
    const publishedGrids = (pubMeta.published as TimetableSnap | null)?.grids
    const printGrids = hasPrintableTimetable(grids) ? grids : (publishedGrids ?? grids)
    if (!hasPrintableTimetable(printGrids)) {
      toast.info('Nothing to print', 'Build a class timetable first, then print or save as PDF.')
      return
    }
    const teacherId = viewTeacherId || teachers[0]?.id || ''
    const subject = viewSubjectName || subjectNames[0] || ''
    void exportTimetablePdf({
      schoolName: app.school.name,
      schoolLogoInitials: app.school.logo,
      schoolLogoUrl: app.school.logoUrl,
      schoolImageUrl: app.school.imageUrl,
      schoolBrandColor: app.school.color,
      schoolCity: app.school.city,
      view: printView,
      grids: printGrids,
      teacherNameOf: (id) => teacherName(teachers, id),
      publishedAt: pubMeta.publishedAt,
      className: cls,
      teacherId,
      teacherLabel: teacherName(teachers, teacherId),
      subjectName: subject,
    }).then((result) => {
      if (result === 'cancelled') {
        toast.info('Save cancelled', 'Choose a folder again when you are ready.')
        return
      }
      if (result === 'blocked') {
        toast.danger('Could not open print', 'Allow pop-ups, then click Save PDF again.')
        return
      }
      if (result === 'saved') {
        toast.success('File saved', 'Pick “Save as PDF” in the print dialog to store a PDF in your folder.')
        return
      }
      toast.success('Save as PDF', 'In the print dialog choose Save as PDF and pick your path.')
    })
  }

  return (
    <div className="col gap16">
      <Card>
        <div className="row ai-center jc-between gap12 wrap">
          <Segmented value={view} onChange={(v) => setView(v as 'class' | 'teacher' | 'subject' | 'overview')}
            options={[{ value: 'class', label: 'Class' }, { value: 'teacher', label: 'Teacher' }, { value: 'subject', label: 'Subject' }, { value: 'overview', label: 'All classes' }]} />
          <div className="row ai-center gap8">
            <div className="col gap2 ai-end">
              <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
              {publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt) && (
                <span className="t-xs muted">{publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt)}</span>
              )}
            </div>
            <Btn variant="secondary" size="sm" icon="download" onClick={handlePrintPdf}>Save PDF</Btn>
          </div>
        </div>
      </Card>

      {liveReady && (
        <Card>
          <CardHead title="Saved history" sub="Last 5 drafts and publishes are kept" icon="clock" />
          {history.length === 0 ? (
            <div className="t-sm muted" style={{ marginTop: 8 }}>Nothing saved yet. Save a draft or publish to start the history.</div>
          ) : (
            <div className="col gap8" style={{ marginTop: 8 }}>
              {history.slice(0, 5).map((h) => (
                <div key={h.id} className="row ai-center jc-between gap12 wrap">
                  <div className="row ai-center gap8 wrap">
                    <Badge tone={h.kind === 'published' ? 'success' : 'info'}>{h.kind === 'published' ? 'Published' : 'Draft'}</Badge>
                    <span className="t-sm">{timetableHistorySummary(h.snapshotJson)}</span>
                  </div>
                  <span className="t-xs muted">{formatPublishTime(h.savedAt) ?? h.savedAt}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {view === 'teacher' && (
        liveReady
          ? <TeacherView grids={grids} setGrids={setGrids} editable={editable} onTeacherChange={setViewTeacherId} />
          : <Empty icon="calendar" title="Loading timetable…" body="Fetching saved class routines." />
      )}
      {view === 'subject' && (
        liveReady
          ? <SubjectView grids={grids} setGrids={setGrids} editable={editable} subjectNames={pivotSubjects} onSubjectChange={setViewSubjectName} />
          : <Empty icon="calendar" title="Loading timetable…" body="Fetching saved class routines." />
      )}
      {view === 'overview' && (
        liveReady
          ? <ClassOverview grids={grids} classList={classList} />
          : <Empty icon="calendar" title="Loading timetable…" body="Fetching saved class routines." />
      )}

      {view === 'class' && classList.length === 0 && (
        <Empty icon="grid" title="No classes yet" body="Add classes under Academics → Classes first. Dummy grade lists are no longer used." />
      )}

      {view === 'class' && classList.length > 0 && subjectNames.length === 0 && (
        <div className="col gap12">
          <Card>
            <Field label="Class"><Select style={{ minWidth: 140 }} options={classList} value={cls} onChange={(e) => setCls(e.target.value)} /></Field>
          </Card>
          {catalogSubjects.length === 0 ? (
            <Empty icon="book" title="No subjects yet" body="Add subjects under Academics → Subjects, then map them to each class before building a timetable." />
          ) : (
            <Empty icon="book" title={`No subjects mapped to ${cls || 'this class'}`} body="Map subjects to this class under Academics → Classes → Subjects. The timetable generates only from the class's own mapped subjects — it no longer falls back to generic default subjects." />
          )}
        </div>
      )}

      {view === 'class' && classList.length > 0 && subjectNames.length > 0 && (<>
      {/* toolbar */}
      <Card>
        <div className="row ai-center jc-between gap12 wrap">
          <div className="row ai-center gap12 wrap">
            <Field label="Class"><Select style={{ minWidth: 140 }} options={classList} value={cls} onChange={(e) => setCls(e.target.value)} /></Field>
            {ctId && <Badge tone="brand" icon="user" style={{ alignSelf: 'flex-end', marginBottom: 4 }}>Class teacher: {teacherName(teachers, ctId)}</Badge>}
            <Badge tone="neutral" style={{ alignSelf: 'flex-end', marginBottom: 4 }}>
              {classPeriods} periods/day{selectedClassRow?.id && periodOverrides[selectedClassRow.id] != null ? ' · override' : ''}
            </Badge>
            {assignedSubjects.length > 0 ? (
              <Badge
                tone={subjectsAligned ? 'success' : 'warning'}
                icon="book"
                style={{ alignSelf: 'flex-end', marginBottom: 4 }}
              >
                {assignedSubjects.length}/{periodTarget} subjects
              </Badge>
            ) : (
              <Badge tone="neutral" icon="book" style={{ alignSelf: 'flex-end', marginBottom: 4 }}>
                Catalog subjects
              </Badge>
            )}
          </div>
          {m === 'build' && (
            <div className="row ai-center gap8 wrap">
              <Badge tone={filled === totalSlots ? 'success' : 'neutral'}>{filled}/{totalSlots} periods set</Badge>
              {conflicts.size > 0
                ? <Badge tone="danger" icon="alert">{conflicts.size} clash{conflicts.size > 1 ? 'es' : ''}</Badge>
                : filled > 0 ? <Badge tone="success" icon="checkCircle">No clashes</Badge> : null}
              {editable && <Btn size="sm" variant="secondary" icon="sparkle" onClick={() => setCfgOpen(true)}>Re-generate</Btn>}
              {editable && <Btn size="sm" variant="ghost" icon="refresh" onClick={restart}>Restart</Btn>}
              {editable && <Btn size="sm" variant="ghost" icon="check" onClick={saveDraft}>Save draft</Btn>}
              {editable && showPublishClass && (
                <Btn size="sm" variant="primary" icon="check" onClick={publish} disabled={anyClash || publishing}>
                  {publishing ? 'Publishing…' : 'Save & publish'}
                </Btn>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* choice screen */}
      {m === 'choice' && (
        editable ? (
          <div className="sm-grid-2 gap16">
            <Card hover className="pad" onClick={() => setCfgOpen(true)}>
              <div className="row ai-center gap12">
                <span className="sm-kpi-ic" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><Icon name="sparkle" size={20} /></span>
                <div><div className="fw6">Auto-generate <Badge tone="success">recommended</Badge></div><div className="t-sm muted">Set periods-per-week + teachers; we build a balanced routine.</div></div>
              </div>
            </Card>
            <Card hover className="pad" onClick={startManual}>
              <div className="row ai-center gap12">
                <span className="sm-kpi-ic" style={{ background: 'var(--surface-2)' }}><Icon name="edit" size={20} /></span>
                <div><div className="fw6">Build manually</div><div className="t-sm muted">Pick a subject from the palette, then tap cells to place it.</div></div>
              </div>
            </Card>
          </div>
        ) : (
          <Empty icon="calendar" title="No timetable yet" body={`No routine has been published for ${cls}.`} />
        )
      )}

      {/* builder */}
      {m === 'build' && (
        <>
        <div className="row gap16 wrap" style={{ alignItems: 'flex-start' }}>
          {/* palette */}
          {editable && (
            <Card style={{ width: 260, flex: '0 0 auto' }}>
              <CardHead title="Subjects" sub="Pick one, then tap a cell" icon="book" />
              <div className="col gap8" style={{ marginTop: 8 }}>
                {subjectNames.map((s) => {
                  const st = subjStyle(s)
                  const on = brush === s
                  return (
                    <div key={s} className="col gap6" style={{ border: `1px solid ${on ? st.fg : 'var(--border)'}`, borderRadius: 10, padding: 8, background: on ? st.bg : undefined }}>
                      <button onClick={() => setBrush(s)} style={{ border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: st.fg, flex: '0 0 auto' }} />
                        <span className="fw6 t-sm" style={{ color: st.fg }}>{s}</span>
                      </button>
                      <TeacherChips subject={s} ids={subjTeachers[s] ?? []} onChange={(ids) => setSubjTeam(s, ids)} editable={editable} />
                    </div>
                  )
                })}
                <div className="row gap8" style={{ marginTop: 4 }}>
                  <Btn size="sm" variant={brush === ERASE ? 'danger' : 'secondary'} icon="trash" onClick={() => setBrush(ERASE)}>Erase</Btn>
                  <Btn size="sm" variant="ghost" onClick={clearGrid}>Clear all</Btn>
                </div>
              </div>
            </Card>
          )}

          {/* weekly grid */}
          <Card style={{ flex: 1, minWidth: 320, overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `56px repeat(${DAYS.length}, minmax(78px, 1fr))`, gap: 5, minWidth: 640 }}>
              <div />
              {DAYS.map((d) => <div key={d} className="t-xs fw6 ta-center muted" style={{ padding: '4px 0' }}>{d}</div>)}
              {rowsDesc.map((rd, ri) => rd.type === 'lunch' ? (
                <Fragment key={`lunch-${ri}`}>
                  <div className="t-xs muted ai-center" style={{ display: 'flex', justifyContent: 'center' }}><Icon name="clock" size={13} /></div>
                  <div className="t-xs fw6 muted" style={{ gridColumn: `2 / span ${DAYS.length}`, textAlign: 'center', padding: '6px 0', background: 'var(--surface-2)', borderRadius: 8 }}>Lunch break</div>
                </Fragment>
              ) : (
                <Fragment key={`p-${rd.p}`}>
                  <div className="t-xs fw6 muted" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', lineHeight: 1.15, gap: 1 }}>
                    <span>P{rd.p + 1}</span>
                    {bellTimes[rd.p + 1] ? (
                      <span className="t-xs muted3" style={{ fontWeight: 500, fontSize: 9 }}>
                        {bellTimes[rd.p + 1].start}
                      </span>
                    ) : null}
                  </div>
                  {DAYS.map((_d, di) => {
                    const ck = cellKey(di, rd.p)
                    const cell = g[ck]
                    const st = cell ? subjStyle(cell.subject) : null
                    const isClash = conflicts.has(ck)
                    const clashWith = cell && isClash ? clashingClass(grids, cell.teacherId, di, rd.p, cls) : null
                    return (
                      <button key={di} onClick={() => place(di, rd.p)} disabled={!editable}
                        title={clashWith ? `Also in ${clashWith} · ${DAYS[di]} P${rd.p + 1}` : undefined}
                        style={{
                          minHeight: 56, borderRadius: 8, padding: 6, textAlign: 'left',
                          cursor: editable ? 'pointer' : 'default',
                          border: `${isClash ? '2px' : '1px'} solid ${isClash ? 'var(--danger)' : st ? st.bd : 'var(--border)'}`,
                          background: st ? st.bg : 'var(--surface)',
                          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
                        }}>
                        {cell ? (
                          <>
                            <span className="fw6 t-xs" style={{ color: st!.fg }}>{cell.subject}</span>
                            <span className="t-xs" style={{ lineHeight: 1.1, display: 'flex', alignItems: 'center', gap: 3, color: isClash ? 'var(--danger)' : 'var(--text-2)' }}>
                              {isClash && <Icon name="alert" size={11} />}{teacherName(teachers, cell.teacherId)}
                            </span>
                          </>
                        ) : <span className="muted" style={{ opacity: editable ? 0.5 : 0.2, fontSize: 16, textAlign: 'center' }}>{editable ? '+' : '·'}</span>}
                      </button>
                    )
                  })}
                </Fragment>
              ))}
            </div>
            {editable && <div className="t-xs muted" style={{ marginTop: 10 }}>{brush === ERASE ? 'Erase mode — tap a cell to clear it.' : brush ? `Placing “${brush}”. Tap a cell to drop it (teachers rotate).` : 'Select a subject to place — or tap a filled cell to change its teacher.'}</div>}
          </Card>
        </div>

        {/* teacher load overview */}
        {filled > 0 && (
          <Card>
            <CardHead title="Teacher load" sub="Periods assigned this week · across all classes" icon="users" />
            <div className="sm-grid-3 gap8" style={{ marginTop: 8 }}>
              {Object.entries(loads).sort((a, b) => b[1] - a[1]).map(([tid, n]) => (
                <div key={tid} className="row ai-center jc-between" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '8px 11px' }}>
                  <div className="row ai-center gap8" style={{ minWidth: 0 }}>
                    <span className="sm-card-ic" style={{ width: 26, height: 26 }}><Icon name="user" size={13} /></span>
                    <span className="fw6 t-sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{teacherName(teachers, tid)}</span>
                  </div>
                  <div className="row ai-center gap6" style={{ flex: '0 0 auto' }}>
                    {clashers.has(tid) && <Badge tone="danger" icon="alert">clash</Badge>}
                    <Badge tone="neutral">{n}/wk</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
        </>
      )}

      {/* auto-generate config */}
      <Modal
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        size="lg"
        icon="sparkle"
        title="Auto-generate timetable"
        sub={`Class ${cls} · ${subjectNames.length} subjects · ${periodTarget} periods/day`}
        footer={
          <div className="row ai-center jc-between" style={{ width: '100%' }}>
            <Badge tone={cfgTotal === totalSlots ? 'success' : cfgTotal > totalSlots ? 'danger' : 'warning'}>
              {cfgTotal}/{totalSlots} periods{cfgTotal === totalSlots ? ' · perfect fit' : cfgTotal > totalSlots ? ' · over capacity' : ' · free periods left'}
            </Badge>
            <div className="row gap8">
              <Btn variant="ghost" onClick={() => setCfgOpen(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                icon="sparkle"
                disabled={!subjectNames.length}
                onClick={() => {
                  if (!assignedSubjects.length) {
                    toast.info('Using catalog', 'Assign subjects on Classes (match period count) for a cleaner generate.')
                  } else if (!subjectsAligned) {
                    toast.info('Subject count', subjectsMatchPeriodsHint(assignedSubjects.length, periodTarget))
                  }
                  generate()
                }}
              >
                Generate
              </Btn>
            </div>
          </div>
        }
      >
        <div className="row ai-center gap8 wrap" style={{ marginBottom: 12 }}>
          <Badge tone={subjectsAligned ? 'success' : assignedSubjects.length ? 'warning' : 'neutral'}>
            {assignedSubjects.length
              ? subjectsMatchPeriodsHint(assignedSubjects.length, periodTarget)
              : `No class subjects — using ${catalogSubjects.length} catalog subjects`}
          </Badge>
        </div>
        {!subjectNames.length ? (
          <Empty icon="book" title="No subjects" body="Add subjects to this class under Academics → Classes, or seed the Subjects catalog." />
        ) : (
          <>
            <Field label="Class teacher"><Select options={[{ value: '', label: '— Select —' }, ...teacherOpts]} value={ctId} onChange={(e) => setClassTeachers((p) => ({ ...p, [cls]: e.target.value }))} /></Field>
            <div className="col gap10" style={{ marginTop: 12 }}>
              <div className="t-sm fw6">Subjects for generate ({subjectNames.length})</div>
              {subjectNames.map((s, i) => {
                const st = subjStyle(s)
                return (
                  <div key={s} className="row ai-center gap12 wrap" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
                    <Badge tone="neutral">{i + 1}/{periodTarget}</Badge>
                    <div className="row ai-center gap8" style={{ width: 150 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: st.fg, flex: '0 0 auto' }} />
                      <span className="fw6 t-sm">{s}</span>
                    </div>
                    <div style={{ width: 110 }}>
                      <Select value={String(ppw[s] ?? 0)} options={Array.from({ length: 11 }, (_, j) => ({ value: String(j), label: `${j}/week` }))}
                        onChange={(e) => setPpw((p) => ({ ...p, [s]: Number(e.target.value) }))} />
                    </div>
                    <div className="flex1"><TeacherChips subject={s} ids={subjTeachers[s] ?? []} onChange={(ids) => setSubjTeam(s, ids)} editable /></div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Modal>

      {/* change-teacher (per-cell override) — cannot pick a teacher already busy elsewhere this slot */}
      <Modal open={!!editCell} onClose={() => setEditCell(null)} size="sm" icon="user"
        title="Change teacher"
        sub={editCell ? `${editCell.subject} · ${DAYS[editCell.d]} P${editCell.p + 1} · ${cls}` : ''}
        footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={() => setEditCell(null)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={applyTeacher}>Save</Btn></div>}>
        {editCell && (
          <div className="col gap8">
            {qualified(teachers, editCell.subject).length === 0 && (
              <Empty icon="users" title="No teachers yet" body="Onboard teachers in People first." />
            )}
            {qualified(teachers, editCell.subject).map((t) => {
              const busy = clashingClass(grids, t.id, editCell.d, editCell.p, cls)
              const sel = editTid === t.id
              return (
                <button key={t.id} onClick={() => setEditTid(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%',
                    border: `1px solid ${sel ? (busy ? 'var(--danger)' : 'var(--brand-600)') : 'var(--border)'}`, borderRadius: 10, padding: '9px 11px',
                    background: sel ? (busy ? 'var(--danger-bg)' : 'var(--brand-50)') : 'var(--surface)', textAlign: 'left',
                    cursor: 'pointer',
                  }}>
                  <div className="row ai-center gap8" style={{ minWidth: 0 }}>
                    <Icon name={sel ? 'checkCircle' : 'user'} size={15} style={{ color: sel ? 'var(--brand-600)' : 'var(--text-3)' }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="fw6 t-sm">{t.name}</div>
                      <div className="t-xs muted3">{t.dept} · {loads[t.id] ?? 0}/wk</div>
                    </div>
                  </div>
                  {busy
                    ? <Badge tone="danger" icon="alert">busy in {busy}</Badge>
                    : <Badge tone="success">free</Badge>}
                </button>
              )
            })}
          </div>
        )}
      </Modal>

      {/* overlap popup — names the class(es) the teacher is already assigned to */}
      <Modal open={!!clashPrompt} onClose={() => setClashPrompt(null)} size="sm" icon="alert"
        title="Teacher already assigned"
        sub={clashPrompt ? `${DAYS[clashPrompt.d]} P${clashPrompt.p + 1} · ${cls}` : ''}
        footer={
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setClashPrompt(null)}>Cancel</Btn>
            <Btn variant="danger" icon="alert" onClick={() => { clashPrompt?.onConfirm(); setClashPrompt(null) }}>Assign anyway</Btn>
          </div>
        }>
        {clashPrompt && (
          <div className="col gap12">
            <div className="sm-card pad row ai-center gap10" style={{ background: 'var(--danger-bg)' }}>
              <Icon name="alert" size={18} style={{ color: 'var(--danger)', flex: '0 0 auto' }} />
              <div className="t-sm">
                <span className="fw7">{teacherName(teachers, clashPrompt.tid)}</span> is already teaching{' '}
                <span className="fw7">{clashPrompt.others.join(', ')}</span> on{' '}
                <span className="fw6">{DAYS[clashPrompt.d]} P{clashPrompt.p + 1}</span>.
              </div>
            </div>
            <div className="t-sm muted">Assigning this teacher double-books them at the same time. Cancel and choose a free teacher/slot, or assign anyway (the cell will be flagged as a clash).</div>
          </div>
        )}
      </Modal>
      </>)}
    </div>
  )
}

/* ============================================================
   3 · Periods — daily bell schedule
   ============================================================ */
interface PeriodRow { label: string; start: string; end: string; type: string }
const PTYPES = ['Class', 'Library', 'Lab', 'Break', 'Assembly']
const toMin = (s: string) => { const [h, m] = String(s ?? '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
const durOf = (a: string, b: string) => { const d = toMin(b) - toMin(a); return d > 0 ? `${d} min` : '—' }

function periodTypeTone(type: string): BadgeTone {
  switch (type) {
    case 'Class': return 'brand'
    case 'Library': return 'info'
    case 'Lab': return 'success'
    case 'Break': return 'warning'
    case 'Assembly': return 'neutral'
    default: return 'neutral'
  }
}

const DEFAULT_PERIODS: PeriodRow[] = [
  { label: 'Assembly', start: '08:00', end: '08:15', type: 'Assembly' },
  { label: 'Period 1', start: '08:15', end: '09:00', type: 'Class' },
  { label: 'Period 2', start: '09:00', end: '09:45', type: 'Class' },
  { label: 'Short break', start: '09:45', end: '09:55', type: 'Break' },
  { label: 'Period 3', start: '09:55', end: '10:40', type: 'Class' },
  { label: 'Period 4', start: '10:40', end: '11:25', type: 'Class' },
  { label: 'Lunch', start: '11:25', end: '12:05', type: 'Break' },
  { label: 'Period 5', start: '12:05', end: '12:50', type: 'Class' },
  { label: 'Period 6', start: '12:50', end: '13:35', type: 'Class' },
  { label: 'Period 7', start: '13:35', end: '14:20', type: 'Class' },
  { label: 'Period 8', start: '14:20', end: '15:05', type: 'Class' },
]

function PeriodsTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const { register } = useAcademicsActions()
  const [pubMeta, setPubMeta] = useState<PublishEnvelope<PeriodRow[]>>(() => ({
    draft: null, published: null, draftSavedAt: null, publishedAt: null,
  }))
  const [rows, setRows] = useState<PeriodRow[]>(DEFAULT_PERIODS)

  useEffect(() => {
    let cancelled = false
    void fetchPublishEnvelope<PeriodRow[]>('periods')
      .then((env) => {
        if (cancelled) return
        setPubMeta(env)
        setRows(activeSnapshot(env, editable, DEFAULT_PERIODS))
      })
      .catch((err) => {
        if (!cancelled) {
          toast.danger('Could not load periods', err instanceof Error ? err.message : 'Please try again.')
        }
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  const status = publishStatusOf(pubMeta, rows)

  const saveDraft = () => {
    void (async () => {
      try {
        const next = await saveDraftSnapshot('periods', rows)
        setPubMeta(next)
        toast.success('Draft saved', `${rows.length} periods saved as draft.`)
      } catch (err) {
        toast.danger('Could not save draft', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }
  const publish = () => {
    void (async () => {
      try {
        const next = await publishSnapshot('periods', rows)
        setPubMeta(next)
        toast.success('Schedule published', `${rows.length} periods are now live.`)
      } catch (err) {
        toast.danger('Could not publish', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }

  useEffect(() => {
    if (!editable) { register('periods', null); return }
    register('periods', {
      saveDraft,
      publish,
      status,
      canPublish: true,
      showPublish: showPublishButton(status, pubMeta, rows),
      draftSavedAt: pubMeta.draftSavedAt,
      publishedAt: pubMeta.publishedAt,
    })
    return () => register('periods', null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, status, rows, pubMeta.draftSavedAt, pubMeta.publishedAt])

  const update = (i: number, patch: Partial<PeriodRow>) => setRows((rs) => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i))
  const add = () => { const last = rows[rows.length - 1]; setRows((rs) => [...rs, { label: `Period ${rs.filter((r) => r.type === 'Class').length + 1}`, start: last?.end ?? '14:00', end: '14:45', type: 'Class' }]) }

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div className="row ai-center gap10 wrap">
          <div>
            <div className="fw6">Daily bell schedule</div>
            <div className="t-sm muted">{rows.length} periods · {durOf(rows[0]?.start ?? '08:00', rows[rows.length - 1]?.end ?? '08:00')} school day</div>
            {publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt) && (
              <div className="t-xs muted" style={{ marginTop: 4 }}>{publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt)}</div>
            )}
          </div>
          <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
        </div>
        {editable && (
          <div className="row gap8 wrap">
            <Btn variant="secondary" icon="plus" onClick={add}>Add period</Btn>
            <Btn variant="ghost" icon="check" onClick={saveDraft}>Save draft</Btn>
            {showPublishButton(status, pubMeta, rows) && (
              <Btn variant="primary" icon="check" onClick={publish}>Save & publish</Btn>
            )}
          </div>
        )}
      </div>
      <table className="sm-table">
        <thead><tr><th>Label</th><th>Start</th><th>End</th><th>Type</th><th className="ta-right">Duration</th>{editable && <th />}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ minWidth: 160 }}>{editable ? <Input value={r.label} onChange={(e) => update(i, { label: e.target.value })} /> : <span className="fw6">{r.label}</span>}</td>
              <td>{editable ? <Input type="time" value={r.start} onChange={(e) => update(i, { start: e.target.value })} /> : r.start}</td>
              <td>{editable ? <Input type="time" value={r.end} onChange={(e) => update(i, { end: e.target.value })} /> : r.end}</td>
              <td style={{ minWidth: 130 }}>{editable ? <Select options={PTYPES} value={r.type} onChange={(e) => update(i, { type: e.target.value })} /> : <Badge tone={periodTypeTone(r.type)}>{r.type}</Badge>}</td>
              <td className="ta-right muted">{durOf(r.start, r.end)}</td>
              {editable && <td className="ta-right"><Btn size="sm" variant="ghost" icon="trash" onClick={() => del(i)} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/* ============================================================
   4 · Subjects
   ============================================================ */
function SubjectsTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const app = useApp()
  const { data: subjectsData, isSuccess } = useSubjects()
  const list = subjectsData ?? []
  const createSubject = useCreateSubject()
  const updateSubjectMut = useUpdateSubject()
  const deleteSubject = useDeleteSubject()
  const seedDefaults = useEnsureDefaultSubjects()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [editRow, setEditRow] = useState<{ id: string; name: string } | null>(null)
  const [editName, setEditName] = useState('')
  const autoSeedKey = `sm.subjects.autoseed.${app.school.id}`

  const runSeedDefaults = () => {
    if (seedDefaults.isPending) return
    seedDefaults.mutate(list, {
      onSuccess: (n) => {
        if (n === 0) toast.info('Already complete', 'Default subjects are already present.')
        else toast.success('Default subjects added', `${n} subjects added.`)
      },
      onError: (err) => {
        toast.danger('Could not add defaults', err instanceof Error ? err.message : 'Please try again.')
      },
    })
  }

  useEffect(() => {
    if (!editable || !isSuccess || list.length > 0 || seedDefaults.isPending) return
    try {
      if (sessionStorage.getItem(autoSeedKey) === '1') return
      sessionStorage.setItem(autoSeedKey, '1')
    } catch { /* ignore */ }
    seedDefaults.mutate(list, {
      onSuccess: (n) => {
        if (n > 0) toast.success('Default subjects ready', `${n} subjects added.`)
      },
      onError: () => {
        try { sessionStorage.removeItem(autoSeedKey) } catch { /* ignore */ }
      },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot seed when list is empty
  }, [editable, isSuccess, list.length, autoSeedKey])

  const add = () => {
    const n = name.trim()
    if (!n) { toast.danger('Name required', 'Enter a subject name.'); return }
    if (list.some((s) => s.name.toLowerCase() === n.toLowerCase())) {
      toast.danger('Already exists', `${n} is already a subject.`)
      return
    }
    createSubject.mutate(n, {
      onSuccess: () => { toast.success('Subject added', `${n} created.`); setName(''); setOpen(false) },
      onError: (err) => { toast.danger('Could not add subject', err instanceof Error ? err.message : 'Please try again.') },
    })
  }

  const openEdit = (s: { id: string; name: string }) => {
    setEditRow(s)
    setEditName(s.name)
  }

  const saveEdit = () => {
    if (!editRow) return
    const n = editName.trim()
    if (!n) { toast.danger('Name required', 'Enter a subject name.'); return }
    if (list.some((s) => s.id !== editRow.id && s.name.toLowerCase() === n.toLowerCase())) {
      toast.danger('Already exists', `${n} is already a subject.`)
      return
    }
    updateSubjectMut.mutate(
      { id: editRow.id, name: n },
      {
        onSuccess: () => { toast.success('Subject updated', n); setEditRow(null) },
        onError: (err) => toast.danger('Could not update subject', err instanceof Error ? err.message : 'Please try again.'),
      },
    )
  }

  const remove = (id: string, subjectName: string) => {
    if (deleteSubject.isPending) return
    deleteSubject.mutate(id, {
      onSuccess: () => toast.success('Subject removed', `${subjectName} deleted.`),
      onError: (err) => toast.danger('Could not remove subject', err instanceof Error ? err.message : 'Please try again.'),
    })
  }

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div><div className="fw6">Subjects</div><div className="t-sm muted">{list.length} subjects offered · live catalog</div></div>
        {editable && (
          <div className="row ai-center gap8 wrap">
            <Btn variant="secondary" icon="sparkle" disabled={seedDefaults.isPending} onClick={runSeedDefaults}>
              {seedDefaults.isPending ? 'Adding…' : 'Add defaults'}
            </Btn>
            <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>Add subject</Btn>
          </div>
        )}
      </div>
      {list.length === 0 ? (
        <Empty
          icon="book"
          title={seedDefaults.isPending ? 'Adding default subjects…' : 'No subjects yet'}
          body="Default set includes English, Hindi, Mathematics, Science, and more. You can add custom subjects too."
        />
      ) : (
        <div className="sm-grid-3 gap12" style={{ padding: 16 }}>
          {list.map((s) => {
            const st = subjStyle(s.name)
            return (
              <div key={s.id} className="row ai-center jc-between gap8" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <div className="row ai-center gap10" style={{ minWidth: 0 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 8, background: st.bg, color: st.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}><Icon name="book" size={15} /></span>
                  <span className="fw6 t-sm">{s.name}</span>
                </div>
                {editable && (
                  <div className="row ai-center gap6">
                    <Btn size="sm" variant="secondary" icon="edit" aria-label={`Edit ${s.name}`} onClick={() => openEdit(s)}>Edit</Btn>
                    <Btn size="sm" variant="ghost" icon="trash" aria-label={`Remove ${s.name}`} onClick={() => remove(s.id, s.name)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} icon="book" title="Add subject"
        footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn><Btn variant="primary" icon="check" onClick={add}>Add</Btn></div>}>
        <Field label="Subject name" required><Input icon="book" value={name} placeholder="e.g. Physics" onChange={(e) => setName(e.target.value)} /></Field>
      </Modal>
      <Modal
        open={!!editRow}
        onClose={() => setEditRow(null)}
        icon="edit"
        title="Edit subject"
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setEditRow(null)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={saveEdit} disabled={updateSubjectMut.isPending}>
              {updateSubjectMut.isPending ? 'Saving…' : 'Save'}
            </Btn>
          </div>
        )}
      >
        <Field label="Subject name" required>
          <Input icon="book" value={editName} placeholder="e.g. Physics" onChange={(e) => setEditName(e.target.value)} />
        </Field>
      </Modal>
    </Card>
  )
}

/* ============================================================
   5 · Homework tracker (live GET /assignments)
   ============================================================ */
interface Hw {
  id: string
  cls: string
  subject: string
  title: string
  due: string
  status: string
  teacher: string
  source: 'teacher_app' | 'admin'
  submissions: string
}
const hwTone: Record<string, BadgeTone> = {
  Active: 'brand',
  'Due soon': 'info',
  Overdue: 'danger',
  Closed: 'success',
}
const sourceBadge = (s: 'teacher_app' | 'admin') =>
  s === 'teacher_app' ? <Badge tone="info">Teacher app</Badge> : <Badge tone="neutral">Admin</Badge>

function HomeworkTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const app = useApp()
  const { data: classes = [] } = useClasses()
  const classList = useClassNames()
  const { data: teachers = [] } = useTeachers()
  const subjectNames = useSubjectNames()
  const { data: assignments = [], isLoading, isError } = useAssignments()
  const createMut = useCreateAssignment()
  const [open, setOpen] = useState(false)
  const [cls, setCls] = useState('')
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('2026-06-15')

  const classLabel = (c: { name: string; grade: string; section: string }) =>
    (c.name || `${c.grade}-${c.section}`).trim()

  const classIdFor = (label: string) =>
    classes.find((c) => classLabel(c) === label)?.id

  const teacherNameForClass = (label: string) => {
    const c = classes.find((cl) => classLabel(cl) === label)
    if (!c?.teacherId) return 'Teacher'
    const t = teachers.find((te) => te.id === c.teacherId)
    return t?.name ?? 'Teacher'
  }

  const rows: Hw[] = useMemo(() =>
    assignments.map((a) => {
      const clsName = a.className ?? '—'
      const label = homeworkStatusLabel(a.status)
      return {
        id: a.id,
        cls: clsName,
        subject: a.subject ?? '—',
        title: a.title,
        due: a.dueDate ?? '—',
        status: label,
        teacher: a.source === 'admin' ? (app.user?.name ?? 'Admin') : teacherNameForClass(clsName),
        source: a.source,
        submissions: a.totalStudents > 0 ? `${a.submissionsCount}/${a.totalStudents}` : '—',
      }
    }),
  [assignments, app.user?.name, classes, teachers])

  useEffect(() => {
    if (!cls && classList.length) setCls(classList[0])
    else if (cls && classList.length && !classList.includes(cls)) setCls(classList[0])
  }, [classList, cls])

  useEffect(() => {
    if (!subject && subjectNames.length) setSubject(subjectNames[0])
    else if (subject && subjectNames.length && !subjectNames.includes(subject)) setSubject(subjectNames[0])
  }, [subjectNames, subject])

  const add = async () => {
    if (!classList.length) { toast.danger('No classes', 'Add a class in Academics → Classes first.'); return }
    if (!cls) { toast.danger('Class required', 'Select a class.'); return }
    if (!title.trim()) { toast.danger('Title required', 'Enter a homework title.'); return }
    const classId = classIdFor(cls)
    if (!classId) { toast.danger('Class not found', 'Re-select a class from the list.'); return }
    try {
      await createMut.mutateAsync({
        title: title.trim(),
        classId,
        className: cls,
        subject,
        dueDate: due,
      })
      toast.success('Homework assigned', `${subject} → ${cls}.`)
      setTitle('')
      setOpen(false)
    } catch (e) {
      toast.danger('Could not assign', e instanceof Error ? e.message : 'Request failed')
    }
  }

  const cols: Column<Hw>[] = [
    { key: 'cls', label: 'Class', sortValue: (r) => r.cls, render: (r) => <Badge tone="neutral">{r.cls}</Badge> },
    { key: 'subject', label: 'Subject', sortValue: (r) => r.subject, render: (r) => <span className="fw6">{r.subject}</span> },
    { key: 'teacher', label: 'Teacher', sortValue: (r) => r.teacher, render: (r) => (
      <div className="row ai-center gap8"><span className="t-sm">{r.teacher}</span>{sourceBadge(r.source)}</div>
    ) },
    { key: 'title', label: 'Title', sortValue: (r) => r.title },
    { key: 'due', label: 'Due', sortValue: (r) => r.due, render: (r) => <span className="muted">{r.due}</span> },
    {
      key: 'submissions', label: 'Submissions', align: 'center', sortValue: (r) => r.submissions,
      render: (r) => <span className="t-sm muted">{r.submissions}</span>,
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status,
      render: (r) => <Badge tone={hwTone[r.status] ?? 'neutral'} dot>{r.status}</Badge>,
    },
  ]

  const empty = isError
    ? <Empty icon="clipboard" title="Could not load homework" body="Check your connection and try again." />
    : <Empty icon="clipboard" title="No homework yet" body="Assign homework or create it in the teacher app." />

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="fw6">Homework tracker</div>
          <div className="t-sm muted">
            {isLoading ? 'Loading…' : `${rows.length} assignment${rows.length === 1 ? '' : 's'}`}
          </div>
        </div>
        {editable && <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>Assign homework</Btn>}
      </div>
      <DataTable<Hw> columns={cols} rows={rows} rowKey={(r) => r.id} pageSize={10} initialSort={{ key: 'due', dir: 'asc' }}
        empty={empty} />
      <Modal open={open} onClose={() => setOpen(false)} icon="clipboard" title="Assign homework"
        footer={
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={() => void add()} disabled={createMut.isPending}>
              {createMut.isPending ? 'Assigning…' : 'Assign'}
            </Btn>
          </div>
        }>
        <div className="sm-grid-2 gap12">
          <Field label="Class"><Select options={classList} value={cls} onChange={(e) => setCls(e.target.value)} /></Field>
          <Field label="Subject"><Select options={subjectNames} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        </div>
        <Field label="Title" required><Input icon="clipboard" value={title} placeholder="e.g. Chapter 5 exercises" onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Due date"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
      </Modal>
    </Card>
  )
}

/* ============================================================
   6 · Class tests (created in the teacher app; admin can add)
   ============================================================ */
interface Test {
  id: number
  cls: string
  subject: string
  title: string
  date: string
  maxMarks: number
  teacher: string
  source: 'teacher_app' | 'admin'
  status: 'Scheduled' | 'Completed' | 'Graded'
}
const testTone: Record<Test['status'], BadgeTone> = { Scheduled: 'brand', Completed: 'info', Graded: 'success' }

function classLabelOf(c: { name?: string; grade?: string; section?: string }): string {
  return (c.name || `${c.grade ?? ''}-${c.section ?? ''}`).trim()
}

function parseClassTests(raw: unknown): Test[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item, i) => {
    const r = (item && typeof item === 'object') ? item as Record<string, unknown> : {}
    const status: Test['status'] = r.status === 'Completed' || r.status === 'Graded' ? r.status : 'Scheduled'
    return {
      id: Number(r.id) || i + 1,
      cls: String(r.cls ?? r.className ?? r.class_name ?? '').trim(),
      subject: String(r.subject ?? ''),
      title: String(r.title ?? ''),
      date: String(r.date ?? '').slice(0, 10),
      maxMarks: Number(r.maxMarks ?? r.max_marks ?? 0) || 0,
      teacher: String(r.teacher ?? ''),
      source: r.source === 'admin' ? 'admin' : 'teacher_app',
      status,
    }
  })
}

function TestsTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const app = useApp()
  const { register } = useAcademicsActions()
  const classesQ = useClasses()
  const classList = useClassNames()
  const classSubjectsMap = useClassSubjectsMap()
  const [pubMeta, setPubMeta] = useState<PublishEnvelope<Test[]>>(() => ({
    draft: null, published: null, draftSavedAt: null, publishedAt: null,
  }))
  const [rows, setRows] = useState<Test[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [cls, setCls] = useState('')
  const [subject, setSubject] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('2026-06-20')
  const [maxMarks, setMaxMarks] = useState('20')

  const selectedClass = useMemo(
    () => (classesQ.data ?? []).find((c) => classLabelOf(c) === cls),
    [classesQ.data, cls],
  )
  const fetchedSubjectsQ = useListClassSubjects(open ? (selectedClass?.id ?? null) : null)
  const mappedSubjects = useMemo(() => {
    if (fetchedSubjectsQ.isSuccess && fetchedSubjectsQ.data) return fetchedSubjectsQ.data
    if (!cls) return []
    const byId = selectedClass?.id ? classSubjectsMap[selectedClass.id] : undefined
    const byName = classSubjectsMap[cls]
    return (byId?.length ? byId : byName) ?? []
  }, [fetchedSubjectsQ.isSuccess, fetchedSubjectsQ.data, selectedClass, classSubjectsMap, cls])
  const subjectOpts = mappedSubjects
  const subjectOptions = !cls
    ? [{ value: '', label: 'Select a class first' }]
    : fetchedSubjectsQ.isLoading && mappedSubjects.length === 0
      ? [{ value: '', label: 'Loading subjects…' }]
      : mappedSubjects.length
        ? mappedSubjects
        : [{ value: '', label: 'No subjects mapped — map them in Classes' }]
  const classOptions = classList.length
    ? classList
    : [{ value: '', label: classesQ.isLoading ? 'Loading classes…' : 'No classes yet — add in Classes' }]

  useEffect(() => {
    let cancelled = false
    void fetchPublishEnvelope<Test[]>('tests')
      .then((env) => {
        if (cancelled) return
        const parsed: PublishEnvelope<Test[]> = {
          ...env,
          draft: env.draft != null ? parseClassTests(env.draft) : null,
          published: env.published != null ? parseClassTests(env.published) : null,
        }
        setPubMeta(parsed)
        setRows(activeSnapshot(parsed, editable, []))
      })
      .catch((err) => {
        if (!cancelled) toast.danger('Could not load tests', err instanceof Error ? err.message : 'Please try again.')
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  const status = publishStatusOf(pubMeta, rows)

  const persistTests = async (nextRows: Test[]): Promise<PublishEnvelope<Test[]>> => {
    const env = await saveDraftSnapshot('tests', nextRows)
    const parsed: PublishEnvelope<Test[]> = {
      ...env,
      draft: env.draft != null ? parseClassTests(env.draft) : nextRows,
      published: env.published != null ? parseClassTests(env.published) : env.published,
    }
    setPubMeta(parsed)
    setRows(activeSnapshot(parsed, editable, nextRows))
    return parsed
  }

  const saveDraft = () => {
    void (async () => {
      try {
        await persistTests(rows)
        toast.success('Draft saved', `${rows.length} test${rows.length === 1 ? '' : 's'} saved as draft.`)
      } catch (err) {
        toast.danger('Could not save draft', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }
  const publish = () => {
    void (async () => {
      try {
        const next = await publishSnapshot('tests', rows)
        const parsed: PublishEnvelope<Test[]> = {
          ...next,
          draft: next.draft != null ? parseClassTests(next.draft) : null,
          published: next.published != null ? parseClassTests(next.published) : null,
        }
        setPubMeta(parsed)
        setRows(activeSnapshot(parsed, editable, rows))
        toast.success('Tests published', `${rows.length} test${rows.length === 1 ? '' : 's'} are now live.`)
      } catch (err) {
        toast.danger('Could not publish', err instanceof Error ? err.message : 'Please try again.')
      }
    })()
  }

  useEffect(() => {
    if (!editable) { register('tests', null); return }
    register('tests', {
      saveDraft,
      publish,
      status,
      canPublish: true,
      showPublish: showPublishButton(status, pubMeta, rows),
      draftSavedAt: pubMeta.draftSavedAt,
      publishedAt: pubMeta.publishedAt,
    })
    return () => register('tests', null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, status, rows, pubMeta.draftSavedAt, pubMeta.publishedAt])

  useEffect(() => {
    if (!cls && classList.length) setCls(classList[0])
    else if (cls && classList.length && !classList.includes(cls)) setCls(classList[0])
  }, [classList, cls])

  useEffect(() => {
    if (!subject && subjectOpts.length) setSubject(subjectOpts[0])
    else if (subject && subjectOpts.length && !subjectOpts.includes(subject)) setSubject(subjectOpts[0])
  }, [subjectOpts, subject])

  const resetForm = () => {
    setTitle('')
    setMaxMarks('20')
    setEditId(null)
    setOpen(false)
  }

  const openAdd = () => {
    setEditId(null)
    setTitle('')
    setMaxMarks('20')
    setDate('2026-06-20')
    if (classList[0]) setCls(classList[0])
    if (subjectOpts[0]) setSubject(subjectOpts[0])
    setOpen(true)
  }

  const openEdit = (t: Test) => {
    setEditId(t.id)
    setCls(t.cls)
    setSubject(t.subject)
    setTitle(t.title)
    setDate(t.date)
    setMaxMarks(String(t.maxMarks))
    setOpen(true)
  }

  const saveForm = () => {
    if (!classList.length) { toast.danger('No classes', 'Add a class in Academics → Classes first.'); return }
    if (!cls) { toast.danger('Class required', 'Select a class.'); return }
    if (!mappedSubjects.length || !mappedSubjects.includes(subject)) {
      toast.danger('Subject required', 'Map subjects on this class in Academics → Classes first.')
      return
    }
    if (!title.trim()) { toast.danger('Title required', 'Enter a test title.'); return }
    const marks = Math.max(0, Number(maxMarks) || 0)
    const next = editId != null
      ? rows.map((t) => t.id === editId
        ? { ...t, cls, subject, title: title.trim(), date, maxMarks: marks }
        : t)
      : [{
          id: Date.now(), cls, subject, title: title.trim(), date, maxMarks: marks,
          teacher: app.user?.name ?? 'Admin', source: 'admin' as const, status: 'Scheduled' as const,
        }, ...rows]
    setSaving(true)
    void persistTests(next)
      .then(() => {
        toast.success(editId != null ? 'Test updated' : 'Test added', `${subject} → ${cls}.`)
        resetForm()
      })
      .catch((err) => {
        toast.danger(editId != null ? 'Could not update test' : 'Could not add test', err instanceof Error ? err.message : 'Please try again.')
      })
      .finally(() => setSaving(false))
  }

  const remove = (id: number) => {
    const next = rows.filter((t) => t.id !== id)
    void persistTests(next)
      .then(() => toast.success('Test removed', 'Removed from the server draft.'))
      .catch((err) => toast.danger('Could not remove test', err instanceof Error ? err.message : 'Please try again.'))
  }

  const cols: Column<Test>[] = [
    { key: 'cls', label: 'Class', sortValue: (r) => r.cls, render: (r) => <Badge tone="neutral">{r.cls}</Badge> },
    { key: 'subject', label: 'Subject', sortValue: (r) => r.subject, render: (r) => <span className="fw6">{r.subject}</span> },
    { key: 'teacher', label: 'Teacher', sortValue: (r) => r.teacher, render: (r) => (
      <div className="row ai-center gap8"><span className="t-sm">{r.teacher}</span>{sourceBadge(r.source)}</div>
    ) },
    { key: 'title', label: 'Title', sortValue: (r) => r.title },
    { key: 'date', label: 'Date', sortValue: (r) => r.date, render: (r) => <span className="muted">{r.date}</span> },
    { key: 'maxMarks', label: 'Max', align: 'center', sortValue: (r) => r.maxMarks, render: (r) => <span className="fw6">{r.maxMarks}</span> },
    { key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status, render: (r) => <Badge tone={testTone[r.status]} dot>{r.status}</Badge> },
    { key: 'act', label: '', render: (r) => editable ? (
      <div className="row ai-center gap6 jc-end">
        <Btn size="sm" variant="secondary" icon="edit" onClick={() => openEdit(r)}>Edit</Btn>
        <Btn size="sm" variant="ghost" icon="trash" onClick={() => remove(r.id)} />
      </div>
    ) : null },
  ]

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div className="row ai-center gap10 wrap">
          <div>
            <div className="fw6">Class tests</div>
            <div className="t-sm muted">{rows.length} tests</div>
            {publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt) && (
              <div className="t-xs muted" style={{ marginTop: 4 }}>{publishMetaLine(pubMeta.draftSavedAt, pubMeta.publishedAt)}</div>
            )}
          </div>
          <Badge tone={statusTone(status)}>{statusLabel(status)}</Badge>
        </div>
        {editable && (
          <div className="row gap8 wrap">
            <Btn variant="ghost" icon="check" onClick={saveDraft}>Save draft</Btn>
            {showPublishButton(status, pubMeta, rows) && (
              <Btn variant="secondary" icon="check" onClick={publish}>Save & publish</Btn>
            )}
            <Btn variant="primary" icon="plus" onClick={openAdd}>Add test</Btn>
          </div>
        )}
      </div>
      <DataTable<Test> columns={cols} rows={rows} rowKey={(r) => r.id} pageSize={10} initialSort={{ key: 'date', dir: 'asc' }}
        empty={<Empty icon="clipboard" title="No tests yet" body="Add a test — it is saved to the server. Use Save & publish when it should go live." />} />
      <Modal open={open} onClose={resetForm} icon="clipboard" title={editId != null ? 'Edit class test' : 'Add class test'}
        footer={<div className="row gap8 jc-end"><Btn variant="ghost" onClick={resetForm} disabled={saving}>Cancel</Btn><Btn variant="primary" icon="check" onClick={saveForm} disabled={saving || !classList.length || !mappedSubjects.length}>{saving ? 'Saving…' : editId != null ? 'Save' : 'Add'}</Btn></div>}>
        <div className="sm-grid-2 gap12">
          <Field label="Class"><Select options={classOptions} value={cls} onChange={(e) => setCls(e.target.value)} /></Field>
          <Field label="Subject"><Select options={subjectOptions} value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        </div>
        <Field label="Title" required><Input icon="clipboard" value={title} placeholder="e.g. Unit Test 2" onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="sm-grid-2 gap12">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Max marks"><Input type="number" min={0} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} /></Field>
        </div>
      </Modal>
    </Card>
  )
}

/* ============================================================
   Houses — used by Add Student house dropdown
   ============================================================ */
function HousesTab({ editable }: { editable: boolean }) {
  const toast = useToast()
  const [rows, setRows] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [editFrom, setEditFrom] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  useEffect(() => {
    let cancelled = false
    void listSchoolHouses()
      .then((list) => { if (!cancelled) setRows(list) })
      .catch((err) => {
        if (!cancelled) toast.danger('Could not load houses', err instanceof Error ? err.message : 'Please try again.')
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    const n = name.trim()
    if (!n) { toast.danger('Name required', 'Enter a house name.'); return }
    if (rows.some((h) => h.toLowerCase() === n.toLowerCase())) {
      toast.danger('Already exists', `${n} is already in the list.`)
      return
    }
    try {
      const next = await addSchoolHouse(n)
      setRows(next)
      setName('')
      setOpen(false)
      toast.success('House added', `${n} will show in Add student.`)
    } catch (err) {
      toast.danger('Could not save house', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const remove = async (h: string) => {
    try {
      const next = await removeSchoolHouse(h)
      setRows(next)
      toast.success('House removed', h)
    } catch (err) {
      toast.danger('Could not remove house', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const saveEdit = async () => {
    if (!editFrom) return
    const n = editName.trim()
    if (!n) { toast.danger('Name required', 'Enter a house name.'); return }
    if (rows.some((h) => h.toLowerCase() === n.toLowerCase() && h.toLowerCase() !== editFrom.toLowerCase())) {
      toast.danger('Already exists', `${n} is already in the list.`)
      return
    }
    try {
      setRows(await renameSchoolHouse(editFrom, n))
      toast.success('House updated', n)
      setEditFrom(null)
    } catch (err) {
      toast.danger('Could not update house', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  return (
    <Card pad={false}>
      <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="fw6">Houses</div>
          <div className="t-sm muted">{rows.length} houses · live catalog · shown in student enrolment</div>
        </div>
        {editable && <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>Add house</Btn>}
      </div>
      {rows.length === 0 ? (
        <Empty icon="users" title="No houses yet" body="Add houses here so they appear in the student create dropdown." />
      ) : (
        <div className="col gap10" style={{ padding: 16 }}>
          {rows.map((h) => (
            <div key={h} className="row ai-center jc-between gap12" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-2)' }}>
              <div className="row ai-center gap10">
                <span className="sm-card-ic"><Icon name="users" size={15} /></span>
                <span className="fw6">{h}</span>
              </div>
              {editable && (
                <div className="row ai-center gap6">
                  <Btn size="sm" variant="secondary" icon="edit" onClick={() => { setEditFrom(h); setEditName(h) }}>Edit</Btn>
                  <Btn size="sm" variant="ghost" icon="trash" onClick={() => remove(h)}>Remove</Btn>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon="plus"
        title="Add house"
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={add}>Add house</Btn>
          </div>
        )}
      >
        <Field label="House name" required hint="e.g. Ruby, Emerald, Sapphire">
          <Input icon="sparkle" value={name} placeholder="House name" onChange={(e) => setName(e.target.value)} />
        </Field>
      </Modal>
      <Modal
        open={!!editFrom}
        onClose={() => setEditFrom(null)}
        icon="edit"
        title="Edit house"
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setEditFrom(null)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={saveEdit}>Save</Btn>
          </div>
        )}
      >
        <Field label="House name" required>
          <Input icon="sparkle" value={editName} onChange={(e) => setEditName(e.target.value)} />
        </Field>
      </Modal>
    </Card>
  )
}

/* ============================================================
   Academics hub — tab shell
   ============================================================ */
const PUBLISH_TABS = new Set(['timetable', 'periods', 'tests'])

function AcademicsScreenInner() {
  const app = useApp()
  const editable = can(app.role, 'academics', 'E')
  const [tab, setTab] = useState('classes')
  const { getActions, version } = useAcademicsActions()
  void version
  const actions = PUBLISH_TABS.has(tab) ? getActions(tab) : null

  const tabs = [
    { value: 'classes', label: 'Classes', icon: 'grid' },
    { value: 'houses', label: 'Houses', icon: 'users' },
    { value: 'timetable', label: 'Timetable', icon: 'calendar' },
    { value: 'periods', label: 'Periods', icon: 'clock' },
    { value: 'subjects', label: 'Subjects', icon: 'book' },
    { value: 'tests', label: 'Tests', icon: 'cap' },
    { value: 'homework', label: 'Homework', icon: 'clipboard' },
  ]

  const headerActions = (() => {
    if (!editable) return <Badge tone="neutral" icon="eye">View only</Badge>
    if (PUBLISH_TABS.has(tab) && actions) {
      const meta = publishMetaLine(actions.draftSavedAt, actions.publishedAt)
      return (
        <div className="row ai-center gap8 wrap">
          <div className="col gap2 ai-end">
            <Badge tone={statusTone(actions.status)}>{statusLabel(actions.status)}</Badge>
            {meta && <span className="t-xs muted">{meta}</span>}
          </div>
          <Btn size="sm" variant="ghost" icon="check" onClick={() => actions.saveDraft()}>Save draft</Btn>
          {actions.showPublish && (
            <Btn
              size="sm"
              variant="primary"
              icon="check"
              disabled={actions.canPublish === false}
              onClick={() => actions.publish()}
            >
              Save & publish
            </Btn>
          )}
        </div>
      )
    }
    if (tab === 'classes' || tab === 'subjects' || tab === 'houses') {
      return (
        <div className="row ai-center gap8">
          <Badge tone="success" icon="edit">Editing enabled</Badge>
          <Badge tone="info">Live catalog</Badge>
        </div>
      )
    }
    return <Badge tone="success" icon="edit">Editing enabled</Badge>
  })()

  return (
    <div>
      <PageHead title="Academics" sub={`${app.school.name} · classes, timetable & curriculum`}
        actions={headerActions} />
      <div style={{ marginBottom: 16 }}><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>

      {/* keep all panels mounted so builder state survives tab switches */}
      <div style={{ display: tab === 'classes' ? 'block' : 'none' }}><ClassesTab editable={editable} /></div>
      <div style={{ display: tab === 'houses' ? 'block' : 'none' }}><HousesTab editable={editable} /></div>
      <div style={{ display: tab === 'timetable' ? 'block' : 'none' }}><TimetableTab editable={editable} /></div>
      <div style={{ display: tab === 'periods' ? 'block' : 'none' }}><PeriodsTab editable={editable} /></div>
      <div style={{ display: tab === 'subjects' ? 'block' : 'none' }}><SubjectsTab editable={editable} /></div>
      <div style={{ display: tab === 'tests' ? 'block' : 'none' }}><TestsTab editable={editable} /></div>
      <div style={{ display: tab === 'homework' ? 'block' : 'none' }}><HomeworkTab editable={editable} /></div>
    </div>
  )
}

function AcademicsScreen() {
  const teachersQ = useTeachers()
  const liveTeachers = teachersQ.data ?? []
  return (
    <LiveTeachersCtx.Provider value={liveTeachers}>
      <AcademicsActionsProvider>
        <AcademicsScreenInner />
      </AcademicsActionsProvider>
    </LiveTeachersCtx.Provider>
  )
}

/* ---------- export contract ---------- */
export const academicsScreens: Record<string, ComponentType> = { 'school.academics': AcademicsScreen }
