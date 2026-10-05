/* ============================================================
   SchoolMate — Sidebar (console + role aware navigation)
   ============================================================ */
import { useApp } from '@/lib/hooks'
import catreLogo from '@/assets/catre-logo.jpeg'
import { Icon, Btn, Tip, TierPill } from '@/components/ui'
import { SchoolMark } from '@/components/SchoolMark'
import { tierIncludes, gateRole, requiredTier } from '@/lib/gating'
import { useApprovals } from '@/api/hooks/useApprovals'
import { approvalsForRole } from '@/api/approvals'
import type { Role } from '@/types'

interface NavItem { label: string; view: string; icon: string; lockFeature?: string; adminOnly?: boolean; badge?: number }
interface NavGroup { label?: string; items: NavItem[] }

const OWNER_NAV: NavGroup[] = [
  { items: [
    { label: 'Overview', view: 'owner.dashboard', icon: 'grid' },
    { label: 'Schools', view: 'owner.schools', icon: 'building' },
  ] },
  { label: 'Insights', items: [
    { label: 'Cross-school reports', view: 'owner.reports', icon: 'trend' },
    { label: 'Fee collection', view: 'owner.revenue', icon: 'rupee' },
    { label: 'Subscriptions & billing', view: 'owner.billing', icon: 'wallet' },
  ] },
  { label: 'Workspace', items: [
    { label: 'Users & roles', view: 'owner.users', icon: 'users' },
    { label: 'Owner settings', view: 'owner.settings', icon: 'settings' },
  ] },
]

function schoolNav(role: Role, approvalCount: number): NavGroup[] {
  return [
    { items: [
      { label: 'Dashboard', view: 'school.dashboard', icon: 'grid' },
      { label: 'Approvals', view: 'school.approvals', icon: 'inbox', badge: approvalCount || undefined },
    ] },
    { label: 'People', items: [
      { label: 'Students (SIS)', view: 'school.sis', icon: 'users' },
      { label: 'Teachers', view: 'school.teachers', icon: 'cap' },
      { label: 'Staff & support', view: 'school.staff', icon: 'briefcase', lockFeature: 'staff_support' },
      { label: 'Parents', view: 'school.parents', icon: 'user' },
    ] },
    { label: 'Academic', items: [
      { label: 'Academics', view: 'school.academics', icon: 'book' },
      { label: 'Calendar', view: 'school.calendar', icon: 'calendar' },
      { label: 'PTM', view: 'school.ptm', icon: 'users' },
      { label: 'Attendance', view: 'school.attendance', icon: 'checkCircle' },
      { label: 'Exams & grading', view: 'school.exams', icon: 'clipboard' },
    ] },
    { label: 'Operations', items: [
      { label: 'Fees', view: 'school.fees', icon: 'rupee' },
      { label: 'HR & Payroll', view: 'school.hr', icon: 'wallet', lockFeature: 'hr_payroll' },
      { label: 'Communication', view: 'school.comm', icon: 'message' },
      { label: 'Transport', view: 'school.transport', icon: 'bus', lockFeature: 'operations' },
      { label: 'Live bus tracking', view: 'school.gps', icon: 'zap', lockFeature: 'transport.gps' },
      { label: 'Hostel & sports', view: 'school.ops', icon: 'box', lockFeature: 'operations' },
    ] },
    { label: 'Administration', items: [
      { label: 'Reports', view: 'school.reports', icon: 'trend' },
      { label: 'Identity & access', view: 'school.identity', icon: 'key', adminOnly: true },
      { label: 'Settings', view: 'school.settings', icon: 'settings' },
    ].filter((i) => !i.adminOnly || gateRole(role) === 'admin') },
  ]
}

export function Sidebar() {
  const app = useApp()
  const isOwner = app.consoleKind === 'owner'
  const { data: approvalsData } = useApprovals({ status: 'pending', enabled: !isOwner })
  const approvalCount = isOwner ? 0 : approvalsForRole(approvalsData ?? [], app.role).length
  const groups = isOwner ? OWNER_NAV : schoolNav(app.role, approvalCount)

  return (
    <aside className="sm-sidebar">
      <div className="sm-sidebar-head">
        <img className="sm-sidebar-logo" src={catreLogo} alt="SchoolMate by Catre Technologies" />
        <div className="sm-sidebar-brand">SchoolMate<small>{isOwner ? 'Owner console' : 'School console'}</small></div>
      </div>

      {!isOwner && (
        <div style={{ padding: '12px 12px 0' }}>
          <div className="sm-school-switch" style={{ width: '100%' }}>
            <SchoolMark school={app.school} size={34} />
            <div className="flex1" style={{ minWidth: 0 }}>
              <div className="fw6 t-sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{app.school.name}</div>
              <div className="t-xs muted3">{app.school.city}</div>
            </div>
            <TierPill plan={app.plan} />
          </div>
        </div>
      )}

      <nav className="sm-nav">
        {groups.map((g, gi) => (
          <div className="sm-nav-group" key={gi}>
            {g.label && <div className="sm-nav-label">{g.label}</div>}
            {g.items.map((it) => {
              const locked = it.lockFeature && !tierIncludes(app.plan, it.lockFeature)
              return (
                <button key={it.view} className={['sm-nav-item', app.view === it.view && 'on'].filter(Boolean).join(' ')} onClick={() => app.go(it.view)}>
                  <span className="sm-nav-ic"><Icon name={it.icon} size={17} /></span>
                  <span className="flex1" style={{ textAlign: 'left' }}>{it.label}</span>
                  {it.badge != null && <span className="sm-nav-badge">{it.badge}</span>}
                  {locked && it.lockFeature && <Tip text={`${requiredTier(it.lockFeature)} feature`}><span className="sm-nav-lock"><Icon name="lock" size={13} /></span></Tip>}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {!isOwner && app.plan !== 'platinum' && (
        <div className="sm-sidebar-foot">
          <div className="sm-upsell">
            <div className="t">Unlock more</div>
            <div className="s">Upgrade for {app.plan === 'silver' ? 'advanced analytics' : 'HR, payroll, live GPS & geo-fencing'}.</div>
            <Btn size="sm" variant={app.plan === 'silver' ? 'gold' : 'platinum'} icon="sparkle" style={{ width: '100%' }}
              onClick={() => app.upgrade(app.plan === 'silver' ? 'gold' : 'platinum')}>
              Upgrade plan
            </Btn>
          </div>
        </div>
      )}
    </aside>
  )
}
