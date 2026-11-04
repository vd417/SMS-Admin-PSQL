/* ============================================================
   SchoolMate — App root: providers + shell
   ============================================================ */
import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/context/ToastProvider'
import { ThemeProvider } from '@/context/ThemeProvider'
import { AppProvider } from '@/context/AppProvider'
import { useApp } from '@/lib/hooks'
import { Sidebar } from '@/components/shell/Sidebar'
import { Topbar } from '@/components/shell/Topbar'
import { Tweaks } from '@/components/shell/Tweaks'
import { AiFloatingButton } from '@/components/shell/AiFloatingButton'
import { LoginScreen } from '@/screens/LoginScreen'
import { Router } from '@/router'
import { PendingActivationScreen } from '@/components/shell/gates'
import { useAttendanceLiveSocket } from '@/api/hooks/useAttendanceLive'
import { useThreadsLiveSocket } from '@/api/hooks/useThreadsLive'
import { registerWebPush } from '@/lib/webPush'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function Shell() {
  const app = useApp()
  useAttendanceLiveSocket(app.loggedIn && app.consoleKind === 'school')
  useThreadsLiveSocket(app.loggedIn && app.consoleKind === 'school')
  useEffect(() => {
    if (app.loggedIn) void registerWebPush()
  }, [app.loggedIn])
  if (app.sessionRestoring) {
    return (
      <div className="col ai-center jc-center" style={{ minHeight: '100vh', gap: 12 }}>
        <div className="t-sm muted">Restoring session…</div>
      </div>
    )
  }
  if (!app.loggedIn) return <LoginScreen />
  const pendingActivation = app.consoleKind === 'school' && app.school.status !== 'active' && !app.isPlatform
  return (
    <div className={['sm-app', app.mobileNav && 'nav-open'].filter(Boolean).join(' ')}>
      {app.mobileNav && <div className="sm-scrim only-mobile" onClick={() => app.setMobileNav(false)} />}
      <Sidebar />
      <div className="sm-main">
        <Topbar />
        <main className="sm-content">
          <div className="sm-content-narrow">
            {pendingActivation ? <PendingActivationScreen /> : <Router />}
          </div>
        </main>
      </div>
      <Tweaks />
      <AiFloatingButton />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ThemeProvider>
          <AppProvider>
            <Shell />
          </AppProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
