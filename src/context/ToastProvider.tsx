/* ============================================================
   SchoolMate — Toast notifications
   ============================================================ */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'

type ToastTone = 'success' | 'info' | 'danger'
interface Toast { id: number; tone: ToastTone; title: string; sub?: string }

interface ToastApi {
  success: (title: string, sub?: string) => void
  info: (title: string, sub?: string) => void
  danger: (title: string, sub?: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((list) => list.filter((x) => x.id !== id))
  }, [])

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer))
      timersRef.current.clear()
    }
  }, [])

  const push = useCallback((tone: ToastTone, title: string, sub?: string) => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, tone, title, sub }])
    const timer = setTimeout(() => {
      timersRef.current.delete(id)
      setToasts((t) => t.filter((x) => x.id !== id))
    }, 4000)
    timersRef.current.set(id, timer)
  }, [])

  const api: ToastApi = {
    success: (t, s) => push('success', t, s),
    info: (t, s) => push('info', t, s),
    danger: (t, s) => push('danger', t, s),
  }

  const toneIcon = (tone: ToastTone) => tone === 'success' ? 'checkCircle' : tone === 'danger' ? 'alert' : 'bell'

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="sm-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`sm-toast sm-toast-${t.tone}`}>
            <span className="sm-toast-ic"><Icon name={toneIcon(t.tone)} size={18} /></span>
            <div className="sm-toast-body">
              <div className="sm-toast-title">{t.title}</div>
              {t.sub && <div className="sm-toast-sub">{t.sub}</div>}
            </div>
            <button className="sm-toast-x" onClick={() => dismiss(t.id)}><Icon name="x" size={15} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
