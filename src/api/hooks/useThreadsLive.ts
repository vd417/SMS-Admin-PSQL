/* SignalR live chat — refreshes the CRM Messenger when a message arrives from the teacher/
   parent app (or another tab), instead of waiting for the next manual refresh. */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import * as signalR from '@microsoft/signalr'
import { config } from '../config'
import { tokenStore } from '../auth/tokenStore'
import { snakeToCamel } from '../mapper'
import { queryKeys } from '../queryKeys'
import { useToast } from '@/lib/hooks'

export function bumpThreadsLiveQueries(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: queryKeys.threads.all })
  // Thread ids differ across the sender/recipient mirror, so bump every open
  // thread's messages rather than trying to know which one this event was for.
  void qc.invalidateQueries({ queryKey: ['threads', 'messages'] })
}

function isChatLiveEvent(wire: unknown): boolean {
  if (!wire || typeof wire !== 'object') return false
  const msg = snakeToCamel<Record<string, unknown>>(wire as Record<string, unknown>)
  return String(msg.type ?? '') === 'chat'
}

export interface LiveNotice {
  id: string
  userId: string | null
  title: string
  body: string
  tone: string
  icon: string
}

const seenNoticeIds = new Set<string>()

export function currentUserId(): string | null {
  const token = tokenStore.getAccess()
  if (!token) return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    const payload = JSON.parse(json) as { sub?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

/** A notification live event. Null when the message is a different event. */
export function noticeFromLiveEvent(wire: unknown): LiveNotice | null {
  if (!wire || typeof wire !== 'object') return null
  const msg = snakeToCamel<Record<string, unknown>>(wire as Record<string, unknown>)
  if (String(msg.type ?? '') !== 'notification') return null
  const raw = msg.data
  const data = raw && typeof raw === 'object'
    ? snakeToCamel<Record<string, unknown>>(raw as Record<string, unknown>)
    : {}
  return {
    id: data.id == null ? '' : String(data.id),
    userId: data.userId == null || data.userId === '' ? null : String(data.userId),
    title: data.title == null ? '' : String(data.title),
    body: data.body == null ? '' : String(data.body),
    tone: data.tone == null ? '' : String(data.tone),
    icon: data.icon == null ? '' : String(data.icon),
  }
}

export function noticeIsForCurrentUser(notice: LiveNotice, userId = currentUserId()): boolean {
  if (!notice.userId) return true
  return !!userId && notice.userId.toLowerCase() === userId.toLowerCase()
}

export function destinationForNotice(tone: string, icon: string): string | null {
  const t = tone.toLowerCase()
  const i = icon.toLowerCase()
  if (t === 'chat' || i.includes('chat')) return 'school.comm'
  if (i.includes('calendar')) return 'school.calendar'
  if (t === 'bus' || i === 'bus') return 'school.transport'
  return null
}

/**
 * Subscribe to LiveHub. On a chat `live_event`, refresh the conversation list and open
 * thread without a manual refresh. Polls every 20s while the socket is down.
 */
export function useThreadsLiveSocket(enabled = true): { connected: boolean } {
  const qc = useQueryClient()
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast
  const [connected, setConnected] = useState(false)
  const connRef = useRef<signalR.HubConnection | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bumpRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)
  const activeRef = useRef(true)

  useEffect(() => {
    if (!enabled || !tokenStore.getAccess()) return
    activeRef.current = true
    backoffRef.current = 1000

    const hubBase = config.apiBaseUrl.replace(/\/v1\/?$/, '')
    const hubUrl = `${hubBase}/hubs/live`

    function scheduleReconnect() {
      if (!activeRef.current) return
      retryRef.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30_000)
        connect()
      }, backoffRef.current)
    }

    function bump() {
      if (bumpRef.current) clearTimeout(bumpRef.current)
      bumpRef.current = setTimeout(() => bumpThreadsLiveQueries(qc), 250)
    }

    function connect() {
      if (!activeRef.current) return
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(hubUrl, {
          accessTokenFactory: () => tokenStore.getAccess() ?? '',
          skipNegotiation: true,
          transport: signalR.HttpTransportType.WebSockets,
        })
        .withAutomaticReconnect([0, 2000, 5000, 10_000, 30_000])
        .configureLogging(signalR.LogLevel.Warning)
        .build()

      connection.on('live_event', (wire: unknown) => {
        if (isChatLiveEvent(wire)) bump()
        const notice = noticeFromLiveEvent(wire)
        if (!notice) return
        void qc.invalidateQueries({ queryKey: queryKeys.notifications.all })
        if (!notice.title || !noticeIsForCurrentUser(notice)) return
        if (notice.id) {
          if (seenNoticeIds.has(notice.id)) return
          seenNoticeIds.add(notice.id)
          if (seenNoticeIds.size > 200) {
            const oldest = seenNoticeIds.values().next().value
            if (oldest) seenNoticeIds.delete(oldest)
          }
        }
        toastRef.current.info(notice.title, notice.body || undefined)
      })
      connection.onreconnected(() => {
        setConnected(true)
        bump()
      })
      connection.onclose(() => {
        setConnected(false)
        connRef.current = null
        scheduleReconnect()
      })

      connRef.current = connection
      connection.start()
        .then(() => {
          setConnected(true)
          backoffRef.current = 1000
        })
        .catch(() => {
          setConnected(false)
          scheduleReconnect()
        })
    }

    connect()

    return () => {
      activeRef.current = false
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null }
      if (bumpRef.current) { clearTimeout(bumpRef.current); bumpRef.current = null }
      const c = connRef.current
      connRef.current = null
      if (c) c.stop().catch(() => {})
      setConnected(false)
    }
  }, [enabled, qc])

  useEffect(() => {
    if (!enabled || connected || !tokenStore.getAccess()) return
    const id = window.setInterval(() => bumpThreadsLiveQueries(qc), 20_000)
    return () => window.clearInterval(id)
  }, [enabled, connected, qc])

  return { connected }
}
