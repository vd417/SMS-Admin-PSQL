/* ============================================================
   SchoolMate — Login screen
   ============================================================ */
import { useEffect, useState } from 'react'
import { useApp, useToast } from '@/lib/hooks'
import { DEMO_ACCOUNTS, type DemoAccount } from '@/context/AppProvider'
import { Icon, Field, Input, Btn, Checkbox, Spinner } from '@/components/ui'
import { validateEmail, validatePassword, passwordsMatch, required } from '@/lib/validation'
import { passwordForgot, passwordReset } from '@/api/auth'
import { tokenStore } from '@/api/auth/tokenStore'
import { ApiError } from '@/api/client'

/* ---------- Sign-in identifier helpers (which account an email/mobile maps to) ---------- */

/** Keep only digits, for tolerant phone matching. */
export function normalizePhone(s: string): string {
  return s.replace(/\D/g, '')
}

/**
 * Resolve a typed email or mobile number to a seeded demo account.
 * Email matches case-insensitively; phone matches on the last 10 digits
 * (so the +91 country code and spaces are optional). Returns null if none.
 */
export function findAccountByIdentifier(identifier: string): DemoAccount | null {
  const id = identifier.trim()
  if (!id) return null
  const email = id.toLowerCase()
  const byEmail = DEMO_ACCOUNTS.find((a) => a.email.toLowerCase() === email)
  if (byEmail) return byEmail
  const digits = normalizePhone(id)
  if (digits.length >= 10) {
    const tail = digits.slice(-10)
    const byPhone = DEMO_ACCOUNTS.find((a) => normalizePhone(a.phone).slice(-10) === tail)
    if (byPhone) return byPhone
  }
  return null
}

/** True when the input looks like a phone number (digits, +, -, spaces, parens). */
function looksLikePhone(v: string): boolean {
  return /^[\d+\-\s()]+$/.test(v)
}

/** Map a thrown error to friendly copy by the backend's error code. */
function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'not_registered': return 'No account is registered for this email/mobile.'
      case 'invalid_code':   return 'That code is invalid or expired. Request a new one.'
      case 'weak_password':  return 'Password is too weak — use at least 8 characters.'
      case 'rate_limited':   return 'Too many requests — please wait a minute and try again.'
      default:               return e.message || fallback
    }
  }
  return fallback
}

const POINTS = [
  { icon: 'users', t: 'Owner SaaS — manage every school in your group' },
  { icon: 'shield', t: 'Plans & billing — Catre activates after payment' },
  { icon: 'sparkle', t: 'Open a school console for day-to-day ops' },
]

/** Browser-local “Remember me” for login id only (never store passwords). */
const REMEMBER_KEY = 'sm.login.remember'

export function loadRemembered(): { id: string } | null {
  try {
    const raw = localStorage.getItem(REMEMBER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { id?: unknown; pw?: unknown }
    const id = typeof parsed.id === 'string' ? parsed.id : ''
    if (!id.trim()) return null
    /* Drop any legacy password that may still be on disk. */
    if (typeof parsed.pw === 'string' && parsed.pw) {
      localStorage.setItem(REMEMBER_KEY, JSON.stringify({ id }))
    }
    return { id }
  } catch {
    return null
  }
}

function saveRemembered(id: string) {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ id }))
}

function clearRemembered() {
  localStorage.removeItem(REMEMBER_KEY)
}

export function LoginScreen() {
  const app = useApp()
  const toast = useToast()
  const [email, setEmail] = useState(() => loadRemembered()?.id ?? '')
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [remember, setRemember] = useState(() => !!loadRemembered())
  const busy = app.authBusy

  /* Login is product-branded only — never show a sticky school logo (e.g. ssc). */
  useEffect(() => { tokenStore.setSchoolBrand(null) }, [])

  const signIn = (e: string) => {
    const id = e.trim()
    const password = pw.trim()
    if (remember) saveRemembered(id)
    else clearRemembered()
    void app.loginWithPassword(id, password)
  }

  /* Password reset/create: prove the identifier via a one-time code, then set a new
     password in a single /auth/password/reset call. On success, return to sign in. */
  const [resetOpen, setResetOpen] = useState(false)
  const [resetStep, setResetStep] = useState<'id' | 'reset'>('id')
  const [resetId, setResetId] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPw, setResetPw] = useState('')
  const [resetPw2, setResetPw2] = useState('')
  const [resetErr, setResetErr] = useState<string | null>(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetDone, setResetDone] = useState(false)
  const [showResetPw, setShowResetPw] = useState(false)
  /* Arrived via a magic login link (?identifier=&code=) — the code is a long opaque
     token carried silently, not something the person types, so the code field and
     its 6-digit shape are skipped for this path. */
  const [viaLink, setViaLink] = useState(false)

  const openReset = () => {
    setResetOpen(true); setResetStep('id'); setResetDone(false); setShowResetPw(false)
    setResetId(''); setResetCode(''); setResetPw(''); setResetPw2(''); setViaLink(false)
    setResetErr(null)
  }
  const closeReset = () => { setResetOpen(false); app.clearAuthError() }

  /* Magic link: prefill identifier + token and jump straight to "set password",
     then scrub the token from the URL/history so it doesn't linger visibly. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const linkIdentifier = params.get('identifier')
    const linkCode = params.get('code')
    if (linkIdentifier && linkCode) {
      setResetId(linkIdentifier)
      setResetCode(linkCode)
      setResetStep('reset')
      setResetOpen(true)
      setViaLink(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  /* Step 1 — send the code via /auth/password/forgot. */
  const resetRequest = async () => {
    if (resetBusy) return
    const v = resetId.trim()
    if (!v) { setResetErr('Enter your email or mobile number.'); return }
    if (!looksLikePhone(v) && validateEmail(v)) { setResetErr('Enter a valid email or mobile number.'); return }
    setResetErr(null)
    setResetBusy(true)
    try {
      await passwordForgot(v)
      setResetCode(''); setResetPw(''); setResetPw2('')
      setResetStep('reset')
    } catch (e) {
      // Not-registered is the common, expected case — surface it as a popup so it's unmissable,
      // and keep the inline hint on the field. Other errors stay inline only.
      if (e instanceof ApiError && e.code === 'not_registered') {
        toast.danger('Email or mobile not registered', 'No account exists for that email or mobile number.')
      }
      setResetErr(apiErrorMessage(e, 'Could not send a code. Check your connection and try again.'))
    } finally {
      setResetBusy(false)
    }
  }

  /* Resend the code from the reset step. */
  const resendCode = async () => {
    if (resetBusy) return
    setResetErr(null)
    setResetBusy(true)
    try {
      await passwordForgot(resetId.trim())
    } catch (e) {
      setResetErr(apiErrorMessage(e, 'Could not resend the code. Try again.'))
    } finally {
      setResetBusy(false)
    }
  }

  /* Step 2 — code + new password in one /auth/password/reset call (204, no tokens). */
  const resetSubmit = async () => {
    if (resetBusy) return
    const code = resetCode.trim()
    if (!viaLink && code.length !== 6) { setResetErr('Enter the 6-digit code we sent you.'); return }
    if (viaLink && !code) { setResetErr('This link is missing its code — request a new one.'); return }
    const pwErr = required(resetPw) ?? validatePassword(resetPw)
    if (pwErr) { setResetErr(pwErr); return }
    const matchErr = passwordsMatch(resetPw, resetPw2)
    if (matchErr) { setResetErr(matchErr); return }
    setResetErr(null)
    setResetBusy(true)
    try {
      await passwordReset(resetId.trim(), code, resetPw)
    } catch (e) {
      setResetErr(apiErrorMessage(e, 'Could not reset your password. Check your connection and try again.'))
      return
    } finally {
      setResetBusy(false)
    }
    // Success: return to sign in with a banner; prefill the email if it's email-shaped.
    const id = resetId.trim()
    setResetOpen(false); setResetStep('id')
    setResetCode(''); setResetPw(''); setResetPw2(''); setResetErr(null); setViaLink(false)
    if (validateEmail(id) === null) setEmail(id)
    setResetDone(true)
  }

  return (
    <div className="sm-login">
      <div className="sm-login-brand is-saas">
        <div className="sm-login-brand-logo">
          <img className="sm-login-brand-initial sm-login-brand-img" src="/catre-emblem.png" alt="SchoolMate" />
          <div className="sm-login-brand-text">
            <strong>SchoolMate</strong>
            <small>Owner SaaS</small>
          </div>
        </div>
        <div>
          <h1 className="sm-login-headline">
            Run every school in your group from one console.
          </h1>
          <p className="sm-login-sub">
            Owner console — portfolios, plans, and schools. Catre is the platform that activates after payment.
          </p>
          <div className="sm-login-points">
            {POINTS.map((p, i) => (
              <div className="sm-login-point" key={i}><span><Icon name={p.icon} size={15} /></span>{p.t}</div>
            ))}
          </div>
        </div>
        <div className="sm-login-foot">
          © 2026 SchoolMate by Catre Technology · Multi-tenant school SaaS for owners
        </div>
      </div>

      <div className="sm-login-panel">
        <div className="sm-login-form">
          {resetOpen ? (
            <>
              {resetStep === 'id' && (
                <>
                  <h2>Set your password</h2>
                  <p className="lead">First time here or forgot your password? Enter your email or mobile — if it's registered, we'll send a 6-digit code to verify it's you.</p>
                  <form className="col gap10" onSubmit={(e) => { e.preventDefault(); void resetRequest() }}>
                    <Field label="Email or mobile number" error={resetErr ?? undefined}>
                      <Input icon="phone" value={resetId} onChange={(e) => { setResetId(e.target.value); setResetErr(null) }} placeholder="you@school.edu or +91…" />
                    </Field>
                    <Btn type="submit" variant="primary" size="lg" style={{ width: '100%' }} disabled={busy || resetBusy}>
                      Send code <Icon name="arrowRight" size={16} />
                    </Btn>
                  </form>
                </>
              )}

              {resetStep === 'reset' && (
                <form className="col gap10" onSubmit={(e) => { e.preventDefault(); void resetSubmit() }}>
                  <h2>{viaLink ? 'Create new password' : 'Choose a new password'}</h2>
                  <p className="lead">
                    {viaLink
                      ? 'You\'re verified via your login link — create new password (at least 8 characters) and you\'re in.'
                      : `Enter the 6-digit code we sent to ${resetId.trim()}, then set a new password (at least 8 characters).`}
                  </p>
                  {!viaLink && (
                    <Field
                      label="6-digit code"
                      error={resetCode.length > 0 && resetCode.length < 6 ? 'Enter all 6 digits of the code.' : undefined}
                      hint={resetCode.length > 0 && resetCode.length < 6 ? undefined : 'Enter all 6 digits of the code.'}
                    >
                      <Input icon="key" inputMode="numeric" maxLength={6} value={resetCode}
                        onChange={(e) => { setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setResetErr(null) }}
                        placeholder="••••••" style={{ letterSpacing: '4px' }} />
                    </Field>
                  )}
                  <Field
                    label={viaLink ? 'Create new password' : 'New password'}
                    error={resetPw.length > 0 && resetPw.length < 8 ? 'Must be at least 8 characters.' : undefined}
                    hint={resetPw.length > 0 && resetPw.length < 8 ? undefined : 'Must be at least 8 characters.'}
                  >
                    <div style={{ position: 'relative' }}>
                      <Input icon="lock" type={showResetPw ? 'text' : 'password'} value={resetPw}
                        onChange={(e) => { setResetPw(e.target.value); setResetErr(null) }} placeholder="At least 8 characters" />
                      <button type="button" className="sm-login-pw-toggle" onClick={() => setShowResetPw((s) => !s)} aria-label="Toggle password">
                        <Icon name="eye" size={16} />
                      </button>
                    </div>
                  </Field>
                  <Field
                    label="Confirm password"
                    hint={resetPw2.length > 0 && resetPw !== resetPw2 ? "Passwords don't match yet." : undefined}
                  >
                    <Input icon="lock" type={showResetPw ? 'text' : 'password'} value={resetPw2}
                      onChange={(e) => { setResetPw2(e.target.value); setResetErr(null) }} placeholder="Re-enter your password" />
                  </Field>
                  {resetErr && <span className="sm-err"><Icon name="alert" size={12} /> {resetErr}</span>}
                  <Btn type="submit" variant="primary" size="lg" style={{ width: '100%' }} disabled={busy || resetBusy}>
                    {(busy || resetBusy)
                      ? <><Spinner size={16} /> Saving…</>
                      : <>{viaLink ? 'Create new password' : 'Set password'} <Icon name="arrowRight" size={16} /></>}
                  </Btn>
                  {!viaLink && (
                    <button type="button" className="sm-login-link" onClick={() => { void resendCode() }}>
                      Resend code
                    </button>
                  )}
                  <button type="button" className="sm-login-link" onClick={() => { setResetStep('id'); setResetErr(null); setViaLink(false) }}>
                    <Icon name="arrowLeft" size={13} /> Use a different email/mobile
                  </button>
                </form>
              )}

              <button type="button" className="sm-login-link" onClick={closeReset}>
                <Icon name="arrowLeft" size={13} /> Back to sign in
              </button>
            </>
          ) : (
            <>
              <h2>Welcome back</h2>
              <p className="lead">Sign in to your SchoolMate workspace.</p>

              {resetDone && (
                <div className="sm-login-otp-hint" role="status">
                  <Icon name="checkCircle" size={14} /><span>Password updated — sign in with your new password.</span>
                </div>
              )}

              <form className="col gap14" onSubmit={(e) => { e.preventDefault(); signIn(email) }}>
                <Field label="Email or mobile number">
                  <Input
                    icon="user"
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setResetDone(false) }}
                    placeholder="you@school.edu or +91…"
                  />
                </Field>
                <Field label="Password" error={app.authError ?? undefined}>
                  <div style={{ position: 'relative' }}>
                    <Input
                      icon="lock"
                      name="password"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={pw}
                      onChange={(e) => setPw(e.target.value)}
                      placeholder="••••••••"
                    />
                    <button type="button" className="sm-login-pw-toggle" onClick={() => setShowPw((s) => !s)} aria-label="Toggle password">
                      <Icon name="eye" size={16} />
                    </button>
                  </div>
                </Field>

                <div className="sm-login-row">
                  <Checkbox
                    checked={remember}
                    onChange={(v) => {
                      setRemember(v)
                      if (!v) clearRemembered()
                    }}
                    label="Remember me"
                  />
                  <button type="button" className="sm-login-link" onClick={openReset}>Forgot password?</button>
                </div>

                <Btn type="submit" variant="primary" size="lg" style={{ width: '100%' }} disabled={busy}>
                  {busy ? <><Spinner size={16} /> Signing in…</> : <>Sign in <Icon name="arrowRight" size={16} /></>}
                </Btn>
              </form>

              <div className="sm-login-row" style={{ justifyContent: 'center', gap: 6 }}>
                <span className="lead" style={{ margin: 0 }}>First time here?</span>
                <button type="button" className="sm-login-link" onClick={openReset}>Create a password</button>
              </div>
            </>
          )}
          <footer className="sm-login-copyright">
            <strong>© 2026 Catre Technology. All Rights Reserved.</strong>
            <span>
              This software, source code, design, graphics, logos, documentation, and related materials are the
              exclusive property of Catre Technology. Unauthorized copying, reproduction, modification, distribution,
              or use of any part of this project without prior written permission from Catre Technology is strictly
              prohibited.
            </span>
          </footer>
        </div>
      </div>
    </div>
  )
}
