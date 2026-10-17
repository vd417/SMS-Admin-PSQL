import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/lib/hooks'
import { Modal, Btn, Badge } from '@/components/ui'
import { SchoolMark } from '@/components/SchoolMark'
import { fmtNum } from '@/lib/format'
import type { School } from '@/types'
import { increaseClientSeats, updateClientSeatSettings } from '@/api/clients'
import { requestMySchoolSeats, listMySchoolSeatRequests } from '@/api/mySchools'
import { ApiError } from '@/api/ApiError'

const reqTone = { pending: 'warning', approved: 'success', rejected: 'danger' } as const

/**
 * Seat change. Platform (CATRE) raises the billed seats directly (applies + bills). A school owner
 * raises a REQUEST that CATRE must approve. Only increases are allowed.
 */
export function IncreaseSeatsModal({
  school,
  isPlatform,
  onClose,
}: {
  school: School | null
  isPlatform: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const currentLimit = school?.seatLimit ?? school?.students ?? 0
  const [limit, setLimit] = useState<number>(currentLimit + 10)
  const [busy, setBusy] = useState(false)
  // Platform-only seat policy.
  const [mode, setMode] = useState<'auto' | 'manual'>(school?.seatIncreaseMode === 'auto' ? 'auto' : 'manual')
  const [threshold, setThreshold] = useState<number>(school?.seatAlertThreshold ?? 5)

  // Owner-side request history.
  const historyQ = useQuery({
    queryKey: ['owner', 'my-seat-requests', school?.id],
    queryFn: () => listMySchoolSeatRequests(school!.id),
    enabled: !!school && !isPlatform,
  })

  if (!school) return null

  const limitChanged = limit > currentLimit
  const policyChanged = isPlatform
    && (mode !== (school.seatIncreaseMode === 'auto' ? 'auto' : 'manual')
      || threshold !== (school.seatAlertThreshold ?? 5))

  const submit = async () => {
    if (isPlatform) {
      if (!limitChanged && !policyChanged) {
        toast.info('Nothing to change', 'Raise the seat count or change the seat policy first.')
        return
      }
      if (limit < currentLimit) {
        toast.info('Not an increase', `New seats cannot be below the current ${fmtNum(currentLimit)}.`)
        return
      }
    } else if (limit <= currentLimit) {
      toast.info('Not an increase', `Enter a seat count above the current ${fmtNum(currentLimit)}.`)
      return
    }

    setBusy(true)
    try {
      if (isPlatform) {
        if (policyChanged)
          await updateClientSeatSettings(school.id, { seat_increase_mode: mode, seat_alert_threshold: threshold })
        if (limitChanged)
          await increaseClientSeats(school.id, { seat_limit: limit })
        toast.success('Saved', limitChanged
          ? `${school.name} now has ${fmtNum(limit)} billed seats.`
          : 'Seat policy updated.')
      } else {
        await requestMySchoolSeats(school.id, { requested_seats: limit })
        toast.success('Request sent', `Asked the SchoolMate team to raise ${school.name} to ${fmtNum(limit)} seats.`)
      }
      await qc.invalidateQueries({ queryKey: ['owner'] })
      onClose()
    } catch (e) {
      toast.danger(
        isPlatform ? 'Could not save' : 'Could not send request',
        e instanceof ApiError ? e.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const title = isPlatform ? `Seats & policy · ${school.name}` : `Request more seats · ${school.name}`

  return (
    <Modal
      open
      onClose={onClose}
      icon="building"
      size="sm"
      title={title}
      sub={isPlatform
        ? 'Raise the billed seat limit so more students can enrol.'
        : 'Ask the SchoolMate team to raise your billed seats. They approve and bill the top-up.'}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon="check" disabled={busy} onClick={() => { void submit() }}>
            {busy ? 'Working…' : isPlatform ? 'Save' : 'Send request'}
          </Btn>
        </div>
      }
    >
      <div className="row ai-center gap12" style={{ marginBottom: 14 }}>
        <SchoolMark school={school} size={40} />
        <div>
          <div className="fw7">{school.name}</div>
          <div className="t-xs muted">{school.city}</div>
        </div>
      </div>

      <div className="col gap10">
        <div className="row jc-between t-sm">
          <span className="muted">Current billed seats</span>
          <span className="fw6">{fmtNum(currentLimit)}</span>
        </div>
        {school.enrolled != null && (
          <div className="row jc-between t-sm">
            <span className="muted">Enrolled now</span>
            <span className="fw6">{fmtNum(school.enrolled)}</span>
          </div>
        )}
        <label className="col gap4">
          <span className="t-sm fw6">{isPlatform ? 'New seat limit' : 'Seats requested'}</span>
          <input
            type="number"
            className="sm-input"
            min={isPlatform ? currentLimit : currentLimit + 1}
            value={limit === 0 ? '' : limit}
            onChange={(e) => {
              const v = e.target.value
              setLimit(v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)))
            }}
          />
        </label>

        {isPlatform && (
          <>
            <div className="col gap4">
              <span className="t-sm fw6">Seat increase mode</span>
              <div className="row gap8">
                <Btn size="sm" variant={mode === 'manual' ? 'primary' : 'secondary'} onClick={() => setMode('manual')}>Manual</Btn>
                <Btn size="sm" variant={mode === 'auto' ? 'primary' : 'secondary'} onClick={() => setMode('auto')}>Auto (per-student)</Btn>
              </div>
              <span className="t-xs muted">
                {mode === 'auto'
                  ? 'Per-student schools grow seats automatically as students enrol (billing follows).'
                  : 'Enrolment is blocked at the cap until seats are raised or a request is approved.'}
              </span>
            </div>
            <label className="col gap4">
              <span className="t-sm fw6">Near-limit warning gap</span>
              <input
                type="number" className="sm-input" min={0}
                value={threshold === 0 ? '' : threshold}
                onChange={(e) => {
                  const v = e.target.value
                  setThreshold(v === '' ? 0 : Math.max(0, Math.round(Number(v) || 0)))
                }}
              />
              <span className="t-xs muted">Warn the school when this many seats remain (default 5).</span>
            </label>
          </>
        )}

        <div className="t-xs muted">
          {isPlatform
            ? 'MRR is recomputed on a new count. Per-student plans are billed a prorated top-up for the rest of the current cycle.'
            : 'The SchoolMate team reviews your request. Once approved, the top-up is billed and the new seats apply.'}
        </div>

        {!isPlatform && (historyQ.data?.length ?? 0) > 0 && (
          <div className="col gap6" style={{ marginTop: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <span className="t-sm fw6">Your requests</span>
            {historyQ.data!.slice(0, 5).map((r) => (
              <div key={r.id} className="row ai-center jc-between gap8 t-xs">
                <span className="muted">{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                <span>{fmtNum(r.current_seats)} → {fmtNum(r.requested_seats)}</span>
                <Badge tone={reqTone[r.status] ?? 'neutral'} dot>{r.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
