/* ============================================================
   SchoolMate — Owner console: Cross-school reports +
   Subscriptions & billing.
   Both screens use live portfolio schools (/me/schools or /clients).
   ============================================================ */
import { useMemo, useState, type ComponentType } from 'react'
import { useApp } from '@/lib/hooks'
import {
  PageHead, Tabs, Card, CardHead, Kpi, Badge, TierPill, Segmented, Btn,
  HBars, Legend, Donut, DataTable, Empty, Spinner,
  type Column, type BadgeTone,
} from '@/components/ui'
import { TIERS, TIER_META } from '@/data/mockDb'
import { fmtMoney, fmtNum } from '@/lib/format'
import type { School, Tier } from '@/types'
import { usePortfolioSchools, useOwnerPlans, useMyUpgradeRequests, useOwnerFeeSummary } from '@/api/hooks/useOwner'
import { clientToSchool } from '@/api/ownerMap'
import { listInvoices, type ApiInvoice } from '@/api/billing'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/api/queryKeys'
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
      key: 'students', label: 'Seats (billed / enrolled)', align: 'right', sortValue: (s) => s.students,
      render: (s) => {
        const limit = s.seatLimit ?? s.students
        const enrolled = s.enrolled
        const near = limit > 0 && enrolled != null && limit - enrolled <= 5
        return (
          <div className="col" style={{ alignItems: 'flex-end', lineHeight: 1.2 }}>
            <span className="fw6">{fmtNum(s.students)}{enrolled != null ? ` / ${fmtNum(enrolled)}` : ''}</span>
            {near && <Badge tone={enrolled! >= limit ? 'danger' : 'warning'}>{enrolled! >= limit ? 'Seats full' : 'Near limit'}</Badge>}
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
      render: (s) => isPlatform
        ? <Btn size="sm" variant="secondary" icon="building" onClick={(e) => { e.stopPropagation(); onIncreaseSeats(s) }}>Increase seats</Btn>
        : (s.plan !== 'platinum'
          ? <Btn size="sm" variant="secondary" icon="sparkle" onClick={(e) => { e.stopPropagation(); onUpgrade(s) }}>Upgrade</Btn>
          : null),
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

function UpgradeRequestsTab() {
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

function InvoicesTab({ isPlatform }: { isPlatform: boolean }) {
  const q = useQuery({
    queryKey: [...queryKeys.owner.clients({}), 'invoices'],
    queryFn: async () => (await listInvoices()).data,
    enabled: isPlatform,
  })

  if (!isPlatform) {
    return (
      <Card>
        <Empty
          icon="doc"
          title="No invoices yet"
          body="Invoices appear after Catre admin activates a school and billing starts."
        />
      </Card>
    )
  }

  if (q.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 200 }}><Spinner size={28} /><div className="t-sm muted">Loading invoices…</div></div>
  }
  if (q.isError) {
    return <Card><Empty icon="alert" title="Could not load invoices" body="Check your connection and try again." /></Card>
  }

  const invoices = q.data ?? []
  const columns: Column<ApiInvoice>[] = [
    { key: 'id', label: 'Invoice', sortValue: (r) => r.id, render: (r) => <span className="fw6 t-xs">{r.id.slice(0, 8)}…</span> },
    { key: 'tenant_name', label: 'School', sortValue: (r) => r.tenant_name ?? '', render: (r) => <span className="fw6">{r.tenant_name ?? '—'}</span> },
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
  ]

  return (
    <Card pad={false}>
      <DataTable<ApiInvoice>
        columns={columns}
        rows={invoices}
        pageSize={10}
        rowKey={(r) => r.id}
        initialSort={{ key: 'status', dir: 'asc' }}
        empty={<Empty icon="doc" title="No invoices" body="No invoices have been issued yet." />}
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
    <div className="sm-grid-3">
      {plans.map((p) => {
        const tier = ((TIERS as readonly string[]).includes((p.tier ?? '').toLowerCase()) ? p.tier!.toLowerCase() : 'gold') as Tier
        const price = p.pricing === 'per_student'
          ? Number(p.per_student) || 0
          : Number(p.price) || 0
        return (
          <Card key={p.id}>
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
            <Badge tone="info" style={{ marginTop: 12 }}>Published by Catre</Badge>
          </Card>
        )
      })}
    </div>
  )
}

/* ============================================================
   OwnerBilling — Subscriptions & billing (live portfolio data)
   ============================================================ */
function OwnerBilling() {
  const app = useApp()
  const [tab, setTab] = useState('subs')
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
          { value: 'revenue', label: 'Revenue', icon: 'trend' },
          { value: 'plans', label: 'Plans & pricing', icon: 'layers' },
        ]}
      />

      <div style={{ marginTop: 16 }}>
        {tab === 'subs' && <SubscriptionsTab schools={schools} isPlatform={app.isPlatform} onUpgrade={setUpgrade} onIncreaseSeats={setSeatsSchool} />}
        {tab === 'upgrades' && <UpgradeRequestsTab />}
        {tab === 'invoices' && <InvoicesTab isPlatform={app.isPlatform} />}
        {tab === 'revenue' && <RevenueTab schools={schools} />}
        {tab === 'plans' && <LivePlansTab plans={plansQ.data ?? []} loading={plansQ.isLoading} error={plansQ.isError} />}
      </div>

      <UpgradePlanModal key={upgrade?.id} school={upgrade} onClose={() => setUpgrade(null)} isPlatform={app.isPlatform} />
      <IncreaseSeatsModal key={seatsSchool?.id} school={seatsSchool} onClose={() => setSeatsSchool(null)} />
    </div>
  )
}

/* ---------- export contract ---------- */
export const billingScreens: Record<string, ComponentType> = {
  'owner.reports': OwnerReports,
  'owner.billing': OwnerBilling,
}
