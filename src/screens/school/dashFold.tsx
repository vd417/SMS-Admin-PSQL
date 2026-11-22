import { useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui'
import './dashboardBoard.css'

export function DashFold({ title, sub, art, children }: {
  title: string
  sub: string
  art: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="sd-fold">
      <button type="button" className="sd-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {art}
        <span className="sd-fold-copy">
          <span className="sd-fold-title">{title}</span>
          <span className="sd-fold-sub">{sub}</span>
        </span>
        <span className={`sd-fold-chev${open ? ' open' : ''}`}><Icon name="chevDown" size={16} /></span>
      </button>
      {open ? <div className="sd-people sd-people-4">{children}</div> : null}
    </section>
  )
}

export function DashStat({
  tone, label, value, sub, art,
}: {
  tone: 'violet' | 'green' | 'blue' | 'peach'
  label: string
  value: string
  sub: string
  art: ReactNode
}) {
  return (
    <div className={`sd-person sd-stat ${tone}`}>
      <div className="sd-person-main">
        <div className="sd-person-label">{label}</div>
        <div className="sd-person-val">{value}</div>
        <div className="sd-person-sub">{sub}</div>
      </div>
      {art}
    </div>
  )
}
