const KEY = 'sms.suspensionNotice'

/** Kept across the forced sign-out so the login screen can show why. */
export function rememberSuspension(message: string): void {
  try { sessionStorage.setItem(KEY, message) } catch { /* private mode */ }
}

export function takeSuspension(): string | null {
  try {
    const value = sessionStorage.getItem(KEY)
    if (value) sessionStorage.removeItem(KEY)
    return value
  } catch {
    return null
  }
}
