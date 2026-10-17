/* ============================================================
   SchoolMate — AI assistant. Opened from the Topbar "AI" button
   (window 'sm:open-ai' event) and shown as a centered modal in the
   middle of the screen. Mounted once in Shell (App.tsx). Reuses
   AiSearchScreen unmodified.
   ============================================================ */
import { useEffect, useState } from 'react'
import { useApp } from '@/lib/hooks'
import { tierIncludes } from '@/lib/gating'
import { Icon } from '@/components/ui'
import { TierGate } from '@/components/shell/gates'
import { AiSearchScreen } from '@/screens/school/aiSearch'

export function AiFloatingButton() {
  const app = useApp()
  const [open, setOpen] = useState(false)

  // The Topbar "AI" button opens the assistant.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('sm:open-ai', onOpen)
    return () => window.removeEventListener('sm:open-ai', onOpen)
  }, [])

  // Esc closes it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // AI is available in the owner console, or in an active school (platform always).
  const available = (app.consoleKind === 'school' || app.consoleKind === 'owner')
    && !(app.consoleKind === 'school' && app.school.status !== 'active' && !app.isPlatform)

  useEffect(() => { if (!available) setOpen(false) }, [available])

  if (!available || !open) return null

  const live = app.consoleKind === 'owner' || tierIncludes(app.plan, 'ai_search')

  return (
    <div
      className="sm-ai-overlay"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        className="sm-card sm-ai-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(680px, 96vw)', maxHeight: '88vh', overflow: 'auto', position: 'relative', padding: 0 }}
      >
        <button
          className="sm-iconbtn"
          onClick={() => setOpen(false)}
          aria-label="Close AI"
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}
        >
          <Icon name="x" size={18} />
        </button>
        {/* Owner console isn't scoped to one school's plan — the owner always gets live AI.
            Inside a school, access is bound to that school's own plan. */}
        {live ? (
          <AiSearchScreen role={app.role} userName={app.user?.name} />
        ) : (
          <TierGate feature="ai_search" title="AI Mode" blurb="Ask natural-language questions about your school on the Platinum plan.">
            <div />
          </TierGate>
        )}
      </div>
    </div>
  )
}
