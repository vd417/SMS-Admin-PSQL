/* ============================================================
   SchoolMate — Owner console: Cross-school reports +
   Subscriptions & billing.
   Both screens use live portfolio schools (/me/schools or /clients).
   ============================================================ */
import { useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useApp } from '@/lib/hooks'
import {
  PageHead, Tabs, Card, CardHead, Kpi, Badge, TierPill, Segmented, Btn, Icon, Modal,
  HBars, Legend, Donut, DataTable, Empty, Spinner,
  type Column, type BadgeTone,
} from '@/components/ui'
import { TIERS, TIER_META } from '@/data/mockDb'
import { fmtMoney, fmtNum } from '@/lib/format'
import type { School, Tier } from '@/types'
import { usePortfolioSchools, useOwnerPlans, useMyUpgradeRequests, useOwnerFeeSummary } from '@/api/hooks/useOwner'
import { clientToSchool } from '@/api/ownerMap'
import { listInvoices, listMySchoolInvoices, downloadInvoicePdf, myInvoicePdfPath, platformInvoicePdfPath, type ApiInvoice } from '@/api/billing'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
import { listSeatRequests, approveSeatRequest, rejectSeatRequest } from '@/api/clients'
import { listMySchoolSeatRequests } from '@/api/mySchools'
import { useToast } from '@/lib/hooks'
import { ApiError } from '@/api/ApiError'
import type { Plan, FeeSchoolSummary } from '@/api/ownerTypes'
import { UpgradePlanModal } from '@/screens/owner/UpgradePlanModal'
import { IncreaseSeatsModal } from '@/screens/owner/IncreaseSeatsModal'
import type { PlanUpgradeRequest, UpgradeStatus } from '@/api/upgradeRequests'
import { SchoolMark } from '@/components/SchoolMark'

/* compact ₹ for charts/KPIs */
function compactMoney(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L'
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'k'
  return '₹' + n
}

const statusTone: Record<School['status'], BadgeTone> = { active: 'success', trial: 'info', past_due: 'danger' }
const statusLabel: Record<School['status'], string> = { active: 'Active', trial: 'Trial', past_due: 'Past due' }

/* ============================================================
   OwnerReports — live portfolio + student fee comparison
   ============================================================ */
type Metric = 'enrolment' | 'staff' | 'subscription' | 'fees_collected' | 'fees_outstanding' | 'fee_rate'

interface MetricMeta {
  label: string
  short: string
  sum: boolean
  isFee: boolean
  fmt: (v: number) => string
}
const METRIC_META: Record<Metric, MetricMeta> = {
  enrolment: { label: 'Enrolment', short: 'students', sum: true, isFee: false, fmt: (v) => fmtNum(Math.round(v)) },
  staff: { label: 'Staff', short: 'staff', sum: true, isFee: false, fmt: (v) => fmtNum(Math.round(v)) },
  subscription: { label: 'Subscription MRR', short: 'MRR', sum: true, isFee: false, fmt: (v) => compactMoney(Math.round(v)) },
  fees_collected: { label: 'Student fees collected', short: 'collected', sum: true, isFee: true, fmt: (v) => fmtMoney(Math.round(v)) },
  fees_outstanding: { label: 'Student fees outstanding', short: 'outstanding', sum: true, isFee: true, fmt: (v) => fmtMoney(Math.round(v)) },
  fee_rate: { label: 'Fee collection rate', short: 'rate', sum: false, isFee: true, fmt: (v) => `${v.toFixed(1)}%` },
}

function feeRowForSchool(school: School, feeSchools: FeeSchoolSummary[]): FeeSchoolSummary | undefined {
  return feeSchools.find((f) => f.tenant_id === school.id || (school.slug && f.tenant_id === school.slug))
}

function metricValue(school: School, fee: FeeSchoolSummary | undefined, metric: Metric): number {
  switch (metric) {
    case 'enrolment': return school.students
    case 'staff': return school.staff
    case 'subscription': return school.mrr
    case 'fees_collected': return Number(fee?.collected ?? 0)
    case 'fees_outstanding': return Number(fee?.outstanding ?? 0)
    case 'fee_rate': {
      const collected = Number(fee?.collected ?? 0)
      const outstanding = Number(fee?.outstanding ?? 0)
      const denom = collected + outstanding
      return denom > 0 ? Math.round((collected / denom) * 1000) / 10 : 0
    }
    default: return 0
  }
}

function OwnerReports() {
  const app = useApp()
  const [metric, setMetric] = useState<Metric>('enrolment')
  const schoolsQ = usePortfolioSchools(app.isPlatform)
  const feeQ = useOwnerFeeSummary(true)
  const schools = useMemo(() => (schoolsQ.data ?? []).map(clientToSchool), [schoolsQ.data])
  const feeSchools = feeQ.data?.schools ?? []
  const feePeriod = feeQ.data?.period

  const meta = METRIC_META[metric]

  const ranked = useMemo(() => {
    return schools
      .map((s) => {
        const fee = feeRowForSchool(s, feeSchools)
        const raw = metricValue(s, fee, metric)
        const value = meta.sum ? Math.round(raw) : +raw.toFixed(1)
        return { school: s, value, fee }
      })
      .sort((a, b) => b.value - a.value)
  }, [schools, feeSchools, metric, meta])

  const summary = useMemo(() => {
    if (ranked.length === 0) return { agg: 0, top: null as null | typeof ranked[0], low: null as null | typeof ranked[0], count: 0 }
    const values = ranked.map((r) => r.value)
    const total = values.reduce((a, v) => a + v, 0)
    const agg = meta.sum ? total : total / values.length
    return { agg, top: ranked[0], low: ranked[ranked.length - 1], count: ranked.length }
  }, [ranked, meta])

  const bars = ranked.map((r) => ({ value: r.value, label: r.school.name, color: r.school.color }))
  const feeDonut = useMemo(() => {
    if (!meta.isFee || metric !== 'fees_collected') return []
    return feeSchools
      .filter((f) => Number(f.collected) > 0)
      .map((f, i) => {
        const school = schools.find((s) => s.id === f.tenant_id || s.slug === f.tenant_id)
        return { value: Number(f.collected), label: f.name, color: school?.color ?? ['#4f46e5', '#0ea5e9', '#10b981'][i % 3] }
      })
  }, [meta.isFee, metric, feeSchools, schools])

  const loading = schoolsQ.isLoading || feeQ.isLoading
  if (loading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 280 }}><Spinner size={28} /><div className="t-sm muted">Loading reports…</div></div>
  }
  if (schoolsQ.isError) {
    return <Empty icon="alert" title="Could not load reports" body="Check your connection and try again." />
  }
  if (feeQ.isError && meta.isFee) {
    return <Empty icon="alert" title="Could not load fee data" body="Check your connection and try again." />
  }
  if (schools.length === 0) {
    return (
      <div>
        <PageHead title="Cross-school reports" sub="Live portfolio data" />
        <Card>
          <Empty icon="building" title="No schools yet" body="Create a school to compare enrolment, staff, MRR, and health across your portfolio." />
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHead
        title="Cross-school reports"
        sub={meta.isFee && feePeriod
          ? `Comparing ${schools.length} schools · ${meta.label} · ${feePeriod.from} → ${feePeriod.to}`
          : `Comparing ${schools.length} ${schools.length === 1 ? 'school' : 'schools'} · ${meta.label} · live portfolio`}
      />

      <Card className="row ai-center jc-between gap12 wrap" style={{ marginBottom: 16 }}>
        <Segmented
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={(Object.keys(METRIC_META) as Metric[]).map((m) => ({ value: m, label: METRIC_META[m].label }))}
        />
        {meta.isFee && (
          <Btn size="sm" icon="rupee" onClick={() => app.go('owner.revenue')}>Fee collection</Btn>
        )}
      </Card>

      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi
          icon="trend" iconBg="var(--brand-50)" iconColor="var(--brand-600)"
          label={meta.sum ? `Total ${meta.short}` : `Average ${meta.short}`}
          value={meta.fmt(summary.agg)} foot={`Across ${summary.count} schools`}
        />
        <Kpi
          icon="sparkle" iconBg="var(--success-bg)" iconColor="var(--success)"
          label="Top school"
          value={summary.top ? meta.fmt(summary.top.value) : '—'}
          foot={summary.top?.school.name ?? '—'}
        />
        <Kpi
          icon="alert" iconBg="var(--warning-bg)" iconColor="var(--warning)"
          label="Lowest"
          value={summary.low ? meta.fmt(summary.low.value) : '—'}
          foot={summary.low?.school.name ?? '—'}
        />
        <Kpi
          icon="building" iconBg="var(--info-bg)" iconColor="var(--info)"
          label="Schools compared" value={fmtNum(summary.count)} foot="From your portfolio"
        />
      </div>

      <Card>
        <CardHead
          title={`${meta.label} by school`}
          sub={meta.isFee ? 'From student fee invoices & payments in each school' : 'Ranked from live portfolio data'}
          icon="grid"
        />
        <div style={{ marginTop: 16 }}>
          {bars.length === 0 || (meta.isFee && bars.every((b) => b.value <= 0))
            ? (
              <Empty
                icon={meta.isFee ? 'rupee' : 'grid'}
                title={meta.isFee ? 'No student fee data yet' : 'No data'}
                body={meta.isFee
                  ? 'Open a school → Fees → generate invoices and record payments. Amounts appear here across your portfolio.'
                  : 'No values to chart for this metric.'}
              />
            )
            : <HBars data={bars} labelWidth={200} valueFmt={(v) => meta.fmt(v)} />}
        </div>
        {metric === 'fees_collected' && feeDonut.length > 0 && (
          <div className="row ai-center gap20 wrap" style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <Donut
              segments={feeDonut}
              size={130} thickness={18}
              center={
                <div style={{ textAlign: 'center' }}>
                  <div className="fw7" style={{ fontSize: 14 }}>{compactMoney(summary.agg)}</div>
                  <div className="t-xs muted">collected</div>
                </div>
              }
            />
            <div className="col gap8" style={{ flex: 1, minWidth: 140 }}>
              <Legend items={feeDonut.map((d) => ({ color: d.color, label: d.label }))} />
            </div>
          </div>
        )}
        {ranked.length > 0 && (
          <div className="col gap10" style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            {ranked.map((r, i) => (
              <div key={r.school.id} className="row ai-center gap12">
                <span className="t-xs muted fw6" style={{ width: 22 }}>{i + 1}</span>
                <SchoolMark school={r.school} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fw6" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.school.name}</div>
                  <div className="t-xs muted">
                    {r.school.city}
                    {meta.isFee && r.fee && (
                      <> · {fmtNum(r.fee.payment_count)} payments · {fmtNum(r.fee.invoice_count)} open invoices</>
                    )}
                  </div>
                </div>
                <div className="fw7">{meta.fmt(r.value)}</div>
                {meta.isFee && (
                  <Btn size="sm" variant="ghost" icon="arrowRight" onClick={() => {
                    void app.enterSchool(r.school.id, r.school).then((ok) => { if (ok) app.go('school.fees') })
                  }}>Fees</Btn>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ============================================================
   Subscriptions tab — live schools from portfolio API
   ============================================================ */
function SubscriptionsTab({
  schools,
  isPlatform,
  onUpgrade,
  onIncreaseSeats,
}: {
  schools: School[]
  isPlatform: boolean
  onUpgrade: (s: School) => void
  onIncreaseSeats: (s: School) => void
}) {
  const columns: Column<School>[] = [
    {
      key: 'name', label: 'School', sortValue: (s) => s.name,
      render: (s) => (
        <div className="row ai-center gap10">
          <SchoolMark school={s} size={34} />
          <div>
            <div className="fw6">{s.name}</div>
            <div className="t-xs muted">{s.city}</div>
          </div>
        </div>
      ),
    },
    { key: 'plan', label: 'Plan', sortValue: (s) => s.plan, render: (s) => <TierPill plan={s.plan} /> },
    {
      key: 'students', label: 'Seat usage', align: 'right', sortValue: (s) => s.students,
      render: (s) => {
        const purchased = s.seatLimit ?? s.students
        const enrolled = s.enrolled ?? 0
        const pct = purchased > 0 ? Math.min(100, Math.round((enrolled / purchased) * 100)) : 0
        const full = purchased > 0 && enrolled >= purchased
        const near = purchased > 0 && !full && purchased - enrolled <= 5
        const barColor = full ? 'var(--danger)' : near ? 'var(--warning, #d97706)' : 'var(--brand-600)'
        return (
          <div className="col" style={{ alignItems: 'flex-end', gap: 5, minWidth: 128 }}>
            <div>
              <span className="fw7">{fmtNum(enrolled)}</span>
              <span className="t-xs muted"> / {fmtNum(purchased)} seats</span>
            </div>
            <div style={{ width: 110, height: 5, borderRadius: 999, background: 'var(--border-2)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 999 }} />
            </div>
            {(full || near) && <Badge tone={full ? 'danger' : 'warning'}>{full ? 'Seats full' : `${purchased - enrolled} left`}</Badge>}
          </div>
        )
      },
    },
    { key: 'mrr', label: 'MRR', align: 'right', sortValue: (s) => s.mrr, render: (s) => fmtMoney(s.mrr) },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (s) => s.status,
      render: (s) => <Badge tone={statusTone[s.status]} dot>{statusLabel[s.status]}</Badge>,
    },
    {
      key: 'actions', label: '', align: 'right',
      render: (s) => (
        <div className="row gap6 jc-end">
          {!isPlatform && s.plan !== 'platinum' && (
            <Btn size="sm" variant="ghost" icon="sparkle" onClick={(e) => { e.stopPropagation(); onUpgrade(s) }}>Upgrade</Btn>
          )}
          <Btn size="sm" variant="secondary" icon="building" onClick={(e) => { e.stopPropagation(); onIncreaseSeats(s) }}>
            {isPlatform ? 'Increase seats' : 'Request seats'}
          </Btn>
        </div>
      ),
    },
  ]

  if (schools.length === 0) {
    return (
      <Card>
        <Empty icon="building" title="No schools yet" body="Create a school to see its subscription here. Billing activates when Catre admin activates the client." />
      </Card>
    )
  }

  return (
    <Card pad={false}>
      <DataTable<School>
        columns={columns}
        rows={schools}
        pageSize={10}
        rowKey={(s) => s.id}
        initialSort={{ key: 'mrr', dir: 'desc' }}
        empty={<Empty icon="building" title="No subscriptions" body="No schools in your portfolio." />}
      />
    </Card>
  )
}

const seatReqTone: Record<string, BadgeTone> = { pending: 'warning', approved: 'success', rejected: 'danger' }

/** School owner's own seat-increase requests across their schools (read-only history). */
function OwnerSeatRequests({ schools }: { schools: School[] }) {
  const q = useQuery({
    queryKey: ['owner', 'my-seat-requests', schools.map((s) => s.id).sort().join(',')],
    queryFn: async () => {
      const lists = await Promise.all(schools.map((s) => listMySchoolSeatRequests(s.id).catch(() => [])))
      return lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at))
    },
    enabled: schools.length > 0,
  })

  if (q.isLoading) return <div className="col ai-center jc-center gap12" style={{ minHeight: 120 }}><Spinner size={22} /></div>
  const rows = q.data ?? []
  if (rows.length === 0) {
    return <Card><Empty icon="inbox" title="No seat requests yet" body="Use 'Request seats' on a subscription to ask the SchoolMate team for more seats." /></Card>
  }

  const statusLabel: Record<string, string> = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' }
  return (
    <Card pad={false}>
      <div className="col">
        {rows.map((r, i) => (
          <div key={r.id} className="row ai-center jc-between gap12"
            style={{ padding: '12px 16px', borderTop: i === 0 ? undefined : '1px solid var(--border)' }}>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="fw6" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.tenant_name ?? '—'}</span>
              <span className="t-xs muted3">Raised {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            </div>
            <div className="row ai-center gap14">
              <div className="row ai-baseline gap6">
                <span className="t-sm muted">{fmtNum(r.current_seats)}</span>
                <Icon name="arrowRight" size={13} />
                <span className="fw7 t-md">{fmtNum(r.requested_seats)}</span>
                <span className="t-xs muted">seats</span>
              </div>
              <Badge tone={seatReqTone[r.status] ?? 'neutral'} soft>{statusLabel[r.status] ?? r.status}</Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SeatRequestsTab() {
  const toast = useToast()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const q = useQuery({
    queryKey: [...queryKeys.owner.clients({}), 'seat-requests', filter],
    queryFn: () => listSeatRequests(filter === 'pending' ? 'pending' : undefined),
  })
  const [busyId, setBusyId] = useState<string | null>(null)

  const act = async (id: string, kind: 'approve' | 'reject') => {
    setBusyId(id)
    try {
      if (kind === 'approve') { await approveSeatRequest(id); toast.success('Approved', 'Seats increased and the top-up invoice was raised.') }
      else { await rejectSeatRequest(id); toast.info('Rejected', 'The seat request was declined.') }
      await qc.invalidateQueries({ queryKey: ['owner'] })
      await q.refetch()
    } catch (e) {
      toast.danger('Action failed', e instanceof ApiError ? e.message : 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  const rows = q.data ?? []
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'tenant_name', label: 'School', sortValue: (r) => r.tenant_name ?? '', render: (r) => <span className="fw6">{r.tenant_name ?? r.tenant_id}</span> },
    { key: 'current_seats', label: 'Current', align: 'right', render: (r) => fmtNum(r.current_seats) },
    { key: 'requested_seats', label: 'Requested', align: 'right', render: (r) => <span className="fw6">{fmtNum(r.requested_seats)}</span> },
    { key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status, render: (r) => <Badge tone={seatReqTone[r.status] ?? 'neutral'} dot>{r.status}</Badge> },
    { key: 'created_at', label: 'Raised', sortValue: (r) => r.created_at, render: (r) => new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => r.status === 'pending' ? (
        <div className="row gap6 jc-end">
          <Btn size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => { void act(r.id, 'reject') }}>Reject</Btn>
          <Btn size="sm" variant="primary" icon="check" disabled={busyId === r.id} onClick={() => { void act(r.id, 'approve') }}>Approve</Btn>
        </div>
      ) : <span className="t-xs muted3">{new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>,
    },
  ]

  return (
    <div className="col gap12">
      <div className="row gap8">
        <Btn size="sm" variant={filter === 'pending' ? 'primary' : 'secondary'} onClick={() => setFilter('pending')}>Pending</Btn>
        <Btn size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>All history</Btn>
      </div>
      {q.isLoading
        ? <div className="col ai-center jc-center gap12" style={{ minHeight: 160 }}><Spinner size={24} /></div>
        : rows.length === 0
          ? <Card><Empty icon="inbox" title={filter === 'pending' ? 'No pending seat requests' : 'No seat requests yet'} body="When a school asks for more seats, it shows here." /></Card>
          : <Card pad={false}><DataTable rows={rows} columns={columns} pageSize={10} rowKey={(r) => r.id} initialSort={{ key: 'created_at', dir: 'desc' }} /></Card>}
    </div>
  )
}

const upgradeTone: Record<UpgradeStatus, BadgeTone> = {
  pending_payment: 'warning',
  pending_offline: 'info',
  paid_pending_approval: 'brand',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
}
const upgradeLabel: Record<UpgradeStatus, string> = {
  pending_payment: 'Awaiting payment',
  pending_offline: 'Pending offline',
  paid_pending_approval: 'Paid — awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

function UpgradeRequestsTab({ isPlatform, schools }: { isPlatform: boolean; schools: School[] }) {
  const q = useMyUpgradeRequests(true)
  if (q.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 200 }}><Spinner size={28} /><div className="t-sm muted">Loading upgrade requests…</div></div>
  }
  if (q.isError) {
    return <Card><Empty icon="alert" title="Could not load upgrade requests" body="Check your connection and try again." /></Card>
  }
  const rows = q.data ?? []
  const columns: Column<PlanUpgradeRequest>[] = [
    { key: 'tenant_name', label: 'School', sortValue: (r) => r.tenant_name ?? '', render: (r) => <span className="fw6">{r.tenant_name ?? '—'}</span> },
    {
      key: 'plan', label: 'Upgrade',
      render: (r) => <span className="t-sm">{r.from_plan_name ?? r.from_tier ?? '—'} → <strong>{r.to_plan_name ?? r.to_tier}</strong></span>,
    },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="fw6">{fmtMoney(Number(r.amount))}</span> },
    { key: 'mode', label: 'Mode', render: (r) => <Badge tone="neutral">{r.mode === 'online' ? 'Razorpay' : 'Offline'}</Badge> },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status,
      render: (r) => <Badge tone={upgradeTone[r.status] ?? 'neutral'} soft>{upgradeLabel[r.status] ?? r.status}</Badge>,
    },
  ]
  return (
    <div className="col gap20">
      <div className="col gap8">
        <div className="t-sm fw6 muted">Plan upgrades</div>
        <Card pad={false}>
          <DataTable<PlanUpgradeRequest>
            columns={columns}
            rows={rows}
            pageSize={10}
            rowKey={(r) => r.id}
            initialSort={{ key: 'status', dir: 'asc' }}
            empty={<Empty icon="sparkle" title="No upgrade requests" body="Use Upgrade on a school subscription to request Gold or Platinum." />}
          />
        </Card>
      </div>
      <div className="col gap8">
        <div className="t-sm fw6 muted">Seat increase requests</div>
        {isPlatform ? <SeatRequestsTab /> : <OwnerSeatRequests schools={schools} />}
      </div>
    </div>
  )
}

/* ============================================================
   Invoices tab — platform live API; school owners get empty (no fake INV-*)
   ============================================================ */
type InvUiStatus = 'paid' | 'open' | 'past_due'
const invTone: Record<InvUiStatus, BadgeTone> = { paid: 'success', open: 'info', past_due: 'danger' }
const invLabel: Record<InvUiStatus, string> = { paid: 'Paid', open: 'Open', past_due: 'Past due' }

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function InvoicesTab({ isPlatform, schools }: { isPlatform: boolean; schools: School[] }) {
  const toast = useToast()
  const [dl, setDl] = useState<string | null>(null)
  const q = useQuery({
    queryKey: [...queryKeys.owner.clients({}), 'invoices', isPlatform ? 'platform' : schools.map((s) => s.id).sort().join(',')],
    queryFn: async () => {
      if (isPlatform) return (await listInvoices()).data
      const lists = await Promise.all(schools.map((s) => listMySchoolInvoices(s.id).catch(() => [])))
      return lists.flat()
    },
    enabled: isPlatform || schools.length > 0,
  })

  const download = async (r: ApiInvoice) => {
    setDl(r.id)
    try {
      const path = isPlatform ? platformInvoicePdfPath(r.id) : myInvoicePdfPath(r.tenant_id, r.id)
      await downloadInvoicePdf(path, `invoice-${r.id.slice(0, 8)}.pdf`)
    } catch (e) {
      toast.danger('Download failed', e instanceof Error ? e.message : 'Please try again.')
    } finally {
      setDl(null)
    }
  }

  if (q.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 200 }}><Spinner size={28} /><div className="t-sm muted">Loading invoices…</div></div>
  }
  if (q.isError) {
    return <Card><Empty icon="alert" title="Could not load invoices" body="Check your connection and try again." /></Card>
  }

  const invoices = (q.data ?? []).slice().sort((a, b) => (b.issued ?? '').localeCompare(a.issued ?? ''))
  const columns: Column<ApiInvoice>[] = [
    { key: 'id', label: 'Invoice', sortValue: (r) => r.id, render: (r) => <span className="fw6 t-xs">{r.id.slice(0, 8)}…</span> },
    ...(isPlatform ? [{ key: 'tenant_name', label: 'School', sortValue: (r: ApiInvoice) => r.tenant_name ?? '', render: (r: ApiInvoice) => <span className="fw6">{r.tenant_name ?? '—'}</span> }] : []),
    { key: 'plan_name', label: 'Plan', render: (r) => <span className="t-sm muted">{r.plan_name ?? '—'}</span> },
    { key: 'amount', label: 'Amount', align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="fw6">{fmtMoney(Number(r.amount))}</span> },
    { key: 'issued', label: 'Issued', align: 'right', render: (r) => <span className="t-sm muted">{fmtDate(r.issued)}</span> },
    { key: 'due', label: 'Due', align: 'right', render: (r) => <span className="t-sm muted">{fmtDate(r.due)}</span> },
    {
      key: 'status', label: 'Status', align: 'center', sortValue: (r) => r.status,
      render: (r) => {
        const st = (r.status === 'paid' || r.status === 'open' || r.status === 'past_due' ? r.status : 'open') as InvUiStatus
        return <Badge tone={invTone[st]} dot>{invLabel[st]}</Badge>
      },
    },
    {
      key: 'pdf', label: '', align: 'right',
      render: (r) => <Btn size="sm" variant="secondary" icon="download" disabled={dl === r.id} onClick={() => { void download(r) }}>{dl === r.id ? '…' : 'PDF'}</Btn>,
    },
  ]

  return (
    <Card pad={false}>
      <DataTable<ApiInvoice>
        columns={columns}
        rows={invoices}
        pageSize={10}
        rowKey={(r) => r.id}
        initialSort={{ key: 'issued', dir: 'desc' }}
        empty={<Empty icon="doc" title="No invoices yet"
          body={isPlatform ? 'No invoices have been issued yet.' : 'Invoices appear after your school is activated and billing starts.'} />}
      />
    </Card>
  )
}

/* ============================================================
   Revenue tab — real MRR from portfolio (no fake 12-month curve)
   ============================================================ */
function RevenueTab({ schools }: { schools: School[] }) {
  const totalMrr = useMemo(() => schools.reduce((a, s) => a + s.mrr, 0), [schools])
  const byPlan = useMemo(() =>
    TIERS.map((t) => ({
      tier: t,
      value: schools.filter((s) => s.plan === t).reduce((a, s) => a + s.mrr, 0),
      color: TIER_META[t].color,
    })), [schools])

  const bySchool = useMemo(
    () => schools.map((s) => ({ value: s.mrr, label: s.name, color: s.color })),
    [schools],
  )

  if (schools.length === 0) {
    return <Card><Empty icon="trend" title="No revenue yet" body="MRR appears when your schools have an active or trial plan with billing." /></Card>
  }

  return (
    <div className="sm-grid-2">
      <Card>
        <CardHead title="Subscription MRR by school" sub="Software plan billing — not student fees" icon="trend" />
        <div style={{ marginTop: 12 }}>
          <HBars
            data={bySchool}
            valueFmt={(v) => compactMoney(v)}
          />
        </div>
      </Card>
      <Card>
        <CardHead title="Revenue by plan" sub="Share of current MRR" icon="layers" />
        <div className="row ai-center gap20 wrap" style={{ marginTop: 12 }}>
          <Donut
            segments={byPlan.map((p) => ({ value: p.value, color: p.color, label: TIER_META[p.tier].label }))}
            size={150} thickness={20}
            center={<div style={{ textAlign: 'center' }}><div className="fw7" style={{ fontSize: 18 }}>{compactMoney(totalMrr)}</div><div className="t-xs muted">MRR</div></div>}
          />
          <div className="col gap10">
            {byPlan.map((p) => (
              <div key={p.tier} className="row ai-center jc-between gap16">
                <Legend items={[{ color: p.color, label: TIER_META[p.tier].label }]} />
                <span className="fw6">{fmtMoney(p.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ============================================================
   Plans & pricing — published Catre plans (no dummy calculator trials)
   ============================================================ */
function LivePlansTab({ plans, loading, error }: { plans: Plan[]; loading: boolean; error: boolean }) {
  const [detail, setDetail] = useState<Plan | null>(null)
  if (loading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 200 }}><Spinner size={28} /><div className="t-sm muted">Loading published plans…</div></div>
  }
  if (error) {
    return <Card><Empty icon="alert" title="Could not load plans" body="Check your connection and try again." /></Card>
  }
  if (plans.length === 0) {
    return <Card><Empty icon="layers" title="No published plans" body="Ask Catre admin to publish a plan. Only live plans are listed here." /></Card>
  }

  return (
    <>
      <div className="sm-grid-3">
        {plans.map((p) => {
          const tier = ((TIERS as readonly string[]).includes((p.tier ?? '').toLowerCase()) ? p.tier!.toLowerCase() : 'gold') as Tier
          const price = p.pricing === 'per_student'
            ? Number(p.per_student) || 0
            : Number(p.price) || 0
          return (
            <Card key={p.id} hover style={{ cursor: 'pointer' }} onClick={() => setDetail(p)}>
              <div className="row ai-center jc-between gap8">
                <div className="t-md fw7">{p.name}</div>
                <TierPill plan={tier} size="md" />
              </div>
              {p.description && <div className="t-xs muted3" style={{ marginTop: 6 }}>{p.description}</div>}
              <div style={{ marginTop: 14 }}>
                <div className="row ai-end gap6">
                  <div className="fw7" style={{ fontSize: 26, fontFamily: 'var(--font-display)' }}>{fmtMoney(price)}</div>
                  <div className="t-xs muted" style={{ marginBottom: 4 }}>
                    {p.pricing === 'per_student' ? '/student' : 'flat'} · {p.period || 'month'}
                  </div>
                </div>
              </div>
              <div className="col gap2" style={{ marginTop: 10 }}>
                {p.pricing !== 'per_student' && p.included_students != null && (
                  <div className="t-xs muted">Includes {fmtNum(p.included_students)} students</div>
                )}
                {p.allowed_cycles && (
                  <div className="t-xs muted">Cycles: {p.allowed_cycles.split(',').map((c) => c.trim()).join(' · ')}</div>
                )}
              </div>
              <div className="row ai-center jc-between" style={{ marginTop: 12 }}>
                <Badge tone="info">Published by Catre</Badge>
                <span className="t-xs fw6" style={{ color: 'var(--brand-600)' }}>View details →</span>
              </div>
            </Card>
          )
        })}
      </div>
      <PlanDetailsModal plan={detail} onClose={() => setDetail(null)} />
    </>
  )
}

function PlanDetailsModal({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  if (!plan) return null
  const p = plan
  const tier = ((TIERS as readonly string[]).includes((p.tier ?? '').toLowerCase()) ? p.tier!.toLowerCase() : 'gold') as Tier
  const perStudent = p.pricing === 'per_student'
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Pricing', value: perStudent ? `${fmtMoney(Number(p.per_student) || 0)} / student / month` : `${fmtMoney(Number(p.price) || 0)} flat / month` },
    ...(perStudent && p.min_students ? [{ label: 'Minimum billable students', value: fmtNum(p.min_students) }] : []),
    ...(!perStudent && p.included_students != null ? [{ label: 'Included students', value: fmtNum(p.included_students) }] : []),
    { label: 'Billing cycles', value: (p.allowed_cycles ?? 'month,quarter,year').split(',').map((c) => c.trim()).join(' · ') },
    ...(p.seat_alert_threshold != null ? [{ label: 'Near-limit alert at', value: `${fmtNum(p.seat_alert_threshold)} seats left` }] : []),
    ...(p.limits ? [{ label: 'Capacity', value: `${fmtNum(p.limits.students)} students · ${fmtNum(p.limits.staff)} staff · ${fmtNum(p.limits.storage_gb)} GB` }] : []),
    { label: 'Audience', value: p.audience || 'all' },
    { label: 'Visibility', value: p.visibility || '—' },
  ]
  return (
    <Modal open onClose={onClose} icon="layers" size="md" title={p.name}
      sub={p.description ?? 'Published plan details'}
      footer={<div className="row jc-end" style={{ width: '100%' }}><Btn variant="primary" onClick={onClose}>Close</Btn></div>}>
      <div className="row ai-center gap10" style={{ marginBottom: 14 }}>
        <TierPill plan={tier} size="md" />
        <Badge tone="info">Published by Catre</Badge>
      </div>
      <div className="col gap0">
        {rows.map((r, i) => (
          <div key={r.label} className="row ai-center jc-between gap12"
            style={{ padding: '9px 0', borderTop: i === 0 ? undefined : '1px solid var(--border)' }}>
            <span className="t-sm muted">{r.label}</span>
            <span className="t-sm fw6" style={{ textAlign: 'right' }}>{r.value}</span>
          </div>
        ))}
      </div>
      {p.features && p.features.length > 0 && (
        <div className="col gap6" style={{ marginTop: 14 }}>
          <span className="t-sm fw6">Features</span>
          <div className="row gap6" style={{ flexWrap: 'wrap' }}>
            {p.features.map((f) => <Badge key={f} tone="neutral" soft>{f}</Badge>)}
          </div>
        </div>
      )}
    </Modal>
  )
}

/* ============================================================
   OwnerBilling — Subscriptions & billing (live portfolio data)
   ============================================================ */
function OwnerBilling() {
  const app = useApp()
  const BILLING_TABS = ['subs', 'upgrades', 'invoices', 'revenue', 'plans']
  const [tab, setTabState] = useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab')
      return t && BILLING_TABS.includes(t) ? t : 'subs'
    } catch { return 'subs' }
  })
  const setTab = (t: string) => {
    setTabState(t)
    // Reflect the active tab in the URL query (no history spam) so it's refresh/deep-link safe.
    try {
      const path = window.location.pathname || '/owner/billing'
      window.history.replaceState(null, '', t === 'subs' ? path : `${path}?tab=${t}`)
    } catch { /* ignore */ }
  }
  const [upgrade, setUpgrade] = useState<School | null>(null)
  const [seatsSchool, setSeatsSchool] = useState<School | null>(null)
  const schoolsQ = usePortfolioSchools(app.isPlatform)
  const plansQ = useOwnerPlans(app.isPlatform)
  const schools = useMemo(() => (schoolsQ.data ?? []).map(clientToSchool), [schoolsQ.data])

  const kpis = useMemo(() => {
    const mrr = schools.reduce((a, s) => a + s.mrr, 0)
    const paying = schools.filter((s) => s.status === 'active' || s.mrr > 0).length
    const overdue = schools.filter((s) => s.status === 'past_due').reduce((a, s) => a + s.mrr, 0)
    return { mrr, arr: mrr * 12, paying, overdue }
  }, [schools])

  if (schoolsQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 280 }}><Spinner size={28} /><div className="t-sm muted">Loading billing…</div></div>
  }
  if (schoolsQ.isError) {
    return <Empty icon="alert" title="Could not load billing" body="Check your connection and try again." />
  }

  return (
    <div>
      <PageHead
        title="Subscriptions & billing"
        sub={`${schools.length} ${schools.length === 1 ? 'school' : 'schools'} · live portfolio data`}
      />

      <div className="sm-kpi-grid" style={{ marginBottom: 16 }}>
        <Kpi icon="rupee" iconBg="var(--brand-50)" iconColor="var(--brand-600)" label="Subscription MRR" value={fmtMoney(kpis.mrr)} foot="What schools pay for SchoolMate software" />
        <Kpi icon="trend" iconBg="var(--success-bg)" iconColor="var(--success)" label="Subscription ARR" value={fmtMoney(kpis.arr)} foot="Annual run-rate (MRR × 12)" />
        <Kpi icon="building" iconBg="var(--info-bg)" iconColor="var(--info)" label="Paying / billed" value={fmtNum(kpis.paying)} foot={`of ${schools.length} schools`} />
        <Kpi icon="alert" iconBg="var(--danger-bg)" iconColor="var(--danger)" label="Overdue amount" value={fmtMoney(kpis.overdue)} foot="Past-due accounts" />
      </div>

      <Tabs
        value={tab} onChange={setTab}
        tabs={[
          { value: 'subs', label: 'Subscriptions', icon: 'list' },
          { value: 'upgrades', label: 'Upgrade requests', icon: 'sparkle' },
          { value: 'invoices', label: 'Invoices', icon: 'doc' },
          { value: 'revenue', label: 'Bill', icon: 'trend' },
          { value: 'plans', label: 'Plans & pricing', icon: 'layers' },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === 'subs' && <SubscriptionsTab schools={schools} isPlatform={app.isPlatform} onUpgrade={setUpgrade} onIncreaseSeats={setSeatsSchool} />}
        {tab === 'upgrades' && <UpgradeRequestsTab isPlatform={app.isPlatform} schools={schools} />}
        {tab === 'invoices' && <InvoicesTab isPlatform={app.isPlatform} schools={schools} />}
        {tab === 'revenue' && <RevenueTab schools={schools} />}
        {tab === 'plans' && <LivePlansTab plans={plansQ.data ?? []} loading={plansQ.isLoading} error={plansQ.isError} />}
      </div>

      <UpgradePlanModal key={upgrade?.id} school={upgrade} onClose={() => setUpgrade(null)} isPlatform={app.isPlatform} />
      <IncreaseSeatsModal key={seatsSchool?.id} school={seatsSchool} isPlatform={app.isPlatform} onClose={() => setSeatsSchool(null)} />
    </div>
  )
}

/* ---------- export contract ---------- */
export const billingScreens: Record<string, ComponentType> = {
  'owner.reports': OwnerReports,
  'owner.billing': OwnerBilling,
}
