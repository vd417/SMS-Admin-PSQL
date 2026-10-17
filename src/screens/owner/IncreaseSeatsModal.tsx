import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/lib/hooks'
import { Modal, Btn } from '@/components/ui'
import { SchoolMark } from '@/components/SchoolMark'
import { fmtNum } from '@/lib/format'
import type { School } from '@/types'
import { increaseClientSeats } from '@/api/clients'
import { requestMySchoolSeats } from '@/api/mySchools'
import { ApiError } from '@/api/ApiError'

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

  if (!school) return null

  const submit = async () => {
    if (limit <= currentLimit) {
      toast.info('Not an increase', `Enter a seat count above the current ${fmtNum(currentLimit)}.`)
      return
    }
    setBusy(true)
    try {
      if (isPlatform) {
        await increaseClientSeats(school.id, { seat_limit: limit })
        toast.success('Seats increased', `${school.name} now has ${fmtNum(limit)} billed seats.`)
      } else {
        await requestMySchoolSeats(school.id, { requested_seats: limit })
        toast.success('Request sent', `Asked the SchoolMate team to raise ${school.name} to ${fmtNum(limit)} seats.`)
      }
      await qc.invalidateQueries({ queryKey: ['owner'] })
      onClose()
    } catch (e) {
      toast.danger(
        isPlatform ? 'Could not increase seats' : 'Could not send request',
        e instanceof ApiError ? e.message : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const title = isPlatform ? `Increase seats · ${school.name}` : `Request more seats · ${school.name}`

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
            {busy ? 'Working…' : isPlatform ? 'Increase seats' : 'Send request'}
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
            min={currentLimit + 1}
            value={limit}
            onChange={(e) => setLimit(Math.max(0, Math.round(Number(e.target.value) || 0)))}
          />
        </label>
        <div className="t-xs muted">
          {isPlatform
            ? 'MRR is recomputed on the new count. Per-student plans are billed a prorated top-up for the rest of the current cycle.'
            : 'The SchoolMate team reviews your request. Once approved, the top-up is billed and the new seats apply.'}
        </div>
      </div>
    </Modal>
  )
}
