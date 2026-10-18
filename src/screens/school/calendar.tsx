/* ============================================================
   SchoolMate — Academic Calendar
   Month grid + agenda. Events persist via GET/POST/DELETE /v1/calendar
   (SQL). Email notify uses announcements API.
   ============================================================ */
import { useMemo, useState, useCallback, useEffect, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { can } from '@/lib/gating'
import {
  PageHead, Card, CardHead, Btn, Badge, Select, Field, Input, Textarea, Checkbox, Modal, Icon, Empty, Segmented, FileUpload,
} from '@/components/ui'
import {
  listCalendarEvents,
  addCalendarEvent,
  removeCalendarEvent,
  type CalendarEvent,
  type CalendarEventType,
} from '@/api/calendarEvents'
import { createAnnouncement } from '@/api/announcements'
import { collectAudienceContacts } from '@/lib/collectAudienceEmails'

type EvType = CalendarEventType
type Channel = 'email' | 'sms' | 'app'

const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: 'email', label: 'Email', hint: 'Parents & teachers mail ids' },
  { key: 'sms', label: 'SMS', hint: 'Guardian & teacher mobile numbers' },
  { key: 'app', label: 'App', hint: 'In-app notification (bell)' },
]

const EVENT_META: Record<EvType, { label: string; color: string; icon: string }> = {
  holiday: { label: 'Holiday', color: '#16a34a', icon: 'sparkle' },
  exam: { label: 'Exam', color: '#dc2626', icon: 'clipboard' },
  fee: { label: 'Fee due', color: '#d97706', icon: 'rupee' },
  ptm: { label: 'PTM', color: '#0ea5e9', icon: 'users' },
  event: { label: 'Event', color: '#7c3aed', icon: 'calendar' },
}
const TYPES = Object.keys(EVENT_META) as EvType[]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate()

function fileToBase64(file: File): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const comma = raw.indexOf(',')
      resolve({
        base64: comma >= 0 ? raw.slice(comma + 1) : raw,
        contentType: file.type || 'application/octet-stream',
      })
    }
    reader.onerror = () => reject(new Error('Could not read attachment'))
    reader.readAsDataURL(file)
  })
}

function CalendarScreen() {
  const app = useApp()
  const toast = useToast()
  const editable = can(app.role, 'academics', 'E')

  const today = new Date()
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate())
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [enabled, setEnabled] = useState<Set<EvType>>(new Set(TYPES))
  const [view, setView] = useState<'month' | 'agenda'>('month')
  const [tick, setTick] = useState(0)
  const [selDay, setSelDay] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [form, setForm] = useState<{ date: string; type: EvType; title: string; desc: string; channels: Channel[] }>({
    date: iso(today.getFullYear(), today.getMonth(), today.getDate()),
    type: 'event',
    title: '',
    desc: '',
    channels: ['email', 'sms', 'app'],
  })

  const refresh = useCallback(() => setTick((n) => n + 1), [])
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([])

  useEffect(() => {
    let cancelled = false
    void listCalendarEvents()
      .then((rows) => { if (!cancelled) setAllEvents(rows) })
      .catch((err) => {
        if (!cancelled) {
          setAllEvents([])
          toast.danger('Could not load calendar', err instanceof Error ? err.message : 'Please try again.')
        }
      })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, app.school.id])

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const events = useMemo(() => {
    return allEvents.filter((e) => {
      const [yy, mm] = e.date.split('-').map(Number)
      if (yy !== cursor.y || mm !== cursor.m + 1) return false
      return enabled.has(e.type)
    })
  }, [allEvents, cursor, enabled])

  const byDay = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {}
    events.forEach((e) => {
      const d = Number(e.date.split('-')[2])
      ;(map[d] ??= []).push(e)
    })
    return map
  }, [events])

  const dim = daysInMonth(cursor.y, cursor.m)
  const lead = new Date(cursor.y, cursor.m, 1).getDay()
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const isToday = (d: number) => today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === d
  const go = (delta: number) => setCursor((c) => {
    let m = c.m + delta, y = c.y
    if (m < 0) { m = 11; y-- }
    if (m > 11) { m = 0; y++ }
    return { y, m }
  })
  const toggleType = (t: EvType) => setEnabled((s) => {
    const n = new Set(s)
    if (n.has(t)) n.delete(t)
    else n.add(t)
    return n
  })
  const toggleChannel = (c: Channel) => setForm((f) => ({
    ...f,
    channels: f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c],
  }))

  const addEvent = async () => {
    if (!form.title.trim()) {
      toast.danger('Title required', 'Enter an event title.')
      return
    }
    if (form.date < todayIso) {
      toast.danger('Past date', 'You can only create events for today or a future date.')
      return
    }
    setSaving(true)
    try {
      const created = await addCalendarEvent({
        date: form.date,
        type: form.type,
        title: form.title.trim(),
        desc: form.desc.trim() || undefined,
        channels: form.channels,
        attachmentName: attachment?.name,
      })
      refresh()

      let mailNote = ''
      if (form.channels.length > 0) {
        try {
          const when = new Date(created.date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })
          const contacts = await collectAudienceContacts('everyone')
          const channels = form.channels.map((c) => (c === 'app' ? 'app' : c))
          if (
            (channels.includes('email') && !contacts.emails.length)
            && (channels.includes('sms') && !contacts.phones.length)
            && !channels.includes('app')
          ) {
            toast.danger(
              'Event saved, no contacts',
              'Add parent/teacher email or mobile, then resend with notify on.',
            )
            setAddOpen(false)
            setAttachment(null)
            setForm((f) => ({ ...f, title: '', desc: '', channels: ['email', 'sms', 'app'] }))
            return
          }
          const kind = EVENT_META[created.type].label
          let attachmentBase64: string | undefined
          let attachmentFileName: string | undefined
          let attachmentContentType: string | undefined
          if (attachment) {
            const encoded = await fileToBase64(attachment)
            attachmentBase64 = encoded.base64
            attachmentFileName = attachment.name
            attachmentContentType = encoded.contentType
          }
          const ann = await createAnnouncement({
            title: created.title,
            body: created.desc?.trim() || `${kind} scheduled at ${app.school.name}.`,
            type: 'calendar',
            audience: 'everyone',
            emails: contacts.emails,
            phones: contacts.phones,
            channels,
            schoolName: app.school.name,
            eventDate: when,
            eventKind: kind,
            attachmentBase64,
            attachmentFileName,
            attachmentContentType,
          })
          mailNote = ann.reach > 0
            ? ` · notice${attachment ? ' + your file' : ''} to ${ann.reach}`
            : ' · saved (0 reach — check contacts)'
        } catch (err) {
          toast.danger(
            'Event saved, notify failed',
            err instanceof Error ? err.message : 'Could not queue announcement.',
          )
          setAddOpen(false)
          setAttachment(null)
          setForm((f) => ({ ...f, title: '', desc: '', channels: ['email', 'sms', 'app'] }))
          return
        }
      }

      toast.success(
        'Event saved',
        `${EVENT_META[form.type].label}: ${form.title.trim()}${mailNote}`,
      )
      setAddOpen(false)
      setAttachment(null)
      setForm((f) => ({ ...f, title: '', desc: '', channels: ['email', 'sms', 'app'] }))
    } catch (err) {
      toast.danger('Could not save', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const deleteEvent = async (ev: CalendarEvent) => {
    try {
      await removeCalendarEvent(ev.id)
      refresh()
      toast.success('Event removed', ev.title)
      if (selDay && !allEvents.some((e) => e.id !== ev.id && e.date === selDay)) setSelDay(null)
    } catch (err) {
      toast.danger('Could not remove', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const agenda = useMemo(() => [...events].sort((a, b) => a.date.localeCompare(b.date)), [events])
  const selEvents = selDay ? events.filter((e) => e.date === selDay) : []

  return (
    <div>
      <PageHead
        title="Calendar"
        sub={`${app.school.name} · academic year · your events only`}
        actions={editable
          ? <Btn variant="primary" icon="plus" onClick={() => setAddOpen(true)}>Add event</Btn>
          : undefined}
      />

      <Card style={{ marginBottom: 16 }}>
        <div className="row ai-center jc-between gap12 wrap">
          <div className="row ai-center gap8">
            <Btn size="sm" variant="secondary" icon="arrowLeft" onClick={() => go(-1)} />
            <span className="fw7 t-lg" style={{ minWidth: 170, textAlign: 'center' }}>{monthLabel}</span>
            <Btn size="sm" variant="secondary" icon="arrowRight" onClick={() => go(1)} />
            <Btn size="sm" variant="ghost" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>Today</Btn>
          </div>
          <Segmented value={view} onChange={(v) => setView(v as 'month' | 'agenda')} options={[{ value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]} />
        </div>
        <div className="row ai-center gap8 wrap" style={{ marginTop: 12 }}>
          {TYPES.map((t) => {
            const on = enabled.has(t)
            const m = EVENT_META[t]
            return (
              <button key={t} type="button" onClick={() => toggleType(t)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${on ? m.color : 'var(--border)'}`,
                background: on ? `color-mix(in srgb, ${m.color} 14%, transparent)` : 'var(--surface)',
                color: on ? m.color : 'var(--text-3)', fontSize: 12.5, fontWeight: 600,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: m.color }} />{m.label}
              </button>
            )
          })}
        </div>
      </Card>

      {view === 'month' ? (
        <Card pad={false}>
          {allEvents.length === 0 && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <Empty icon="calendar" title="No events yet" body="Dummy sample events were removed. Add holidays, exams, fees, and PTMs — email notify queues a school announcement." />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="t-xs fw7 muted3" style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>{w}</div>
            ))}
            {cells.map((d, i) => (
              <div
                key={i}
                onClick={() => d && setSelDay(iso(cursor.y, cursor.m, d))}
                style={{
                  minHeight: 106, padding: 6,
                  borderRight: (i % 7 !== 6) ? '1px solid var(--border)' : undefined,
                  borderBottom: '1px solid var(--border)',
                  background: d == null ? 'var(--surface-2)' : undefined,
                  cursor: d ? 'pointer' : 'default',
                }}
              >
                {d != null && (
                  <>
                    <span className="t-xs fw6" style={isToday(d)
                      ? { background: 'var(--brand-600)', color: '#fff', borderRadius: 999, width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
                      : { color: 'var(--text-2)' }}>{d}</span>
                    <div className="col gap4" style={{ marginTop: 4 }}>
                      {(byDay[d] ?? []).slice(0, 3).map((e) => {
                        const m = EVENT_META[e.type]
                        return (
                          <div key={e.id} className="t-xs" style={{
                            display: 'flex', alignItems: 'center', gap: 4, borderRadius: 5, padding: '1px 5px', fontWeight: 600,
                            background: `color-mix(in srgb, ${m.color} 13%, transparent)`, color: m.color,
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: m.color, flex: '0 0 auto' }} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
                          </div>
                        )
                      })}
                      {(byDay[d]?.length ?? 0) > 3 && <span className="t-xs muted3">+{byDay[d].length - 3} more</span>}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card pad={false}>
          <CardHead title="Agenda" sub={`${agenda.length} events · ${monthLabel}`} icon="calendar" />
          {agenda.length === 0
            ? <div style={{ padding: 8 }}><Empty icon="calendar" title="No events" body="Nothing scheduled this month. Add an event to get started." /></div>
            : (
              <div className="col">
                {agenda.map((e) => {
                  const m = EVENT_META[e.type]
                  const dt = new Date(e.date + 'T00:00:00')
                  return (
                    <div key={e.id} className="row ai-center gap12" style={{ padding: '11px 16px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 46, textAlign: 'center', flex: '0 0 auto' }}>
                        <div className="fw7 t-lg" style={{ lineHeight: 1 }}>{dt.getDate()}</div>
                        <div className="t-xs muted3">{dt.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                      </div>
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: m.color, flex: '0 0 auto' }} />
                      <div className="flex1"><div className="t-md fw6">{e.title}</div></div>
                      <Badge tone="neutral" icon={m.icon}>{m.label}</Badge>
                      {editable && (
                        <Btn size="sm" variant="ghost" icon="trash" onClick={() => deleteEvent(e)} aria-label="Remove event" />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
        </Card>
      )}

      <Modal
        open={!!selDay}
        onClose={() => setSelDay(null)}
        size="sm"
        icon="calendar"
        title={selDay ? new Date(selDay + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) : ''}
        footer={editable
          ? (
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={() => setSelDay(null)}>Close</Btn>
              {selDay && selDay >= todayIso && (
                <Btn variant="primary" icon="plus" onClick={() => { setForm((f) => ({ ...f, date: selDay! })); setSelDay(null); setAddOpen(true) }}>Add event</Btn>
              )}
            </div>
          )
          : undefined}
      >
        {selEvents.length === 0
          ? <Empty icon="calendar" title="No events" body="Nothing scheduled for this day." />
          : (
            <div className="col gap8">
              {selEvents.map((e) => {
                const m = EVENT_META[e.type]
                return (
                  <div key={e.id} className="row ai-center gap10" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '9px 11px' }}>
                    <span className="sm-card-ic" style={{ background: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color, flex: '0 0 auto' }}><Icon name={m.icon} size={15} /></span>
                    <div className="flex1" style={{ minWidth: 0 }}>
                      <div className="fw6 t-sm">{e.title}</div>
                      <div className="t-xs muted3">{m.label}{e.channels.includes('email') ? ' · email' : ''}{e.attachmentName ? ' · file' : ''}</div>
                      {e.desc && <div className="t-xs muted" style={{ marginTop: 4 }}>{e.desc}</div>}
                      {e.attachmentName && <div className="t-xs muted" style={{ marginTop: 4 }}>📎 {e.attachmentName}</div>}
                    </div>
                    {editable && <Btn size="sm" variant="ghost" icon="trash" onClick={() => deleteEvent(e)} />}
                  </div>
                )
              })}
            </div>
          )}
      </Modal>

      <Modal
        open={addOpen}
        onClose={() => {
          if (saving) return
          setAddOpen(false)
          setAttachment(null)
        }}
        size="sm"
        icon="plus"
        title="Add event"
        footer={(
          <div className="row gap8 jc-end">
            <Btn variant="ghost" disabled={saving} onClick={() => setAddOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="check" disabled={saving} onClick={() => void addEvent()}>
              {saving ? 'Saving…' : form.channels.length ? 'Save & notify' : 'Save event'}
            </Btn>
          </div>
        )}
      >
        <div className="col gap12">
          <Field label="Date" hint="Today or later — past dates can be viewed but not created."><Input type="date" min={todayIso} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
          <Field label="Type"><Select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as EvType }))} options={TYPES.map((t) => ({ value: t, label: EVENT_META[t].label }))} /></Field>
          <Field label="Title" required><Input icon="calendar" value={form.title} placeholder="e.g. Independence Day" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="Description"><Textarea value={form.desc} placeholder="Optional details — agenda, venue, instructions…" onChange={(e) => setForm((f) => ({ ...f, desc: e.target.value }))} /></Field>
          <Field label="Attachment" hint="Optional PDF or image — emailed with the Catre notice (max ~2.5 MB)">
            <FileUpload
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              value={attachment}
              onChange={setAttachment}
              ariaLabel="Event attachment"
            />
          </Field>
          <Field label="Notify via" hint="Email includes Catre PDF notice + your attachment (if any).">
            <div className="col gap8">
              {CHANNELS.map((c) => (
                <Checkbox key={c.key} checked={form.channels.includes(c.key)} onChange={() => toggleChannel(c.key)} label={`${c.label} — ${c.hint}`} />
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

export const calendarScreens: Record<string, ComponentType> = { 'school.calendar': CalendarScreen }
