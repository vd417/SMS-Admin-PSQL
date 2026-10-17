/* ============================================================
   SchoolMate — Content primitives: Card, CardHead, Empty,
   Kpi, PageHead
   ============================================================ */
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icon'
import { Spark } from '@/components/charts/Charts'

export function Card({ pad = true, hover, className, style, children, onClick }: {
  pad?: boolean; hover?: boolean; className?: string; style?: CSSProperties; children: ReactNode; onClick?: () => void
}) {
  return (
    <div className={['sm-card', pad && 'pad', hover && 'hover', className].filter(Boolean).join(' ')} style={style} onClick={onClick}>
      {children}
    </div>
  )
}

export function CardHead({ title, sub, icon, iconBg, iconColor, action }: {
  title: ReactNode; sub?: ReactNode; icon?: string; iconBg?: string; iconColor?: string; action?: ReactNode
}) {
  return (
    <div className="sm-card-head">
      <div className="row ai-center gap12">
        {icon && <span className="sm-card-ic" style={{ background: iconBg, color: iconColor }}><Icon name={icon} size={16} /></span>}
        <div>
          <div className="sm-card-title">{title}</div>
          {sub && <div className="sm-card-sub">{sub}</div>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function Empty({ icon = 'inbox', title, body, action }: { icon?: string; title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="sm-empty">
      <div className="sm-empty-ic"><Icon name={icon} size={26} /></div>
      <div className="sm-empty-title">{title}</div>
      {body && <div className="sm-empty-body">{body}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  )
}

export function Kpi({ icon, iconBg, iconColor, label, value, delta, deltaDir, foot, spark, sparkColor }: {
  icon: string; iconBg?: string; iconColor?: string; label: ReactNode; value: ReactNode;
  delta?: ReactNode; deltaDir?: 'up' | 'down'; foot?: ReactNode; spark?: number[]; sparkColor?: string
}) {
  return (
    <div className="sm-kpi" style={iconColor ? ({ '--kpi-accent': iconColor } as CSSProperties) : undefined}>
      <div className="row ai-center jc-between">
        <div className="row ai-center gap10">
          <span className="sm-kpi-ic" style={{ background: iconBg, color: iconColor }}><Icon name={icon} size={18} /></span>
          <div className="sm-kpi-label">{label}</div>
        </div>
        {delta != null && (
          <span className={`sm-stat-delta ${deltaDir === 'down' ? 'down' : 'up'}`}>
            <Icon name="trend" size={13} />{delta}
          </span>
        )}
      </div>
      <div className="sm-kpi-val" style={{ marginTop: 12 }}>{value}</div>
      {spark && <div style={{ marginTop: 8 }}><Spark data={spark} w={160} h={32} color={sparkColor || 'var(--brand-600)'} /></div>}
      {foot && <div className="sm-kpi-foot">{foot}</div>}
    </div>
  )
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sm-pagehead">
      <div>
        <h1 className="sm-pagehead-title">{title}</h1>
        {sub && <div className="sm-pagehead-sub">{sub}</div>}
      </div>
      {actions && <div className="sm-pagehead-actions">{actions}</div>}
    </div>
  )
}
