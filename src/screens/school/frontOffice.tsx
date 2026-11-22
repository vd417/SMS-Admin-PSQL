/* Receptionist — Front Office. Same school-console layout as the rest of the CRM.
   Published admission fees are view-only. Desk records stay in this browser. */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { listStudents } from '@/api/students'
import { useFeeStructureHistory } from '@/api/hooks/useFeeStructure'
import { nextPersonCode } from '@/lib/personCodes'
import {
  PageHead, Card, CardHead, Kpi, Btn, Badge, Search, Field, Input, Textarea, Select,
  Tabs, Empty, DataTable, Modal, Donut, Icon, type Column, type BadgeTone,
} from '@/components/ui'
import type { Student } from '@/types'
import './frontOffice.css'

type EnquiryStatus = 'New' | 'Called' | 'Visit booked' | 'Applied' | 'Ready to admit' | 'Closed'
type MeetingStatus = 'Scheduled' | 'Confirmed' | 'Rescheduled' | 'Completed' | 'Missed' | 'Cancelled'
type GateKind = 'visitor' | 'late' | 'exit'

interface Enquiry {
  id: string
  enquiryNo: string
  parent: string
  phone: string
  email: string
  child: string
  gender: string
  dob: string
  academicYear: string
  motherName: string
  motherPhone: string
  lastSchool: string
  address: string
  cls: string
  source: string
  status: EnquiryStatus
  note: string
  next: string
}
interface GateRow {
  id: string
  kind: GateKind
  name: string
  phone: string
  purpose: string
  at: string
  day: string
}
interface Meeting {
  id: string
  who: string
  with: string
  when: string
  reason: string
  status: MeetingStatus
}
interface TaskRow { id: string; title: string; due: string; done: boolean }
interface Notice { id: string; text: string; at: string }
interface Desk {
  enquiries: Enquiry[]
  gate: GateRow[]
  meetings: Meeting[]
  tasks: TaskRow[]
  notices: Notice[]
}

const EMPTY: Desk = { enquiries: [], gate: [], meetings: [], tasks: [], notices: [] }
const ENQUIRY_STATUS: EnquiryStatus[] = ['New', 'Called', 'Visit booked', 'Applied', 'Ready to admit', 'Closed']
const MEETING_STATUS: MeetingStatus[] = ['Scheduled', 'Confirmed', 'Rescheduled', 'Completed', 'Missed', 'Cancelled']
const ENQUIRY_TONE: Record<EnquiryStatus, BadgeTone> = {
  New: 'info', Called: 'brand', 'Visit booked': 'warning', Applied: 'brand', 'Ready to admit': 'success', Closed: 'neutral',
}
const MEETING_TONE: Record<MeetingStatus, BadgeTone> = {
  Scheduled: 'info', Confirmed: 'success', Rescheduled: 'warning', Completed: 'success', Missed: 'danger', Cancelled: 'neutral',
}
const GATE_TONE: Record<GateKind, BadgeTone> = { visitor: 'info', late: 'warning', exit: 'neutral' }
const GATE_LABEL: Record<GateKind, string> = { visitor: 'Visitor', late: 'Late entry', exit: 'Exit' }
const ENQUIRY_YEARS = ['2026–27', '2025–26', '2027–28']
const BLANK_ENQUIRY = {
  firstName: '', lastName: '', parent: '', phone: '', email: '', gender: '', dob: '',
  academicYear: ENQUIRY_YEARS[0], motherName: '', motherPhone: '', lastSchool: '', address: '',
  cls: '', source: 'Walk-in',
}

function today() { return new Date().toISOString().slice(0, 10) }
function uid() { return Math.random().toString(36).slice(2, 10) }
function money(n: number, cur: string) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR', maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${cur} ${n}`
  }
}
function nextEnquiryNo(existing: Enquiry[]) {
  const year = String(new Date().getFullYear() % 100).padStart(2, '0')
  return nextPersonCode(`ENQ/${year}/`, existing.map((e) => e.enquiryNo))
}

function fillEnquiry(e: Partial<Enquiry> & Pick<Enquiry, 'id'>): Enquiry {
  return {
    enquiryNo: '', parent: '', phone: '', email: '', child: '', gender: '', dob: '',
    academicYear: '', motherName: '', motherPhone: '', lastSchool: '', address: '',
    cls: '', source: 'Walk-in', status: 'New', note: '', next: '',
    ...e,
  }
}

function whenLabel(value: string) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.replace('T', ' ')
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}-${mm}-${d.getFullYear()} ${hh}:${min}`
}

function useDesk() {
  const app = useApp()
  const key = `sm-front-office:${app.school.id}`
  const [desk, setDesk] = useState<Desk>(EMPTY)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      const parsed = raw ? { ...EMPTY, ...JSON.parse(raw) } as Desk : EMPTY
      setDesk({ ...parsed, enquiries: (parsed.enquiries ?? []).map((e) => fillEnquiry(e)) })
    } catch {
      setDesk(EMPTY)
    }
  }, [key])
  const save = (next: Desk) => {
    setDesk(next)
    localStorage.setItem(key, JSON.stringify(next))
  }
  return { desk, save }
}

function PublishedFees({ askClass }: { askClass: string }) {
  const fees = useFeeStructureHistory()
  const published = (fees.data ?? []).filter((f) => f.status === 'active')
  const shown = published.filter((f) => !askClass || !f.classGrade || f.classGrade.toLowerCase() === askClass.toLowerCase())
  const lines = shown.flatMap((f) => {
    const sheet = `${f.name} · ${f.academicYear}${f.classGrade ? ` · Class ${f.classGrade}` : ''}`
    if (f.headAmounts.length === 0) {
      return [{ id: f.id, sheet, head: 'Total', amount: money(f.totalAmount, f.currency) }]
    }
    return f.headAmounts.map((h) => ({
      id: `${f.id}:${h.headName}`,
      sheet,
      head: h.headName,
      amount: money(h.perStudentAmount || h.amount, f.currency),
    }))
  })
  return (
    <div style={{ marginTop: 8 }}>
      <div className="t-sm muted" style={{ marginBottom: 8 }}>Show this sheet to the parent. Collection, waivers, and fee setup stay with the admin.</div>
      {fees.isLoading ? <Empty icon="doc" title="Loading published fees" body="Fetching the fee sheets the admin has published." /> : null}
      {fees.isError ? <Empty icon="alert" title="Could not load published fees" body="Try again in a moment." /> : null}
      {!fees.isLoading && !fees.isError && lines.length === 0 ? <Empty icon="doc" title="No published fee for this class" body="Ask the admin to publish the new-admission fees. Draft sheets stay hidden." /> : null}
      {!fees.isLoading && !fees.isError ? lines.map((line) => (
        <div key={line.id} className="fo-line">
          <span><span className="fw6">{line.head}</span><span className="t-xs muted"> · {line.sheet}</span></span>
          <span className="fw7">{line.amount}</span>
        </div>
      )) : null}
    </div>
  )
}

function pad2(n: number) { return String(n).padStart(2, '0') }
function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '—'
}
function clock(value: string) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
const FO_HUES = ['#3B82F6', '#7C3AED', '#10B981', '#F59E0B', '#EC4899', '#0EA5E9']
const FO_DOTS = ['#22C55E', '#3B82F6', '#7C3AED', '#F59E0B']

function FrontDesk() {
  const app = useApp()
  const { desk, save } = useDesk()
  const fees = useFeeStructureHistory()
  const [tab, setTab] = useState('enquiries')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<EnquiryStatus | 'all'>('all')
  const [feeClass, setFeeClass] = useState('')
  const day = today()
  const visitors = desk.gate.filter((g) => g.day === day && g.kind === 'visitor')
  const moves = desk.gate.filter((g) => g.day === day && g.kind !== 'visitor')
  const fresh = desk.enquiries.filter((e) => e.status === 'New')
  const openTasks = desk.tasks.filter((t) => !t.done)
  const meets = desk.meetings.filter((m) => m.when.slice(0, 10) === day && m.status !== 'Cancelled')
  const pipeline = ENQUIRY_STATUS.filter((s) => s !== 'Closed').map((s) => ({
    label: s,
    value: desk.enquiries.filter((e) => e.status === s).length,
    color: s === 'New' ? '#3B82F6' : s === 'Called' ? '#F59E0B' : s === 'Visit booked' ? '#22C55E' : s === 'Applied' ? '#8B5CF6' : '#0EA5E9',
  })).filter((s) => s.value > 0)
  const published = (fees.data ?? []).filter((f) => f.status === 'active')
  const classOptions = [...new Set(published.map((f) => f.classGrade).filter(Boolean))]
  const feeRows = published.filter((f) => !feeClass || !f.classGrade || f.classGrade === feeClass)
  const term = q.trim().toLowerCase()
  const enquiries = desk.enquiries.filter((e) => {
    if (status !== 'all' && e.status !== status) return false
    if (!term) return true
    return [e.child, e.parent, e.phone, e.cls, e.source, e.enquiryNo].join(' ').toLowerCase().includes(term)
  })
  const mark = (e: Enquiry, next: EnquiryStatus) => {
    save({ ...desk, enquiries: desk.enquiries.map((row) => row.id === e.id ? { ...row, status: next } : row) })
  }
  const feeLines = feeRows.flatMap((f) => (
    f.headAmounts.length
      ? f.headAmounts.map((h) => ({ id: `${f.id}:${h.headName}`, name: h.headName, amount: money(h.perStudentAmount || h.amount, f.currency) }))
      : [{ id: f.id, name: f.name, amount: money(f.totalAmount, f.currency) }]
  ))
  const actionsFor = (e: Enquiry): { label: string; tel?: string; status?: EnquiryStatus }[] => {
    if (e.status === 'Visit booked') return [{ label: 'View' }, { label: 'Follow-up' }]
    if (e.status === 'Called') return [{ label: 'Call', tel: e.phone }, { label: 'Note' }]
    return [{ label: 'Call', tel: e.phone }, { label: 'Book visit', status: 'Visit booked' }]
  }
  return (
    <div className="fo-desk">
      <PageHead title="Front Office CRM" sub="Your complete front desk view" />
      <div className="fo-kpis">
        <div className="fo-kpi">
          <span className="fo-kpi-ic" style={{ background: '#DBEAFE', color: '#2563EB' }}><Icon name="users" size={22} /></span>
          <div><div className="fo-kpi-val">{pad2(fresh.length)}</div><div className="fo-kpi-label">New enquiries</div><div className="fo-kpi-delta up">Waiting for a first call</div></div>
        </div>
        <div className="fo-kpi">
          <span className="fo-kpi-ic" style={{ background: '#DCFCE7', color: '#16A34A' }}><Icon name="user" size={22} /></span>
          <div><div className="fo-kpi-val">{pad2(visitors.length)}</div><div className="fo-kpi-label">Today's visitors</div><div className="fo-kpi-delta up">At the gate today</div></div>
        </div>
        <div className="fo-kpi">
          <span className="fo-kpi-ic" style={{ background: '#FFEDD5', color: '#EA580C' }}><Icon name="phone" size={22} /></span>
          <div><div className="fo-kpi-val">{pad2(openTasks.length)}</div><div className="fo-kpi-label">Follow-ups due</div><div className={openTasks.length ? 'fo-kpi-delta down' : 'fo-kpi-delta up'}>{openTasks.length ? `${openTasks.length} open` : 'None overdue'}</div></div>
        </div>
        <div className="fo-kpi">
          <span className="fo-kpi-ic" style={{ background: '#EDE9FE', color: '#7C3AED' }}><Icon name="calendar" size={22} /></span>
          <div><div className="fo-kpi-val">{pad2(meets.length)}</div><div className="fo-kpi-label">Meetings today</div><div className="fo-kpi-delta up">Not cancelled</div></div>
        </div>
      </div>
      <div className="fo-board">
        <section className="fo-panel">
          <div className="fo-tabs">
            {[
              ['enquiries', 'Admission enquiries'],
              ['fees', 'Fee & facilities'],
              ['visitors', 'Visitors'],
              ['appointments', 'Appointments'],
              ['tasks', 'My tasks'],
            ].map(([value, label]) => (
              <button key={value} type="button" className={tab === value ? 'fo-tab on' : 'fo-tab'} onClick={() => setTab(value)}>{label}</button>
            ))}
          </div>
          {tab === 'enquiries' ? (
            <>
              <div className="fo-head">
                <div className="fo-title">Admission enquiries</div>
                <button type="button" className="fo-link" onClick={() => app.go('school.front.admissions')}>View all →</button>
              </div>
              <div className="fo-filters">
                <Search value={q} onChange={setQ} placeholder="Search by name, class or phone..." />
                <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | 'all')} options={[{ value: 'all', label: 'All status' }, ...ENQUIRY_STATUS.map((s) => ({ value: s, label: s }))]} />
              </div>
              {enquiries.length === 0 ? <Empty icon="inbox" title="No enquiries yet" body="A new walk-in or phone enquiry shows up here." /> : enquiries.slice(0, 6).map((e, i) => (
                <div key={e.id} className="fo-row">
                  <span className="fo-avatar" style={{ background: FO_HUES[i % FO_HUES.length] }}>{initials(e.child || e.parent)}</span>
                  <div className="fo-row-main">
                    <div className="fo-row-name">{e.child || 'Child not named'}</div>
                    <div className="fo-row-meta">Parent: {e.parent || '—'} · Class: {e.cls || '—'} · Source: {e.source}</div>
                  </div>
                  <div className="fo-row-note">
                    <Badge tone={ENQUIRY_TONE[e.status]}>{e.status}</Badge>
                    <span>{e.note || ' '}</span>
                  </div>
                  <div className="fo-row-time"><b>Today</b></div>
                  <div className="fo-actions">
                    {actionsFor(e).map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className="fo-chip"
                        onClick={() => {
                          if (action.status) mark(e, action.status)
                          else if (action.tel) window.location.href = `tel:${action.tel}`
                          else app.go('school.front.admissions')
                        }}
                      >{action.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : null}
          {tab === 'fees' ? <PublishedFees askClass={feeClass} /> : null}
          {tab === 'visitors' ? (
            visitors.length + moves.length === 0 ? <Empty icon="users" title="No visitors today" body="Gate entries for today show up here." /> : [...visitors, ...moves].map((g) => (
              <div key={g.id} className="fo-row">
                <span className="fo-avatar" style={{ background: GATE_TONE[g.kind] === 'warning' ? '#F59E0B' : '#0EA5E9' }}>{initials(g.name)}</span>
                <div className="fo-row-main"><div className="fo-row-name">{g.name}</div><div className="fo-row-meta">{g.purpose || '—'} · {g.phone || 'No phone'}</div></div>
                <Badge tone={GATE_TONE[g.kind]}>{GATE_LABEL[g.kind]}</Badge>
                <div className="fo-row-time"><b>{g.at}</b></div>
              </div>
            ))
          ) : null}
          {tab === 'appointments' ? (
            desk.meetings.length === 0 ? <Empty icon="calendar" title="No appointments" body="Book a meeting with the principal, a teacher, or the admin." /> : desk.meetings.slice(0, 6).map((m) => (
              <div key={m.id} className="fo-row">
                <span className="fo-avatar" style={{ background: '#7C3AED' }}>{initials(m.who)}</span>
                <div className="fo-row-main"><div className="fo-row-name">{m.who}</div><div className="fo-row-meta">With {m.with} · {m.reason || 'No reason'}</div></div>
                <Badge tone={MEETING_TONE[m.status]}>{m.status}</Badge>
                <div className="fo-row-time"><b>{whenLabel(m.when)}</b></div>
              </div>
            ))
          ) : null}
          {tab === 'tasks' ? (
            desk.tasks.length === 0 ? <Empty icon="check" title="No follow-ups" body="Calls and reminders you add show up here." /> : desk.tasks.slice(0, 6).map((t) => (
              <div key={t.id} className="fo-row">
                <div className="fo-row-main"><div className={t.done ? 'muted' : 'fo-row-name'}>{t.title}</div><div className="fo-row-meta">Due {t.due}</div></div>
                <Badge tone={t.done ? 'success' : 'warning'}>{t.done ? 'Done' : 'Open'}</Badge>
              </div>
            ))
          ) : null}
        </section>
        <section className="fo-panel fo-schedule">
          <div className="fo-head">
            <div className="fo-title">Today's schedule</div>
            <button type="button" className="fo-link" onClick={() => app.go('school.front.appointments')}>View calendar →</button>
          </div>
          {meets.length === 0 ? <Empty icon="calendar" title="Nothing booked today" body="Scheduled meetings appear here." /> : meets.map((m, i) => (
            <div key={m.id} className="fo-slot">
              <span className="fo-dot" style={{ background: FO_DOTS[i % FO_DOTS.length] }} />
              <div>
                <div className="fw6 t-sm">{clock(m.when) || 'Time not set'}</div>
                <div className="t-sm">{m.reason || 'Meeting'}</div>
                <div className="t-xs muted">({m.who})</div>
              </div>
            </div>
          ))}
        </section>
      </div>
      <div className="fo-lower">
        <section className="fo-panel">
          <div className="fo-head">
            <div className="fo-title">Fee & facilities enquiry</div>
            <button type="button" className="fo-link" onClick={() => setTab('fees')}>View all →</button>
          </div>
          <Field label="Select class">
            <Select value={feeClass} onChange={(e) => setFeeClass(e.target.value)} options={[{ value: '', label: 'All classes' }, ...classOptions.map((c) => ({ value: c, label: `Class ${c}` }))]} />
          </Field>
          <div className="fo-split">
            <div className="fo-pane">
              <h4>{feeClass ? `Class ${feeClass} — fee structure` : 'Fee structure'} <span className="t-xs muted">(view only)</span></h4>
              {feeLines.length === 0 ? <div className="t-sm muted">No published fee for this class yet.</div> : feeLines.slice(0, 5).map((line) => (
                <div key={line.id} className="fo-line"><span>{line.name}</span><span className="fw6">{line.amount}</span></div>
              ))}
            </div>
            <div className="fo-pane">
              <h4>Included on this sheet</h4>
              {feeLines.length === 0 ? <div className="t-sm muted">Published heads appear here.</div> : feeLines.slice(0, 6).map((line) => (
                <div key={`in-${line.id}`} className="fo-line"><span><span className="fo-check">✓</span>{line.name}</span></div>
              ))}
            </div>
          </div>
        </section>
        <section className="fo-panel">
          <div className="fo-title" style={{ margin: '10px 0 12px' }}>Quick actions</div>
          <div className="fo-qa">
            <button type="button" style={{ background: '#EEF4FF', color: '#1D4ED8' }} onClick={() => app.go('school.front.admissions')}><span className="ic"><Icon name="phone" size={16} /></span>New enquiry</button>
            <button type="button" style={{ background: '#ECFDF3', color: '#15803D' }} onClick={() => app.go('school.front.gate')}><span className="ic"><Icon name="user" size={16} /></span>Visitor entry</button>
            <button type="button" style={{ background: '#F5F3FF', color: '#6D28D9' }} onClick={() => app.go('school.front.appointments')}><span className="ic"><Icon name="calendar" size={16} /></span>Book appointment</button>
            <button type="button" style={{ background: '#FFF7ED', color: '#C2410C' }} onClick={() => app.go('school.front.tasks')}><span className="ic"><Icon name="check" size={16} /></span>Add follow-up</button>
          </div>
        </section>
        <section className="fo-panel">
          <div className="fo-title" style={{ margin: '10px 0 12px' }}>Status pipeline</div>
          {pipeline.length === 0 ? <Empty icon="inbox" title="No enquiries yet" /> : (
            <div className="fo-pipe">
              <Donut segments={pipeline} size={132} thickness={18} center={<div style={{ textAlign: 'center' }}><div className="fw7" style={{ fontSize: 22 }}>{desk.enquiries.length}</div><div className="t-xs muted">Total</div></div>} />
              <div className="fo-legend">
                {pipeline.map((p) => <div key={p.label}><i style={{ background: p.color }} />{p.label} <b>{p.value}</b></div>)}
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="fo-bottom">
        <section className="fo-panel">
          <div className="fo-head"><div className="fo-title">Recent activities</div></div>
          {desk.notices.length === 0 ? <div className="t-sm muted">Enquiry, gate, and appointment notes appear here.</div> : desk.notices.slice(0, 4).map((n, i) => (
            <div key={n.id} className="fo-act">
              <time>{n.at}</time>
              <span className="fo-dot" style={{ background: FO_DOTS[i % FO_DOTS.length], marginTop: 4 }} />
              <div>{n.text}</div>
            </div>
          ))}
        </section>
        <section className="fo-ready">
          <span className="fo-ready-ic"><Icon name="check" size={18} /></span>
          <div>
            <div className="fw7">You're all set!</div>
            <div className="t-sm" style={{ marginTop: 4 }}>
              {openTasks.length === 0
                ? 'Manage enquiries, schedule meetings, and keep parents informed.'
                : `${openTasks.length} follow-up${openTasks.length === 1 ? '' : 's'} still open. Call them back from My tasks.`}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function Admissions() {
  const toast = useToast()
  const { desk, save } = useDesk()
  const [form, setForm] = useState(BLANK_ENQUIRY)
  const [open, setOpen] = useState(false)
  const [showFees, setShowFees] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<EnquiryStatus | 'all'>('all')
  const [editing, setEditing] = useState<Enquiry | null>(null)
  const set = (key: keyof typeof BLANK_ENQUIRY, value: string) => setForm((f) => ({ ...f, [key]: value }))
  const add = () => {
    const child = [form.firstName, form.lastName].map((s) => s.trim()).filter(Boolean).join(' ')
    if (!child || !form.phone.trim()) return
    const enquiryNo = nextEnquiryNo(desk.enquiries)
    const row: Enquiry = {
      id: uid(),
      enquiryNo,
      parent: form.parent.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      child,
      gender: form.gender,
      dob: form.dob,
      academicYear: form.academicYear,
      motherName: form.motherName.trim(),
      motherPhone: form.motherPhone.trim(),
      lastSchool: form.lastSchool.trim(),
      address: form.address.trim(),
      cls: form.cls,
      source: form.source,
      status: 'New',
      note: '',
      next: '',
    }
    save({ ...desk, enquiries: [row, ...desk.enquiries], tasks: [{ id: uid(), title: `Call ${form.parent || child} about ${child}`, due: today(), done: false }, ...desk.tasks] })
    toast.success('Enquiry saved', `${child} · ${enquiryNo}`)
    setForm(BLANK_ENQUIRY)
    setOpen(false)
    setShowFees(true)
  }
  const patch = (id: string, partial: Partial<Enquiry>) => {
    save({ ...desk, enquiries: desk.enquiries.map((e) => e.id === id ? { ...e, ...partial } : e) })
  }
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase()
    return desk.enquiries.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (!n) return true
      return [e.child, e.parent, e.phone, e.cls, e.source].join(' ').toLowerCase().includes(n)
    })
  }, [desk.enquiries, q, status])
  const openCount = desk.enquiries.filter((e) => e.status !== 'Closed').length
  const ready = desk.enquiries.filter((e) => e.status === 'Ready to admit').length
  const cols: Column<Enquiry>[] = [
    { key: 'child', label: 'Child', sortValue: (r) => r.child, render: (r) => <div><div className="fw6">{r.child}</div><div className="t-xs muted3">{r.source}</div></div> },
    { key: 'parent', label: 'Parent', sortValue: (r) => r.parent, render: (r) => <div><div>{r.parent}</div><div className="t-xs muted3">{r.phone || 'No phone'}</div></div> },
    { key: 'cls', label: 'Class', sortValue: (r) => r.cls, render: (r) => r.cls || '—' },
    { key: 'status', label: 'Status', sortValue: (r) => r.status, render: (r) => <Badge tone={ENQUIRY_TONE[r.status]} dot>{r.status}</Badge> },
    { key: 'note', label: 'Follow-up', render: (r) => <span className="t-sm muted">{r.note || '—'}</span> },
    { key: 'act', label: '', align: 'right', render: (r) => <Btn size="sm" variant="ghost" onClick={() => setEditing(r)}>Update</Btn> },
  ]
  return (
    <div>
      <PageHead
        title="Admissions & Enquiries"
        sub="Add and follow up. Admit into the student list stays with the admin."
        actions={(
          <div className="row gap8">
            <Btn variant="secondary" icon="doc" onClick={() => setShowFees((v) => !v)}>{showFees ? 'Hide admission fees' : 'Show admission fees'}</Btn>
            <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>New enquiry</Btn>
          </div>
        )}
      />
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="inbox" iconColor="#4F46E5" iconBg="color-mix(in srgb, #4F46E5 12%, white)" label="Open enquiries" value={openCount} foot="Not closed" />
        <Kpi icon="check" iconColor="#16A34A" iconBg="color-mix(in srgb, #22C55E 12%, white)" label="Ready to admit" value={ready} foot="Admin still admits the student" />
        <Kpi icon="users" iconColor="#0EA5E9" iconBg="color-mix(in srgb, #0EA5E9 12%, white)" label="All enquiries" value={desk.enquiries.length} foot="This desk" />
      </div>
      {showFees ? <PublishedFees askClass={form.cls || editing?.cls || ''} /> : null}
      <Card style={{ marginBottom: 16 }}>
        <div className="row ai-center gap12 wrap">
          <div style={{ flex: '1 1 220px' }}>
            <Search value={q} onChange={setQ} placeholder="Child, parent, or phone" />
          </div>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as EnquiryStatus | 'all')} options={[{ value: 'all', label: 'All statuses' }, ...ENQUIRY_STATUS.map((s) => ({ value: s, label: s }))]} />
          </Field>
        </div>
      </Card>
      <Card pad={false}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<Empty icon="inbox" title="No enquiries yet" body="Save a walk-in or phone enquiry. Admission approval stays with the admin." />}
        />
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="lg"
        icon="inbox"
        title="New enquiry"
        sub="Saves the student name and an enquiry number. Admission into the school stays with the admin."
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={add}>Save enquiry</Btn>
          </div>
        )}
      >
        <div className="col gap12">
          <div className="sm-grid-2 gap16">
            <Field label="Student first name" required><Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} /></Field>
            <Field label="Student last name"><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} /></Field>
          </div>
          <div className="sm-grid-2 gap16">
            <Field label="Parent name"><Input value={form.parent} onChange={(e) => set('parent', e.target.value)} /></Field>
            <Field label="Mobile number" required><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          </div>
          <div className="sm-grid-2 gap16">
            <Field label="Class asked"><Input value={form.cls} onChange={(e) => set('cls', e.target.value)} /></Field>
            <Field label="Academic year">
              <Select value={form.academicYear} onChange={(e) => set('academicYear', e.target.value)} options={ENQUIRY_YEARS} />
            </Field>
          </div>
          <div className="sm-grid-2 gap16">
            <Field label="Gender">
              <Select value={form.gender} onChange={(e) => set('gender', e.target.value)} options={[{ value: '', label: 'Select' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }]} />
            </Field>
            <Field label="Date of birth"><Input type="date" value={form.dob} onChange={(e) => set('dob', e.target.value)} /></Field>
          </div>
          <div className="sm-grid-2 gap16">
            <Field label="Email"><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Source">
              <Select value={form.source} onChange={(e) => set('source', e.target.value)} options={['Walk-in', 'Phone', 'Website', 'Referral']} />
            </Field>
          </div>
          <div className="sm-grid-2 gap16">
            <Field label="Mother name"><Input value={form.motherName} onChange={(e) => set('motherName', e.target.value)} /></Field>
            <Field label="Mother phone"><Input value={form.motherPhone} onChange={(e) => set('motherPhone', e.target.value)} /></Field>
          </div>
          <Field label="Previous school"><Input value={form.lastSchool} onChange={(e) => set('lastSchool', e.target.value)} /></Field>
          <Field label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        </div>
      </Modal>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        size="sm"
        icon="edit"
        title={editing ? `${editing.child} · ${editing.parent}` : 'Follow-up'}
        sub="Update the status and the next note. You cannot admit the student."
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setEditing(null)}>Close</Btn>
          </div>
        )}
      >
        {editing ? (
          <div className="col gap12">
            <Field label="Status">
              <Select aria-label="Enquiry status" value={editing.status} options={ENQUIRY_STATUS} onChange={(ev) => {
                const next = ev.target.value as EnquiryStatus
                patch(editing.id, { status: next })
                setEditing({ ...editing, status: next })
              }} />
            </Field>
            <Field label="Follow-up note">
              <Textarea value={editing.note} onChange={(ev) => {
                patch(editing.id, { note: ev.target.value })
                setEditing({ ...editing, note: ev.target.value })
              }} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function Directory() {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Student[]>([])
  const [err, setErr] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let live = true
    listStudents().then((list) => { if (live) setRows(list) }).catch(() => { if (live) setErr(true) }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase()
    const list = !n ? rows : rows.filter((s) => [s.name, s.cls, s.guardian, s.phone, s.adm].join(' ').toLowerCase().includes(n))
    return list.slice(0, 40)
  }, [rows, q])
  const cols: Column<Student>[] = [
    { key: 'name', label: 'Student', sortValue: (s) => s.name, render: (s) => <span className="fw6">{s.name}</span> },
    { key: 'cls', label: 'Class', sortValue: (s) => s.cls, render: (s) => s.cls || '—' },
    { key: 'adm', label: 'Admission no.', sortValue: (s) => s.adm, render: (s) => s.adm || '—' },
    { key: 'guardian', label: 'Parent', sortValue: (s) => s.guardian, render: (s) => s.guardian || 'Not on file' },
    { key: 'phone', label: 'Phone', render: (s) => s.phone || '—' },
  ]
  return (
    <div>
      <PageHead title="Student & Parent Directory" sub="Search only. Name, class, parent, and phone. Student edit stays with the admin." />
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="users" iconColor="#4F46E5" iconBg="color-mix(in srgb, #4F46E5 12%, white)" label="Students on file" value={loading ? '—' : rows.length} foot="This school" />
        <Kpi icon="search" iconColor="#0EA5E9" iconBg="color-mix(in srgb, #0EA5E9 12%, white)" label="Showing" value={loading ? '—' : shown.length} foot={q.trim() ? 'Matching the search' : 'First 40'} />
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Search value={q} onChange={setQ} placeholder="Name, class, admission no., or parent phone" />
      </Card>
      <Card pad={false}>
        <DataTable
          columns={cols}
          rows={err ? [] : shown}
          rowKey={(s) => s.id}
          empty={err
            ? <Empty icon="alert" title="Could not load the directory" body="The student list did not load. Try again." />
            : loading
              ? <Empty icon="users" title="Loading directory" body="Fetching students for this school." />
              : <Empty icon="users" title="No students match" body="Try another name, class, or phone." />}
        />
      </Card>
    </div>
  )
}

function Gate() {
  const { desk, save } = useDesk()
  const [tab, setTab] = useState('visitor')
  const [form, setForm] = useState({ name: '', phone: '', purpose: '' })
  const day = today()
  const add = (kind: GateKind) => {
    if (!form.name.trim()) return
    const row: GateRow = { id: uid(), kind, name: form.name, phone: form.phone, purpose: form.purpose, at: new Date().toLocaleTimeString(), day }
    save({ ...desk, gate: [row, ...desk.gate] })
    setForm({ name: '', phone: '', purpose: '' })
  }
  const todayRows = desk.gate.filter((g) => g.day === day)
  const rows = todayRows.filter((g) => (tab === 'visitor' ? g.kind === 'visitor' : g.kind !== 'visitor'))
  const cols: Column<GateRow>[] = [
    { key: 'name', label: 'Name', sortValue: (g) => g.name, render: (g) => <span className="fw6">{g.name}</span> },
    { key: 'kind', label: 'Type', render: (g) => <Badge tone={GATE_TONE[g.kind]} dot>{GATE_LABEL[g.kind]}</Badge> },
    { key: 'phone', label: 'Phone', render: (g) => g.phone || '—' },
    { key: 'purpose', label: tab === 'visitor' ? 'Here to see' : 'Reason', render: (g) => g.purpose || '—' },
    { key: 'at', label: 'Time', align: 'right', render: (g) => <span className="t-sm muted">{g.at}</span> },
  ]
  return (
    <div>
      <PageHead title="Gate" sub="Visitors, late entry, and exit for today only." />
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="users" iconColor="#0EA5E9" iconBg="color-mix(in srgb, #0EA5E9 12%, white)" label="Visitors" value={todayRows.filter((g) => g.kind === 'visitor').length} foot="Today" />
        <Kpi icon="clock" iconColor="#D97706" iconBg="color-mix(in srgb, #D97706 12%, white)" label="Late entry" value={todayRows.filter((g) => g.kind === 'late').length} foot="Today" />
        <Kpi icon="logout" iconColor="#64748B" iconBg="color-mix(in srgb, #64748B 12%, white)" label="Exit" value={todayRows.filter((g) => g.kind === 'exit').length} foot="Today" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'visitor', label: 'Visitors' }, { value: 'move', label: 'Late entry / Exit' }]} />
      <Card style={{ marginTop: 16 }}>
        <CardHead
          icon={tab === 'visitor' ? 'users' : 'clock'}
          title={tab === 'visitor' ? 'Visitor in' : 'Late entry or exit'}
          sub="Logged for today. Yesterday's gate book is not kept on this desk."
        />
        <div className="sm-grid-3 gap16" style={{ marginTop: 12 }}>
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label={tab === 'visitor' ? 'Who they came to see' : 'Reason'}><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></Field>
        </div>
        <div className="row gap8" style={{ marginTop: 12 }}>
          {tab === 'visitor'
            ? <Btn variant="primary" icon="plus" onClick={() => add('visitor')}>Visitor in</Btn>
            : <>
              <Btn variant="primary" icon="plus" onClick={() => add('late')}>Late entry</Btn>
              <Btn variant="secondary" icon="logout" onClick={() => add('exit')}>Exit</Btn>
            </>}
        </div>
      </Card>
      <Card pad={false} style={{ marginTop: 16 }}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(g) => g.id}
          empty={<Empty icon="clock" title="Nothing on the gate today" body={tab === 'visitor' ? 'Visitor arrivals for today appear here.' : 'Late entries and exits for today appear here.'} />}
        />
      </Card>
    </div>
  )
}

function Appointments() {
  const toast = useToast()
  const { desk, save } = useDesk()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<MeetingStatus | 'all'>('all')
  const [form, setForm] = useState({ who: '', with: 'Principal', when: '', reason: '' })
  const note = (text: string) => ({ id: uid(), text, at: new Date().toLocaleString() })
  const add = () => {
    if (!form.who.trim() || !form.when) return
    const meeting: Meeting = { id: uid(), ...form, status: 'Scheduled' }
    save({
      ...desk,
      meetings: [meeting, ...desk.meetings],
      notices: [
        note(`${form.with} notified: meeting with ${form.who}`),
        note(`Parent confirmation sent to ${form.who}`),
        note(`Reminder set for ${form.when}`),
        ...desk.notices,
      ],
    })
    toast.success('Appointment scheduled', `${form.with} is notified and the parent gets a confirmation.`)
    setForm({ who: '', with: 'Principal', when: '', reason: '' })
    setOpen(false)
  }
  const setMeetingStatus = (id: string, next: MeetingStatus) => {
    const meeting = desk.meetings.find((m) => m.id === id)
    const notices = next === 'Completed' && meeting
      ? [note(`Meeting completed: ${meeting.who} with ${meeting.with}. Reception notified.`), ...desk.notices]
      : desk.notices
    save({ ...desk, meetings: desk.meetings.map((m) => m.id === id ? { ...m, status: next } : m), notices })
    if (next === 'Completed') toast.success('Meeting completed', 'The receptionist is notified.')
  }
  const rows = desk.meetings.filter((m) => status === 'all' || m.status === status)
  const todayCount = desk.meetings.filter((m) => m.when.slice(0, 10) === today() && m.status !== 'Cancelled').length
  const cols: Column<Meeting>[] = [
    { key: 'who', label: 'Parent', sortValue: (m) => m.who, render: (m) => <div><div className="fw6">{m.who}</div><div className="t-xs muted3">{m.reason || 'No reason'}</div></div> },
    { key: 'with', label: 'With', sortValue: (m) => m.with, render: (m) => m.with },
    { key: 'when', label: 'When', sortValue: (m) => m.when, render: (m) => whenLabel(m.when) },
    {
      key: 'status', label: 'Status', width: 180,
      render: (m) => (
        <Select aria-label="Meeting status" value={m.status} options={MEETING_STATUS} onChange={(e) => setMeetingStatus(m.id, e.target.value as MeetingStatus)} />
      ),
    },
  ]
  return (
    <div>
      <PageHead
        title="Appointments & Meetings"
        sub="Scheduled, confirmed, rescheduled, completed, missed, or cancelled."
        actions={<Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>Schedule</Btn>}
      />
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="calendar" iconColor="#4F46E5" iconBg="color-mix(in srgb, #4F46E5 12%, white)" label="Today" value={todayCount} foot="Not cancelled" />
        <Kpi icon="clock" iconColor="#D97706" iconBg="color-mix(in srgb, #D97706 12%, white)" label="Open" value={desk.meetings.filter((m) => m.status === 'Scheduled' || m.status === 'Confirmed' || m.status === 'Rescheduled').length} foot="Still to happen" />
        <Kpi icon="check" iconColor="#16A34A" iconBg="color-mix(in srgb, #22C55E 12%, white)" label="Completed" value={desk.meetings.filter((m) => m.status === 'Completed').length} foot="Reception notified" />
      </div>
      <Card style={{ marginBottom: 16 }}>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as MeetingStatus | 'all')} options={[{ value: 'all', label: 'All statuses' }, ...MEETING_STATUS.map((s) => ({ value: s, label: s }))]} />
        </Field>
      </Card>
      <Card pad={false}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(m) => m.id}
          empty={<Empty icon="calendar" title="No appointments" body="Schedule a meeting with the principal, a teacher, or the admin." />}
        />
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        icon="calendar"
        title="Schedule appointment"
        sub="The teacher or principal is marked notified, and the parent gets a confirmation on this desk."
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" onClick={add}>Schedule</Btn>
          </div>
        )}
      >
        <div className="col gap12">
          <Field label="Parent" required><Input value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} /></Field>
          <Field label="With">
            <Select value={form.with} options={['Principal', 'Teacher', 'Admin']} onChange={(e) => setForm({ ...form, with: e.target.value })} />
          </Field>
          <Field label="When" required><Input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></Field>
          <Field label="Reason"><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  )
}

function Messages() {
  const [tab, setTab] = useState('parent')
  const [who, setWho] = useState('')
  const [text, setText] = useState('')
  const { desk, save } = useDesk()
  const parentNotes = desk.notices.filter((n) => n.text.startsWith('Parent message:'))
  const send = () => {
    if (!text.trim()) return
    const label = who.trim() ? `${who.trim()}: ${text.trim()}` : text.trim()
    save({ ...desk, notices: [{ id: uid(), text: `Parent message: ${label}`, at: new Date().toLocaleString() }, ...desk.notices] })
    setText('')
    setWho('')
  }
  return (
    <div>
      <PageHead title="Messages" sub="One parent at a time. School-wide announcements stay with the admin." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'parent', label: 'Parent' }, { value: 'notices', label: 'Notices' }]} />
      {tab === 'parent' ? (
        <>
          <Card style={{ marginTop: 16 }}>
            <CardHead icon="message" title="Message one parent" sub="Saved on this desk. It is not sent to the whole school." />
            <div className="col gap12" style={{ marginTop: 12 }}>
              <Field label="Parent"><Input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Parent name" /></Field>
              <Field label="Message">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Visit, pickup, or a call" />
              </Field>
              <div><Btn variant="primary" icon="message" onClick={send}>Save message</Btn></div>
            </div>
          </Card>
          <Card pad={false} style={{ marginTop: 16 }}>
            <DataTable
              columns={[
                { key: 'at', label: 'When', width: 180, render: (n: Notice) => <span className="t-sm muted">{n.at}</span> },
                { key: 'text', label: 'Message', render: (n: Notice) => n.text.replace(/^Parent message:\s*/, '') },
              ]}
              rows={parentNotes}
              rowKey={(n) => n.id}
              empty={<Empty icon="message" title="No parent messages yet" body="Messages you save for one parent appear here." />}
            />
          </Card>
        </>
      ) : (
        <Card pad={false} style={{ marginTop: 16 }}>
          <div style={{ padding: '16px 16px 0' }}>
            <CardHead icon="bell" title="Notices you can read" sub="You do not send these to the whole school." />
          </div>
          <DataTable
            columns={[
              { key: 'at', label: 'When', width: 180, render: (n: Notice) => <span className="t-sm muted">{n.at}</span> },
              { key: 'text', label: 'Notice', render: (n: Notice) => n.text },
            ]}
            rows={desk.notices}
            rowKey={(n) => n.id}
            empty={<Empty icon="bell" title="No notices" body="Appointment reminders and desk notes appear here." />}
          />
        </Card>
      )}
    </div>
  )
}

function Tasks() {
  const { desk, save } = useDesk()
  const [title, setTitle] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const rows = desk.tasks.filter((t) => !openOnly || !t.done)
  const cols: Column<TaskRow>[] = [
    { key: 'title', label: 'Follow-up', sortValue: (t) => t.title, render: (t) => <span className={t.done ? 'muted' : 'fw6'}>{t.title}</span> },
    { key: 'due', label: 'Due', sortValue: (t) => t.due, render: (t) => t.due },
    { key: 'state', label: 'Status', render: (t) => <Badge tone={t.done ? 'success' : 'warning'} dot>{t.done ? 'Done' : 'Open'}</Badge> },
    {
      key: 'act', label: '', align: 'right',
      render: (t) => (
        <Btn size="sm" variant="secondary" onClick={() => save({ ...desk, tasks: desk.tasks.map((x) => x.id === t.id ? { ...x, done: !x.done } : x) })}>
          {t.done ? 'Reopen' : 'Done'}
        </Btn>
      ),
    },
  ]
  return (
    <div>
      <PageHead title="My tasks" sub="Calls, reminders, and follow-ups for this desk." />
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="check" iconColor="#D97706" iconBg="color-mix(in srgb, #D97706 12%, white)" label="Open" value={desk.tasks.filter((t) => !t.done).length} foot="Still to do" />
        <Kpi icon="checkCircle" iconColor="#16A34A" iconBg="color-mix(in srgb, #22C55E 12%, white)" label="Done" value={desk.tasks.filter((t) => t.done).length} foot="Closed on this desk" />
      </div>
      <Card style={{ marginBottom: 16 }}>
        <CardHead icon="plus" title="Add a follow-up" sub="Enquiry calls are added here automatically." />
        <div className="row gap8 wrap" style={{ marginTop: 12 }}>
          <div style={{ flex: '1 1 240px' }}>
            <Field label="Task"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call the parent back" /></Field>
          </div>
          <div className="row ai-end"><Btn variant="primary" icon="plus" onClick={() => { if (!title.trim()) return; save({ ...desk, tasks: [{ id: uid(), title, due: today(), done: false }, ...desk.tasks] }); setTitle('') }}>Add</Btn></div>
        </div>
      </Card>
      <Card style={{ marginBottom: 16 }}>
        <Field label="Show">
          <Select value={openOnly ? 'open' : 'all'} onChange={(e) => setOpenOnly(e.target.value === 'open')} options={[{ value: 'open', label: 'Open only' }, { value: 'all', label: 'Open and done' }]} />
        </Field>
      </Card>
      <Card pad={false}>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(t) => t.id}
          empty={<Empty icon="check" title="No follow-ups" body="Add a call or reminder, or save an enquiry and the call is created for you." />}
        />
      </Card>
    </div>
  )
}

function FrontProfile() {
  const app = useApp()
  return (
    <div>
      <PageHead title="Profile" sub="Your account. School settings stay with the admin." />
      <Card>
        <CardHead icon="user" title={app.user?.name || 'Receptionist'} sub={app.user?.email || 'Front office'} />
        <div className="t-sm" style={{ marginTop: 12 }}>Receptionist · {app.school.name}</div>
      </Card>
    </div>
  )
}

export const frontOfficeScreens: Record<string, ComponentType> = {
  'school.frontdesk': FrontDesk,
  'school.front.admissions': Admissions,
  'school.front.directory': Directory,
  'school.front.gate': Gate,
  'school.front.appointments': Appointments,
  'school.front.messages': Messages,
  'school.front.tasks': Tasks,
  'school.front.profile': FrontProfile,
}
