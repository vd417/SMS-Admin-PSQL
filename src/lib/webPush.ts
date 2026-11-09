import { request } from '@/api/client'

const firebaseConfig = {
  apiKey: 'AIzaSyCblK72KXTNVLUWaUrEz4mAdFZLAFnUOI4',
  authDomain: 'sms-1085d.firebaseapp.com',
  projectId: 'sms-1085d',
  storageBucket: 'sms-1085d.firebasestorage.app',
  messagingSenderId: '157548521334',
  appId: '1:157548521334:web:a94ffd5f1b621b589ffc57',
}

const vapidKey = 'BDAfyo-3I8WvcjmPsZ8MS8Y_pr3qO9i9MgnEjAXO6Rhmyczk2UL5ssSEbxeIb9vV526mRhP2o90FNG6tgYuWl14'

const PUSH_TOKEN_KEY = 'sms.crm.pushToken'

let pending: Promise<void> | null = null

/** Drop this browser's push token. Sign-out calls this so a logged-out CRM user stops receiving pushes. */
export async function unregisterWebPush(): Promise<void> {
  let token: string | null = null
  try { token = sessionStorage.getItem(PUSH_TOKEN_KEY) } catch { /* ignore */ }
  pending = null
  if (!token) return
  try {
    await request<unknown>('/push-devices', { method: 'DELETE', body: { token, platform: 'web', app: 'crm' } })
  } catch {
    /* the session is ending either way */
  }
  try { sessionStorage.removeItem(PUSH_TOKEN_KEY) } catch { /* ignore */ }
}

/** Asks the browser once, then stores this browser's token for school alerts. */
export function registerWebPush(): Promise<void> {
  if (import.meta.env.VITEST) return Promise.resolve()
  pending ??= register()
  return pending
}

async function register(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) return
  try {
    const { initializeApp } = await import('firebase/app')
    const { getMessaging, getToken, isSupported, onMessage } = await import('firebase/messaging')
    if (!(await isSupported())) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')
    const messaging = getMessaging(initializeApp(firebaseConfig))
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })
    if (!token) return
    try { sessionStorage.setItem(PUSH_TOKEN_KEY, token) } catch { /* logout still clears a missing token */ }
    await request<unknown>('/push-devices', { method: 'POST', body: { token, platform: 'web', app: 'crm' } })
    onMessage(messaging, () => {
      /* Foreground popup is the in-app toast. A browser Notification here would show twice. */
    })
  } catch {
    /* a blocked permission or an unsupported browser leaves the in-app bell working */
  }
}
