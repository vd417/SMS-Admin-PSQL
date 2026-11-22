import { listRequest } from './client'

export interface AuditEntry {
  id: string
  actorId: string | null
  actorName: string | null
  action: string
  target: string | null
  at: string
}

interface AuditEntryWire {
  id: string
  actor_id: string | null
  actor_name: string | null
  action: string
  target: string | null
  time: string
}

interface AuditEnvelope {
  data: AuditEntryWire[] | null
  next_cursor: string | null
}

export interface AuditParams {
  action?: string
  actorId?: string
  from?: string
  to?: string
  q?: string
  cursor?: string
}

export async function listAuditLog(params: AuditParams = {}): Promise<{ data: AuditEntry[]; nextCursor: string | null }> {
  const env = await listRequest<AuditEnvelope>('/school/audit', {
    query: {
      action: params.action,
      actor_id: params.actorId,
      from: params.from,
      to: params.to,
      q: params.q,
      cursor: params.cursor,
    },
  })
  return {
    data: (env.data ?? []).map((r) => ({
      id: r.id, actorId: r.actor_id, actorName: r.actor_name, action: r.action, target: r.target, at: r.time,
    })),
    nextCursor: env.next_cursor,
  }
}
