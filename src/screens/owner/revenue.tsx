/* ============================================================
   SchoolMate — Owner console: Fee Collection (school-wise cash)
   Live data from GET /me/schools/fee-summary — no dummy series.
   ============================================================ */
import { useMemo, type ComponentType } from 'react'
import { useApp } from '@/lib/hooks'
import {
  PageHead, Card, CardHead, Kpi, Btn, Badge, Donut, HBars, Legend, DataTable, Empty, Spinner,
  type Column,
} from '@/components/ui'
import { fmtMoney, fmtNum } from '@/lib/format'
import { useOwnerFeeSummary, usePortfolioSchools } from '@/api/hooks/useOwner'
import { clientToSchool } from '@/api/ownerMap'
import type { FeeSchoolSummary } from '@/api/ownerTypes'
import type { School } from '@/types'
import { SchoolMark } from '@/components/SchoolMark'

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444']

function ratePct(collected: number, outstanding: number): number {
  const denom = collected + outstanding
  if (denom <= 0) return 0
  return Math.round((collected / denom) * 1000) / 10
}

function OwnerRevenue() {
  const app = useApp()
  const feeQ = useOwnerFeeSummary(true)
  const schoolsQ = usePortfolioSchools(app.isPlatform)
  const schoolsById = useMemo(() => {
    const map = new Map<string, School>()
    for (const c of schoolsQ.data ?? []) map.set(c.id, clientToSchool(c))
    return map
  }, [schoolsQ.data])

  const schools = feeQ.data?.schools ?? []
  const totals = feeQ.data?.totals ?? { collected: 0, outstanding: 0, payment_count: 0, invoice_count: 0 }
  const period = feeQ.data?.period
  const collectionRate = ratePct(totals.collected, totals.outstanding)
  const schoolsWithCash = schools.filter((s) => s.collected > 0).length

  const donutBySchool = useMemo(
    () => schools
      .filter((s) => s.collected > 0)
      .map((s, i) => ({ value: Number(s.collected), color: COLORS[i % COLORS.length], label: s.name })),
    [schools],
  )

  const cashVsOut = useMemo(() => [
    { value: Number(totals.collected), color: 'var(--success)', label: 'Collected' },
    { value: Number(totals.outstanding), color: 'var(--warning)', label: 'Outstanding' },
  ], [totals.collected, totals.outstanding])

  const bars = useMemo(
    () => [...schools]
      .filter((s) => Number(s.collected) > 0)
      .sort((a, b) => b.collected - a.collected)
      .map((s, i) => ({
        value: Number(s.collected),
        label: s.name,
        color: COLORS[i % COLORS.length],
      })),
    [schools],
  )

  const outstandingBars = useMemo(
    () => [...schools]
      .filter((s) => Number(s.outstanding) > 0)
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding))
      .map((s, i) => ({
        value: Number(s.outstanding),
        label: s.name,
        color: COLORS[i % COLORS.length],
      })),
    [schools],
  )

  const columns: Column<FeeSchoolSummary>[] = [
    {
      key: 'name', label: 'School', sortValue: (r) => r.name,
      render: (r) => {
        const s = schoolsById.get(r.tenant_id)
        return (
          <div className="row ai-center gap10">
            <SchoolMark
              school={s ?? { name: r.name, logo: r.name.slice(0, 2).toUpperCase(), color: COLORS[0], logoUrl: null }}
              size={34}
            />
            <div>
              <div className="fw6">{r.name}</div>
              <div className="t-xs muted">{fmtNum(r.payment_count)} payments · {fmtNum(r.invoice_count)} open invoices</div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'collected', label: 'Collected', align: 'right', sortValue: (r) => r.collected,
      render: (r) => <span className="fw6">{fmtMoney(Number(r.collected))}</span>,
    },
    {
      key: 'outstanding', label: 'Outstanding', align: 'right', sortValue: (r) => r.outstanding,
      render: (r) => <span className="t-sm">{fmtMoney(Number(r.outstanding))}</span>,
    },
    {
      key: 'rate', label: 'Rate', align: 'center', sortValue: (r) => ratePct(r.collected, r.outstanding),
      render: (r) => {
        const rate = ratePct(Number(r.collected), Number(r.outstanding))
        const tone = rate >= 80 ? 'success' : rate >= 50 ? 'warning' : 'danger'
        return <Badge tone={tone}>{rate}%</Badge>
      },
    },
    {
      key: 'open', label: '', align: 'right',
      render: (r) => {
        const s = schoolsById.get(r.tenant_id)
        return (
          <Btn size="sm" variant="primary" icon="arrowRight"
            onClick={() => {
              void (async () => {
                await app.enterSchool(r.tenant_id, s)
                app.go('school.fees')
              })()
            }}>
            Open
          </Btn>
        )
      },
    },
  ]

  if (feeQ.isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 280 }}><Spinner size={28} /><div className="t-sm muted">Loading fee collection…</div></div>
  }
  if (feeQ.isError) {
    return <Empty icon="alert" title="Could not load fee collection" body="Check your connection and try again." />
  }

  const periodLabel = period
    ? `${period.from} → ${period.to}`
    : 'Current month'

  return (
    <div className="col gap20">
      <PageHead
        title="Fee Collection"
        sub={`School-wise student fee cash · ${periodLabel}`}
        actions={
          <Btn icon="trend" onClick={() => app.go('owner.dashboard')}>Dashboard</Btn>
        }
      />

      <div className="sm-kpi-grid">
        <Kpi
          icon="rupee" iconBg="var(--success-bg)" iconColor="var(--success)"
          label="Fee collected" value={fmtMoney(Number(totals.collected))}
          foot={`${fmtNum(totals.payment_count)} payments this period`}
        />
        <Kpi
          icon="alert" iconBg="var(--warning-bg)" iconColor="var(--warning)"
          label="Outstanding" value={fmtMoney(Number(totals.outstanding))}
          foot={`${fmtNum(totals.invoice_count)} open invoices`}
        />
        <Kpi
          icon="trend" iconBg="var(--brand-50)" iconColor="var(--brand-600)"
          label="Collection rate" value={`${collectionRate}%`}
          foot="Collected / (collected + outstanding)"
        />
        <Kpi
          icon="building" iconBg="var(--info-bg)" iconColor="var(--info)"
          label="Schools with cash" value={fmtNum(schoolsWithCash)}
          foot={`of ${fmtNum(schools.length)} in portfolio`}
        />
      </div>

      <div className="sm-grid-2">
        <Card>
          <CardHead title="Collected by school" sub="Share of fee cash this period" icon="layers" />
          <div className="row ai-center gap20 wrap" style={{ marginTop: 12 }}>
            {donutBySchool.length === 0 ? (
              <Empty icon="rupee" title="No cash yet" body="Fee payments in this period will appear here." />
            ) : (
              <>
                <Donut
                  segments={donutBySchool}
                  size={150} thickness={20}
                  center={
                    <div style={{ textAlign: 'center' }}>
                      <div className="fw7" style={{ fontSize: 16 }}>{fmtMoney(Number(totals.collected))}</div>
                      <div className="t-xs muted">collected</div>
                    </div>
                  }
                />
                <div className="col gap10" style={{ flex: 1, minWidth: 140 }}>
                  <Legend items={donutBySchool.map((d) => ({ color: d.color, label: d.label }))} />
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Cash vs outstanding" sub="Portfolio collection balance" icon="wallet" />
          <div className="row ai-center gap20 wrap" style={{ marginTop: 12 }}>
            {(totals.collected <= 0 && totals.outstanding <= 0) ? (
              <Empty icon="doc" title="No fee invoices yet" body="When schools raise invoices and take payments, the split shows here." />
            ) : (
              <>
                <Donut
                  segments={cashVsOut.filter((s) => s.value > 0)}
                  size={150} thickness={20}
                  center={
                    <div style={{ textAlign: 'center' }}>
                      <div className="fw7" style={{ fontSize: 18 }}>{collectionRate}%</div>
                      <div className="t-xs muted">rate</div>
                    </div>
                  }
                />
                <div className="col gap10">
                  {cashVsOut.map((s) => (
                    <div key={s.label} className="row ai-center jc-between gap16">
                      <Legend items={[{ color: s.color, label: s.label }]} />
                      <span className="fw6">{fmtMoney(s.value)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Collected ranking" sub="Bars by school (cash this period)" icon="trend" />
        <div style={{ marginTop: 16 }}>
          {bars.length === 0
            ? <Empty icon="rupee" title="No fee cash yet" body="Generate invoices and record payments inside a school — amounts appear here." />
            : <HBars data={bars} labelWidth={200} valueFmt={(v) => fmtMoney(v)} />}
        </div>
      </Card>

      <Card>
        <CardHead title="Outstanding by school" sub="Open student fee invoices" icon="alert" />
        <div style={{ marginTop: 16 }}>
          {outstandingBars.length === 0
            ? <Empty icon="checkCircle" title="Nothing outstanding" body="No open fee invoices across your schools." />
            : <HBars data={outstandingBars} labelWidth={200} valueFmt={(v) => fmtMoney(v)} />}
        </div>
      </Card>

      <Card pad={false}>
        <div style={{ padding: '14px 16px' }}>
          <CardHead title="School-wise fee cash" sub="Click Open to enter the school Fees console" icon="list" />
        </div>
        <DataTable<FeeSchoolSummary>
          columns={columns}
          rows={schools}
          pageSize={10}
          rowKey={(r) => r.tenant_id}
          initialSort={{ key: 'collected', dir: 'desc' }}
          empty={<Empty icon="rupee" title="No fee data" body="Schools in your portfolio appear here once fee activity exists." />}
        />
      </Card>
    </div>
  )
}

export const revenueScreens: Record<string, ComponentType> = {
  'owner.revenue': OwnerRevenue,
}
