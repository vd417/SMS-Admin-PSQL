/* ============================================================
   SchoolMate — Fees collection + HR & Payroll.
   Phase 3 screens. Frontend-only, deterministic mock data.
   HR is owned by the Admin office (payroll prepared by Admin,
   Principal only approves). No separate HR persona.
   ============================================================ */
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { useFeePayments, usePayInvoice, useCreateFeeRazorpayOrder, useVerifyFeeRazorpayPayment } from '@/api/hooks/useFeePayments'
import { useSchoolIntegrations } from '@/api/hooks/useSchoolIntegrations'
import { loadRazorpayScript } from '@/api/upgradeRequests'
import { useFeeHeads, useCreateFeeHead, useDeleteFeeHead, useUpdateFeeHead } from '@/api/hooks/useFeeHeads'
import {
  useFeeStructure, useSaveFeeStructure, useFeeStructureHistory, useFeeStructureVersion,
  usePublishFeeStructureVersion, useUnpublishFeeStructureVersion, useDeleteFeeStructureVersion,
} from '@/api/hooks/useFeeStructure'
import type { FeeStructureDocument, FeeStructureStatus } from '@/api/feeStructure'
import { useFeeInvoices, useGenerateFeeInvoices } from '@/api/hooks/useFeeInvoices'
import { useCreateNotification } from '@/api/hooks/useNotifications'
import { useFeeReportSummary } from '@/api/hooks/useFeeReports'
import { useClasses } from '@/api/hooks/useClasses'
import { useTransportSummary } from '@/api/hooks/useOperations'
import { useStudents } from '@/api/hooks/useStudents'
import { useTeachers } from '@/api/hooks/useTeachers'
import { useStaff } from '@/api/hooks/useStaff'
import { buildUpiPayUri, upiQrImageUrl } from '@/lib/upiQr'
import { downloadTextFile, invoicesToCsv } from '@/lib/feeExport'
import { payrollRunToCsv, payrollCsvFileName, downloadPayslip } from '@/lib/payrollExport'
import { downloadFeeReceipt } from '@/lib/feeReceipt'
import { studentPhotoUrl } from '@/api/studentExtras'
import { notifyFeeAudience } from '@/lib/feeNotify'
import { collectAudienceContacts, contactsByStudentId } from '@/lib/collectAudienceEmails'
import { openMailCompose, guardianEmailsFromStudent } from '@/lib/composeMail'
import { can } from '@/lib/gating'
import { newIdempotencyKey } from '@/lib/idempotencyKey'
import {
  PageHead, Card, CardHead, Kpi, Btn, Badge, Avatar, Search, Select, Field, Input,
  Modal, Tabs, Icon, Empty, Bars, DataTable, Checkbox, type Column, type BadgeTone,
} from '@/components/ui'
import { TierGate } from '@/components/shell/gates'
import { gradeRank } from '@/lib/defaultClasses'
import { fmtMoney, fmtNum, feeInvoiceNo } from '@/lib/format'
import { properName } from '@/lib/properCase'
import { localDateIso, paymentDateIso } from '@/api/feeReports'
import { currentPeriod, periodLabel, computeSalary, toAmount, type SalaryComponents } from '@/lib/payroll'
import {
  usePayrollRun, usePayrollPreview, useRunPayroll, useApprovePayroll, useSalaryStructures, useUpsertSalaryStructure,
} from '@/api/hooks/usePayroll'
import type { PayrollLine, PersonType, SalaryStructure } from '@/api/payroll'
import { TEACHER_DESIGNATIONS, STAFF_ROLES, LEADERSHIP_ROLES } from '@/lib/salaryRoles'
import { useQuery } from '@tanstack/react-query'
import { listSchoolUsers, fromApiRole } from '@/api/users'
import { queryKeys } from '@/api/queryKeys'
import type { FeeStatus, FeePayment, FeeHead, FeeInvoice, Student } from '@/types'

/* ============================================================
   Fees collection
   ============================================================ */
const feeTone: Record<FeeStatus, BadgeTone> = { paid: 'success', partial: 'warning', due: 'danger' }
const feeLabel: Record<FeeStatus, string> = { paid: 'Paid', partial: 'Partial', due: 'Due' }
const PAY_MODES = ['Cash', 'UPI (manual)', 'Cheque', 'Card / POS', 'Bank transfer', 'DD']
const ALL_MODES = [...PAY_MODES, 'Razorpay', 'Adjustment / waiver']
const STARTER_FEE_HEADS = ['Academic', 'Transport', 'Exam', 'Admission', 'Lab']

/* ---------- Record-payment modal ---------- */
const FEE_TYPE_ALL = '__all__'

/** Record-payment form body — rendered inside PaymentModal (Collection) or inline (Pay fees tab). */
function PaymentForm({ invoice, cur, schoolName, studentAdm, onDone, onCancel }: {
  invoice: FeeInvoice
  cur: string
  schoolName: string
  studentAdm?: string
  onDone: () => void
  onCancel: () => void
}) {
  const toast = useToast()
  const payInvoice = usePayInvoice()
  const headsQ = useFeeHeads()
  const paymentsQ = useFeePayments()
  const heads = useMemo<FeeHead[]>(() => (headsQ.data ?? []).filter((h) => h.active !== false), [headsQ.data])
  const adm = studentAdm || invoice.studentAdm || ''

  /* Auto receipt no. — RCP/YYYYMMDD/NNN, where NNN is the next in today's sequence. */
  const autoRef = useMemo(() => {
    const today = localDateIso()
    const seq = (paymentsQ.data ?? []).filter((p) => (p.date ?? '').slice(0, 10) === today).length + 1
    return `RCP/${today.replace(/-/g, '')}/${String(seq).padStart(3, '0')}`
  }, [paymentsQ.data])

  const [amount, setAmount] = useState(String(invoice.due > 0 ? invoice.due : ''))
  const [mode, setMode] = useState(PAY_MODES[0])
  const [headId, setHeadId] = useState(() => (invoice.lines.length === 1 ? invoice.lines[0].headId : FEE_TYPE_ALL))
  const [ref, setRef] = useState('')
  const [refTouched, setRefTouched] = useState(false)
  /* Prefill the generated receipt no. once payments load, unless the user has typed their own. */
  useEffect(() => {
    if (!refTouched && !ref && autoRef) setRef(autoRef)
  }, [autoRef, refTouched, ref])
  const [chequeNumber, setChequeNumber] = useState('')
  const [chequeBank, setChequeBank] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [upiVpa, setUpiVpa] = useState('')
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey()

  const feeTypeOptions = useMemo(
    () => [
      { value: FEE_TYPE_ALL, label: 'All fee types' },
      ...heads.map((h) => ({ value: h.id, label: h.name })),
    ],
    [heads],
  )

  const amtNum = Math.max(0, Number(amount) || 0)
  const upiUri = mode === 'UPI (manual)'
    ? buildUpiPayUri({
      pa: upiVpa,
      am: amtNum,
      pn: schoolName,
      tn: `Fee ${invoice.studentName} ${invoice.cls}`,
    })
    : ''
  const upiQr = upiUri ? upiQrImageUrl(upiUri) : ''

  const submit = () => {
    const n = Number(amount)
    if (!n || n <= 0) { toast.danger('Amount required', 'Enter a valid payment amount.'); return }
    if (invoice.due > 0 && n > invoice.due + 0.001) {
      toast.danger('Amount too high', `Outstanding due is ${fmtMoney(invoice.due, cur)}.`)
      return
    }
    if (mode === 'Cheque' && !chequeNumber.trim()) { toast.danger('Cheque number required', 'Enter the cheque number.'); return }
    if (mode === 'UPI (manual)' && !upiVpa.trim() && !refTouched) {
      toast.danger('UPI VPA or reference required', 'Enter the school UPI ID for QR, or a UPI transaction reference.')
      return
    }
    const head = headId === FEE_TYPE_ALL ? undefined : heads.find((h) => h.id === headId)
    const headName = headId === FEE_TYPE_ALL ? 'All fee types' : head?.name
    const paymentRef = ref.trim() || (mode === 'UPI (manual)' ? upiVpa.trim() : '')
    const payment: FeePayment = {
      id: Date.now(), invoiceId: invoice.id, studentId: invoice.studentId, studentName: invoice.studentName, cls: invoice.cls,
      headId: headId === FEE_TYPE_ALL ? undefined : (headId || undefined),
      headName,
      feeType: headName,
      amount: n, mode,
      ref: paymentRef,
      date: localDateIso(),
      idempotencyKey: idempotencyKeyRef.current,
      ...(mode === 'Cheque' ? { cheque: { number: chequeNumber.trim(), bank: chequeBank.trim() || undefined, date: chequeDate || undefined } } : {}),
    }
    payInvoice.mutate({ invoiceId: invoice.id, payment }, {
      onSuccess: () => {
        toast.success('Payment recorded', `${fmtMoney(n, cur)} · ${mode} · ${properName(invoice.studentName)} (${invoice.cls})`)
        onDone()
      },
      onError: (err) => { toast.danger('Payment failed', err instanceof Error ? err.message : 'Please try again.') },
    })
  }

  return (
      <div className="col gap16">
        <div className="row gap12 wrap" style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
          <div style={{ flex: '1 1 140px' }}>
            <div className="t-xs muted">Student</div>
            <div className="fw6">{properName(invoice.studentName)}</div>
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <div className="t-xs muted">Student ID</div>
            <div className="fw6">{adm || '—'}</div>
          </div>
          <div style={{ flex: '1 1 80px' }}>
            <div className="t-xs muted">Class</div>
            <div className="fw6">{invoice.cls}</div>
          </div>
          <div style={{ flex: '1 1 100px' }}>
            <div className="t-xs muted">Due</div>
            <div className="fw6" style={{ color: invoice.due > 0 ? 'var(--danger)' : undefined }}>{fmtMoney(invoice.due, cur)}</div>
          </div>
        </div>
        <Field label="Fee type" required hint="All fee types, or one head — Academic, Transport, etc.">
          <Select options={feeTypeOptions} value={headId} onChange={(e) => setHeadId(e.target.value)} />
        </Field>
        <Field label="Amount" required hint={`Term fee ${fmtMoney(invoice.total, cur)} · paid so far ${fmtMoney(invoice.paid, cur)} · due ${fmtMoney(invoice.due, cur)}.`}>
          <Input icon="rupee" type="number" inputMode="numeric" placeholder="e.g. 5000" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment mode" required>
          <Select options={PAY_MODES} value={mode} onChange={(e) => setMode(e.target.value)} />
        </Field>
        {mode === 'UPI (manual)' && (
          <div className="col gap12">
            <Field label="School UPI ID (VPA)" required hint="Used to show a desk QR parents can scan.">
              <Input icon="phone" value={upiVpa} placeholder="e.g. schoolname@okhdfcbank" onChange={(e) => setUpiVpa(e.target.value)} />
            </Field>
            {upiQr ? (
              <div className="col ai-center gap8" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
                <img src={upiQr} alt="UPI QR" width={180} height={180} style={{ borderRadius: 8, background: '#fff' }} />
                <div className="t-xs muted ta-center">Scan to pay {fmtMoney(amtNum, cur)} · {upiVpa.trim()}</div>
                <Btn size="sm" variant="ghost" icon="clipboard" onClick={() => {
                  void navigator.clipboard?.writeText(upiUri).then(
                    () => toast.success('UPI link copied', 'Share or open in a UPI app.'),
                    () => toast.info('Copy manually', upiUri),
                  )
                }}>Copy UPI link</Btn>
              </div>
            ) : (
              <div className="t-sm muted">Enter UPI ID to show QR for this amount.</div>
            )}
          </div>
        )}
        {mode === 'Cheque' && (
          <div className="row gap12 wrap">
            <div style={{ flex: '1 1 140px' }}>
              <Field label="Cheque number" required>
                <Input icon="clipboard" value={chequeNumber} placeholder="e.g. 004821" onChange={(e) => setChequeNumber(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Field label="Bank">
                <Input value={chequeBank} placeholder="e.g. HDFC Bank" onChange={(e) => setChequeBank(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Field label="Cheque date">
                <Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} />
              </Field>
            </div>
          </div>
        )}
        <Field label="Reference / receipt no." hint="Auto-generated receipt no. — overwrite with a UPI ref / transaction id if you have one.">
          <Input icon="clipboard" value={ref} placeholder="e.g. RCP/20261018/001" onChange={(e) => { setRef(e.target.value); setRefTouched(true) }} />
        </Field>
        <div className="row gap8 jc-end" style={{ marginTop: 4 }}>
          <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn variant="primary" icon="check" onClick={submit}>Pay fee</Btn>
        </div>
      </div>
  )
}

/* ---------- Record-payment modal (Collection tab) ---------- */
function PaymentModal({ invoice, cur, schoolName, studentAdm, onClose }: {
  invoice: FeeInvoice
  cur: string
  schoolName: string
  studentAdm?: string
  onClose: () => void
}) {
  const adm = studentAdm || invoice.studentAdm || ''
  return (
    <Modal
      open onClose={onClose} icon="rupee" size="sm"
      title="Pay fee"
      sub={adm ? `${properName(invoice.studentName)} · ${adm}` : `${properName(invoice.studentName)} · ${invoice.cls}`}
    >
      <PaymentForm invoice={invoice} cur={cur} schoolName={schoolName} studentAdm={studentAdm} onDone={onClose} onCancel={onClose} />
    </Modal>
  )
}

/* ---------- Waiver modal (Principal approves) ---------- */
function WaiverModal({ invoice, cur, onClose }: { invoice: FeeInvoice; cur: string; onClose: () => void }) {
  const toast = useToast()
  const payInvoice = usePayInvoice()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('Financial hardship')
  const idempotencyKeyRef = useRef<string | undefined>(undefined)
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = newIdempotencyKey()

  const submit = () => {
    const n = Number(amount)
    if (!n || n <= 0) { toast.danger('Amount required', 'Enter the waiver amount to approve.'); return }
    if (n > invoice.due + 0.001) { toast.danger('Amount too high', `Outstanding due is ${fmtMoney(invoice.due, cur)}.`); return }
    const payment: FeePayment = {
      id: Date.now(), invoiceId: invoice.id, studentId: invoice.studentId, studentName: invoice.studentName, cls: invoice.cls,
      amount: n, mode: 'Adjustment / waiver', ref: '', note: reason,
      date: localDateIso(),
      idempotencyKey: idempotencyKeyRef.current,
    }
    payInvoice.mutate({ invoiceId: invoice.id, payment }, {
      onSuccess: () => { toast.success('Waiver approved', `${fmtMoney(n, cur)} waived for ${invoice.studentName} · ${reason}.`); onClose() },
      onError: (err) => { toast.danger('Waiver failed', err instanceof Error ? err.message : 'Please try again.') },
    })
  }

  return (
    <Modal
      open onClose={onClose} icon="shield" size="sm"
      title="Waiver discount" sub={`${invoice.studentName} · ${invoice.cls}`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="success" icon="check" onClick={submit}>Approve waiver</Btn>
        </div>
      }
    >
      <div className="col gap16">
        <div className="row ai-center gap8 t-sm muted">
          <Icon name="shield" size={14} />
          Waivers require Principal approval and are written to the audit trail.
        </div>
        <Field label="Waiver amount" required hint={`Outstanding due ${fmtMoney(invoice.due, cur)}.`}>
          <Input icon="rupee" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Reason" required>
          <Select options={['Financial hardship', 'Staff ward concession', 'Sibling discount', 'Scholarship', 'Merit award']} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}

/** Confirms flipping a fee head's transport flag — it changes what invoice
 *  generation charges students, so it isn't a silent toggle. */
function TransportToggleModal({ head, onClose }: { head: FeeHead; onClose: () => void }) {
  const toast = useToast()
  const updateHead = useUpdateFeeHead()
  const willBeTransport = !head.isTransportFeeHead

  const confirm = () => {
    updateHead.mutate({ id: head.id, patch: { isTransportFeeHead: willBeTransport } }, {
      onSuccess: () => {
        toast.success(
          willBeTransport ? `${head.name} marked as Transport` : `${head.name} marked as Regular`,
          willBeTransport
            ? 'Invoice generation will now charge this fee only to students with an active transport assignment for it.'
            : 'Invoice generation will charge this fee to every student in the selected class/grade again.',
        )
        onClose()
      },
      onError: (err) => toast.danger('Could not update fee type', err instanceof Error ? err.message : 'Please try again.'),
    })
  }

  return (
    <Modal
      open onClose={onClose} icon="bus" size="sm"
      title={willBeTransport ? 'Mark as Transport Fee?' : 'Mark as Regular Fee?'}
      sub={head.name}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="check" disabled={updateHead.isPending} onClick={confirm}>
            {updateHead.isPending ? 'Saving…' : 'Confirm'}
          </Btn>
        </div>
      }
    >
      <div className="col gap8 t-sm">
        {willBeTransport ? (
          <p>
            This fee will only be charged to a student on invoice generation when that student has an
            active transport assignment linked to it. Students without a transport assignment will no
            longer be billed for it.
          </p>
        ) : (
          <p>
            This fee will go back to being charged to every student in the selected class/grade on
            invoice generation, regardless of transport assignment.
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ---------- Fee history (saved payments) ---------- */
function FeeHistoryTab({ cur }: { cur: string }) {
  const app = useApp()
  const { data: paymentsData } = useFeePayments()
  const feePayments = paymentsData ?? []
  const studentsQ = useStudents()
  const headsQ = useFeeHeads()
  const heads = headsQ.data ?? []
  const [q, setQ] = useState('')
  const [headId, setHeadId] = useState('all')
  const [mode, setMode] = useState('all')

  const admOfStudent = (studentId: string) =>
    (studentsQ.data ?? []).find((s) => s.id === studentId)?.adm || ''

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return feePayments.filter((p) => {
      if (needle) {
        const adm = admOfStudent(p.studentId).toLowerCase()
        const blob = `${p.studentName} ${p.cls} ${p.ref} ${p.headName ?? ''} ${p.feeType ?? ''} ${adm}`.toLowerCase()
        if (!blob.includes(needle)) return false
      }
      if (headId !== 'all') {
        if (p.headId) {
          if (p.headId !== headId) return false
        } else {
          const head = heads.find((h) => h.id === headId)
          if (!head || (p.headName || p.feeType || '').toLowerCase() !== head.name.toLowerCase()) return false
        }
      }
      if (mode !== 'all' && p.mode !== mode) return false
      return true
    })
  }, [feePayments, q, headId, mode, heads, studentsQ.data])

  const downloadReceipt = (p: FeePayment) => {
    downloadFeeReceipt({
      schoolName: app.school.name,
      schoolCity: app.school.city,
      studentName: p.studentName,
      studentAdm: admOfStudent(p.studentId),
      cls: p.cls,
      amount: p.amount,
      currency: cur,
      mode: p.mode,
      ref: p.ref,
      paidAt: p.date,
      headName: p.headName || p.feeType,
      invoiceId: feeInvoiceNo(p.invoiceId, p.date),
      logoUrl: app.school.logoUrl,
      logoInitials: app.school.logo,
      brandColor: app.school.color,
    })
  }

  const columns: Column<FeePayment>[] = [
    { key: 'date', label: 'Date', sortValue: (p) => p.id, render: (p) => <span className="muted">{fmtDueDay(p.date)}</span> },
    {
      key: 'student', label: 'Student', sortValue: (p) => p.studentName,
      render: (p) => <div><div className="fw6">{properName(p.studentName)}</div><div className="t-xs muted">{p.cls}</div></div>,
    },
    {
      key: 'adm', label: 'Student ID', sortValue: (p) => admOfStudent(p.studentId),
      render: (p) => <span className="t-sm">{admOfStudent(p.studentId) || '—'}</span>,
    },
    {
      key: 'head', label: 'Fee type', sortValue: (p) => p.headName || p.feeType || '',
      render: (p) => <Badge tone="brand">{p.headName || p.feeType || '—'}</Badge>,
    },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (p) => p.amount, render: (p) => <span className="fw6">{fmtMoney(p.amount, cur)}</span> },
    { key: 'mode', label: 'Mode', sortValue: (p) => p.mode, render: (p) => <Badge tone="neutral">{p.mode}</Badge> },
    { key: 'ref', label: 'Reference', sortValue: (p) => p.ref, render: (p) => p.ref ? <span className="t-sm muted">{p.ref}</span> : <span className="muted">—</span> },
    {
      key: 'receipt', label: 'Receipt', align: 'right',
      render: (p) => (
        <Btn variant="ghost" size="sm" icon="download" onClick={() => downloadReceipt(p)}>
          Download
        </Btn>
      ),
    },
  ]

  return (
    <Card pad={false}>
      <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <Search value={q} onChange={setQ} placeholder="Search student, class, head, reference…" style={{ flex: 1, minWidth: 220 }} />
        <Select
          options={[
            { value: 'all', label: 'All fee types' },
            ...heads.map((h) => ({ value: h.id, label: h.name })),
          ]}
          value={headId}
          onChange={(e) => setHeadId(e.target.value)}
        />
        <Select options={[{ value: 'all', label: 'All modes' }, ...ALL_MODES.map((m) => ({ value: m, label: m }))]} value={mode} onChange={(e) => setMode(e.target.value)} />
      </div>
      <DataTable<FeePayment>
        columns={columns}
        rows={rows}
        pageSize={12}
        rowKey={(p) => p.id}
        initialSort={{ key: 'date', dir: 'desc' }}
        empty={<Empty icon="wallet" title="No payments recorded yet" body="Offline (cash / UPI / cheque) and Razorpay payments appear here." />}
      />
    </Card>
  )
}

/* ---------- Fee structure (named header + class-wise amounts) ---------- */
const TERM_OPTIONS = ['Term 1', 'Term 2', 'Annual']
const CURRENCY_OPTIONS = ['₹', 'INR', 'USD', 'AED', 'EUR']
/** Soft cap so desk typos don't become INR 1,00,00,00,00,00,00,000. */
const MAX_FEE_AMOUNT = 9_999_999

function parseFeeAmount(raw: string): number {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const n = Math.round(Number(trimmed))
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.min(n, MAX_FEE_AMOUNT)
}

function defaultAcademicYear(d = new Date()): string {
  const y = d.getFullYear()
  const m = d.getMonth()
  /* Indian AY typically starts April. */
  return m >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`
}

type StructureClassRow = { key: string; label: string; grade: string; section: string }

function FeeStructureTab({ cur, editable, onGenerated, loadVersionId, onDoneEditing }: {
  cur: string
  editable: boolean
  onGenerated?: () => void
  /** When set, edit this specific saved (draft) version instead of the current live one —
   *  set by clicking "Edit" on a draft in the Saved versions tab. */
  loadVersionId?: string | null
  onDoneEditing?: () => void
}) {
  const app = useApp()
  const toast = useToast()
  const headsQ = useFeeHeads()
  const currentStructureQ = useFeeStructure()
  const editingVersionQ = useFeeStructureVersion(loadVersionId ?? null)
  const structureQ = loadVersionId ? editingVersionQ : currentStructureQ
  const classesQ = useClasses()
  const studentsQ = useStudents()
  const createHead = useCreateFeeHead()
  const deleteHead = useDeleteFeeHead()
  const saveStructure = useSaveFeeStructure()
  const generateInvoices = useGenerateFeeInvoices()
  const createNotification = useCreateNotification()

  const heads = useMemo<FeeHead[]>(() => (headsQ.data ?? []).filter((h) => h.active !== false), [headsQ.data])

  const allClasses = useMemo<StructureClassRow[]>(() => {
    return (classesQ.data ?? [])
      .filter((c) => c.name.trim())
      .map((c) => ({
        key: c.name.trim(),
        label: c.name.trim(),
        grade: c.grade || c.name.split('-')[0] || c.name,
        section: c.section || '',
      }))
      .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.label.localeCompare(b.label))
  }, [classesQ.data])

  const gradeOptions = useMemo(() => {
    return [...new Set(allClasses.map((c) => c.grade).filter(Boolean))]
  }, [allClasses])

  const sectionOptions = useMemo(() => {
    const secs = [...new Set(allClasses.map((c) => c.section).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    return secs
  }, [allClasses])

  const [meta, setMeta] = useState({
    name: `School fees ${defaultAcademicYear()}`,
    academicYear: defaultAcademicYear(),
    classGrade: '',
    section: '',
    currency: cur || 'INR',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    status: 'active' as FeeStructureStatus,
    description: '',
  })
  const [newHead, setNewHead] = useState('')
  const [newHeadTransport, setNewHeadTransport] = useState(false)
  const [newHeadDescription, setNewHeadDescription] = useState('')
  const [toggleHead, setToggleHead] = useState<FeeHead | null>(null)
  const [draft, setDraft] = useState<Record<string, Record<string, number>>>({})
  const [hydrated, setHydrated] = useState(false)
  const [viewGrade, setViewGrade] = useState('') /* '' = all grades */
  const [viewSection, setViewSection] = useState('') /* '' = all sections */
  const [classQ, setClassQ] = useState('')

  /* Switching which version we're editing (or back to the live one) means re-hydrating
     meta/draft from that version's data, not keeping whatever was on screen before. */
  useEffect(() => { setHydrated(false) }, [loadVersionId])

  useEffect(() => {
    if (!structureQ.data || hydrated) return
    const d = structureQ.data
    setMeta({
      name: d.name,
      academicYear: d.academicYear,
      classGrade: d.classGrade,
      section: d.section,
      currency: d.currency || cur || 'INR',
      effectiveFrom: d.effectiveFrom,
      status: d.status,
      description: d.description,
    })
    setDraft(d.amounts)
    if (d.classGrade) setViewGrade(d.classGrade)
    if (d.section) setViewSection(d.section)
    setHydrated(true)
  }, [structureQ.data, hydrated, cur])

  /* Keep amount editor filters aligned with structure scope. */
  useEffect(() => {
    if (meta.classGrade) setViewGrade(meta.classGrade)
  }, [meta.classGrade])
  useEffect(() => {
    if (meta.section) setViewSection(meta.section)
  }, [meta.section])

  const structureClasses = useMemo(() => {
    const needle = classQ.trim().toLowerCase()
    const gradeFilter = meta.classGrade || viewGrade
    const sectionFilter = meta.section || viewSection
    return allClasses.filter((row) => {
      if (gradeFilter && row.grade !== gradeFilter) return false
      if (sectionFilter) {
        if (row.section) {
          if (row.section !== sectionFilter) return false
        } else if (!row.label.endsWith(`-${sectionFilter}`)) {
          return false
        }
      }
      if (needle && !`${row.label} ${row.grade} ${row.section}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [allClasses, meta.classGrade, meta.section, viewGrade, viewSection, classQ])

  const cellValue = (row: StructureClassRow, headId: string) =>
    draft[row.key]?.[headId] ?? draft[row.grade]?.[headId] ?? 0

  const cellKey = (row: StructureClassRow, headId: string) => `${row.key}::${headId}`
  const [amountText, setAmountText] = useState<Record<string, string>>({})

  const cellDisplay = (row: StructureClassRow, headId: string) => {
    const k = cellKey(row, headId)
    if (k in amountText) return amountText[k]
    const n = cellValue(row, headId)
    return n > 0 ? String(n) : ''
  }

  const setCell = (row: StructureClassRow, headId: string, raw: string) => {
    const k = cellKey(row, headId)
    setAmountText((t) => ({ ...t, [k]: raw }))
    const n = parseFeeAmount(raw)
    setDraft((d) => ({ ...d, [row.key]: { ...d[row.key], [headId]: n } }))
  }

  const commitCell = (row: StructureClassRow, headId: string) => {
    const k = cellKey(row, headId)
    const capped = parseFeeAmount(amountText[k] ?? String(cellValue(row, headId) || ''))
    if (capped !== cellValue(row, headId)) {
      setDraft((d) => ({ ...d, [row.key]: { ...d[row.key], [headId]: capped } }))
    }
    setAmountText((t) => {
      if (!(k in t)) return t
      const next = { ...t }
      delete next[k]
      return next
    })
  }

  /** Push one fee-type amount onto every class currently shown in the grid. */
  const applyHeadToAllShown = (headId: string, raw: string) => {
    if (!structureClasses.length) {
      toast.danger('No classes', 'Nothing to fill — adjust class / section filters.')
      return
    }
    const n = parseFeeAmount(raw)
    setDraft((d) => {
      const next = { ...d }
      for (const row of structureClasses) {
        next[row.key] = { ...(next[row.key] ?? {}), [headId]: n }
      }
      return next
    })
    setAmountText((t) => {
      const next = { ...t }
      for (const row of structureClasses) delete next[cellKey(row, headId)]
      return next
    })
    const headName = heads.find((h) => h.id === headId)?.name ?? 'Fee'
    toast.success(
      `${headName} applied`,
      `${fmtMoney(n, meta.currency || cur)} set on ${structureClasses.length} class${structureClasses.length === 1 ? '' : 'es'}.`,
    )
  }


  const addHead = () => {
    const name = properName(newHead.trim())
    if (!name) { toast.danger('Name required', 'Enter a fee type name.'); return }
    if (heads.some((h) => h.name.toLowerCase() === name.toLowerCase())) { toast.danger('Already exists', `${name} is already a fee type.`); return }
    createHead.mutate({ name, isTransportFeeHead: newHeadTransport, description: newHeadDescription.trim() || undefined }, {
      onSuccess: () => { setNewHead(''); setNewHeadTransport(false); setNewHeadDescription('') },
      onError: (err) => { toast.danger('Could not add fee type', err instanceof Error ? err.message : 'Please try again.') },
    })
  }
  const removeHead = (head: FeeHead) => {
    deleteHead.mutate(head.id, {
      onError: (err) => { toast.danger('Could not remove fee type', err instanceof Error ? err.message : 'Please try again.') },
    })
  }
  const rowTotal = (row: StructureClassRow) => heads.reduce((a, h) => a + cellValue(row, h.id), 0)
  const grandTotal = useMemo(() => {
    return allClasses.reduce((sum, row) => sum + heads.reduce((a, h) => a + (draft[row.key]?.[h.id] ?? draft[row.grade]?.[h.id] ?? 0), 0), 0)
  }, [allClasses, heads, draft])

  /* Live enrolled-student count per class label (for expected-revenue projection). */
  const studentCountByClass = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of studentsQ.data ?? []) {
      const key = (s.cls || '').trim().toLowerCase()
      if (key) m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }, [studentsQ.data])
  const studentsInRow = (row: StructureClassRow) => studentCountByClass.get(row.label.trim().toLowerCase()) ?? 0

  /* Per-student fee for a set of rows. Sections of a grade share the same fee,
     so we report the range (min–max) instead of summing sections together. */
  const perStudentFee = (rows: StructureClassRow[]) => {
    const vals = rows.map(rowTotal).filter((v) => v > 0)
    if (!vals.length) return { min: 0, max: 0 }
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }
  const feeRangeLabel = (r: { min: number; max: number }) =>
    r.min === r.max
      ? fmtMoney(r.min, meta.currency || cur)
      : `${fmtMoney(r.min, meta.currency || cur)}–${fmtMoney(r.max, meta.currency || cur)}`

  /* Transport-only per-student range. Transport heads are billed only to students with an
     active transport assignment, so it's called out separately from the all-in per-student fee. */
  const transportPerStudent = (rows: StructureClassRow[]) => {
    const transportIds = heads.filter((h) => h.isTransportFeeHead).map((h) => h.id)
    if (!transportIds.length) return { min: 0, max: 0 }
    const vals = rows
      .map((row) => transportIds.reduce((a, id) => a + cellValue(row, id), 0))
      .filter((v) => v > 0)
    if (!vals.length) return { min: 0, max: 0 }
    return { min: Math.min(...vals), max: Math.max(...vals) }
  }

  /* Students actually on transport, school-wide (live). Transport fees are billed only to them,
     so the projection must not charge transport to every enrolled student. */
  const transportStudents = useTransportSummary().data?.students ?? 0

  /* Expected annual collection, split so transport isn't charged to everyone:
     • base  = Σ (non-transport fee × students enrolled in that class)        — exact
     • transport = (enrolment-weighted avg transport fee) × students on transport — estimate */
  const expected = useMemo(() => {
    const transportIds = new Set(heads.filter((h) => h.isTransportFeeHead).map((h) => h.id))
    const amt = (row: StructureClassRow, headId: string) => draft[row.key]?.[headId] ?? draft[row.grade]?.[headId] ?? 0
    let baseRevenue = 0
    let billedStudents = 0
    let transportFeeWeighted = 0 // Σ (transport fee × enrolled) across classes that charge transport
    let transportEnrolled = 0
    for (const row of allClasses) {
      const n = studentCountByClass.get(row.label.trim().toLowerCase()) ?? 0
      const baseFee = heads.reduce((a, h) => a + (transportIds.has(h.id) ? 0 : amt(row, h.id)), 0)
      const transFee = heads.reduce((a, h) => a + (transportIds.has(h.id) ? amt(row, h.id) : 0), 0)
      if (baseFee > 0) { baseRevenue += baseFee * n; billedStudents += n }
      if (transFee > 0) { transportFeeWeighted += transFee * n; transportEnrolled += n }
    }
    const avgTransportFee = transportEnrolled > 0 ? transportFeeWeighted / transportEnrolled : 0
    const transportRevenue = Math.round(avgTransportFee * transportStudents)
    return { baseRevenue, billedStudents, transportRevenue, total: baseRevenue + transportRevenue }
  }, [allClasses, heads, draft, studentCountByClass, transportStudents])

  const buildDocument = (status: FeeStructureStatus): FeeStructureDocument => {
    /* Keep amounts for classes not on screen (other grades). */
    const amounts: Record<string, Record<string, number>> = { ...draft }
    allClasses.forEach((row) => {
      const rowAmounts: Record<string, number> = { ...(amounts[row.key] ?? {}) }
      heads.forEach((h) => {
        if (rowAmounts[h.id] == null) rowAmounts[h.id] = draft[row.key]?.[h.id] ?? draft[row.grade]?.[h.id] ?? 0
      })
      amounts[row.key] = rowAmounts
    })
    structureClasses.forEach((row) => {
      amounts[row.key] = {}
      heads.forEach((h) => { amounts[row.key][h.id] = cellValue(row, h.id) })
    })
    return {
      id: structureQ.data?.id,
      name: meta.name.trim(),
      academicYear: meta.academicYear.trim(),
      classGrade: meta.classGrade.trim(),
      section: meta.section.trim(),
      currency: meta.currency.trim() || cur || 'INR',
      effectiveFrom: meta.effectiveFrom.trim(),
      status,
      description: meta.description.trim(),
      amounts,
    }
  }

  const validateMeta = (): string | null => {
    if (!meta.name.trim()) return 'Fee structure name is required'
    if (!meta.academicYear.trim()) return 'Academic year is required'
    if (!meta.effectiveFrom.trim()) return 'Effective from date is required'
    if (!meta.currency.trim()) return 'Currency is required'
    return null
  }

  /* ---- Generate invoices ---- */
  const [genTerm, setGenTerm] = useState(TERM_OPTIONS[0])
  const [genDue, setGenDue] = useState('')
  const [genClasses, setGenClasses] = useState<Set<string>>(new Set())
  /** Once the user toggles Select all / Clear / a class, stop auto-syncing checks. */
  const genClassesTouched = useRef(false)
  const [seeding, setSeeding] = useState(false)
  const [busy, setBusy] = useState(false)

  const classKeysWithAmount = useMemo(() => {
    return new Set(
      structureClasses.filter((c) => rowTotal(c) > 0).map((c) => c.key),
    )
  }, [structureClasses, draft, heads])

  useEffect(() => {
    const visible = new Set(structureClasses.map((c) => c.key))
    if (genClassesTouched.current) {
      /* Keep manual picks; drop classes that are no longer in the filtered list. */
      setGenClasses((prev) => {
        const next = new Set([...prev].filter((k) => visible.has(k)))
        return next.size === prev.size && [...next].every((k) => prev.has(k)) ? prev : next
      })
      return
    }
    /* Default: only check classes that already have fee amounts (not every empty row). */
    setGenClasses(new Set(classKeysWithAmount))
  }, [structureClasses, classKeysWithAmount])

  const markGenTouched = () => { genClassesTouched.current = true }

  const toggleGenClass = (key: string) => {
    markGenTouched()
    setGenClasses((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const selectAllGenClasses = () => {
    markGenTouched()
    setGenClasses(new Set(structureClasses.map((c) => c.key)))
  }

  const selectGenClassesWithAmounts = () => {
    markGenTouched()
    setGenClasses(new Set(classKeysWithAmount))
  }

  const clearGenClasses = () => {
    markGenTouched()
    setGenClasses(new Set())
  }

  const selectedRows = structureClasses.filter((c) => genClasses.has(c.key))
  const selectedWithAmount = selectedRows.filter((c) => rowTotal(c) > 0)

  /* "Save only" always keeps a draft — it never touches which version is live, so it can
     never accidentally change what students are invoiced against. "Save & generate" is the
     only action that publishes: it makes this version the one live structure (retiring
     whichever was live before) and immediately generates invoices from it. */
  const save = () => {
    const err = validateMeta()
    if (err) { toast.danger('Missing fields', err); return }
    saveStructure.mutate(buildDocument('inactive'), {
      onSuccess: (doc) => {
        toast.success('Draft saved', `${doc.name} · ${structureClasses.length} class(es) · ${heads.length} head(s). Publish it from Saved versions when ready.`)
        onDoneEditing?.()
      },
      onError: (e) => { toast.danger('Save failed', e instanceof Error ? e.message : 'Please try again.') },
    })
  }

  const generate = async () => {
    const err = validateMeta()
    if (err) { toast.danger('Missing fields', err); return }
    if (!selectedRows.length) { toast.danger('Pick classes', 'Select at least one class to generate invoices for.'); return }
    if (!selectedWithAmount.length) {
      toast.danger('No amounts on selection', 'Checked classes have no fee amounts. Fill amounts or use “With amounts”.')
      return
    }
    if (grandTotal <= 0) { toast.danger('Fill amounts', 'Enter fee amounts for at least one class / head.'); return }
    if (genDue.trim() && meta.effectiveFrom.trim() && genDue.trim() < meta.effectiveFrom.trim()) {
      toast.danger('Due date too early', `Due date can't be before the effective date (${meta.effectiveFrom}).`)
      return
    }
    setBusy(true)
    try {
      const doc = await saveStructure.mutateAsync(buildDocument('active'))
      const skipped = selectedRows.length - selectedWithAmount.length
      const classes = selectedWithAmount.map((r) => r.key)
      const res = await generateInvoices.mutateAsync({
        classes,
        academicYear: doc.academicYear,
        term: genTerm,
        ...(genDue.trim() ? { dueDate: genDue.trim() } : {}),
      })
      if (res.created > 0) {
        toast.success(
          'Structure published · invoices generated',
          `${res.created} invoice(s) · ${classes.length} class(es) · ${genTerm} · ${doc.academicYear}${skipped ? ` · skipped ${skipped} with no amount` : ''}. Open Collection to record payment.`,
        )
        try {
          const contacts = await collectAudienceContacts('parents', { classLabels: classes })
          if (contacts.emails.length || contacts.phones.length) {
            await notifyFeeAudience({
              kind: 'invoice_created',
              schoolName: app.school.name,
              channels: { email: true, sms: true, app: true },
              audience: 'parents',
              emails: contacts.emails,
              phones: contacts.phones,
              count: res.created,
              period: `${genTerm} · ${doc.academicYear}`,
            })
          }
        } catch {
          /* Best-effort — a notify failure shouldn't undo the successful publish/generate. */
        }
        try {
          await createNotification.mutateAsync({
            title: 'Fee billed',
            body: `${doc.name} · ${res.created} invoice(s) · ${genTerm} · ${doc.academicYear}`,
            icon: 'rupee',
            tone: 'fees',
          })
        } catch {
          /* Best-effort — a bell-icon failure shouldn't undo the successful publish/generate. */
        }
      } else {
        toast.info(
          'Structure published · no new invoices',
          `Every selected student already has an invoice for ${genTerm} · ${doc.academicYear} — existing invoices never change. Pick a different term/period above to bill this structure.`,
        )
      }
      onDoneEditing?.()
      onGenerated?.()
    } catch (e) {
      toast.danger('Could not generate', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const seedStarterHeads = async () => {
    setSeeding(true)
    let added = 0
    try {
      for (const name of STARTER_FEE_HEADS) {
        if (heads.some((h) => h.name.toLowerCase() === name.toLowerCase())) continue
        await createHead.mutateAsync({ name, isTransportFeeHead: name === 'Transport' })
        added += 1
      }
      toast.success(
        added ? 'Starter fee heads added' : 'Heads already present',
        'Fill header + class amounts, then Save & generate.',
      )
    } catch (e) {
      toast.danger('Could not add starter heads', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setSeeding(false)
    }
  }

  const patchMeta = <K extends keyof typeof meta>(key: K, value: (typeof meta)[K]) => {
    setMeta((m) => {
      const next = { ...m, [key]: value }
      if (key === 'academicYear' && typeof value === 'string') {
        const year = value.trim()
        if (year && (!m.name.trim() || m.name.startsWith('School fees'))) {
          next.name = `School fees ${year}`
        }
      }
      return next
    })
  }

  if (classesQ.isLoading) {
    return (
      <Card>
        <div className="t-sm muted" style={{ padding: 24 }}>Loading classes from the server…</div>
      </Card>
    )
  }
  if (classesQ.isError) {
    return (
      <Card>
        <Empty
          icon="alert"
          title="Classes unavailable"
          body={classesQ.error instanceof Error ? classesQ.error.message : 'Could not load classes from the database. Fee structure needs live classes.'}
        />
      </Card>
    )
  }
  if (!allClasses.length) {
    return (
      <Card>
        <Empty
          icon="users"
          title="No classes found"
          body="Add classes under Academics before creating a fee structure. Mock grades are not shown."
        />
      </Card>
    )
  }

  return (
    <div className="col gap16">
      {loadVersionId && (
        <Card style={{ borderColor: 'var(--brand-600)' }}>
          <div className="row ai-center jc-between gap12 wrap">
            <div className="row ai-center gap8">
              <Icon name="doc" size={16} />
              <span className="t-sm">Editing draft <b>{meta.name}</b> — saving creates a new version; this one is unchanged unless deleted.</span>
            </div>
            <Btn variant="ghost" size="sm" onClick={() => onDoneEditing?.()}>Cancel</Btn>
          </div>
        </Card>
      )}
      <Card pad={false} className="sm-fee-create">
        <div className="row ai-center jc-between gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="fw6">Create fee structure</div>
            <div className="t-sm muted">Header details + class-wise amounts → save & generate · {meta.currency || cur}</div>
          </div>
          {!editable && <Badge tone="neutral" icon="eye">View only</Badge>}
        </div>

        <div className="col gap16" style={{ padding: 16, borderBottom: heads.length ? '1px solid var(--border)' : undefined }}>
          <div className="row gap16 wrap">
            <div style={{ flex: '2 1 220px' }}>
              <Field label="Fee structure name" required>
                <Input
                  value={meta.name}
                  disabled={!editable}
                  placeholder="e.g. Class 1 Fee 2026-27"
                  onChange={(e) => patchMeta('name', e.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Field label="Academic year" required>
                <Input
                  value={meta.academicYear}
                  disabled={!editable}
                  placeholder="e.g. 2026-27"
                  onChange={(e) => patchMeta('academicYear', e.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <Field label="Currency" required>
                <Select
                  options={CURRENCY_OPTIONS}
                  value={meta.currency}
                  disabled={!editable}
                  onChange={(e) => patchMeta('currency', e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="row gap16 wrap">
            <div style={{ flex: '1 1 180px' }}>
              <Field label="Class" hint="Structure scope — All classes applies school-wide">
                <Select
                  options={[
                    { value: '', label: 'All classes' },
                    ...gradeOptions.map((g) => ({ value: g, label: g })),
                  ]}
                  value={meta.classGrade}
                  disabled={!editable}
                  onChange={(e) => {
                    const next = e.target.value
                    patchMeta('classGrade', next)
                    setViewGrade(next)
                  }}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <Field label="Section" hint="All sections includes every section in the class">
                <Select
                  options={[
                    { value: '', label: 'All sections' },
                    ...sectionOptions.map((s) => ({ value: s, label: s })),
                  ]}
                  value={meta.section}
                  disabled={!editable}
                  onChange={(e) => {
                    const next = e.target.value
                    patchMeta('section', next)
                    setViewSection(next)
                  }}
                />
              </Field>
            </div>
            <div style={{ flex: '1 1 140px' }}>
              <Field label="Effective from" required>
                <Input
                  type="date"
                  value={meta.effectiveFrom}
                  disabled={!editable}
                  onChange={(e) => patchMeta('effectiveFrom', e.target.value)}
                />
              </Field>
            </div>
          </div>
          <Field label="Description" hint="Optional remarks">
            <Input
              value={meta.description}
              disabled={!editable}
              placeholder="e.g. Term 1 tuition for primary"
              onChange={(e) => patchMeta('description', e.target.value)}
            />
          </Field>
        </div>

        {heads.length === 0 ? (
          <Empty
            icon="wallet"
            title="Add fee type & amount"
            body="1 · Add fee types (Academic, Transport…) · 2 · Type amount for each class · 3 · Save & generate"
            action={editable ? (
              <div className="col gap12" style={{ alignItems: 'center', width: '100%', maxWidth: 440 }}>
                <Btn variant="primary" icon="plus" disabled={seeding || createHead.isPending} onClick={() => { void seedStarterHeads() }}>
                  {seeding ? 'Adding…' : 'Add starter fee types'}
                </Btn>
                <div className="t-xs muted">or type a fee type</div>
                <div className="row ai-end gap8 wrap jc-center" style={{ width: '100%' }}>
                  <div style={{ flex: '1 1 180px' }}>
                    <Field label="Fee type" required>
                      <Input value={newHead} placeholder="e.g. Library" onChange={(e) => setNewHead(e.target.value)} />
                    </Field>
                  </div>
                  <Checkbox
                    checked={newHeadTransport}
                    onChange={setNewHeadTransport}
                    label="Mark as Transport Fee"
                  />
                  <Btn variant="secondary" icon="plus" disabled={createHead.isPending || !newHead.trim()} onClick={addHead}>
                    Add fee type
                  </Btn>
                </div>
                <div style={{ width: '100%' }}>
                  <Field label="Description (optional)" hint="Shown wherever this fee is billed, e.g. to parents">
                    <Input
                      value={newHeadDescription}
                      placeholder="e.g. Annual educational trip to Mumbai"
                      onChange={(e) => setNewHeadDescription(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            ) : undefined}
          />
        ) : (
          <div className="col gap16" style={{ padding: 16 }}>
            <Card pad={false} style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                <div className="fw6">Fee type & amount</div>
                <div className="t-sm muted">Add a fee type, then enter amount for each class below</div>
              </div>
              <div className="col gap16" style={{ padding: 16 }}>
                {editable && (
                  <div className="col gap8">
                    <div className="row ai-end gap12 wrap">
                      <div style={{ flex: '0 1 300px', minWidth: 180 }}>
                        <Field label="Fee type" required hint="e.g. Academic, Transport, Exam">
                          <Input
                            value={newHead}
                            placeholder="Type fee name…"
                            onChange={(e) => setNewHead(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHead() } }}
                          />
                        </Field>
                      </div>
                      <Btn variant="secondary" icon="plus" disabled={createHead.isPending || !newHead.trim()} onClick={addHead}>
                        Add fee type
                      </Btn>
                    </div>
                    <div style={{ width: '100%', maxWidth: 420 }}>
                      <Field label="Description (optional)" hint="Shown wherever this fee is billed">
                        <Input
                          value={newHeadDescription}
                          placeholder="e.g. Annual educational trip to Mumbai"
                          onChange={(e) => setNewHeadDescription(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHead() } }}
                        />
                      </Field>
                    </div>
                    <Checkbox
                      checked={newHeadTransport}
                      onChange={setNewHeadTransport}
                      label="Mark as Transport Fee"
                    />
                  </div>
                )}
                <div className="row gap6 wrap">
                  {heads.map((h) => (
                    <div key={h.id} className="row ai-center gap4" title={h.description || undefined}>
                      <Badge tone="brand">
                        {h.name}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => removeHead(h)}
                            aria-label={`Remove ${h.name}`}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', display: 'inline-flex', marginLeft: 6, padding: 0, opacity: 0.75 }}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </Badge>
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => setToggleHead(h)}
                          aria-label={`${h.isTransportFeeHead ? 'Unmark' : 'Mark'} ${h.name} as transport fee`}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex' }}
                        >
                          <Badge tone={h.isTransportFeeHead ? 'info' : 'neutral'}>
                            {h.isTransportFeeHead ? '🚌 Transport' : 'Regular'}
                          </Badge>
                        </button>
                      ) : (
                        <Badge tone={h.isTransportFeeHead ? 'info' : 'neutral'}>
                          {h.isTransportFeeHead ? '🚌 Transport' : 'Regular'}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>

                <Field
                  label="Amount by class"
                  required
                  hint={`Showing ${structureClasses.length} of ${allClasses.length} class(es) · max ${fmtMoney(MAX_FEE_AMOUNT, meta.currency || cur)} per cell`}
                >
                  <div className="col gap12">
                    <div className="row ai-center gap8 wrap" style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      background: 'var(--surface-2)',
                    }}>
                      <span className="t-xs muted3 fw6" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>View</span>
                      <div className="row gap6 wrap" role="group" aria-label="Filter by grade">
                        {!meta.classGrade && (
                          <Btn
                            type="button"
                            size="sm"
                            variant={viewGrade === '' ? 'primary' : 'secondary'}
                            onClick={() => setViewGrade('')}
                          >
                            All classes
                          </Btn>
                        )}
                        {(meta.classGrade ? [meta.classGrade] : gradeOptions).map((g) => (
                          <Btn
                            key={g}
                            type="button"
                            size="sm"
                            variant={viewGrade === g ? 'primary' : 'secondary'}
                            onClick={() => setViewGrade(g)}
                          >
                            {g}
                          </Btn>
                        ))}
                      </div>
                      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)', margin: '0 2px' }} aria-hidden />
                      <div style={{ minWidth: 140, flex: '0 1 160px' }}>
                        <Select
                          aria-label="Filter by section"
                          options={[
                            { value: '', label: 'All sections' },
                            ...sectionOptions.map((s) => ({ value: s, label: `Section ${s}` })),
                          ]}
                          value={meta.section || viewSection}
                          disabled={!!meta.section}
                          onChange={(e) => setViewSection(e.target.value)}
                        />
                      </div>
                      <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                        <Search
                          value={classQ}
                          onChange={setClassQ}
                          placeholder="Search class…"
                        />
                      </div>
                    </div>

                    {/* Mobile / narrow: stacked cards */}
                    <div className="sm-fee-amount-cards">
                      {structureClasses.map((row) => (
                        <div key={row.key} className="sm-fee-amount-card">
                          <div className="row ai-center jc-between gap8">
                            <div>
                              <div className="fw6">{row.label}</div>
                              <div className="t-xs muted">{studentsInRow(row)} student{studentsInRow(row) === 1 ? '' : 's'}</div>
                            </div>
                            <div className="t-sm fw7">{fmtMoney(rowTotal(row), meta.currency || cur)}</div>
                          </div>
                          <div className="sm-fee-amount-fields">
                            {heads.map((h) => (
                              <Field key={h.id} label={h.name}>
                                <Input
                                  type="number"
                                  min={0}
                                  max={MAX_FEE_AMOUNT}
                                  inputMode="numeric"
                                  icon="rupee"
                                  placeholder="0"
                                  value={cellDisplay(row, h.id)}
                                  disabled={!editable}
                                  onChange={(e) => setCell(row, h.id, e.target.value)}
                                  onBlur={() => commitCell(row, h.id)}
                                  aria-label={`${row.label} ${h.name} amount`}
                                />
                              </Field>
                            ))}
                          </div>
                        </div>
                      ))}
                      {!structureClasses.length && (
                        <div className="t-sm muted" style={{ padding: 12 }}>No classes match this class / section filter.</div>
                      )}
                    </div>

                    {/* Desktop: compact sticky table */}
                    <div className="sm-fee-amount-table-wrap">
                      <table className="sm-table sm-fee-amount-table">
                        <thead>
                          <tr>
                            <th>Class</th>
                            {heads.map((h) => (
                              <th key={h.id} className="ta-right">
                                <div className="col ai-end gap6">
                                  <div className="col ai-end gap2">
                                    <span className="fw7">{h.name}</span>
                                    <span className="t-xs muted fw4">Amount</span>
                                  </div>
                                  {editable && (
                                    <Btn
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      icon="check"
                                      disabled={!structureClasses.length}
                                      title={`Copy first filled ${h.name} (or 0) to all shown classes`}
                                      onClick={() => {
                                        const first = structureClasses.find((r) => cellValue(r, h.id) > 0)
                                        const raw = first
                                          ? String(cellValue(first, h.id))
                                          : (amountText[cellKey(structureClasses[0], h.id)] ?? '0')
                                        applyHeadToAllShown(h.id, raw)
                                      }}
                                    >
                                      Same all
                                    </Btn>
                                  )}
                                </div>
                              </th>
                            ))}
                            <th className="ta-right">Students</th>
                            <th className="ta-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {structureClasses.map((row) => (
                            <tr key={row.key}>
                              <td className="fw6 sm-fee-amount-sticky">{row.label}</td>
                              {heads.map((h) => (
                                <td key={h.id} className="ta-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    max={MAX_FEE_AMOUNT}
                                    inputMode="numeric"
                                    placeholder="0"
                                    value={cellDisplay(row, h.id)}
                                    disabled={!editable}
                                    className="sm-fee-amount-input"
                                    onChange={(e) => setCell(row, h.id, e.target.value)}
                                    onBlur={() => commitCell(row, h.id)}
                                    aria-label={`${row.label} ${h.name} amount`}
                                  />
                                </td>
                              ))}
                              <td className="ta-right muted">{studentsInRow(row)}</td>
                              <td className="ta-right fw7">{fmtMoney(rowTotal(row), meta.currency || cur)}</td>
                            </tr>
                          ))}
                          {!structureClasses.length && (
                            <tr>
                              <td colSpan={heads.length + 3} className="t-sm muted" style={{ padding: 16 }}>
                                No classes match this class / section filter.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Field>
                <div className="col gap6" style={{ width: '100%' }}>
                  <div className="row jc-between ai-center wrap gap8">
                    <span className="t-sm muted" title="Fee one student pays in this grade (sections share the same fee)">
                      This grade · {feeRangeLabel(perStudentFee(structureClasses))} per student
                      {transportPerStudent(structureClasses).max > 0 && ` · incl. transport ${feeRangeLabel(transportPerStudent(structureClasses))}`}
                    </span>
                    <span className="fw7" title="Per-student fee across all classes (range if grades differ)">
                      All classes · {feeRangeLabel(perStudentFee(allClasses))} per student
                      {transportPerStudent(allClasses).max > 0 && (
                        <span className="t-sm muted fw4"> · incl. transport {feeRangeLabel(transportPerStudent(allClasses))}</span>
                      )}
                    </span>
                  </div>
                  <div className="row jc-between ai-center wrap gap8">
                    <span className="t-sm muted" title="Non-transport fee × students enrolled in each class">
                      Base fee collection
                    </span>
                    <span className="fw6">
                      {fmtMoney(expected.baseRevenue, meta.currency || cur)}
                      <span className="t-xs muted fw4"> · {expected.billedStudents} student{expected.billedStudents === 1 ? '' : 's'}</span>
                    </span>
                  </div>
                  {expected.transportRevenue > 0 && (
                    <div className="row jc-between ai-center wrap gap8">
                      <span className="t-sm muted" title="Avg transport fee × students currently assigned to transport (estimate)">
                        Transport collection (est.)
                      </span>
                      <span className="fw6">
                        {fmtMoney(expected.transportRevenue, meta.currency || cur)}
                        <span className="t-xs muted fw4"> · {transportStudents} on transport</span>
                      </span>
                    </div>
                  )}
                  <div className="row jc-between ai-center wrap gap8">
                    <span className="t-sm muted fw6" title="Base + estimated transport collection for a full year">
                      Expected annual collection{expected.transportRevenue > 0 ? ' (est.)' : ''}
                    </span>
                    <span className="fw7">
                      {fmtMoney(expected.total, meta.currency || cur)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </Card>

      {editable && heads.length > 0 && (
        <Card>
          <CardHead
            title="Save & generate invoices"
            sub={`${meta.name || 'Fee structure'} · ${meta.academicYear} · publishes this version`}
            icon="rupee"
          />
          <div className="col gap16" style={{ marginTop: 12 }}>
            <div className="row gap16 wrap">
              <div style={{ flex: '0 1 220px', minWidth: 160 }}>
                <Field label="Term" required>
                  <Select options={TERM_OPTIONS} value={genTerm} onChange={(e) => setGenTerm(e.target.value)} />
                </Field>
              </div>
              <div style={{ flex: '0 1 220px', minWidth: 160 }}>
                <Field label="Due date" hint={meta.effectiveFrom ? `On/after effective date ${meta.effectiveFrom}` : 'Optional'}>
                  <Input type="date" value={genDue} min={meta.effectiveFrom || undefined} onChange={(e) => setGenDue(e.target.value)} />
                </Field>
              </div>
            </div>
            <Field
              label="Generate for classes"
              required
              hint={
                genClasses.size
                  ? `${selectedWithAmount.length} with amount · ${genClasses.size} checked · ${structureClasses.length} shown`
                  : 'Only classes with fee amounts are checked by default'
              }
            >
              <div className="col gap10">
                <div className="row ai-center gap8 wrap">
                  <Btn type="button" size="sm" variant="secondary" onClick={selectGenClassesWithAmounts}>
                    With amounts
                  </Btn>
                  <Btn type="button" size="sm" variant="secondary" onClick={selectAllGenClasses}>
                    Select all classes
                  </Btn>
                  <Btn type="button" size="sm" variant="ghost" onClick={clearGenClasses}>
                    Clear
                  </Btn>
                </div>
                <div
                  className="sm-fee-gen-class-grid"
                  role="group"
                  aria-label="Select classes"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 8,
                    maxHeight: 220,
                    overflow: 'auto',
                    padding: 10,
                    border: '1px solid var(--border)',
                    borderRadius: 10,
                    background: 'var(--surface)',
                  }}
                >
                  {structureClasses.map((c) => {
                    const on = genClasses.has(c.key)
                    const hasAmt = rowTotal(c) > 0
                    return (
                      <button
                        key={c.key}
                        type="button"
                        className="row ai-center gap8"
                        onClick={() => toggleGenClass(c.key)}
                        style={{
                          margin: 0,
                          padding: '8px 10px',
                          borderRadius: 8,
                          border: `1px solid ${on ? 'var(--brand-600)' : 'var(--border)'}`,
                          background: on ? 'color-mix(in srgb, var(--brand-600) 10%, transparent)' : 'transparent',
                          cursor: 'pointer',
                          textAlign: 'left',
                          color: 'inherit',
                          font: 'inherit',
                          opacity: hasAmt ? 1 : 0.72,
                        }}
                      >
                        <span style={{ pointerEvents: 'none' }}>
                          <Checkbox checked={on} />
                        </span>
                        <span className="col" style={{ gap: 2, minWidth: 0 }}>
                          <span className="t-sm fw6">{c.label}</span>
                          <span className="t-xs muted">{hasAmt ? fmtMoney(rowTotal(c), meta.currency || cur) : 'No amount'}</span>
                        </span>
                      </button>
                    )
                  })}
                  {!structureClasses.length && (
                    <div className="t-sm muted">No classes in the current class / section filter.</div>
                  )}
                </div>
              </div>
            </Field>
            <div className="row jc-end gap8 wrap">
              <Btn variant="secondary" icon="check" disabled={busy || saveStructure.isPending} onClick={save}>
                Save only
              </Btn>
              <Btn
                variant="primary"
                icon="arrowRight"
                disabled={busy || generateInvoices.isPending || selectedWithAmount.length === 0}
                onClick={() => { void generate() }}
              >
                {busy ? 'Working…' : 'Save & generate'}
              </Btn>
            </div>
            {selectedWithAmount.length === 0 && (
              <div className="t-sm muted">Check classes that have fee amounts (or fill amounts first), then generate.</div>
            )}
          </div>
        </Card>
      )}
      {toggleHead && <TransportToggleModal head={toggleHead} onClose={() => setToggleHead(null)} />}
    </div>
  )
}

/* ---------- Send reminders modal ---------- */
function RemindersModal({ dueInvoices, allDueInvoices, defaultersCount, schoolName, currency, onClose }: {
  /** Invoices matching the current search/status filters (the "Selected" audience). */
  dueInvoices: FeeInvoice[]
  /** Every due/partial invoice school-wide (the "Defaulters" audience). */
  allDueInvoices: FeeInvoice[]
  defaultersCount: number
  schoolName: string
  currency: string
  onClose: () => void
}) {
  const toast = useToast()
  const [email, setEmail] = useState(true)
  const [sms, setSms] = useState(true)
  const [appCh, setAppCh] = useState(true)
  const [audience, setAudience] = useState<'defaulters' | 'selected'>('defaulters')
  const [sending, setSending] = useState(false)

  const targetInvoices = audience === 'defaulters' ? allDueInvoices : dueInvoices
  const selectedIds = useMemo(() => targetInvoices.map((i) => i.id), [targetInvoices])

  const submit = async () => {
    const channels = { email, sms, app: appCh }
    if (!email && !sms && !appCh) { toast.danger('Pick a channel', 'Enable Email, SMS, and/or App.'); return }
    if (!targetInvoices.length) { toast.danger('No invoices selected', 'No due/partial invoices match the current view.'); return }
    setSending(true)
    try {
      // One reminder PER STUDENT, each with that student's own outstanding total (already
      // transport-gated correctly by the backend invoice engine, never recomputed here) — never
      // one blended amount broadcast to every parent, which would misstate everyone's due.
      const byStudent = new Map<string, { name: string; due: number; dueDate?: string }>()
      for (const inv of targetInvoices) {
        const entry = byStudent.get(inv.studentId) ?? { name: inv.studentName, due: 0, dueDate: undefined }
        entry.due += inv.due
        if (inv.dueDate && (!entry.dueDate || inv.dueDate < entry.dueDate)) entry.dueDate = inv.dueDate
        byStudent.set(inv.studentId, entry)
      }
      const contactsById = await contactsByStudentId([...byStudent.keys()])

      let totalReach = 0
      let sentChannels: string[] = []
      let sentAny = false
      for (const [studentId, info] of byStudent) {
        if (info.due <= 0) continue
        const contacts = contactsById[studentId]
        if (!contacts || (!contacts.emails.length && !contacts.phones.length)) continue
        const res = await notifyFeeAudience({
          kind: 'reminder',
          schoolName,
          currency,
          studentName: info.name,
          amount: info.due,
          dueDate: info.dueDate,
          channels,
          audience: 'parents',
          emails: contacts.emails,
          phones: contacts.phones,
        })
        sentAny = true
        totalReach += res.reach
        sentChannels = res.channels
      }

      if (!sentAny) {
        toast.danger('No contacts found', 'None of the targeted students have a guardian email or phone on file.')
        return
      }
      toast.success(
        'Reminders sent',
        `Reached ${fmtNum(totalReach)} parent(s) across ${fmtNum(byStudent.size)} student(s) via ${sentChannels.join(' · ')}.`,
      )
      onClose()
    } catch (err) {
      toast.danger('Could not send reminders', err instanceof Error ? err.message : 'Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open onClose={onClose} icon="bell" size="sm"
      title="Send fee reminders"
      sub={audience === 'defaulters' ? `${fmtNum(defaultersCount)} student(s) with pending dues · full outstanding` : `${fmtNum(selectedIds.length)} invoice(s) in the current view`}
      footer={
        <div className="row gap8 jc-end">
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="bell" disabled={sending} onClick={() => { void submit() }}>
            {sending ? 'Sending…' : 'Send reminders'}
          </Btn>
        </div>
      }
    >
      <div className="col gap16">
        <Field label="Audience" hint="Pending dues is every due/partial invoice school-wide; Selected uses invoices matching the current search/status filters.">
          <div className="row gap8 wrap">
            <Btn type="button" size="sm" variant={audience === 'defaulters' ? 'primary' : 'secondary'} onClick={() => setAudience('defaulters')}>Pending dues (all)</Btn>
            <Btn type="button" size="sm" variant={audience === 'selected' ? 'primary' : 'secondary'} onClick={() => setAudience('selected')}>Selected (current view)</Btn>
          </div>
        </Field>
        <Field label="Send via">
          <div className="col gap8">
            <Checkbox checked={appCh} onChange={setAppCh} label="App notification" />
            <Checkbox checked={email} onChange={setEmail} label="Email" />
            <Checkbox checked={sms} onChange={setSms} label="SMS" />
          </div>
        </Field>
      </div>
    </Modal>
  )
}

/** Read-only view of one saved Fee Structure version's class-wise amounts, resolving
 *  fee-head ids to names via the current Fee Head list (a version's amounts are keyed by
 *  head id, but head names can change later — this always shows the CURRENT name, since the
 *  amount itself, not the head's name, is what a structure version snapshots). */
function FeeStructureVersionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const versionQ = useFeeStructureVersion(id)
  const headsQ = useFeeHeads()
  const headNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const h of headsQ.data ?? []) m.set(h.id, h.name)
    return m
  }, [headsQ.data])

  const doc = versionQ.data
  const rows = useMemo(() => {
    if (!doc) return []
    return Object.entries(doc.amounts).map(([classKey, byHead]) => ({
      classKey,
      total: Object.values(byHead).reduce((a, n) => a + n, 0),
      lines: Object.entries(byHead).map(([headId, amount]) => ({
        headId, amount, headName: headNameById.get(headId) || headId,
      })),
    }))
  }, [doc, headNameById])

  return (
    <Modal open onClose={onClose} icon="doc" size="lg" title={doc?.name || 'Fee structure version'} sub={doc ? `${doc.academicYear} · ${doc.status === 'active' ? 'Active' : 'Inactive'}` : undefined}>
      {versionQ.isLoading ? (
        <div className="t-sm muted">Loading…</div>
      ) : !doc ? (
        <Empty icon="doc" title="Not found" body="This fee structure version could not be loaded." />
      ) : (
        <div className="col gap12">
          {rows.length === 0 ? (
            <div className="t-sm muted">No class amounts were saved on this version.</div>
          ) : rows.map((row) => (
            <div key={row.classKey} className="col gap6" style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
              <div className="row ai-center jc-between">
                <div className="fw6">{row.classKey}</div>
                <div className="fw6">{fmtMoney(row.total, doc.currency)}</div>
              </div>
              {row.lines.map((l) => (
                <div key={l.headId} className="row ai-center jc-between t-sm muted">
                  <span>{l.headName}</span>
                  <span>{fmtMoney(l.amount, doc.currency)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function FeeStructureHistoryTab({ editable, onEdit }: { editable: boolean; onEdit: (id: string) => void }) {
  const toast = useToast()
  const historyQ = useFeeStructureHistory()
  const publishVersion = usePublishFeeStructureVersion()
  const unpublishVersion = useUnpublishFeeStructureVersion()
  const deleteVersion = useDeleteFeeStructureVersion()
  const [viewId, setViewId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const entries = historyQ.data ?? []
  const deleteTarget = entries.find((e) => e.id === deleteId) ?? null

  // Publishing is deliberately term-free: it only flips this version's status. Term selection
  // happens later and separately, when someone generates invoices (Structure tab's Save &
  // generate) — never bundled into the Publish action itself.
  const publish = (id: string, name: string) => {
    publishVersion.mutate(id, {
      onSuccess: () => toast.success('Published', `${name} is now billed — every other published version stays billed too. Generate invoices for a term whenever you're ready.`),
      onError: (e) => toast.danger('Could not publish', e instanceof Error ? e.message : 'Please try again.'),
    })
  }

  const unpublish = (id: string, name: string) => {
    unpublishVersion.mutate(id, {
      onSuccess: () => toast.success('Unpublished', `${name} is no longer billed.`),
      onError: (e) => toast.danger('Could not unpublish', e instanceof Error ? e.message : 'Please try again.'),
    })
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteVersion.mutate(deleteTarget.id, {
      onSuccess: () => { toast.success('Draft deleted', deleteTarget.name); setDeleteId(null) },
      onError: (e) => { toast.danger('Could not delete', e instanceof Error ? e.message : 'Please try again.'); setDeleteId(null) },
    })
  }

  return (
    <Card pad={false}>
      <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div className="fw6">Saved fee structure versions</div>
        <div className="t-sm muted">Every save is kept as a draft here. Any number of versions can be Published at once — publishing one never unpublishes another, so publish Transport, then Exam, then a third, and all stay billed together (a fee head set by more than one Published version uses the newer rate, never double-billed). Unpublish a version explicitly when you want it to stop being billed. Total = each class's fee rate × students currently enrolled in that class.</div>
      </div>
      {historyQ.isLoading ? (
        <div className="t-sm muted" style={{ padding: 16 }}>Loading saved versions…</div>
      ) : entries.length === 0 ? (
        <div style={{ padding: 16 }}>
          <Empty icon="doc" title="No saved versions yet" body="Save a fee structure under the Structure tab to see it appear here." />
        </div>
      ) : (
        <table className="sm-table">
          <thead>
            <tr><th>Name</th><th>Academic year</th><th>Class</th><th className="ta-right">Total (by student count)</th><th>Status</th><th>Saved</th><th /></tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="fw6">{e.name}</td>
                <td>{e.academicYear}</td>
                <td className="muted">{[e.classGrade, e.section].filter(Boolean).join('-') || 'All classes'}</td>
                <td className="ta-right">
                  <div className="fw6">{fmtMoney(e.totalAmount, e.currency)}</div>
                  {e.headAmounts.length > 0 && (
                    <div className="t-xs muted">
                      {e.headAmounts
                        .map((h) =>
                          h.perStudentAmount > 0
                            ? `${h.headName} ${fmtMoney(h.perStudentAmount, e.currency)}/student · Total ${fmtMoney(h.amount, e.currency)}`
                            : `${h.headName} ${fmtMoney(h.amount, e.currency)}`,
                        )
                        .join(' · ')}
                    </div>
                  )}
                </td>
                <td><Badge tone={e.status === 'active' ? 'success' : 'neutral'} dot>{e.status === 'active' ? 'Published' : 'Draft'}</Badge></td>
                <td className="muted">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                <td className="ta-right">
                  <div className="row gap6 jc-end">
                    <Btn size="sm" variant="ghost" icon="eye" onClick={() => setViewId(e.id)}>View</Btn>
                    {editable && e.status === 'active' && (
                      <Btn size="sm" variant="ghost" icon="x" disabled={unpublishVersion.isPending} onClick={() => unpublish(e.id, e.name)}>Unpublish</Btn>
                    )}
                    {editable && e.status !== 'active' && (
                      <>
                        <Btn size="sm" variant="ghost" icon="edit" onClick={() => onEdit(e.id)}>Edit</Btn>
                        <Btn size="sm" variant="secondary" icon="check" disabled={publishVersion.isPending} onClick={() => publish(e.id, e.name)}>Publish</Btn>
                        <Btn size="sm" variant="ghost" icon="trash" onClick={() => setDeleteId(e.id)}>Delete</Btn>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {viewId && <FeeStructureVersionModal id={viewId} onClose={() => setViewId(null)} />}
      {deleteTarget && (
        <Modal
          open onClose={() => setDeleteId(null)} icon="trash" size="sm"
          title="Delete this draft?" sub={deleteTarget.name}
          footer={
            <div className="row gap8 jc-end">
              <Btn variant="ghost" onClick={() => setDeleteId(null)}>Cancel</Btn>
              <Btn variant="danger" icon="trash" disabled={deleteVersion.isPending} onClick={confirmDelete}>Delete</Btn>
            </div>
          }
        >
          <div className="t-sm">This draft was never published, so nothing was ever billed against it. This cannot be undone.</div>
        </Modal>
      )}
    </Card>
  )
}

/* ---------- Pay fees: look a student up by admission no. and see all their invoices ---------- */
/** Readable due date — invoices may carry a full ISO timestamp; show just the day. */
function fmtDueDay(raw?: string): string {
  const s = (raw ?? '').trim()
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

function StudentFeesPanel({ invoices, admOf, studentsById, cur, schoolName, canRecord }: {
  invoices: FeeInvoice[]
  admOf: (inv: FeeInvoice) => string
  studentsById: Map<string, Student>
  cur: string
  schoolName: string
  canRecord: boolean
}) {
  const app = useApp()
  const toast = useToast()
  const paymentsQ = useFeePayments()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [payInv, setPayInv] = useState<FeeInvoice | null>(null)
  const query = q.trim().toLowerCase()

  const byStudent = useMemo(() => {
    const m = new Map<string, FeeInvoice[]>()
    for (const inv of invoices) {
      const arr = m.get(inv.studentId)
      if (arr) arr.push(inv)
      else m.set(inv.studentId, [inv])
    }
    return m
  }, [invoices])

  const matchIds = useMemo(() => {
    if (!query) return []
    const ids: string[] = []
    const seen = new Set<string>()
    for (const inv of invoices) {
      if (seen.has(inv.studentId)) continue
      if (admOf(inv).toLowerCase().includes(query) || (inv.studentName ?? '').toLowerCase().includes(query)) {
        ids.push(inv.studentId)
        seen.add(inv.studentId)
      }
    }
    return ids
  }, [invoices, query, admOf])

  const activeId = picked && byStudent.has(picked) ? picked : (matchIds.length === 1 ? matchIds[0] : null)
  const studentInvoices = useMemo(
    () => (activeId
      ? [...(byStudent.get(activeId) ?? [])].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
      : []),
    [activeId, byStudent],
  )
  const first = studentInvoices[0]
  const student = activeId ? studentsById.get(activeId) : undefined
  const totals = studentInvoices.reduce(
    (t, inv) => ({ total: t.total + inv.total, paid: t.paid + inv.paid, due: t.due + inv.due }),
    { total: 0, paid: 0, due: 0 },
  )

  /* This student's recorded payments (newest first) — same data as the History tab. */
  const studentPayments = useMemo(
    () => (activeId ? (paymentsQ.data ?? []).filter((p) => p.studentId === activeId) : [])
      .slice()
      .sort((a, b) => Number(b.id) - Number(a.id)),
    [paymentsQ.data, activeId],
  )
  const downloadReceipt = (p: FeePayment) => {
    downloadFeeReceipt({
      schoolName: app.school.name,
      schoolCity: app.school.city,
      studentName: p.studentName,
      studentAdm: student?.adm || (first ? admOf(first) : ''),
      cls: p.cls,
      amount: p.amount,
      currency: cur,
      mode: p.mode,
      ref: p.ref,
      paidAt: p.date,
      headName: p.headName || p.feeType,
      invoiceId: feeInvoiceNo(p.invoiceId, p.date),
      logoUrl: app.school.logoUrl,
      logoInitials: app.school.logo,
      brandColor: app.school.color,
    })
  }
  const mailReceipt = (p: FeePayment) => {
    const emails = student ? guardianEmailsFromStudent(student) : []
    if (!emails.length) { toast.danger('No guardian email', 'Add a guardian email on the student profile first.'); return }
    const adm = student?.adm || (first ? admOf(first) : '') || '—'
    const body = `Dear Parent/Guardian,\n\nReceipt for a fee payment received:\n\n`
      + `Student: ${properName(p.studentName)} (Adm ${adm}, Class ${p.cls})\n`
      + `Receipt no.: ${p.ref || '—'}\n`
      + `Invoice: ${feeInvoiceNo(p.invoiceId, p.date)}\n`
      + `Fee type: ${p.headName || p.feeType || 'All fee types'}\n`
      + `Amount: ${fmtMoney(p.amount, cur)}\n`
      + `Mode: ${p.mode}\n`
      + `Date: ${fmtDueDay(p.date)}\n\n`
      + `Thank you,\n${schoolName}`
    try {
      openMailCompose({ to: emails, subject: `Fee receipt ${p.ref || ''} · ${properName(p.studentName)}`.replace(/\s+·/, ' ·').trim(), body })
    } catch (err) {
      toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
    }
  }

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
  const buildStatementHtml = (list: FeeInvoice[], title: string, forPrint: boolean): string | null => {
    if (!list.length || !first) return null
    const t = list.reduce((a, i) => ({ total: a.total + i.total, paid: a.paid + i.paid, due: a.due + i.due }), { total: 0, paid: 0, due: 0 })
    const body = list.map((inv) => `<tr>
      <td>${esc(inv.term || '—')}${inv.academicYear ? ` · ${esc(inv.academicYear)}` : ''}<br><span style="color:#64748b;font-size:11px">${esc(feeInvoiceNo(inv.id, inv.dueDate))}</span></td>
      <td>${esc(fmtDueDay(inv.dueDate))}</td>
      <td style="text-align:right">${esc(fmtMoney(inv.total, cur))}</td>
      <td style="text-align:right">${esc(fmtMoney(inv.paid, cur))}</td>
      <td style="text-align:right">${esc(fmtMoney(inv.due, cur))}</td>
      <td>${esc(feeLabel[inv.status])}</td></tr>`).join('')
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#0f172a}
      h1{font-size:18px;margin:0 0 2px}h2{font-size:13px;font-weight:400;color:#475569;margin:0 0 14px}
      .meta{font-size:13px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border-bottom:1px solid #e2e8f0;padding:8px 10px;text-align:left}
      th{background:#f1f5f9;font-weight:700}
      tfoot td{font-weight:700;border-top:2px solid #cbd5e1}</style></head><body>
      <h1>${esc(schoolName)}</h1><h2>Fee statement</h2>
      <div class="meta"><b>${esc(properName(first.studentName))}</b> · Adm ${esc(admOf(first) || '—')} · Class ${esc(first.cls || '—')}</div>
      <table><thead><tr><th>Term</th><th>Due date</th><th style="text-align:right">Total</th><th style="text-align:right">Paid</th><th style="text-align:right">Due</th><th>Status</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="2">Total</td><td style="text-align:right">${esc(fmtMoney(t.total, cur))}</td><td style="text-align:right">${esc(fmtMoney(t.paid, cur))}</td><td style="text-align:right">${esc(fmtMoney(t.due, cur))}</td><td></td></tr></tfoot>
      </table>${forPrint ? '<script>window.onload=function(){window.print()}</script>' : ''}</body></html>`
  }

  const printInvoices = (list: FeeInvoice[], title: string) => {
    const html = buildStatementHtml(list, title, true)
    if (!html) return
    const w = window.open('', '_blank')
    if (!w) { toast.danger('Pop-up blocked', 'Allow pop-ups for this site to print.'); return }
    w.document.write(html)
    w.document.close()
  }

  const downloadStatement = () => {
    const html = buildStatementHtml(studentInvoices, 'Fee statement', false)
    if (!html || !first) return
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fee-statement-${(admOf(first) || first.studentName).replace(/[^a-zA-Z0-9]+/g, '-')}.html`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const emailStatement = () => {
    if (!first) return
    const emails = student ? guardianEmailsFromStudent(student) : []
    if (!emails.length) { toast.danger('No guardian email', 'Add a guardian email on the student profile first.'); return }
    const lines = studentInvoices
      .map((inv) => `- ${inv.term || 'Fee'}${inv.academicYear ? ` (${inv.academicYear})` : ''}: total ${fmtMoney(inv.total, cur)}, paid ${fmtMoney(inv.paid, cur)}, due ${fmtMoney(inv.due, cur)}${inv.dueDate ? `, due ${fmtDueDay(inv.dueDate)}` : ''}`)
      .join('\n')
    const bodyText = `Dear Parent/Guardian,\n\nFee statement for ${properName(first.studentName)} (Adm ${admOf(first) || '—'}, Class ${first.cls || '—'}):\n\n${lines}\n\nTotal outstanding: ${fmtMoney(totals.due, cur)}\n\nRegards,\n${schoolName}`
    try {
      openMailCompose({ to: emails, subject: `Fee statement · ${properName(first.studentName)}`, body: bodyText })
    } catch (err) {
      toast.danger('Could not open mail', err instanceof Error ? err.message : 'Invalid email.')
    }
  }

  return (
    <Card>
      <CardHead title="Pay fees" sub="Search a student by Student ID to see all their invoices" icon="rupee" />
      <div className="col gap16" style={{ marginTop: 12 }}>
        <Field label="Student ID or name" hint="Type or scan the Student ID.">
          <Search value={q} onChange={(v) => { setQ(v); setPicked(null) }} placeholder="e.g. STU/26/0001 or Rahul" />
        </Field>

        {query && matchIds.length > 1 && !picked && (
          <div className="col gap6">
            <div className="t-xs muted">{matchIds.length} students match — pick one:</div>
            {matchIds.slice(0, 8).map((id) => {
              const inv = byStudent.get(id)?.[0]
              if (!inv) return null
              return (
                <button key={id} type="button" className="row ai-center jc-between gap8" onClick={() => setPicked(id)}
                  style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
                  <span className="fw6">{properName(inv.studentName)}</span>
                  <span className="t-xs muted">{admOf(inv) || '—'} · {inv.cls}</span>
                </button>
              )
            })}
          </div>
        )}

        {query && matchIds.length === 0 && (
          <Empty icon="search" title="No student found" body="Check the Student ID and try again." />
        )}

        {activeId && first && (
          <>
            <div className="row ai-center jc-between gap12 wrap" style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="row gap16 wrap">
                <div><div className="t-xs muted">Student</div><div className="fw6">{properName(first.studentName)}</div></div>
                <div><div className="t-xs muted">Student ID</div><div className="fw6">{admOf(first) || '—'}</div></div>
                <div><div className="t-xs muted">Class</div><div className="fw6">{first.cls || '—'}</div></div>
                <div><div className="t-xs muted">Guardian</div><div className="fw6">{student?.guardian || '—'}{student?.phone ? ` · ${student.phone}` : ''}</div></div>
              </div>
            </div>

            {payInv ? (
              <div className="col gap12" style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)' }}>
                <div className="row ai-center jc-between gap8 wrap">
                  <div className="fw6">Pay fee · {payInv.term || 'Fee'}{payInv.academicYear ? ` · ${payInv.academicYear}` : ''}</div>
                  <Btn size="sm" variant="ghost" icon="arrowLeft" onClick={() => setPayInv(null)}>Back to invoices</Btn>
                </div>
                <PaymentForm
                  invoice={payInv}
                  cur={cur}
                  schoolName={schoolName}
                  studentAdm={admOf(payInv)}
                  onDone={() => setPayInv(null)}
                  onCancel={() => setPayInv(null)}
                />
              </div>
            ) : (<>
            <div style={{ overflowX: 'auto' }}>
              <table className="sm-table">
                <thead>
                  <tr>
                    <th>Term</th><th>Due date</th>
                    <th className="ta-right">Total</th><th className="ta-right">Paid</th><th className="ta-right">Due</th>
                    <th>Status</th><th className="ta-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {studentInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="fw6">
                        {inv.term || '—'}{inv.academicYear ? <span className="t-xs muted"> · {inv.academicYear}</span> : null}
                        <div className="t-xs muted">{feeInvoiceNo(inv.id, inv.dueDate)}</div>
                      </td>
                      <td>{fmtDueDay(inv.dueDate)}</td>
                      <td className="ta-right">{fmtMoney(inv.total, cur)}</td>
                      <td className="ta-right">{fmtMoney(inv.paid, cur)}</td>
                      <td className="ta-right" style={{ color: inv.due > 0 ? 'var(--danger)' : undefined }}>{fmtMoney(inv.due, cur)}</td>
                      <td><Badge tone={feeTone[inv.status]} dot>{feeLabel[inv.status]}</Badge></td>
                      <td className="ta-right">
                        <div className="row gap6 jc-end">
                          {canRecord && inv.due > 0 && (
                            <Btn size="sm" variant="primary" icon="rupee" onClick={() => setPayInv(inv)}>Pay</Btn>
                          )}
                          <Btn size="sm" variant="ghost" icon="doc" onClick={() => printInvoices([inv], 'Fee invoice')}>Print</Btn>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="fw7">Total</td>
                    <td className="ta-right fw7">{fmtMoney(totals.total, cur)}</td>
                    <td className="ta-right fw7">{fmtMoney(totals.paid, cur)}</td>
                    <td className="ta-right fw7" style={{ color: totals.due > 0 ? 'var(--danger)' : undefined }}>{fmtMoney(totals.due, cur)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="row gap8 jc-end wrap">
              <Btn variant="secondary" icon="doc" onClick={() => printInvoices(studentInvoices, 'Fee statement')}>Print statement</Btn>
              <Btn variant="secondary" icon="download" onClick={downloadStatement}>Download statement</Btn>
              <Btn variant="secondary" icon="message" onClick={emailStatement}>Email statement</Btn>
            </div>

            <div className="col gap8" style={{ marginTop: 4 }}>
              <div className="fw6 t-sm">Payment history</div>
              {studentPayments.length === 0 ? (
                <div className="t-sm muted">No payments recorded yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="sm-table">
                    <thead>
                      <tr>
                        <th>Date</th><th>Fee type</th><th className="ta-right">Amount</th>
                        <th>Mode</th><th>Receipt no.</th><th className="ta-right">Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentPayments.map((p) => (
                        <tr key={p.id}>
                          <td className="muted">{fmtDueDay(p.date)}</td>
                          <td><Badge tone="brand">{p.headName || p.feeType || 'All fee types'}</Badge></td>
                          <td className="ta-right fw6">{fmtMoney(p.amount, cur)}</td>
                          <td><Badge tone="neutral">{p.mode}</Badge></td>
                          <td className="t-sm muted">{p.ref || '—'}</td>
                          <td className="ta-right">
                            <div className="row gap6 jc-end">
                              <Btn variant="ghost" size="sm" icon="download" onClick={() => downloadReceipt(p)}>Download</Btn>
                              <Btn variant="ghost" size="sm" icon="message" onClick={() => mailReceipt(p)}>Mail</Btn>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            </>)}
          </>
        )}
      </div>
    </Card>
  )
}

function FeesScreen() {
  const app = useApp()
  const cur = app.school.currency
  const canRecord = can(app.role, 'fees', 'E')
  const canWaive = can(app.role, 'fees', 'A')

  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [payRow, setPayRow] = useState<FeeInvoice | null>(null)
  const [waiveRow, setWaiveRow] = useState<FeeInvoice | null>(null)
  const [remindOpen, setRemindOpen] = useState(false)
  const [tab, setTab] = useState('collection')
  const [editVersionId, setEditVersionId] = useState<string | null>(null)

  const invoicesQ = useFeeInvoices()
  const studentsQ = useStudents()
  const studentsById = useMemo(() => {
    const m = new Map<string, Student>()
    for (const s of studentsQ.data ?? []) m.set(s.id, s)
    return m
  }, [studentsQ.data])
  /** Join SIS student row so Collection shows name / class / photo even when invoice API omits them. */
  const invoices = useMemo<FeeInvoice[]>(() => {
    return (invoicesQ.data ?? []).map((inv) => {
      const s = studentsById.get(inv.studentId)
      if (!s && inv.studentName && inv.cls) return inv
      return {
        ...inv,
        studentName: (inv.studentName || s?.name || '').trim(),
        cls: (inv.cls || s?.cls || '').trim(),
        grade: (inv.grade || s?.grade || '').trim(),
        studentAdm: inv.studentAdm?.trim() || s?.adm || inv.studentAdm,
        avatarHue: inv.avatarHue ?? s?.avatarHue,
        photoUrl: inv.photoUrl || studentPhotoUrl(inv.studentId) || undefined,
      }
    })
  }, [invoicesQ.data, studentsById])
  const admOf = (inv: FeeInvoice) =>
    inv.studentAdm?.trim()
    || studentsById.get(inv.studentId)?.adm
    || ''
  const summaryQ = useFeeReportSummary()
  const summary = summaryQ.data
  const latest = summary?.latestPayment

  const byClass = summary?.byClass ?? []

  const toast = useToast()
  const integrationsQ = useSchoolIntegrations()
  const razorpayReady = integrationsQ.data?.razorpay?.enabled && integrationsQ.data?.razorpay?.status === 'configured'
  const createOrder = useCreateFeeRazorpayOrder()
  const verifyPayment = useVerifyFeeRazorpayPayment()

  const collectOnline = async (invoice: FeeInvoice) => {
    try {
      const order = await createOrder.mutateAsync(invoice.id)
      const ok = await loadRazorpayScript()
      if (!ok || !window.Razorpay) {
        toast.info('Payment not started', 'Razorpay checkout did not load. Try again or collect offline.')
        return
      }
      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: app.school.name,
        description: `Fee payment · ${invoice.studentName} (${invoice.cls})`,
        handler: (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          verifyPayment.mutate({
            invoiceId: invoice.id,
            body: {
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            },
          }, {
            onSuccess: () => {
              toast.success('Payment received', `${invoice.studentName} (${invoice.cls}) paid online via Razorpay.`)
            },
            onError: (err) => { toast.danger('Verification failed', err instanceof Error ? err.message : 'Please try again.') },
          })
        },
        modal: {
          ondismiss: () => { toast.info('Payment not completed', 'Checkout closed — payment is still pending.') },
        },
      })
      rzp.open()
    } catch (err) {
      toast.danger('Could not start payment', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const sendPayLink = async (invoice: FeeInvoice) => {
    try {
      const order = await createOrder.mutateAsync(invoice.id)
      if (order.payLink) {
        if (typeof navigator !== 'undefined' && navigator.clipboard) await navigator.clipboard.writeText(order.payLink).catch(() => {})
        toast.success('Pay link copied', `Share it with ${invoice.studentName}'s parent to collect online.`)
      } else {
        toast.info('Pay link unavailable', 'The server did not return a shareable pay link for this order.')
      }
    } catch (err) {
      toast.danger('Could not create pay link', err instanceof Error ? err.message : 'Please try again.')
    }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (needle) {
        const adm = admOf(inv).toLowerCase()
        const hit = inv.studentName.toLowerCase().includes(needle)
          || inv.cls.toLowerCase().includes(needle)
          || adm.includes(needle)
        if (!hit) return false
      }
      if (status !== 'all' && inv.status !== status) return false
      return true
    })
  }, [invoices, q, status, studentsQ.data])

  const exportCsv = () => {
    if (!rows.length) {
      toast.info('Nothing to export', 'No invoices match the current search / status filter.')
      return
    }
    const csv = invoicesToCsv(rows, admOf)
    const day = new Date().toISOString().slice(0, 10)
    downloadTextFile(`fees-collection-${day}.csv`, csv)
    toast.success('Export ready', `${rows.length} invoice row(s) downloaded.`)
  }

  const columns: Column<FeeInvoice>[] = [
    {
      key: 'name', label: 'Student', sortValue: (r) => r.studentName,
      render: (r) => {
        const name = r.studentName || '—'
        const photo = r.photoUrl || studentPhotoUrl(r.studentId)
        const hue = r.avatarHue ?? studentsById.get(r.studentId)?.avatarHue
        return (
          <div className="row ai-center gap10">
            <Avatar name={name} hue={hue} size={34} src={photo} />
            <div>
              <div className="fw6">{properName(name)}</div>
              {r.cls ? <div className="t-xs muted">{r.cls}</div> : null}
            </div>
          </div>
        )
      },
    },
    {
      key: 'adm', label: 'Student ID', sortValue: (r) => admOf(r),
      render: (r) => <span className="t-sm">{admOf(r) || '—'}</span>,
    },
    {
      key: 'cls', label: 'Class', sortValue: (r) => r.cls,
      render: (r) => <span className="t-sm">{r.cls || '—'}</span>,
    },
    {
      key: 'term', label: 'Term fee', align: 'right', sortValue: (r) => r.total,
      render: (r) => (
        <div>
          {r.term && <div className="t-xs fw6 muted">{r.term}</div>}
          <div>{fmtMoney(r.total, cur)}</div>
          {r.lines.length > 0 && (
            <div className="t-xs muted">
              {r.lines.map((l) => `${l.headName} ${fmtMoney(l.amount, cur)}`).join(' · ')}
            </div>
          )}
        </div>
      ),
    },
    { key: 'paid', label: 'Paid', align: 'right', sortValue: (r) => r.paid, render: (r) => fmtMoney(r.paid, cur) },
    {
      key: 'due', label: 'Due', align: 'right', sortValue: (r) => r.due,
      render: (r) => <span className={r.due > 0 ? 'fw6' : 'muted'} style={r.due > 0 ? { color: 'var(--danger)' } : undefined}>{fmtMoney(r.due, cur)}</span>,
    },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status,
      render: (r) => <Badge tone={feeTone[r.status]} dot>{feeLabel[r.status]}</Badge>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => (
        <div className="row gap6 jc-end">
          {canRecord && razorpayReady && r.due > 0 && (
            <Btn size="sm" variant="secondary" icon="zap" disabled={createOrder.isPending} onClick={() => { void collectOnline(r) }}>Collect online</Btn>
          )}
          {canRecord && razorpayReady && r.due > 0 && (
            <Btn size="sm" variant="ghost" icon="clipboard" disabled={createOrder.isPending} onClick={() => { void sendPayLink(r) }}>Send pay link</Btn>
          )}
          {canRecord && <Btn size="sm" variant="secondary" icon="rupee" onClick={() => setPayRow(r)}>Pay fee</Btn>}
          {canWaive && r.due > 0 && <Btn size="sm" variant="ghost" icon="shield" onClick={() => setWaiveRow(r)}>Waiver discount</Btn>}
          {!canRecord && !canWaive && <span className="t-xs muted">—</span>}
        </div>
      ),
    },
  ]

  const searchHit = q.trim() && rows.length === 1 ? rows[0] : null

  return (
    <div>
      <PageHead
        title="Fees collection"
        sub={`${app.school.name} · ${summary?.pct ?? 0}% of term billed collected`}
        actions={
          canRecord ? (
            <>
              <Btn variant="primary" icon="rupee" onClick={() => setTab('pay')}>Pay fees</Btn>
              <Btn variant="secondary" icon="bell" onClick={() => setRemindOpen(true)}>Send reminders</Btn>
              <Btn variant="secondary" icon="download" onClick={exportCsv}>Export</Btn>
            </>
          ) : undefined
        }
      />

      <div style={{ marginBottom: 16 }}>
        <Tabs value={tab} onChange={setTab} tabs={[
          { value: 'collection', label: 'Collection', icon: 'wallet' },
          { value: 'pay', label: 'Pay fees', icon: 'rupee' },
          { value: 'history', label: 'History', icon: 'clock' },
          { value: 'structure', label: 'Structure', icon: 'rupee' },
          { value: 'structure-versions', label: 'Saved versions', icon: 'doc' },
        ]} />
      </div>

      {tab === 'pay' && (
        <StudentFeesPanel
          invoices={invoices}
          admOf={admOf}
          studentsById={studentsById}
          cur={cur}
          schoolName={app.school.name}
          canRecord={canRecord}
        />
      )}
      {tab === 'history' && <FeeHistoryTab cur={cur} />}
      {tab === 'structure-versions' && (
        <FeeStructureHistoryTab
          editable={canRecord}
          onEdit={(id) => { setEditVersionId(id); setTab('structure') }}
        />
      )}
      {tab === 'structure' && (
        <FeeStructureTab
          cur={cur}
          editable={canRecord}
          onGenerated={() => { setEditVersionId(null); setTab('collection') }}
          loadVersionId={editVersionId}
          onDoneEditing={() => setEditVersionId(null)}
        />
      )}

      {tab === 'collection' && (<>
      {/* Live "payment received" cue — only when summary has a real payment today */}
      {latest && latest.amount > 0 && (
        <Card className="row ai-center jc-between gap12 wrap" style={{ marginBottom: 16, borderColor: 'var(--success)' }}>
          <div className="row ai-center gap10">
            <span className="sm-dot-live" />
            <span className="sm-kpi-ic" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}><Icon name="rupee" size={18} /></span>
            <div>
              <div className="fw6">Payment received · {fmtMoney(latest.amount, cur)}</div>
              <div className="t-xs muted">
                {properName(latest.studentName || 'Student')}
                {latest.cls ? ` (${latest.cls})` : ''}
                {latest.mode ? ` · via ${latest.mode}` : ''}
                {latest.date ? ` · ${paymentDateIso(latest.date) === localDateIso() ? 'today' : paymentDateIso(latest.date)}` : ''}
              </div>
            </div>
          </div>
          <Badge tone="success" soft>Today</Badge>
        </Card>
      )}

      {/* KPIs */}
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="rupee" iconBg="var(--success-bg)" iconColor="var(--success)" label="Collected today" value={fmtMoney(summary?.collectedToday ?? 0, cur)} foot="so far today" />
        <Kpi icon="wallet" iconBg="var(--brand-50)" iconColor="var(--brand-600)" label="Collected this term" value={fmtMoney(summary?.collectedTerm ?? 0, cur)} delta={`${summary?.pct ?? 0}%`} deltaDir="up" foot={`of ${fmtMoney(summary?.billedTerm ?? 0, cur)} billed`} />
        <Kpi icon="alert" iconBg="var(--warning-bg)" iconColor="var(--warning)" label="Outstanding dues" value={fmtMoney(summary?.outstanding ?? 0, cur)} foot="across all classes" />
        <Kpi icon="users" iconBg="var(--danger-bg)" iconColor="var(--danger)" label="Pending dues" value={fmtNum(summary?.defaulters ?? 0)} foot="students with unpaid fees" />
      </div>

      {/* Collection by class */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Collection by class" sub="Share of term fee collected" icon="trend" />
        <div style={{ marginTop: 12 }}>
          <Bars data={byClass} h={150} color="var(--success)" valueFmt={(v) => `${v}%`} />
        </div>
      </Card>

      {/* Table */}
      <Card pad={false}>
        <div className="col gap12" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div className="row ai-end gap12 wrap">
            <div style={{ flex: 1, minWidth: 240 }}>
              <Field label="Student search" hint="Name, class, or Student ID — fields fill when one student matches.">
                <Search value={q} onChange={setQ} placeholder="e.g. Rahul or STU/26/0001" />
              </Field>
            </div>
            <div style={{ minWidth: 140 }}>
              <Field label="Status">
                <Select
                  options={[{ value: 'all', label: 'All status' }, { value: 'paid', label: 'Paid' }, { value: 'partial', label: 'Partial' }, { value: 'due', label: 'Due' }]}
                  value={status} onChange={(e) => setStatus(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {searchHit && (
            <div className="row ai-center jc-between gap12 wrap" style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              <div className="row gap16 wrap" style={{ flex: 1 }}>
                <div>
                  <div className="t-xs muted">Student</div>
                  <div className="fw6">{properName(searchHit.studentName)}</div>
                </div>
                <div>
                  <div className="t-xs muted">Student ID</div>
                  <div className="fw6">{admOf(searchHit) || '—'}</div>
                </div>
                <div>
                  <div className="t-xs muted">Class</div>
                  <div className="fw6">{searchHit.cls}</div>
                </div>
                <div>
                  <div className="t-xs muted">Due</div>
                  <div className="fw6" style={{ color: searchHit.due > 0 ? 'var(--danger)' : undefined }}>{fmtMoney(searchHit.due, cur)}</div>
                </div>
                <div>
                  <div className="t-xs muted">Status</div>
                  <Badge tone={feeTone[searchHit.status]} dot>{feeLabel[searchHit.status]}</Badge>
                </div>
              </div>
              {canRecord && (
                <Btn size="sm" variant="primary" icon="rupee" onClick={() => setPayRow(searchHit)}>Pay fee</Btn>
              )}
            </div>
          )}
        </div>
        <DataTable<FeeInvoice>
          columns={columns}
          rows={rows}
          pageSize={10}
          rowKey={(r) => r.id}
          onRowDoubleClick={(r) => app.go('school.student', { focus: r.studentId })}
          initialSort={{ key: 'due', dir: 'desc' }}
          empty={
            <Empty
              icon="wallet"
              title="No invoices yet"
              body="Go to Structure → add fee types & amounts → Save & generate. Then search a student here to record payment."
              action={canRecord ? (
                <Btn variant="primary" icon="rupee" onClick={() => setTab('structure')}>Open Structure</Btn>
              ) : undefined}
            />
          }
        />
      </Card>

      </>)}

      {payRow && (
        <PaymentModal
          key={payRow.id}
          invoice={payRow}
          cur={cur}
          schoolName={app.school.name}
          studentAdm={admOf(payRow)}
          onClose={() => setPayRow(null)}
        />
      )}
      {waiveRow && <WaiverModal key={waiveRow.id} invoice={waiveRow} cur={cur} onClose={() => setWaiveRow(null)} />}
      {remindOpen && (
        <RemindersModal
          dueInvoices={rows.filter((r) => r.due > 0)}
          allDueInvoices={invoices.filter((r) => r.due > 0)}
          defaultersCount={summary?.defaulters ?? 0}
          schoolName={app.school.name}
          currency={cur}
          onClose={() => setRemindOpen(false)}
        />
      )}
    </div>
  )
}

/* ============================================================
   HR & Payroll (Gold) — owned by the Admin office
   ============================================================ */
/** Stable avatar hue from a person id/name so colours persist across renders. */
function nameHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  return h
}

function PayrollBody() {
  const app = useApp()
  const [tab, setTab] = useState<'run' | 'structure'>('run')

  return (
    <div>
      <PageHead
        title="HR & Payroll"
        sub={`${app.school.name} · ${periodLabel(currentPeriod())} cycle · Prepared by Admin office`}
      />

      <div style={{ marginBottom: 16 }}>
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as 'run' | 'structure')}
          tabs={[
            { value: 'run', label: 'Payroll run', icon: 'wallet' },
            { value: 'structure', label: 'Salary structure', icon: 'rupee' },
          ]}
        />
      </div>

      {tab === 'run' ? <PayrollRunTab /> : <SalaryStructureTab />}
    </div>
  )
}

function PayrollRunTab() {
  const app = useApp()
  const cur = app.school.currency
  const canRun = can(app.role, 'hr', 'E')
  const canApprove = can(app.role, 'hr', 'A')
  const toast = useToast()
  const [q, setQ] = useState('')
  const period = useMemo(() => currentPeriod(), [])

  const runQuery = usePayrollRun(period)
  const runMut = useRunPayroll()
  const approveMut = useApprovePayroll()
  const summaryQ = useFeeReportSummary()
  const [payslip, setPayslip] = useState<PayrollLine | null>(null)

  const run = runQuery.data
  const status = run?.status ?? 'draft'
  const ran = status === 'run' || status === 'approved'
  const approved = status === 'approved'

  // Until a cycle is approved, show LIVE figures re-priced from the current salary
  // structures/profiles — so setting a salary reflects immediately without a re-run.
  // Once approved, show the frozen approved snapshot.
  const previewQ = usePayrollPreview(period, ran && !approved)
  const preview = previewQ.data
  const view = (ran && !approved && preview) ? preview : run
  const lines = view?.lines ?? []

  // The prepared snapshot differs from current salaries (informational only — display is live).
  const stale = !!preview && ran && !approved && (
    preview.net !== (run?.net ?? 0) ||
    preview.gross !== (run?.gross ?? 0) ||
    preview.staffCount !== (run?.staffCount ?? 0)
  )

  const totals = {
    count: view?.staffCount ?? lines.length,
    gross: view?.gross ?? 0,
    ded: view?.deductions ?? 0,
    net: view?.net ?? 0,
  }

  // Revenue vs payroll — fees collected this term against this month's net payroll.
  const revenue = summaryQ.data?.collectedTerm ?? 0
  const remaining = revenue - totals.net
  const payrollShare = revenue > 0 ? Math.round((totals.net / revenue) * 100) : 0

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return lines
    return lines.filter((r) =>
      r.name.toLowerCase().includes(needle) ||
      (r.role ?? '').toLowerCase().includes(needle) ||
      (r.dept ?? '').toLowerCase().includes(needle))
  }, [lines, q])

  const runPayrollNow = () => {
    runMut.mutate(period, {
      onSuccess: () => toast.success(
        'Payroll run',
        canApprove
          ? 'Prepared. You can approve it now for disbursal.'
          : 'Prepared by Admin office. Sent to the Principal for approval.',
      ),
      onError: (e) => toast.danger('Could not run payroll', e.message),
    })
  }
  const approve = () => {
    approveMut.mutate(period, {
      onSuccess: (r) => toast.success('Payroll approved', `${periodLabel(period)} · ${fmtMoney(r.net, cur)} net cleared for disbursal.`),
      onError: (e) => toast.danger('Could not approve', e.message),
    })
  }

  const statusBadge = approved
    ? <Badge tone="success" icon="check">Approved</Badge>
    : ran
      ? <Badge tone="info" dot>{canApprove ? 'Ready to approve' : 'Awaiting Principal approval'}</Badge>
      : <Badge tone="warning" dot>{canRun ? 'Ready to run' : 'Awaiting Admin to run'}</Badge>

  const columns: Column<PayrollLine>[] = [
    {
      key: 'name', label: 'Staff', sortValue: (r) => r.name,
      render: (r) => (
        <div className="row ai-center gap10">
          <Avatar name={r.name} hue={nameHue(r.personId || r.name)} size={34} />
          <div>
            <div className="fw6">{r.name}</div>
            <div className="t-xs muted">{r.personType === 'teacher' ? 'Teacher' : r.personType === 'leadership' ? 'Leadership' : 'Staff'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role', label: 'Role / Dept', sortValue: (r) => r.dept ?? '',
      render: (r) => (
        <div>
          <div className="fw6">{r.role || '—'}</div>
          <div className="t-xs muted">{r.dept || '—'}</div>
        </div>
      ),
    },
    { key: 'gross', label: 'Gross', align: 'right', sortValue: (r) => r.gross, render: (r) => fmtMoney(r.gross, cur) },
    { key: 'deductions', label: 'Deductions', align: 'right', sortValue: (r) => r.deductions, render: (r) => <span className="muted">− {fmtMoney(r.deductions, cur)}</span> },
    { key: 'net', label: 'Net pay', align: 'right', sortValue: (r) => r.net, render: (r) => <span className="fw7">{fmtMoney(r.net, cur)}</span> },
    {
      key: 'payslip', label: '', align: 'right', sortValue: () => 0,
      render: (r) => (
        <Btn size="sm" variant="ghost" icon="doc" onClick={() => setPayslip(r)}>Payslip</Btn>
      ),
    },
  ]

  const exportCsv = () => {
    if (!run || lines.length === 0) return
    downloadTextFile(payrollCsvFileName(run), payrollRunToCsv(run))
    toast.success('Payroll exported', `${lines.length} rows · ${payrollCsvFileName(run)}`)
  }

  const busy = runMut.isPending || approveMut.isPending

  return (
    <div>
      {/* Ownership note + run controls */}
      <Card className="row ai-center gap10 wrap" style={{ marginBottom: 16 }}>
        <span className="sm-kpi-ic" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><Icon name="briefcase" size={18} /></span>
        <div className="t-sm" style={{ flex: 1, minWidth: 220 }}>
          <span className="fw6">HR is handled by the Admin office.</span>{' '}
          <span className="muted">
            {canRun && canApprove
              ? 'As Owner you can run and approve payroll yourself. '
              : 'Admin runs the monthly payroll; the Principal approves before disbursal. '}
            Pay comes from each person&rsquo;s profile, or the salary structure for their role. Principal &amp; Owner are included once you set their pay under Salary structure.
          </span>
        </div>
        <div className="row ai-center gap8 wrap">
          {statusBadge}
          <Btn variant="primary" icon="refresh" disabled={!canRun || approved || busy} onClick={runPayrollNow}>
            {runMut.isPending ? 'Running…' : ran ? 'Re-run' : 'Run payroll'}
          </Btn>
          <Btn variant="success" icon="check" disabled={!canApprove || !ran || approved || busy} onClick={approve}>
            {approveMut.isPending ? 'Approving…' : 'Approve'}
          </Btn>
        </div>
      </Card>

      {/* Live-figures note: display already reflects current salaries; approve locks them. */}
      {stale && (
        <Card className="row ai-center gap10 wrap" style={{ marginBottom: 16, borderColor: 'var(--info)', background: 'var(--info-bg)' }}>
          <span className="sm-kpi-ic" style={{ background: 'var(--info-bg)', color: 'var(--info)' }}><Icon name="eye" size={18} /></span>
          <div className="t-sm" style={{ flex: 1, minWidth: 220 }}>
            <span className="fw6">Showing live figures from your current salary structure.</span>{' '}
            <span className="muted">
              The prepared run recorded {fmtMoney(run?.net ?? 0, cur)} net; the current figure is{' '}
              <span className="fw6">{fmtMoney(preview?.net ?? 0, cur)}</span> net for {preview?.staffCount ?? 0} staff.
              Approving locks the current figure — or Re-run to refresh the prepared snapshot.
            </span>
          </div>
          <Btn variant="secondary" icon="refresh" disabled={!canRun || busy} onClick={runPayrollNow}>
            {runMut.isPending ? 'Running…' : 'Re-run'}
          </Btn>
        </Card>
      )}

      {/* Revenue vs payroll — what's left after salaries */}
      <Card style={{ marginBottom: 16 }}>
        <CardHead title="Revenue vs payroll" icon="rupee" sub="Fees collected this term against this month's net payroll" />
        <div className="sm-revpay" style={{ marginTop: 12 }}>
          <div className="sm-revpay-cell">
            <div className="t-xs muted">Revenue collected (term)</div>
            <div className="sm-revpay-val">{fmtMoney(revenue, cur)}</div>
          </div>
          <div className="sm-revpay-op">−</div>
          <div className="sm-revpay-cell">
            <div className="t-xs muted">Net payroll (this month)</div>
            <div className="sm-revpay-val" style={{ color: 'var(--warning)' }}>{fmtMoney(totals.net, cur)}</div>
          </div>
          <div className="sm-revpay-op">=</div>
          <div className="sm-revpay-cell">
            <div className="t-xs muted">Remaining · your amount</div>
            <div className="sm-revpay-val" style={{ color: remaining >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {fmtMoney(remaining, cur)}
            </div>
          </div>
        </div>
        <div className="sm-revpay-bar" title={`Payroll is ${payrollShare}% of collected revenue`}>
          <div
            className="sm-revpay-bar-fill"
            style={{ width: `${Math.min(100, Math.max(0, payrollShare))}%`, background: payrollShare > 100 ? 'var(--danger)' : 'var(--brand-500)' }}
          />
        </div>
        <div className="t-xs muted" style={{ marginTop: 6 }}>
          Payroll is <span className="fw6">{payrollShare}%</span> of fees collected this term.
          {revenue === 0 && ' Collect fees to see the balance.'}
        </div>
      </Card>

      {/* KPIs */}
      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="users" iconBg="var(--brand-50)" iconColor="var(--brand-600)" label="Staff on payroll" value={fmtNum(totals.count)} foot="teaching + support" />
        <Kpi icon="wallet" iconBg="var(--info-bg)" iconColor="var(--info)" label="Gross payroll" value={fmtMoney(totals.gross, cur)} foot="before deductions" />
        <Kpi icon="rupee" iconBg="var(--success-bg)" iconColor="var(--success)" label="Net payable" value={fmtMoney(totals.net, cur)} foot={`${fmtMoney(totals.ded, cur)} deductions`} />
        <Kpi icon="clock" iconBg="var(--warning-bg)" iconColor="var(--warning)" label="Pending" value={approved ? fmtMoney(0, cur) : fmtMoney(totals.net, cur)} foot={approved ? 'cleared' : ran ? (canApprove ? 'ready to approve' : 'awaiting approval') : (canRun ? 'ready to run' : 'awaiting Admin to run')} />
      </div>

      {/* Run table */}
      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Search value={q} onChange={setQ} placeholder="Search staff, role, department…" style={{ flex: 1, minWidth: 220 }} />
          <span className="t-sm muted">{rows.length} of {lines.length} staff</span>
          <Btn size="sm" variant="secondary" icon="download" disabled={lines.length === 0} onClick={exportCsv}>Export CSV</Btn>
        </div>
        <DataTable<PayrollLine>
          columns={columns}
          rows={rows}
          pageSize={10}
          rowKey={(r) => `${r.personType}:${r.personId}`}
          initialSort={{ key: 'net', dir: 'desc' }}
          empty={<Empty icon="briefcase" title="No staff on payroll" body="Add teachers and staff, then set each person's salary in their profile — or define a salary structure for their role." />}
        />
      </Card>

      {payslip && (
        <PayslipModal
          line={payslip}
          cur={cur}
          periodText={periodLabel(period)}
          status={status}
          schoolName={app.school.name}
          schoolCity={app.school.city}
          logoUrl={app.school.logoUrl}
          logoInitials={app.school.logo}
          brandColor={app.school.color}
          onClose={() => setPayslip(null)}
        />
      )}
    </div>
  )
}

function PayslipModal({
  line, cur, periodText, status, schoolName, schoolCity, logoUrl, logoInitials, brandColor, onClose,
}: {
  line: PayrollLine
  cur: string
  periodText: string
  status: string
  schoolName: string
  schoolCity?: string
  logoUrl?: string | null
  logoInitials?: string
  brandColor?: string
  onClose: () => void
}) {
  const earn = (label: string, amt: number) => amt > 0 && (
    <div className="row ai-center jc-between" style={{ padding: '5px 0' }}>
      <span className="muted">{label}</span><span className="fw6">{fmtMoney(amt, cur)}</span>
    </div>
  )
  const ded = (label: string, amt: number) => amt > 0 && (
    <div className="row ai-center jc-between" style={{ padding: '5px 0' }}>
      <span className="muted">{label}</span><span className="fw6">− {fmtMoney(amt, cur)}</span>
    </div>
  )
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      icon="doc"
      title={`Payslip · ${line.name}`}
      sub={`${periodText} · ${line.role || (line.personType === 'teacher' ? 'Teacher' : line.personType === 'leadership' ? 'Leadership' : 'Staff')}`}
      footer={
        <div className="row ai-center jc-between wrap gap8" style={{ width: '100%' }}>
          <span className="t-sm muted">Net pay <span className="fw7" style={{ color: 'var(--success)' }}>{fmtMoney(line.net, cur)}</span></span>
          <div className="row ai-center gap8">
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
            <Btn variant="primary" icon="download" onClick={() => downloadPayslip(line, { schoolName, schoolCity, periodLabel: periodText, currency: cur, status, logoUrl, logoInitials, brandColor }, periodText)}>Download PDF</Btn>
          </div>
        </div>
      }
    >
      <div className="sm-grid-2 gap16">
        <Card>
          <div className="fw7" style={{ marginBottom: 6 }}>Earnings</div>
          {earn('Basic', line.basic)}
          {earn('HRA', line.hra)}
          {earn('Allowances', line.allowances)}
          <div className="row ai-center jc-between" style={{ paddingTop: 8, marginTop: 4, borderTop: '2px solid var(--border)' }}>
            <span className="fw7">Gross</span><span className="fw7">{fmtMoney(line.gross, cur)}</span>
          </div>
        </Card>
        <Card>
          <div className="fw7" style={{ marginBottom: 6 }}>Deductions</div>
          {ded('EPF', line.epf)}
          {ded('Professional tax', line.profTax)}
          {ded('Other deductions', line.otherDeductions)}
          {line.deductions === 0 && <div className="t-sm muted" style={{ padding: '5px 0' }}>No deductions</div>}
          <div className="row ai-center jc-between" style={{ paddingTop: 8, marginTop: 4, borderTop: '2px solid var(--border)' }}>
            <span className="fw7">Total</span><span className="fw7">− {fmtMoney(line.deductions, cur)}</span>
          </div>
        </Card>
      </div>
    </Modal>
  )
}

/* ---------- Salary structure editor (templates by role / designation) ---------- */
type StructDraft = SalaryComponents & { dirty?: boolean }

function structKey(type: PersonType, roleKey: string): string {
  return `${type}:${roleKey.trim().toLowerCase()}`
}

function SalaryStructureTab() {
  const app = useApp()
  const cur = app.school.currency
  const canEdit = can(app.role, 'hr', 'E')
  const toast = useToast()
  const structuresQ = useSalaryStructures()
  const upsertMut = useUpsertSalaryStructure()
  const teachersQ = useTeachers()
  const staffQ = useStaff()
  // Leadership headcount comes from CRM login users (admin/owner may read the list).
  const canReadUsers = app.role === 'owner' || app.role === 'admin'
  const usersQ = useQuery({
    queryKey: queryKeys.users.all,
    queryFn: listSchoolUsers,
    enabled: canReadUsers,
  })

  const saved = useMemo(() => {
    const m = new Map<string, SalaryStructure>()
    for (const s of structuresQ.data ?? []) m.set(structKey(s.personType, s.roleKey), s)
    return m
  }, [structuresQ.data])

  // How many people currently hold each role/designation (impact of a template).
  const headcount = useMemo(() => {
    const m = new Map<string, number>()
    const bump = (type: PersonType, roleKey: string) => {
      const k = structKey(type, roleKey)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    for (const t of teachersQ.data ?? []) if (t.desig) bump('teacher', t.desig)
    for (const s of staffQ.data ?? []) if (s.role) bump('staff', s.role)
    for (const u of usersQ.data ?? []) {
      const roles = u.roles.map((r) => fromApiRole(r))
      // Owner takes precedence over Principal when a user holds both (mirrors the backend).
      if (roles.includes('owner')) bump('leadership', 'Owner')
      else if (roles.includes('principal')) bump('leadership', 'Principal')
    }
    return m
  }, [teachersQ.data, staffQ.data, usersQ.data])

  // draft edits, keyed by `${type}:${roleKey}`
  const [draft, setDraft] = useState<Record<string, StructDraft>>({})

  const componentsFor = (type: PersonType, roleKey: string): SalaryComponents => {
    const k = structKey(type, roleKey)
    const d = draft[k]
    if (d) return d
    const s = saved.get(k)
    return s
      ? { basic: s.basic, hra: s.hra, allowances: s.allowances, epf: s.epf, profTax: s.profTax, otherDeductions: s.otherDeductions }
      : { basic: 0, hra: 0, allowances: 0, epf: 0, profTax: 0, otherDeductions: 0 }
  }

  const setField = (type: PersonType, roleKey: string, field: keyof SalaryComponents, value: string) => {
    const k = structKey(type, roleKey)
    setDraft((prev) => ({
      ...prev,
      [k]: { ...componentsFor(type, roleKey), ...prev[k], [field]: toAmount(value), dirty: true },
    }))
  }

  const saveRow = (type: PersonType, roleKey: string) => {
    const c = componentsFor(type, roleKey)
    upsertMut.mutate(
      { personType: type, roleKey, ...c },
      {
        onSuccess: () => {
          setDraft((prev) => {
            const next = { ...prev }
            delete next[structKey(type, roleKey)]
            return next
          })
          toast.success('Salary structure saved', `${roleKey} · ${fmtMoney(computeSalary(c).net, cur)} net / month.`)
        },
        onError: (e) => toast.danger('Could not save structure', e.message),
      },
    )
  }

  const renderSection = (type: PersonType, title: string, icon: string, roles: readonly string[]) => {
    const extra = (structuresQ.data ?? [])
      .filter((s) => s.personType === type && !roles.some((r) => r.toLowerCase() === s.roleKey.toLowerCase()))
      .map((s) => s.roleKey)
    const allRoles = [...roles, ...extra]

    // Estimated monthly cost if every person in these roles were paid by the structure.
    let people = 0
    let monthlyCost = 0
    for (const roleKey of allRoles) {
      const n = headcount.get(structKey(type, roleKey)) ?? 0
      people += n
      monthlyCost += computeSalary(componentsFor(type, roleKey)).net * n
    }

    return (
      <Card pad={false} style={{ marginBottom: 16 }}>
        <CardHead title={title} icon={icon} sub={`${allRoles.length} roles · ${people} people · net is auto-computed`} />
        <div className="sm-struct-table">
          <div className="sm-struct-row sm-struct-head">
            <div>Role</div>
            <div className="ar">People</div>
            <div className="ar">Basic</div>
            <div className="ar">HRA</div>
            <div className="ar">Allowances</div>
            <div className="ar">EPF</div>
            <div className="ar">Prof. tax</div>
            <div className="ar">Other ded.</div>
            <div className="ar">Gross</div>
            <div className="ar">Net / month</div>
            <div />
          </div>
          {allRoles.map((roleKey) => {
            const c = componentsFor(type, roleKey)
            const { gross, net } = computeSalary(c)
            const k = structKey(type, roleKey)
            const isDirty = !!draft[k]?.dirty
            const n = headcount.get(k) ?? 0
            const num = (field: keyof SalaryComponents) => (
              <input
                className="sm-struct-input"
                type="number"
                min={0}
                value={c[field] || ''}
                placeholder="0"
                disabled={!canEdit}
                onChange={(e) => setField(type, roleKey, field, e.target.value)}
              />
            )
            return (
              <div className="sm-struct-row" key={k}>
                <div className="fw6">{roleKey}</div>
                <div className="ar">{n > 0 ? <Badge tone="info">{n}</Badge> : <span className="muted">0</span>}</div>
                <div className="ar">{num('basic')}</div>
                <div className="ar">{num('hra')}</div>
                <div className="ar">{num('allowances')}</div>
                <div className="ar">{num('epf')}</div>
                <div className="ar">{num('profTax')}</div>
                <div className="ar">{num('otherDeductions')}</div>
                <div className="ar">{fmtMoney(gross, cur)}</div>
                <div className="ar fw7">{fmtMoney(net, cur)}</div>
                <div className="ar">
                  <Btn
                    size="sm"
                    variant={isDirty ? 'primary' : 'ghost'}
                    icon="check"
                    disabled={!canEdit || !isDirty || upsertMut.isPending}
                    onClick={() => saveRow(type, roleKey)}
                  >
                    Save
                  </Btn>
                </div>
              </div>
            )
          })}
        </div>
        <div className="row ai-center jc-between wrap" style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <span className="t-sm muted">Est. monthly cost by structure · {people} people in these roles</span>
          <span className="fw7">{fmtMoney(monthlyCost, cur)}</span>
        </div>
      </Card>
    )
  }

  return (
    <div>
      <Card className="row ai-center gap10 wrap" style={{ marginBottom: 16 }}>
        <span className="sm-kpi-ic" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><Icon name="layers" size={18} /></span>
        <div className="t-sm">
          <span className="fw6">Salary structure by role &amp; designation.</span>{' '}
          <span className="muted">
            Set a default pay package per role once. Anyone with that role inherits it automatically when payroll runs —
            unless they have their own salary on their profile, which always wins.
          </span>
        </div>
      </Card>

      {renderSection('teacher', 'Teaching staff — by designation', 'book', TEACHER_DESIGNATIONS)}
      {renderSection('staff', 'Support staff — by role', 'users', STAFF_ROLES)}
      {renderSection('leadership', 'Leadership — Principal & Owner', 'briefcase', LEADERSHIP_ROLES)}
    </div>
  )
}

function PayrollScreen() {
  return (
    <TierGate feature="hr_payroll" title="HR & Payroll" blurb="HR & Payroll is part of the Platinum plan.">
      <PayrollBody />
    </TierGate>
  )
}

/* ---------- export contract ---------- */
export const financeScreens: Record<string, ComponentType> = {
  'school.fees': FeesScreen,
  'school.hr': PayrollScreen,
}
