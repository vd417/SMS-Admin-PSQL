/* ============================================================
   SchoolMate — Overlays: Modal, Drawer, Tooltip
   ============================================================ */
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

function useEscClose(open: boolean, onClose?: () => void) {
  useEffect(() => {
    if (!open || !onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])
}

/** First paint: ignore pointer hits so the opening click cannot press Continue. No React re-render. */
function useDelayPointer(open: boolean, ms = 400) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!open || !el) return
    el.classList.remove('is-ready')
    const t = window.setTimeout(() => el.classList.add('is-ready'), ms)
    return () => window.clearTimeout(t)
  }, [open, ms])
  return ref
}

function mountOverlay(node: ReactNode) {
  // Vitest queries the render container; portal to body in the real app so the
  // overlay sits above Google Maps without breaking existing tests.
  if (import.meta.env.VITEST || typeof document === 'undefined') return node
  return createPortal(node, document.body)
}

export function Modal({ open, onClose, size = 'md', icon, title, sub, children, footer, closeOnOverlay = true }: {
  open: boolean; onClose?: () => void; size?: ModalSize; icon?: string; title?: ReactNode; sub?: ReactNode; children?: ReactNode; footer?: ReactNode
  /** Backdrop click closes. Off for confirm dialogs so the opening click cannot dismiss or skip a step. */
  closeOnOverlay?: boolean
}) {
  useEscClose(open, onClose)
  const overlayRef = useDelayPointer(open)
  if (!open || typeof document === 'undefined') return null
  const dismissOverlay = (e: MouseEvent) => {
    if (!closeOnOverlay) return
    if (e.target === e.currentTarget) onClose?.()
  }
  return mountOverlay(
    <div
      ref={overlayRef}
      className="sm-overlay sm-overlay-delay"
      onMouseDown={dismissOverlay}
      onClick={dismissOverlay}
    >
      <div
        className={`sm-modal sm-modal-${size}`}
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || icon) && (
          <div className="sm-modal-head">
            <div className="row ai-center gap12">
              {icon && <span className="sm-modal-ic"><Icon name={icon} size={18} /></span>}
              <div>
                {title && <div className="sm-modal-title">{title}</div>}
                {sub && <div className="sm-card-sub">{sub}</div>}
              </div>
            </div>
            {onClose && <button className="sm-iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>}
          </div>
        )}
        <div className="sm-modal-body">{children}</div>
        {footer && <div className="sm-modal-foot">{footer}</div>}
      </div>
    </div>,
  )
}

export function Drawer({ open, onClose, width = 460, icon, title, sub, children, footer }: {
  open: boolean; onClose?: () => void; width?: number; icon?: string; title?: ReactNode; sub?: ReactNode; children?: ReactNode; footer?: ReactNode
}) {
  useEscClose(open, onClose)
  if (!open || typeof document === 'undefined') return null
  return mountOverlay(
    <div className="sm-overlay sm-overlay-r is-ready" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="sm-drawer" style={{ width }} role="dialog" aria-modal="true">
        {(title || icon) && (
          <div className="sm-modal-head">
            <div className="row ai-center gap12">
              {icon && <span className="sm-modal-ic"><Icon name={icon} size={18} /></span>}
              <div>
                {title && <div className="sm-modal-title">{title}</div>}
                {sub && <div className="sm-card-sub">{sub}</div>}
              </div>
            </div>
            {onClose && <button className="sm-iconbtn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>}
          </div>
        )}
        <div className="sm-drawer-body">{children}</div>
        {footer && <div className="sm-modal-foot">{footer}</div>}
      </div>
    </div>,
  )
}

export function Tip({ text, children, bottom }: { text: ReactNode; children: ReactNode; bottom?: boolean }) {
  return (
    <span className="sm-tip-wrap">
      {children}
      <span className={['sm-tip', bottom && 'sm-tip-bottom'].filter(Boolean).join(' ')}>{text}</span>
    </span>
  )
}
