/* ============================================================
   SchoolMate — Owner console: Portfolio overview, Schools list
   (+ branded account report) and the 5-step Create-school wizard.
   ============================================================ */
import { useMemo, useState, useEffect, type ComponentType } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import {
  PageHead, Card, CardHead, Kpi, Btn, IconBtn, Badge, TierPill, Search, Select, Segmented,
  Field, Input, FileUpload, Modal, Icon, Empty, Donut, HBars, Legend, DataTable, Spinner,
  Popover, MenuItem, MenuSep,
  type Column, type BadgeTone,
} from '@/components/ui'
import { SchoolCover, SchoolMark } from '@/components/SchoolMark'
import { EditSchoolProfileModal } from '@/components/EditSchoolProfileModal'
import { compressImageFile } from '@/lib/compressImage'
import type { Client } from '@/api/ownerTypes'
import { TIERS, TIER_META } from '@/data/mockDb'
import { fmtMoney, fmtNum } from '@/lib/format'
import type { School, Tier } from '@/types'
import { usePortfolioSchools, useOwnerPlans, useCreateSchool, useOwnerFeeSummary, useDeleteSchool } from '@/api/hooks/useOwner'
import { clientToSchool, isValidSchoolId, normalizeSchoolId } from '@/api/ownerMap'
import type { FeeSchoolSummary } from '@/api/ownerTypes'
import { ApiError } from '@/api/client'
import { UpgradePlanModal } from '@/screens/owner/UpgradePlanModal'
import {
  createUpgradeRequest,
  createRazorpayOrder,
  confirmUpgradePayment,
  loadRazorpayScript,
  getPaymentGatewayStatus,
  type UpgradeMode,
} from '@/api/upgradeRequests'
import { deleteMySchool } from '@/api/mySchools'
import { deleteClient } from '@/api/clients'
import { updateSchoolProfile } from '@/api/schoolProfile'
import { validateGeofenceInput, RADIUS_PRESETS } from '@/lib/geofence'
import { useQueryClient } from '@tanstack/react-query'

const FEE_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']

/* ============================================================
   Shared: student-strength-based per-student pricing bands
   (smaller schools pay more per student; volume discounts apply)
   ============================================================ */
const PRICE_BANDS: { max: number; rates: [number, number, number] }[] = [
  { max: 500, rates: [120, 300, 520] },
  { max: 1500, rates: [96, 240, 430] },
  { max: 3000, rates: [78, 190, 340] },
  { max: Infinity, rates: [64, 160, 290] },
]
/* rates are ordered to match TIERS = ['silver','gold','platinum'] */
function priceBand(strength: number): [number, number, number] {
  return (PRICE_BANDS.find((b) => strength <= b.max) ?? PRICE_BANDS[PRICE_BANDS.length - 1]).rates
}
function rateFor(strength: number, tier: Tier): number {
  return priceBand(strength)[TIERS.indexOf(tier)]
}

const STATUS_TONE: Record<School['status'], BadgeTone> = {
  active: 'success',
  trial: 'info',
  past_due: 'danger',
}
const STATUS_LABEL: Record<School['status'], string> = {
  active: 'Active',
  trial: 'Awaiting activation',
  past_due: 'Past due',
}

/* compact INR (e.g. ₹1.92L / ₹2.4Cr) for tight chart/price lines */
function fmtCompact(n: number): string {
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + 'Cr'
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + 'L'
  if (n >= 1e3) return '₹' + (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'K'
  return '₹' + n
}

/* ============================================================
   1) Portfolio overview (Owner dashboard)
   ============================================================ */
function OwnerDashboard() {
  const app = useApp()
  const toast = useToast()
  const { data: clients = [], isLoading, isError } = usePortfolioSchools(app.isPlatform)
  const feeQ = useOwnerFeeSummary(true)
  const schools = useMemo(() => clients.map(clientToSchool), [clients])

  const totals = useMemo(() => {
    // Actual enrolled students across the portfolio (not the purchased/billed seat count).
    const students = schools.reduce((a, s) => a + (s.enrolled ?? s.students), 0)
    const staff = schools.reduce((a, s) => a + s.staff, 0)
    return { students, staff }
  }, [schools])

  const planCounts = useMemo(() => {
    const c: Record<Tier, number> = { silver: 0, gold: 0, platinum: 0 }
    schools.forEach((s) => { c[s.plan]++ })
    return c
  }, [schools])

  const feeTotals = feeQ.data?.totals
  const feeSchools = feeQ.data?.schools ?? []
  const feeCollected = Number(feeTotals?.collected ?? 0)
  const feeOutstanding = Number(feeTotals?.outstanding ?? 0)
  const feeRate = feeCollected + feeOutstanding > 0
    ? Math.round((feeCollected / (feeCollected + feeOutstanding)) * 1000) / 10
    : 0
  const schoolsWithCash = feeSchools.filter((s) => Number(s.collected) > 0).length

  const feeDonut = useMemo(
    () => feeSchools
      .filter((s) => Number(s.collected) > 0)
      .map((s, i) => ({ value: Number(s.collected), color: FEE_COLORS[i % FEE_COLORS.length], label: s.name })),
    [feeSchools],
  )
  const feeBars = useMemo(
    () => [...feeSchools]
      .sort((a, b) => Number(b.collected) - Number(a.collected))
      .map((s, i) => ({ value: Number(s.collected), label: s.name, color: FEE_COLORS[i % FEE_COLORS.length] })),
    [feeSchools],
  )
  const outstandingBars = useMemo(
    () => [...feeSchools]
      .filter((s) => Number(s.outstanding) > 0)
      .sort((a, b) => Number(b.outstanding) - Number(a.outstanding))
      .map((s, i) => ({ value: Number(s.outstanding), label: s.name, color: FEE_COLORS[i % FEE_COLORS.length] })),
    [feeSchools],
  )

  const alerts = schools.filter((s) => {
    const row = feeSchools.find((f) => f.tenant_id === s.id)
    const collected = Number(row?.collected ?? 0)
    const outstanding = Number(row?.outstanding ?? 0)
    if (outstanding > 0 && collected + outstanding > 0) {
      return collected / (collected + outstanding) < 0.5
    }
    return outstanding > 0 && collected === 0
  })

  if (isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 280 }}><Spinner size={28} /><div className="t-sm muted">Loading portfolio…</div></div>
  }
  if (isError) {
    return <Empty icon="alert" title="Could not load portfolio" body="Check your connection and try again." />
  }

  return (
    <div className="col gap20">
      <PageHead
        title="Portfolio overview"
        sub={app.isPlatform ? 'All schools on the platform' : 'School fee revenue across your schools'}
        actions={
          <div className="row gap8">
            <Btn icon="rupee" onClick={() => app.go('owner.revenue')}>Fee collection</Btn>
            <Btn icon="building" onClick={() => app.go('owner.schools')}>All schools</Btn>
            <Btn variant="primary" icon="plus" onClick={() => app.go('owner.create')}>Create school</Btn>
          </div>
        }
      />

      <div className="sm-kpi-grid">
        <Kpi
          icon="building" iconBg="var(--brand-50)" iconColor="var(--brand-600)"
          label="Total schools" value={fmtNum(schools.length)}
          foot={`${planCounts.platinum} Platinum · ${planCounts.gold} Gold · ${planCounts.silver} Silver`}
        />
        <Kpi
          icon="cap" iconBg="var(--info-bg)" iconColor="var(--info)"
          label="Total students" value={fmtNum(totals.students)}
          foot={`${fmtNum(totals.staff)} staff across portfolio`}
        />
        <Kpi
          icon="rupee" iconBg="var(--success-bg)" iconColor="var(--success)"
          label="School fee revenue" value={feeQ.isLoading ? '…' : fmtMoney(feeCollected)}
          foot={feeQ.isError ? 'Could not load fees' : `${fmtNum(schoolsWithCash)} schools with cash this period`}
        />
        <Kpi
          icon="alert" iconBg="var(--warning-bg)" iconColor="var(--warning)"
          label="Fees outstanding" value={feeQ.isLoading ? '…' : fmtMoney(feeOutstanding)}
          foot={feeQ.isError ? '—' : `${feeRate}% collection rate`}
        />
      </div>

      <div className="sm-grid-2">
        <Card>
          <CardHead title="School revenue by school" sub="Student fees collected this period" icon="trend"
            iconBg="var(--success-bg)" iconColor="var(--success)"
            action={<Btn size="sm" onClick={() => app.go('owner.revenue')}>Details</Btn>} />
          <div style={{ marginTop: 12 }}>
            {feeQ.isLoading ? (
              <div className="col ai-center gap8" style={{ minHeight: 160 }}><Spinner size={24} /></div>
            ) : feeBars.length === 0 ? (
              <Empty icon="rupee" title="No fee cash yet" body="Payments posted in your schools show up here." />
            ) : (
              <HBars data={feeBars} labelWidth={160} valueFmt={(v) => fmtCompact(v)} />
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Fee collected share" sub="Pie by school (cash this period)" icon="layers"
            iconBg="var(--platinum-bg)" iconColor="var(--platinum)"
            action={<Btn size="sm" onClick={() => app.go('owner.revenue')}>Fee collection</Btn>} />
          <div className="row ai-center jc-between gap16 wrap" style={{ marginTop: 12 }}>
            {feeQ.isLoading ? (
              <div className="col ai-center gap8" style={{ minHeight: 148 }}><Spinner size={24} /></div>
            ) : feeDonut.length === 0 ? (
              <Empty icon="rupee" title="No collection to chart" body="When schools take fee payments, the pie appears here." />
            ) : (
              <>
                <Donut
                  segments={feeDonut}
                  size={148} thickness={18}
                  center={
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fmtCompact(feeCollected)}</div>
                      <div className="t-xs muted3" style={{ marginTop: 2 }}>collected</div>
                    </div>
                  }
                />
                <div className="col gap12" style={{ flex: 1, minWidth: 160 }}>
                  <Legend items={feeDonut.map((d) => ({ color: d.color, label: d.label }))} />
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="sm-grid-2">
        <Card>
          <CardHead title="Outstanding by school" sub="Open student fee invoices" icon="alert"
            iconBg="var(--warning-bg)" iconColor="var(--warning)"
            action={<Btn size="sm" onClick={() => app.go('owner.revenue')}>Fee collection</Btn>} />
          <div style={{ marginTop: 12 }}>
            {feeQ.isLoading ? (
              <div className="col ai-center gap8" style={{ minHeight: 160 }}><Spinner size={24} /></div>
            ) : outstandingBars.length === 0 ? (
              <Empty icon="checkCircle" title="Nothing outstanding" body="No open fee invoices across your schools." />
            ) : (
              <HBars data={outstandingBars} labelWidth={160} valueFmt={(v) => fmtCompact(v)} />
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Attention needed" sub="Low school fee collection" icon="alert"
            iconBg="var(--danger-bg)" iconColor="var(--danger)"
            action={<Badge tone="warning">{alerts.length}</Badge>} />
          {alerts.length === 0 ? (
            <Empty icon="checkCircle" title="All healthy" body="No schools need fee-collection attention right now." />
          ) : (
            <div className="col gap12" style={{ marginTop: 12 }}>
              {alerts.map((s) => {
                const row = feeSchools.find((f) => f.tenant_id === s.id)
                const collected = Number(row?.collected ?? 0)
                const outstanding = Number(row?.outstanding ?? 0)
                const rate = collected + outstanding > 0 ? Math.round((collected / (collected + outstanding)) * 100) : 0
                return (
                  <div key={s.id} className="row ai-center gap12">
                    <SchoolMark school={s} size={34} />
                    <div style={{ flex: 1 }}>
                      <div className="t-md fw6">{s.name}</div>
                      <div className="t-xs muted3">{fmtMoney(outstanding)} outstanding</div>
                    </div>
                    <Badge tone="warning">Low fee collection — {rate}%</Badge>
                    <Btn size="sm" onClick={() => {
                      void app.enterSchool(s.id, s).then((ok) => {
                        if (!ok) toast.info('School not active', `${s.name} opens only after Catre approves payment and activates the school.`)
                      })
                    }}>Open</Btn>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

/* ============================================================
   2) Schools list (+ branded account report modal)
   ============================================================ */
function feeForSchool(school: School, feeSchools: FeeSchoolSummary[]): FeeSchoolSummary | undefined {
  return feeSchools.find((f) => f.tenant_id === school.id || (school.slug != null && f.tenant_id === school.slug))
}

function OwnerSchools() {
  const app = useApp()
  const toast = useToast()
  const qc = useQueryClient()
  const { data: clients = [], isLoading, isError } = usePortfolioSchools(app.isPlatform)
  const feeQ = useOwnerFeeSummary(true)
  const deleteMut = useDeleteSchool(app.isPlatform)
  const schoolsList = useMemo(() => clients.map(clientToSchool), [clients])
  const feeSchools = feeQ.data?.schools ?? []
  const [q, setQ] = useState('')
  const [plan, setPlan] = useState('all')
  const [status, setStatus] = useState('all')
  const [report, setReport] = useState<School | null>(null)
  const [editSchool, setEditSchool] = useState<School | null>(null)
  const [upgrade, setUpgrade] = useState<School | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<School | null>(null)
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const closeDelete = () => {
    setPendingDelete(null)
    setDeleteStep(1)
    setDeleteConfirmText('')
  }

  /** Open (enter) a school — shared by the Open button and the clickable row. */
  const openSchool = (s: School) => {
    if (opening) return
    setOpening(s.id)
    void app.enterSchool(s.id, s).then((ok) => {
      if (!ok) toast.info('School not active', `${s.name} opens only after Catre approves payment and activates the school.`)
    }).finally(() => setOpening(null))
  }

  /** Begin the 2-step delete flow — only empty schools can be deleted. */
  const startDelete = (s: School) => {
    const empty = (s.students ?? 0) === 0 && (s.staff ?? 0) === 0
    if (!empty) {
      toast.info('School not empty', `${s.name} has ${fmtNum(s.students)} student(s) and ${fmtNum(s.staff)} staff.`)
      return
    }
    setDeleteStep(1)
    setDeleteConfirmText('')
    setPendingDelete(s)
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return schoolsList.filter((s) => {
      if (plan !== 'all' && s.plan !== plan) return false
      if (status !== 'all' && s.status !== status) return false
      if (needle && !(
        s.name.toLowerCase().includes(needle)
        || s.city.toLowerCase().includes(needle)
        || (s.slug ?? '').toLowerCase().includes(needle)
      )) return false
      return true
    })
  }, [schoolsList, q, plan, status])

  const columns: Column<School>[] = [
    {
      key: 'name', label: 'School', sortValue: (s) => s.name,
      render: (s) => (
        <div className="row ai-center gap12">
          <SchoolMark school={s} size={36} />
          <div className="t-md fw6">{s.name}</div>
        </div>
      ),
    },
    {
      key: 'address', label: 'Address',
      sortValue: (s) => (s.address?.trim() || (s.city !== '—' ? s.city : '') || ''),
      render: (s) => {
        const loc = s.address?.trim() || (s.city !== '—' ? s.city : '')
        return loc
          ? (
            <div className="row ai-center gap6 t-sm" style={{ maxWidth: 240 }} title={loc}>
              <Icon name="pin" size={13} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc}</span>
            </div>
          )
          : <span className="t-sm muted3">—</span>
      },
    },
    { key: 'plan', label: 'Plan', sortValue: (s) => s.plan, render: (s) => <TierPill plan={s.plan} /> },
    {
      // Live SIS enrolment, not the purchased/billed seat count — matches the "Total students"
      // KPI (falls back to the billed count when live enrolment is unknown).
      key: 'students', label: 'Students', align: 'right',
      sortValue: (s) => s.enrolled ?? s.students,
      render: (s) => fmtNum(s.enrolled ?? s.students),
    },
    { key: 'staff', label: 'Staff', align: 'right', sortValue: (s) => s.staff, render: (s) => fmtNum(s.staff) },
    {
      key: 'collected', label: 'Collected', align: 'right',
      sortValue: (s) => Number(feeForSchool(s, feeSchools)?.collected ?? 0),
      render: (s) => {
        const fee = feeForSchool(s, feeSchools)
        return <span className="fw6">{feeQ.isLoading ? '…' : fmtMoney(Number(fee?.collected ?? 0), s.currency)}</span>
      },
    },
    {
      key: 'outstanding', label: 'Outstanding', align: 'right',
      sortValue: (s) => Number(feeForSchool(s, feeSchools)?.outstanding ?? 0),
      render: (s) => {
        const fee = feeForSchool(s, feeSchools)
        const out = Number(fee?.outstanding ?? 0)
        return (
          <span className="t-sm" style={{ color: out > 0 ? 'var(--warning)' : undefined }}>
            {feeQ.isLoading ? '…' : fmtMoney(out, s.currency)}
          </span>
        )
      },
    },
    { key: 'status', label: 'Status', sortValue: (s) => s.status, render: (s) => <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge> },
    {
      key: 'actions', label: 'Actions', align: 'center',
      render: (s) => (
        <div className="row gap6 jc-center ai-center" style={{ flexWrap: 'nowrap' }}
          onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <Popover
            align="right"
            role="menu"
            trigger={(open, toggle) => (
              <IconBtn icon="settings" size={18} active={open} aria-label="Actions" aria-expanded={open}
                onClick={(e) => { e.stopPropagation(); toggle() }} />
            )}
          >
            <MenuItem icon="edit" onClick={() => setEditSchool(s)}>Edit</MenuItem>
            <MenuItem icon="doc" onClick={() => setReport(s)}>Report</MenuItem>
            {app.isPlatform && s.plan !== 'platinum' && (
              <MenuItem icon="sparkle" onClick={() => setUpgrade(s)}>Upgrade plan</MenuItem>
            )}
            <MenuSep />
            <MenuItem icon="trash" danger onClick={() => startDelete(s)}>Delete school</MenuItem>
          </Popover>
        </div>
      ),
    },
  ]

  if (isLoading) {
    return <div className="col ai-center jc-center gap12" style={{ minHeight: 280 }}><Spinner size={28} /><div className="t-sm muted">Loading schools…</div></div>
  }
  if (isError) {
    return <Empty icon="alert" title="Could not load schools" body="Check your connection and try again." />
  }

  return (
    <div className="col gap20">
      <PageHead
        title="Schools"
        sub={`${schoolsList.length} ${schoolsList.length === 1 ? 'school' : 'schools'} in your portfolio · Click a school row to open it · Delete only when empty (0 students & 0 staff)`}
        actions={
          <div className="row gap8">
            <Btn icon="rupee" onClick={() => app.go('owner.revenue')}>Fee collection</Btn>
            <Btn variant="primary" icon="plus" onClick={() => app.go('owner.create')}>Create school</Btn>
          </div>
        }
      />

      <Card pad={false}>
        <div className="row ai-center gap12 wrap" style={{ padding: 16 }}>
          <Search value={q} onChange={setQ} placeholder="Search by name or city…" style={{ flex: 1, minWidth: 220 }} />
          <Select
            value={plan} onChange={(e) => setPlan(e.target.value)}
            options={[{ value: 'all', label: 'All plans' }, ...TIERS.map((t) => ({ value: t, label: TIER_META[t].label }))]}
          />
          <Select
            value={status} onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'trial', label: 'Trial' },
              { value: 'past_due', label: 'Past due' },
            ]}
          />
        </div>

        <DataTable<School>
          columns={columns}
          rows={rows}
          rowKey={(s) => s.id}
          pageSize={10}
          initialSort={{ key: 'collected', dir: 'desc' }}
          onRowClick={openSchool}
          bulk
          bulkActions={(selected, clear) => (
            <>
              <Btn size="sm" icon="message" onClick={() => { toast.info('Message queued', `Broadcast drafted to ${selected.length} schools.`); clear() }}>Message</Btn>
              <Btn size="sm" icon="download" onClick={() => { toast.success('Export started', `${selected.length} schools queued for export.`); clear() }}>Export</Btn>
            </>
          )}
          empty={<Empty icon="building" title="No schools match" body="Try adjusting your search or create a school." />}
        />
      </Card>

      {opening && (
        <div className="sm-overlay" style={{ display: 'grid', placeItems: 'center' }}>
          <div className="col ai-center gap14"
            style={{ background: 'var(--bg-elev)', padding: '30px 40px', borderRadius: 'var(--r-xl)', boxShadow: 'var(--sh-lg)' }}>
            <Spinner size={38} />
            <div className="t-md fw7">Opening {schoolsList.find((x) => x.id === opening)?.name ?? 'school'}…</div>
            <div className="t-xs muted3">Loading the school workspace</div>
          </div>
        </div>
      )}

      <AccountReportModal
        school={report}
        fee={report ? feeForSchool(report, feeSchools) : undefined}
        onClose={() => setReport(null)}
      />
      <EditSchoolProfileModal
        open={!!editSchool}
        school={editSchool}
        client={(clients as Client[]).find((c) => c.id === editSchool?.id) ?? null}
        isPlatform={app.isPlatform}
        onClose={() => setEditSchool(null)}
        onSaved={(s) => {
          app.rememberSchool(s)
          void qc.invalidateQueries({ queryKey: ['owner'] })
        }}
      />
      <UpgradePlanModal key={upgrade?.id} school={upgrade} onClose={() => setUpgrade(null)} isPlatform={app.isPlatform} />

      <Modal
        open={!!pendingDelete}
        onClose={closeDelete}
        size="sm"
        icon="trash"
        title={deleteStep === 1 ? 'Delete this school?' : 'Confirm permanent delete'}
        sub={pendingDelete ? `${pendingDelete.name} · step ${deleteStep} of 2` : undefined}
        footer={
          <div className="row jc-end gap8" style={{ width: '100%' }}>
            <Btn onClick={closeDelete}>Cancel</Btn>
            {deleteStep === 1 ? (
              <Btn
                variant="danger"
                icon="trash"
                disabled={!pendingDelete}
                onClick={() => setDeleteStep(2)}
              >
                Continue
              </Btn>
            ) : (
              <Btn
                variant="danger"
                icon="trash"
                disabled={
                  deleteMut.isPending
                  || !pendingDelete
                  || deleteConfirmText.trim().toUpperCase() !== 'DELETE'
                }
                onClick={() => {
                  if (!pendingDelete) return
                  deleteMut.mutate(pendingDelete.id, {
                    onSuccess: () => {
                      toast.success('School deleted', `${pendingDelete.name} was removed.`)
                      closeDelete()
                    },
                    onError: (e) => toast.danger('Delete failed', e instanceof ApiError ? e.message : 'Try again.'),
                  })
                }}
              >
                {deleteMut.isPending ? 'Deleting…' : 'Yes, delete permanently'}
              </Btn>
            )}
          </div>
        }
      >
        {deleteStep === 1 ? (
          <p className="t-sm muted">
            This school has no students or staff. Deleting removes it permanently. Click Continue to confirm in the next step.
          </p>
        ) : (
          <div className="col gap12">
            <p className="t-sm muted">
              Type <span className="fw7" style={{ color: 'var(--text)' }}>DELETE</span> to permanently remove{' '}
              <span className="fw7" style={{ color: 'var(--text)' }}>{pendingDelete?.name}</span>. This cannot be undone.
            </p>
            <Field label="Type DELETE to confirm" required>
              <Input
                icon="trash"
                value={deleteConfirmText}
                placeholder="DELETE"
                autoFocus
                onChange={(e) => setDeleteConfirmText(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ---------- Branded account report ---------- */
function AccountReportModal({ school, fee, onClose }: {
  school: School | null
  fee?: FeeSchoolSummary
  onClose: () => void
}) {
  if (!school) return null
  const s = school
  const rate = rateFor(s.students, s.plan)
  const annual = s.students * rate
  const ref = `AR-${s.id.toUpperCase()}-${new Date().getFullYear()}`
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const collected = Number(fee?.collected ?? 0)
  const outstanding = Number(fee?.outstanding ?? 0)
  const feeRate = collected + outstanding > 0
    ? Math.round((collected / (collected + outstanding)) * 1000) / 10
    : 0

  const metrics: { label: string; value: string }[] = [
    { label: 'Billed seats', value: fmtNum(s.students) },
    ...(s.enrolled != null ? [{ label: 'Enrolled (live)', value: fmtNum(s.enrolled) }] : []),
    { label: 'Staff', value: fmtNum(s.staff) },
    { label: 'Fees collected', value: fmtMoney(collected, s.currency) },
    { label: 'Fees outstanding', value: fmtMoney(outstanding, s.currency) },
  ]
  const details: { label: string; value: string }[] = [
    { label: 'Fee collection rate', value: `${feeRate}%` },
    { label: 'Open invoices', value: fmtNum(fee?.invoice_count ?? 0) },
    { label: 'Payments (period)', value: fmtNum(fee?.payment_count ?? 0) },
    { label: 'Support tier', value: s.plan === 'platinum' ? 'Dedicated' : s.plan === 'gold' ? 'Priority' : 'Standard' },
    { label: 'Time zone', value: s.tz },
    { label: 'Plan', value: TIER_META[s.plan].label },
  ]

  return (
    <Modal open={!!school} onClose={onClose} size="lg" title="Account report"
      footer={
        <div className="row jc-between" style={{ width: '100%' }}>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" icon="download" onClick={() => window.print()}>Print report</Btn>
        </div>
      }
    >
      <div className="col gap20" id="sm-account-report">
        {/* branded header underlined in the school's brand colour */}
        <SchoolCover school={s} height={140} />
        <div className="row ai-center gap16" style={{ paddingBottom: 16, borderBottom: `3px solid ${s.color}` }}>
          <SchoolMark school={s} size={56} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-lg fw7" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</div>
            <div className="t-sm muted">{s.city} · {s.currency} · {s.tz}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="t-md fw6" style={{ color: s.color }}>Account Report</div>
            <div className="t-xs muted3">{ref}</div>
            <div className="t-xs muted3">{today}</div>
          </div>
        </div>

        {/* subscription */}
        <div>
          <div className="t-sm fw6 muted" style={{ marginBottom: 10 }}>Subscription</div>
          <div className="sm-grid-3">
            <ReportTile label="Plan" value={<TierPill plan={s.plan} size="md" />} />
            <ReportTile label="Status" value={<Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>} />
            <ReportTile label="Annual value" value={<span className="fw7">{fmtMoney(annual, s.currency)}</span>} sub={`${fmtNum(s.students)} × ${s.currency} ${rate}/yr`} />
          </div>
          <div className="t-xs muted3" style={{ marginTop: 8 }}>
            {CYCLE_LABEL[s.billingCycle ?? 'month']} billing · {s.currency} {rate}/student/yr ({TIER_META[s.plan].label} band)
            {s.seatLimit ? ` · cap ${fmtNum(s.seatLimit)} seats` : ''}
          </div>
        </div>

        {/* key metrics */}
        <div>
          <div className="t-sm fw6 muted" style={{ marginBottom: 10 }}>Key metrics</div>
          <div className="sm-kpi-grid">
            {metrics.map((m) => <ReportTile key={m.label} label={m.label} value={<span className="fw7">{m.value}</span>} />)}
          </div>
        </div>

        {/* account details */}
        <div>
          <div className="t-sm fw6 muted" style={{ marginBottom: 10 }}>Account details</div>
          <div className="col gap8">
            {details.map((d) => (
              <div key={d.label} className="row ai-center jc-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                <span className="t-sm muted">{d.label}</span>
                <span className="t-sm fw6">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ReportTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="sm-card pad" style={{ background: 'var(--surface-2)' }}>
      <div className="t-xs muted3">{label}</div>
      <div style={{ marginTop: 6 }}>{value}</div>
      {sub && <div className="t-xs muted3" style={{ marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

/* ============================================================
   3) Create-school wizard (5 steps)
   ============================================================ */
const WIZARD_STEPS = ['Basics', 'Admin contact', 'Select plan', 'Modules', 'Review']

const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York']

const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
]

function formatSchoolAddress(d: Pick<WizardData, 'address' | 'district' | 'city' | 'state' | 'pincode'>): string {
  const parts = [
    d.address.trim(),
    d.district.trim(),
    d.city.trim(),
    d.state.trim(),
    d.pincode.trim() ? `PIN ${d.pincode.trim()}` : '',
  ].filter(Boolean)
  return parts.join(', ').slice(0, 300)
}

function isValidPincode(pin: string): boolean {
  return /^\d{6}$/.test(pin.trim())
}

const MODULE_OPTIONS: { key: string; label: string; desc: string; tier: Tier }[] = [
  { key: 'sis', label: 'Student Information', desc: 'Admissions, profiles, records', tier: 'silver' },
  { key: 'attendance', label: 'Attendance', desc: 'Daily marking & reports', tier: 'silver' },
  { key: 'exams', label: 'Exams & report cards', desc: 'Marks entry, results', tier: 'silver' },
  { key: 'fees', label: 'Fees & collection', desc: 'Invoicing, receipts', tier: 'silver' },
  { key: 'communication', label: 'Communication', desc: 'SMS, push, messenger', tier: 'silver' },
  { key: 'operations', label: 'Operations', desc: 'Transport, hostel & sports', tier: 'platinum' },
  { key: 'staff_support', label: 'Staff & support', desc: 'Non-teaching staff roster', tier: 'platinum' },
  { key: 'hr_payroll', label: 'HR & payroll', desc: 'Staff salary runs', tier: 'platinum' },
  { key: 'analytics', label: 'Advanced analytics', desc: 'Weak-student insights', tier: 'gold' },
  { key: 'attendance.geofence', label: 'Geo-fenced attendance', desc: 'GPS check-in / check-out for teachers & staff', tier: 'platinum' },
  { key: 'transport.gps', label: 'Transport GPS', desc: 'Live bus tracking', tier: 'platinum' },
]

type BillingCycle = 'monthly' | 'quarterly' | 'yearly'
const CYCLE_META: Record<BillingCycle, { label: string; div: number; per: string }> = {
  monthly: { label: 'Monthly', div: 12, per: '/mo' },
  quarterly: { label: 'Quarterly', div: 4, per: '/qtr' },
  yearly: { label: 'Yearly', div: 1, per: '/yr' },
}
/** Map the wizard's cycle to the API's cycle value. */
const CYCLE_API: Record<BillingCycle, import('@/api/ownerTypes').ApiBillingCycle> = {
  monthly: 'month',
  quarterly: 'quarter',
  yearly: 'year',
}
/** Human label for an API cycle value. */
const CYCLE_LABEL: Record<string, string> = {
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
}

interface WizardData {
  name: string
  /** Unique short school id (stored as tenant slug), e.g. scc or riverdale-blr */
  schoolId: string
  /** Street / building line */
  address: string
  district: string
  city: string
  state: string
  pincode: string
  tz: string
  /** http(s) URL or data-URL from upload — shown across CRM modules */
  logoUrl: string
  logoFile: File | null
  /** Campus / cover photo */
  imageUrl: string
  imageFile: File | null
  adminName: string
  adminEmail: string
  adminPhone: string
  strength: number
  tier: Tier
  planId: string
  cycle: BillingCycle
  /** offline / online — pick a Catre published plan, then pay to activate */
  payChoice: 'offline' | 'online'
  modules: Set<string>
  geofenceLat: string
  geofenceLng: string
  geofenceRadius: string
}

async function readImageDataUrl(file: File, kind: 'logo' | 'cover'): Promise<string> {
  try {
    return await compressImageFile(file, {
      maxEdge: kind === 'logo' ? 256 : 1280,
      quality: kind === 'logo' ? 0.85 : 0.8,
    })
  } catch {
    /* Fallback if canvas/createImageBitmap fails (e.g. unusual formats). */
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(reader.error ?? new Error('Could not read image'))
      reader.readAsDataURL(file)
    })
  }
}

function planTier(plan: { tier: string } | undefined): Tier {
  const t = (plan?.tier ?? 'gold').toLowerCase()
  return (TIERS as readonly string[]).includes(t) ? (t as Tier) : 'gold'
}

function estimatePlanAmount(plan: import('@/api/ownerTypes').Plan, strength: number): number {
  if (plan.pricing === 'per_student') {
    const rate = Number(plan.per_student) || 0
    const min = Number(plan.min_students) || 0
    const seats = Math.max(strength, min, 1)
    return rate * seats
  }
  return Number(plan.price) || 0
}

function CreateSchoolWizard() {
  const app = useApp()
  const toast = useToast()
  const qc = useQueryClient()
  const plansQuery = useOwnerPlans(app.isPlatform)
  const createMut = useCreateSchool(app.isPlatform)
  const publishedPlans = plansQuery.data ?? []
  const [step, setStep] = useState(0)
  const [paying, setPaying] = useState(false)
  const [data, setData] = useState<WizardData>({
    name: '', schoolId: '', address: '', district: '', city: '', state: '', pincode: '',
    tz: 'Asia/Kolkata',
    logoUrl: '', logoFile: null, imageUrl: '', imageFile: null,
    adminName: app.user?.name ?? '', adminEmail: app.user?.email ?? '', adminPhone: '',
    strength: 800, tier: 'gold', planId: '', cycle: 'yearly', payChoice: 'offline',
    modules: new Set(['sis', 'attendance', 'exams', 'fees', 'communication']),
    geofenceLat: '', geofenceLng: '', geofenceRadius: '250',
  })

  // Default to the first published plan once catalog loads.
  useEffect(() => {
    if (data.planId || publishedPlans.length === 0) return
    const first = publishedPlans[0]
    setData((d) => ({ ...d, planId: first.id, tier: planTier(first) }))
  }, [publishedPlans, data.planId])

  const selectedPlan = publishedPlans.find((p) => p.id === data.planId) ?? publishedPlans[0]

  const set = <K extends keyof WizardData>(key: K, value: WizardData[K]) =>
    setData((d) => ({ ...d, [key]: value }))

  const selectPlan = (planId: string) => {
    const plan = publishedPlans.find((p) => p.id === planId)
    setData((d) => ({
      ...d,
      planId,
      tier: planTier(plan),
    }))
  }

  const toggleModule = (key: string) =>
    setData((d) => {
      const next = new Set(d.modules)
      if (next.has(key)) next.delete(key); else next.add(key)
      return { ...d, modules: next }
    })

  const canNext = (() => {
    if (step === 0) {
      return data.name.trim() !== ''
        && isValidSchoolId(data.schoolId)
        && data.address.trim() !== ''
        && data.district.trim() !== ''
        && data.city.trim() !== ''
        && data.state.trim() !== ''
        && isValidPincode(data.pincode)
    }
    if (step === 1) return app.isPlatform
      ? data.adminName.trim() !== '' && data.adminEmail.trim() !== ''
      : true
    if (step === 2) return data.strength > 0 && !!data.planId && publishedPlans.length > 0 && !!data.payChoice
    return true
  })()

  const annual = selectedPlan
    ? estimatePlanAmount(selectedPlan, data.strength)
    : data.strength * rateFor(data.strength, data.tier)
  const cycleMeta = CYCLE_META[data.cycle]
  const cyclePrice = Math.round(annual / cycleMeta.div)

  const rollbackSchool = async (tenantId: string) => {
    try {
      if (app.isPlatform) await deleteClient(tenantId)
      else await deleteMySchool(tenantId)
      await qc.invalidateQueries({ queryKey: ['owner'] })
    } catch {
      /* best-effort cleanup if online pay cannot start */
    }
  }

  const runPayment = async (tenantId: string, planId: string, planLabel: string) => {
    const mode: UpgradeMode = data.payChoice === 'online' ? 'online' : 'offline'
    const created = await createUpgradeRequest(tenantId, planId, mode)
    if (mode === 'offline') {
      toast.success(
        'School created · awaiting Catre',
        `${data.name} is on trial with ${planLabel}. Offline payment is pending — after Catre approves, you can open the school and add students.`,
      )
      await qc.invalidateQueries({ queryKey: ['owner'] })
      app.go('owner.billing')
      return
    }

    const order = await createRazorpayOrder(created.id)
    await new Promise<void>((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: order.key_id,
        amount: order.amount_paise,
        currency: order.currency,
        name: 'SchoolMate',
        description: `Plan for ${data.name}`,
        order_id: order.order_id,
        handler: async (response: {
          razorpay_order_id: string
          razorpay_payment_id: string
          razorpay_signature: string
        }) => {
          try {
            await confirmUpgradePayment(created.id, {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            })
            toast.success('Payment received', 'Waiting for Catre approval. School unlocks after activation.')
            await qc.invalidateQueries({ queryKey: ['owner'] })
            app.go('owner.billing')
            resolve()
          } catch (e) {
            reject(e)
          }
        },
        modal: {
          ondismiss: () => {
            void (async () => {
              toast.info('Payment not completed', 'Checkout closed — school was not kept. Choose Offline pay or finish Razorpay later after keys are set.')
              await rollbackSchool(tenantId)
              app.go('owner.create')
              resolve()
            })()
          },
        },
      })
      rzp.open()
    })
  }

  const create = async () => {
    const planId = data.planId || selectedPlan?.id
    if (!planId) {
      toast.danger('No plan available', 'Catre admin must publish a plan before you can create a school.')
      return
    }

    /* Online pay: stop before create if Razorpay is missing or checkout cannot load. */
    if (data.payChoice === 'online') {
      try {
        const gw = await getPaymentGatewayStatus()
        if (!gw.razorpay_configured) {
          toast.danger(
            'Razorpay not configured',
            'School was not created. Choose Offline pay, or ask Catre to add Razorpay keys first.',
          )
          return
        }
      } catch (e) {
        toast.danger(
          'Could not verify payment',
          e instanceof ApiError ? e.message : 'School was not created. Try Offline pay or check API.',
        )
        return
      }
      const scriptOk = await loadRazorpayScript()
      if (!scriptOk || !window.Razorpay) {
        toast.danger(
          'Razorpay checkout unavailable',
          'School was not created. Choose Offline pay, or retry when checkout can load.',
        )
        return
      }
    }

    setPaying(true)
    let createdTenantId: string | null = null
    try {
      const slug = normalizeSchoolId(data.schoolId)
      if (!isValidSchoolId(slug)) {
        toast.danger('Invalid school ID', 'Use 3–40 characters: letters, numbers, hyphens (e.g. scc or riverdale-blr).')
        return
      }
      let logoUrl = data.logoUrl.trim() || undefined
      if (data.logoFile) {
        try {
          logoUrl = await readImageDataUrl(data.logoFile, 'logo')
        } catch {
          toast.danger('Logo upload failed', 'Could not read the image. Try a smaller PNG/JPG or paste a URL.')
          return
        }
      }
      let imageUrl = data.imageUrl.trim() || undefined
      if (data.imageFile) {
        try {
          imageUrl = await readImageDataUrl(data.imageFile, 'cover')
        } catch {
          toast.danger('School image upload failed', 'Could not read the photo. Try a smaller PNG/JPG or paste a URL.')
          return
        }
      }
      const fullAddress = formatSchoolAddress(data)
      const locationLabel = [data.city.trim(), data.state.trim()].filter(Boolean).join(', ')
      // Both plan types carry the entered student count now (flat plans get an included-seat count too).
      const studentsCount = data.strength > 0 ? data.strength : undefined
      const billingCycle = CYCLE_API[data.cycle]
      const client = app.isPlatform
        ? await createMut.mutateAsync({
          name: data.name.trim(),
          slug,
          country: locationLabel || data.city.trim(),
          address: fullAddress,
          logo_url: logoUrl,
          image_url: imageUrl,
          admin_name: data.adminName.trim(),
          admin_email: data.adminEmail.trim(),
          admin_phone: data.adminPhone.trim() || undefined,
          plan_id: planId,
          trial_days: 0,
          students_count: studentsCount,
          billing_cycle: billingCycle,
        })
        : await createMut.mutateAsync({
          name: data.name.trim(),
          slug,
          country: locationLabel || data.city.trim(),
          address: fullAddress,
          logo_url: logoUrl,
          image_url: imageUrl,
          plan_id: planId,
          admin_name: data.adminName.trim() || app.user?.name,
          admin_phone: data.adminPhone.trim() || undefined,
          trial_days: 0,
          students_count: studentsCount,
          billing_cycle: billingCycle,
        })

      const planLabel = selectedPlan?.name ?? TIER_META[data.tier].label
      const tenantId = client.id
      createdTenantId = tenantId

      if (!tenantId) {
        toast.danger('Could not create school', 'No school id returned.')
        return
      }

      if (data.modules.has('attendance.geofence') && data.geofenceLat && data.geofenceLng) {
        const lat = Number(data.geofenceLat)
        const lng = Number(data.geofenceLng)
        const radius = Number(data.geofenceRadius) || 250
        if (!validateGeofenceInput(lat, lng, radius)) {
          try {
            await updateSchoolProfile(tenantId, {
              lat, lng, geofence_radius_meters: radius, set_geofence: true,
            }, app.isPlatform)
          } catch {
            /* fence can be set later in Attendance → Geo-fence */
          }
        }
      }

      try {
        await runPayment(tenantId, planId, planLabel)
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Payment could not start.'
        if (data.payChoice === 'online' && createdTenantId) {
          await rollbackSchool(createdTenantId)
          toast.danger(
            'School not created',
            `${msg} Razorpay did not complete — nothing was kept. Use Offline pay or fix Razorpay keys.`,
          )
          return
        }
        toast.danger('Payment step failed', msg)
        app.go('owner.billing')
      }
    } catch (e) {
      toast.danger('Could not create school', e instanceof ApiError ? e.message : 'Try again.')
    } finally {
      setPaying(false)
    }
  }

  const busy = createMut.isPending || paying

  return (
    <div className="col gap20">
      <PageHead
        title="Create school"
        sub="Add a new tenant to your portfolio"
        actions={<Btn icon="arrowLeft" onClick={() => app.go('owner.schools')}>Back to schools</Btn>}
      />

      {/* stepper */}
      <Card>
        <div className="row ai-center jc-between wrap gap12">
          {WIZARD_STEPS.map((label, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : 'todo'
            const bg = state === 'todo' ? 'var(--surface-3)' : 'var(--brand-600)'
            const fg = state === 'todo' ? 'var(--text-3)' : '#fff'
            return (
              <div key={label} className="row ai-center gap10" style={{ flex: 1, minWidth: 130 }}>
                <span style={{
                  width: 30, height: 30, borderRadius: 999, background: bg, color: fg,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 13, flexShrink: 0,
                }}>
                  {state === 'done' ? <Icon name="check" size={15} stroke={3} /> : i + 1}
                </span>
                <div>
                  <div className="t-xs muted3">Step {i + 1}</div>
                  <div className="t-sm fw6" style={{ color: state === 'current' ? 'var(--text-1)' : undefined }}>{label}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        {step === 0 && (
          <div className="col gap16">
            <CardHead title="Basics" sub="Name, school ID, address, logo and school photo used across CRM modules" icon="building" />
            <Field label="School name" required>
              <Input icon="building" value={data.name} placeholder="e.g. Riverdale International School" onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field
              label="School ID"
              required
              hint="Unique short code for this school (letters, numbers, hyphens). You can change it later in Edit."
              error={
                data.schoolId.trim().length > 0 && !isValidSchoolId(data.schoolId)
                  ? 'Use 3–40 characters: letters, numbers, hyphens (e.g. scc or riverdale-blr)'
                  : undefined
              }
            >
              <Input
                icon="key"
                value={data.schoolId}
                placeholder="e.g. riverdale-blr"
                onChange={(e) => {
                  const next = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '')
                    .replace(/--+/g, '-')
                    .slice(0, 40)
                  set('schoolId', next)
                }}
              />
            </Field>
            <Field label="Street address" required hint="Building, street, area — used on invoices & reports.">
              <Input icon="pin" value={data.address} placeholder="e.g. 4th Floor, Prestige Tech Park" onChange={(e) => set('address', e.target.value)} />
            </Field>
            <div className="sm-grid-2">
              <Field label="District" required>
                <Input icon="pin" value={data.district} placeholder="e.g. Bengaluru Urban" onChange={(e) => set('district', e.target.value)} />
              </Field>
              <Field label="City" required>
                <Input icon="pin" value={data.city} placeholder="e.g. Bengaluru" onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="State" required>
                <Select
                  options={[
                    { value: '', label: 'Select state' },
                    ...INDIA_STATES.map((s) => ({ value: s, label: s })),
                  ]}
                  value={data.state}
                  onChange={(e) => set('state', e.target.value)}
                />
              </Field>
              <Field
                label="PIN code"
                required
                error={data.pincode.length > 0 && !isValidPincode(data.pincode) ? 'Enter a 6-digit PIN code' : undefined}
              >
                <Input
                  icon="pin"
                  inputMode="numeric"
                  maxLength={6}
                  value={data.pincode}
                  placeholder="560103"
                  onChange={(e) => set('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </Field>
              <Field label="Time zone">
                <Select options={TIMEZONES} value={data.tz} onChange={(e) => set('tz', e.target.value)} />
              </Field>
            </div>
            <div className="sm-grid-2" style={{ alignItems: 'start' }}>
              <Field
                label="School logo"
                hint="Small mark in sidebar & school switcher. PNG/JPG, under 4 MB."
              >
                <FileUpload
                  accept=".png,.jpg,.jpeg,.webp,image/*"
                  value={data.logoFile}
                  ariaLabel="Upload school logo"
                  onChange={(file) => {
                    setData((d) => ({
                      ...d,
                      logoFile: file,
                      logoUrl: file ? '' : d.logoUrl,
                    }))
                  }}
                />
              </Field>
              <Field label="Or logo URL" hint="Optional if you upload a file.">
                <Input
                  icon="globe"
                  value={data.logoUrl}
                  placeholder="https://…/logo.png"
                  onChange={(e) => setData((d) => ({ ...d, logoUrl: e.target.value, logoFile: null }))}
                />
                {!!data.logoUrl.trim() && (
                  <div className="row ai-center gap10" style={{ marginTop: 12 }}>
                    <span className="t-xs muted">URL preview</span>
                    <SchoolMark
                      school={{
                        name: data.name || 'School',
                        logo: (data.name || 'SC').slice(0, 2).toUpperCase(),
                        logoUrl: data.logoUrl.trim(),
                        color: '#4f46e5',
                      }}
                      size={48}
                    />
                  </div>
                )}
              </Field>
            </div>
            <div className="sm-grid-2" style={{ alignItems: 'start' }}>
              <Field
                label="School image"
                hint="Campus / cover photo on dashboard and school profile. PNG/JPG, under 4 MB."
              >
                <FileUpload
                  accept=".png,.jpg,.jpeg,.webp,image/*"
                  value={data.imageFile}
                  ariaLabel="Upload school image"
                  onChange={(file) => {
                    setData((d) => ({
                      ...d,
                      imageFile: file,
                      imageUrl: file ? '' : d.imageUrl,
                    }))
                  }}
                />
              </Field>
              <Field label="Or school image URL" hint="Optional if you upload a file.">
                <Input
                  icon="globe"
                  value={data.imageUrl}
                  placeholder="https://…/campus.jpg"
                  onChange={(e) => setData((d) => ({ ...d, imageUrl: e.target.value, imageFile: null }))}
                />
                {!!data.imageUrl.trim() && (
                  <img
                    src={data.imageUrl.trim()}
                    alt="School"
                    style={{
                      marginTop: 12, width: '100%', maxHeight: 120, objectFit: 'cover',
                      borderRadius: 12, border: '1px solid var(--border)',
                    }}
                  />
                )}
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="col gap16">
            <CardHead title="Admin contact" sub="Primary administrator for this school" icon="user" />
            <Field label="Administrator name" required>
              <Input icon="user" value={data.adminName} placeholder="Full name" onChange={(e) => set('adminName', e.target.value)} />
            </Field>
            <div className="sm-grid-2">
              <Field label="Email" required>
                <Input icon="message" type="email" value={data.adminEmail} placeholder="admin@school.edu" onChange={(e) => set('adminEmail', e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input icon="phone" value={data.adminPhone} placeholder="+91 90000 00000" onChange={(e) => set('adminPhone', e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <PlanStep
            data={data}
            plans={publishedPlans}
            loading={plansQuery.isLoading}
            error={plansQuery.isError}
            selectedPlan={selectedPlan}
            onStrength={(v) => set('strength', v)}
            onSelectPlan={selectPlan}
            onCycle={(c) => set('cycle', c)}
            onPayChoice={(c) => set('payChoice', c)}
          />
        )}

        {step === 3 && (
          <div className="col gap16">
            <CardHead title="Modules & features" sub="Enable the modules this school will use" icon="layers" />
            <div className="sm-grid-2">
              {MODULE_OPTIONS.map((m) => {
                const on = data.modules.has(m.key)
                const locked = TIERS.indexOf(m.tier) > TIERS.indexOf(data.tier)
                return (
                  <div key={m.key}
                    className="sm-card pad row ai-center jc-between gap12"
                    style={{
                      cursor: locked ? 'not-allowed' : 'pointer',
                      borderColor: on && !locked ? 'var(--brand-600)' : undefined,
                      opacity: locked ? 0.55 : 1,
                    }}
                    onClick={() => { if (!locked) toggleModule(m.key) }}
                  >
                    <div>
                      <div className="t-md fw6 row ai-center gap6">
                        {m.label}
                        {m.tier !== 'silver' && <TierPill plan={m.tier} />}
                      </div>
                      <div className="t-xs muted3" style={{ marginTop: 2 }}>{locked ? `Requires ${TIER_META[m.tier].label} plan` : m.desc}</div>
                    </div>
                    <Icon name={on && !locked ? 'checkCircle' : locked ? 'lock' : 'plus'} size={18}
                      style={{ color: on && !locked ? 'var(--brand-600)' : 'var(--text-3)' }} />
                  </div>
                )
              })}
            </div>
            {data.modules.has('attendance.geofence') && TIERS.indexOf('platinum') <= TIERS.indexOf(data.tier) && (
              <Card pad style={{ marginTop: 4 }}>
                <div className="t-md fw6 row ai-center gap8">
                  <Icon name="pin" size={18} />
                  Set school location (Platinum)
                </div>
                <div className="t-sm muted3" style={{ marginTop: 6, marginBottom: 12 }}>
                  Optional — stand at the school gate, capture GPS, and pick a radius so teacher check-in works on day one.
                </div>
                <div className="col gap12">
                  <div>
                    <span className="t-xs muted3">Radius preset</span>
                    <Segmented
                      value={data.geofenceRadius}
                      onChange={(v) => set('geofenceRadius', v)}
                      options={RADIUS_PRESETS.map((m) => ({ value: String(m), label: `${m} m` }))}
                    />
                  </div>
                  <div className="sm-grid-2 gap12">
                    <Field label="Latitude"><Input value={data.geofenceLat} onChange={(e) => set('geofenceLat', e.target.value)} placeholder="12.971600" /></Field>
                    <Field label="Longitude"><Input value={data.geofenceLng} onChange={(e) => set('geofenceLng', e.target.value)} placeholder="77.594600" /></Field>
                  </div>
                </div>
                <div className="row ai-center gap8 wrap" style={{ marginTop: 12 }}>
                  <Btn
                    variant="primary"
                    icon="pin"
                    onClick={() => {
                      if (!navigator.geolocation) {
                        toast.danger('GPS unavailable', 'Enter coordinates manually or set up later in Attendance.')
                        return
                      }
                      navigator.geolocation.getCurrentPosition(
                        (pos) => {
                          setData((d) => ({
                            ...d,
                            geofenceLat: String(pos.coords.latitude.toFixed(6)),
                            geofenceLng: String(pos.coords.longitude.toFixed(6)),
                          }))
                          toast.success('Campus GPS captured', 'Will be saved when the school is created.')
                        },
                        () => toast.danger('Location denied', 'Allow GPS or set the fence later in Settings → Geo-fence.'),
                        { enableHighAccuracy: true, timeout: 15000 },
                      )
                    }}
                  >
                    Set school location (GPS)
                  </Btn>
                  <Btn
                    variant="secondary"
                    icon="pin"
                    onClick={() => {
                      if (!navigator.geolocation) {
                        toast.danger('GPS unavailable', 'Enter coordinates manually or set up later in Attendance.')
                        return
                      }
                      navigator.geolocation.getCurrentPosition(
                        (pos) => {
                          setData((d) => ({
                            ...d,
                            geofenceLat: String(pos.coords.latitude.toFixed(6)),
                            geofenceLng: String(pos.coords.longitude.toFixed(6)),
                          }))
                          toast.success('Campus GPS captured', 'Will be saved when the school is created.')
                        },
                        () => toast.danger('Location denied', 'Allow GPS or set the fence later in Settings → Geo-fence.'),
                        { enableHighAccuracy: true, timeout: 15000 },
                      )
                    }}
                  >
                    Capture GPS only
                  </Btn>
                </div>
              </Card>
            )}
          </div>
        )}

        {step === 4 && <ReviewStep data={data} plan={selectedPlan} />}

        {/* nav buttons + running price summary */}
        <div className="sm-divider" style={{ margin: '20px 0 16px' }} />
        <div className="row ai-center jc-between gap12 wrap">
          <Btn icon="arrowLeft" disabled={step === 0 || busy} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</Btn>
          <div className="row ai-center gap8 t-sm muted" style={{ marginLeft: 'auto' }}>
            <TierPill plan={data.tier} />
            <span className="t-xs">{selectedPlan?.name ?? 'No plan'}</span>
            <span>{fmtNum(data.strength)} students ·</span>
            <span className="fw7" style={{ color: 'var(--text)' }}>{fmtMoney(cyclePrice)}{cycleMeta.per}</span>
          </div>
          {step < WIZARD_STEPS.length - 1 ? (
            <Btn variant="primary" iconRight="arrowRight" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Btn>
          ) : (
            <Btn variant="primary" icon="check" disabled={busy || !data.planId} onClick={() => { void create() }}>
              {busy
                ? 'Working…'
                : data.payChoice === 'online'
                  ? `Create & pay · ${fmtMoney(cyclePrice)}${cycleMeta.per}`
                  : 'Create & request offline payment'}
            </Btn>
          )}
        </div>
      </Card>
    </div>
  )
}

/* ---------- Wizard step 3: pick a published Catre plan + payment ---------- */
function PlanStep({
  data, plans, loading, error, selectedPlan, onStrength, onSelectPlan, onCycle, onPayChoice,
}: {
  data: WizardData
  plans: import('@/api/ownerTypes').Plan[]
  loading: boolean
  error?: boolean
  selectedPlan: import('@/api/ownerTypes').Plan | undefined
  onStrength: (v: number) => void
  onSelectPlan: (planId: string) => void
  onCycle: (c: BillingCycle) => void
  onPayChoice: (c: WizardData['payChoice']) => void
}) {
  const [razorpayOk, setRazorpayOk] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    void getPaymentGatewayStatus()
      .then((g) => { if (!cancelled) setRazorpayOk(!!g.razorpay_configured) })
      .catch(() => { if (!cancelled) setRazorpayOk(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (razorpayOk === false && data.payChoice === 'online') onPayChoice('offline')
  }, [razorpayOk, data.payChoice, onPayChoice])

  const strength = data.strength
  const cm = CYCLE_META[data.cycle]
  const amount = selectedPlan ? estimatePlanAmount(selectedPlan, strength) : 0
  const cycleSel = Math.round(amount / cm.div)

  if (loading) {
    return (
      <div className="col ai-center jc-center gap12" style={{ minHeight: 200 }}>
        <Spinner size={28} />
        <div className="t-sm muted">Loading published plans…</div>
      </div>
    )
  }

  if (error) {
    return (
      <Empty
        icon="alert"
        title="Could not load plans"
        body="Check your connection, then reopen Create school. School owners need GET /me/plans."
      />
    )
  }

  if (plans.length === 0) {
    return (
      <Empty
        icon="layers"
        title="No published plans"
        body="Ask Catre admin to publish a plan (visibility public/published). Only those plans appear here."
      />
    )
  }

  return (
    <div className="col gap16">
      <CardHead
        title="Select plan & payment"
        sub="Choose a Catre published plan, then Offline or Razorpay. Trial plans from Catre appear in the list above."
        icon="rupee"
      />

      <div className="sm-grid-2">
        <Field label="Expected student strength" hint="Used for per-student plan estimates.">
          <Input icon="users" type="number" min={1} value={strength}
            onChange={(e) => onStrength(Math.max(0, parseInt(e.target.value || '0', 10)))} />
        </Field>
        <Field label="Billing cycle" hint="Display estimate only.">
          <Segmented
            value={data.cycle}
            onChange={(v) => onCycle(v as BillingCycle)}
            options={(Object.keys(CYCLE_META) as BillingCycle[]).map((c) => ({ value: c, label: CYCLE_META[c].label }))}
          />
        </Field>
      </div>

      <div className="sm-grid-3">
        {plans.map((p) => {
          const tier = planTier(p)
          const m = TIER_META[tier]
          const total = estimatePlanAmount(p, strength)
          const cyclePrice = Math.round(total / cm.div)
          const selected = data.planId === p.id
          const accent = p.color || m.color
          const rateLabel = p.pricing === 'per_student'
            ? `₹${Number(p.per_student) || 0}/student`
            : `${fmtMoney(Number(p.price) || 0)} flat`
          return (
            <div key={p.id}
              className="sm-card pad col gap10"
              style={{ cursor: 'pointer', borderColor: selected ? accent : undefined, borderWidth: selected ? 2 : undefined }}
              onClick={() => onSelectPlan(p.id)}
            >
              <div className="row ai-center jc-between gap8 wrap">
                <div className="t-md fw7">{p.name}</div>
                <TierPill plan={tier} size="md" />
              </div>
              {p.description && <div className="t-xs muted3">{p.description}</div>}
              <div>
                <div className="row ai-end gap6">
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--font-display)', lineHeight: 1 }}>{fmtMoney(cyclePrice)}</div>
                  <div className="t-xs muted3" style={{ marginBottom: 2 }}>{cm.per}</div>
                </div>
                <div className="t-xs muted3" style={{ marginTop: 3 }}>
                  {rateLabel} · {p.period || 'monthly'} · published
                </div>
              </div>
              <div className="row ai-center gap6 t-xs fw6" style={{ color: selected ? accent : 'var(--text-3)' }}>
                <Icon name={selected ? 'checkCircle' : 'plus'} size={15} />
                {selected ? 'Selected' : 'Choose plan'}
              </div>
            </div>
          )
        })}
      </div>

      <div className="col gap8">
        <div className="t-sm fw6">Payment method</div>
        {razorpayOk === false && (
          <div className="t-xs muted" style={{ color: 'var(--danger, #b91c1c)' }}>
            Razorpay is not configured — online pay is unavailable. Use Offline pay, or ask Catre to add keys.
          </div>
        )}
        {([
          { value: 'offline' as const, title: 'Pay offline', desc: 'Bank / NEFT. Catre confirms payment then activates the plan.', disabled: false },
          {
            value: 'online' as const,
            title: 'Pay online (Razorpay)',
            desc: razorpayOk === false
              ? 'Unavailable — Razorpay keys missing. Choose Offline pay.'
              : 'Pay now. School is created only after checkout can start. Catre approves after payment.',
            disabled: razorpayOk === false,
          },
        ]).map((opt) => {
          const on = data.payChoice === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              className="sm-card pad"
              disabled={opt.disabled}
              style={{
                textAlign: 'left',
                cursor: opt.disabled ? 'not-allowed' : 'pointer',
                opacity: opt.disabled ? 0.55 : 1,
                borderColor: on ? 'var(--brand-600)' : undefined,
                borderWidth: on ? 2 : undefined,
                background: 'var(--surface)',
              }}
              onClick={() => { if (!opt.disabled) onPayChoice(opt.value) }}
            >
              <div className="fw7">{opt.title}</div>
              <div className="t-xs muted" style={{ marginTop: 4 }}>{opt.desc}</div>
            </button>
          )
        })}
      </div>

      <div className="sm-card pad row ai-center gap10 wrap" style={{ background: 'var(--brand-50)' }}>
        <Icon name="rupee" size={18} style={{ color: 'var(--brand-600)' }} />
        <span className="t-md fw6">
          {selectedPlan?.name ?? 'Plan'} · {cm.label} · {fmtMoney(cycleSel)}{cm.per}
        </span>
        <Badge tone="info" style={{ marginLeft: 'auto' }}>
          {data.payChoice === 'offline' ? 'Offline payment' : 'Razorpay'}
        </Badge>
      </div>
    </div>
  )
}

/* ---------- Wizard step 5: review ---------- */
function ReviewStep({ data, plan }: { data: WizardData; plan: import('@/api/ownerTypes').Plan | undefined }) {
  const amount = plan ? estimatePlanAmount(plan, data.strength) : data.strength * rateFor(data.strength, data.tier)
  const cm = CYCLE_META[data.cycle]
  const cyclePrice = Math.round(amount / cm.div)
  const payLabel =
    data.payChoice === 'offline'
      ? 'Pay offline — Catre activates after confirming payment'
      : 'Pay online (Razorpay) — Catre activates after payment'
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'School name', value: data.name || '—' },
    { label: 'School ID', value: data.schoolId ? normalizeSchoolId(data.schoolId) : '—' },
    { label: 'Street address', value: data.address || '—' },
    { label: 'District', value: data.district || '—' },
    { label: 'City', value: data.city || '—' },
    { label: 'State', value: data.state || '—' },
    { label: 'PIN code', value: data.pincode || '—' },
    { label: 'Time zone', value: data.tz },
    {
      label: 'Logo',
      value: data.logoFile
        ? `Uploaded · ${data.logoFile.name}`
        : data.logoUrl.trim()
          ? (
            <SchoolMark
              school={{
                name: data.name || 'School',
                logo: (data.name || 'SC').slice(0, 2).toUpperCase(),
                logoUrl: data.logoUrl.trim(),
                color: '#4f46e5',
              }}
              size={36}
            />
          )
          : 'Initials (no logo)',
    },
    {
      label: 'School image',
      value: data.imageFile
        ? `Uploaded · ${data.imageFile.name}`
        : data.imageUrl.trim()
          ? 'Image URL set'
          : '—',
    },
    { label: 'Administrator', value: data.adminName || '—' },
    { label: 'Admin email', value: data.adminEmail || '—' },
    { label: 'Admin phone', value: data.adminPhone || '—' },
    { label: 'Student strength', value: fmtNum(data.strength) },
    { label: 'Published plan', value: plan?.name ?? '—' },
    { label: 'Tier', value: <TierPill plan={data.tier} /> },
    { label: 'Billing cycle', value: cm.label },
    { label: `Estimate (${cm.label.toLowerCase()})`, value: <span className="fw7">{fmtMoney(cyclePrice)}{cm.per}</span> },
    { label: 'Payment', value: payLabel },
    { label: 'Modules enabled', value: `${data.modules.size} modules` },
  ]
  return (
    <div className="col gap16">
      <CardHead title="Review & confirm" sub="Verify the details before creating the school" icon="checkCircle" />
      <div className="col gap8">
        {rows.map((r) => (
          <div key={r.label} className="row ai-center jc-between" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <span className="t-sm muted">{r.label}</span>
            <span className="t-sm fw6" style={{ textAlign: 'right', maxWidth: '60%' }}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------- export contract ---------- */
export const portfolioScreens: Record<string, ComponentType> = {
  'owner.dashboard': OwnerDashboard,
  'owner.schools': OwnerSchools,
  'owner.create': CreateSchoolWizard,
}
