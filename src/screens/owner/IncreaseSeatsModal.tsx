import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/lib/hooks'
import { Modal, Btn } from '@/components/ui'
import { SchoolMark } from '@/components/SchoolMark'
import { fmtNum } from '@/lib/format'
import type { School } from '@/types'
import { increaseClientSeats } from '@/api/clients'
import { ApiError } from '@/api/ApiError'

/**
 * CATRE team action: raise a school's billed seat limit. Recomputes MRR and (per-student) issues a
 * mid-cycle proration invoice server-side. Only increases are allowed.
 */
export function IncreaseSeatsModal({
  school,
  onClose,
}: {
  school: School | null
  onClose: () => void
}) {
  const toast = useToast()
  const qc = useQueryClient()
  const currentLimit = school?.seatLimit ?? school?.students ?? 0
  const [limit, setLimit] = useState<number>(currentLimit + 10)
  const [busy, setBusy] = useState(false)

  if (!school) return null

  const submit = async () => {
    if (limit <= currentLimit) {
      toast.info('Not an increase', `Enter a seat limit above the current ${fmtNum(currentLimit)}.`)
      return
    }
    setBusy(true)
    try {
      await increaseClientSeats(school.id, { seat_limit: limit })
      toast.success('Seats increased', `${school.name} now has ${fmtNum(limit)} billed seats.`)
      await qc.invalidateQueries({ queryKey: ['owner'] })
      onClose()
    } catch (e) {
      toast.danger('Could not increase seats', e instanceof ApiError ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      icon="building"
      size="sm"
      title={`Increase seats · ${school.name}`}
      sub="Raise the billed seat limit so more students can enrol."
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" icon="check" disabled={busy} onClick={() => { void submit() }}>
            {busy ? 'Working…' : 'Increase seats'}
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
          <span className="t-sm fw6">New seat limit</span>
          <input
            type="number"
            className="sm-input"
            min={currentLimit + 1}
            value={limit}
            onChange={(e) => setLimit(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          />
        </label>
        <div className="t-xs muted">
          MRR is recomputed on the new count. Per-student plans are billed a prorated top-up for the
          rest of the current cycle; the next cycle bills the full amount.
        </div>
      </div>
    </Modal>
  )
}
