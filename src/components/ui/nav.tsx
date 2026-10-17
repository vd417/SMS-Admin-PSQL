/* ============================================================
   SchoolMate — Navigation primitives: Tabs, Segmented,
   Breadcrumb, Popover, Menu
   ============================================================ */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export interface TabItem { value: string; label: ReactNode; count?: number; icon?: string }
export function Tabs({ value, onChange, tabs }: { value: string; onChange: (v: string) => void; tabs: TabItem[] }) {
  return (
    <div className="sm-tabs">
      {tabs.map((t) => (
        <button key={t.value} className={['sm-tab', value === t.value && 'on'].filter(Boolean).join(' ')} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={15} />}
          {t.label}
          {t.count != null && <span className="sm-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export interface SegItem { value: string; label: ReactNode }
export function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: SegItem[] }) {
  return (
    <div className="sm-seg">
      {options.map((o) => (
        <button key={o.value} className={['sm-seg-btn', value === o.value && 'on'].filter(Boolean).join(' ')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface Crumb { label: ReactNode; onClick?: () => void }
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <div className="sm-crumb">
      {items.map((c, i) => (
        <span key={i} className="sm-crumb">
          {i > 0 && <span className="sm-crumb-sep"><Icon name="chevRight" size={13} /></span>}
          {i === items.length - 1 || !c.onClick
            ? <span className="sm-crumb-cur">{c.label}</span>
            : <button className="sm-crumb-link" onClick={c.onClick}>{c.label}</button>}
        </span>
      ))}
    </div>
  )
}

/* Popover — click trigger to toggle a floating panel, closes on outside click.
   `role` is opt-in (e.g. "menu") for consumers whose panel content is a list of
   actionable MenuItems; omit it for panels holding non-interactive content
   (e.g. a notifications list) where an ARIA menu role would be incorrect. */
export function Popover({ trigger, children, align = 'right', role }: { trigger: (open: boolean, toggle: () => void) => ReactNode; children: ReactNode; align?: 'left' | 'right'; role?: string }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // The menu renders in a body portal (position:fixed) so it is never clipped by a
  // scrollable/overflow-hidden ancestor such as a data-table wrapper. Its position is
  // measured from the trigger and kept in sync on scroll/resize while open.
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null)

  const place = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(align === 'right'
      ? { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }
      : { top: r.bottom + 8, left: r.left })
  }

  useLayoutEffect(() => { if (open) place() }, [open])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    const onMove = () => place()
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  const style: CSSProperties = { position: 'fixed', top: pos?.top ?? -9999, left: pos?.left, right: pos?.right }
  return (
    <div className="sm-pop-wrap" ref={triggerRef}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && createPortal(
        <div ref={menuRef} className={`sm-pop sm-pop-${align}`} role={role} style={style} onClick={() => setOpen(false)}>{children}</div>,
        document.body,
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, danger }: { icon?: string; children: ReactNode; onClick?: () => void; danger?: boolean }) {
  return (
    <button role="menuitem" className={['sm-menu-item', danger && 'danger'].filter(Boolean).join(' ')} onClick={onClick}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  )
}
export function MenuSep() { return <div className="sm-menu-sep" /> }
export function MenuLabel({ children }: { children: ReactNode }) { return <div className="sm-menu-label">{children}</div> }
