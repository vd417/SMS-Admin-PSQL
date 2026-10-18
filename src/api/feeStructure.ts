import { request, listRequest, ApiError } from './client'
import { snakeToCamel } from './mapper'
import { tokenStore } from './auth/tokenStore'

/** Class/grade key → headId → amount (legacy + amounts block). */
export type FeeStructureMatrix = Record<string, Record<string, number>>

export type FeeStructureStatus = 'active' | 'inactive'

/** Named fee structure with header fields + class-wise amounts. */
export interface FeeStructureDocument {
  id?: string
  name: string
  academicYear: string
  /** Grade or class scope (e.g. I, X). Empty = all classes in amounts. */
  classGrade: string
  /** Optional section (A/B/C). Empty = all sections. */
  section: string
  currency: string
  effectiveFrom: string
  effectiveTo?: string
  status: FeeStructureStatus
  description: string
  amounts: FeeStructureMatrix
}

export type FeeStructureMetaInput = {
  currency?: string
  academicYear?: string
  name?: string
}

function defaultAcademicYear(d = new Date()): string {
  const y = d.getFullYear()
  const m = d.getMonth()
  return m >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`
}

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function defaultFeeStructureMeta(opts: FeeStructureMetaInput = {}): Omit<FeeStructureDocument, 'amounts'> {
  const academicYear = opts.academicYear?.trim() || defaultAcademicYear()
  const currency = opts.currency?.trim() || 'INR'
  return {
    name: opts.name?.trim() || `School fees ${academicYear}`,
    academicYear,
    classGrade: '',
    section: '',
    currency,
    effectiveFrom: todayIso(),
    status: 'active',
    description: '',
  }
}

function isPlainAmountMatrix(raw: unknown): raw is FeeStructureMatrix {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const o = raw as Record<string, unknown>
  /* Document shape has known meta keys — not a bare matrix. */
  if ('amounts' in o || 'academic_year' in o || 'academicYear' in o || 'effective_from' in o || 'effectiveFrom' in o) {
    return false
  }
  if ('name' in o && typeof o.name === 'string' && ('status' in o || 'currency' in o)) return false
  return Object.values(o).every((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false
    return Object.values(v as Record<string, unknown>).every((n) => typeof n === 'number')
  })
}

function coerceAmounts(raw: unknown): FeeStructureMatrix {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: FeeStructureMatrix = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const row: Record<string, number> = {}
    for (const [hid, amt] of Object.entries(v as Record<string, unknown>)) {
      const n = Number(amt)
      if (Number.isFinite(n)) row[hid] = n
    }
    out[k] = row
  }
  return out
}

/** Normalize API / legacy matrix into a FeeStructureDocument. */
export function normalizeFeeStructure(
  raw: unknown,
  opts: FeeStructureMetaInput = {},
): FeeStructureDocument {
  const defaults = defaultFeeStructureMeta(opts)
  if (isPlainAmountMatrix(raw)) {
    return { ...defaults, amounts: coerceAmounts(raw) }
  }
  if (!raw || typeof raw !== 'object') {
    return { ...defaults, amounts: {} }
  }
  const c = snakeToCamel<Record<string, unknown>>(raw as Record<string, unknown>)
  const amounts = coerceAmounts(c.amounts ?? {})
  const statusRaw = String(c.status ?? 'active').toLowerCase()
  const status: FeeStructureStatus = statusRaw === 'inactive' ? 'inactive' : 'active'
  const classGrade = String(c.classGrade ?? c.class ?? c.grade ?? '').trim()
  return {
    id: c.id != null ? String(c.id) : undefined,
    name: String(c.name ?? defaults.name).trim() || defaults.name,
    academicYear: String(c.academicYear ?? defaults.academicYear).trim() || defaults.academicYear,
    classGrade,
    section: String(c.section ?? '').trim(),
    currency: String(c.currency ?? defaults.currency).trim() || defaults.currency,
    effectiveFrom: String(c.effectiveFrom ?? defaults.effectiveFrom).trim() || defaults.effectiveFrom,
    effectiveTo: c.effectiveTo ? String(c.effectiveTo).trim() : undefined,
    status,
    description: String(c.description ?? '').trim(),
    amounts,
  }
}

function toWire(doc: FeeStructureDocument): Record<string, unknown> {
  return {
    ...(doc.id && !doc.id.startsWith('local-') ? { id: doc.id } : {}),
    name: doc.name.trim(),
    academic_year: doc.academicYear.trim(),
    class: doc.classGrade.trim() || null,
    section: doc.section.trim() || null,
    currency: doc.currency.trim(),
    effective_from: doc.effectiveFrom.trim(),
    effective_to: doc.effectiveTo?.trim() || null,
    status: doc.status,
    description: doc.description.trim() || null,
    amounts: doc.amounts ?? {},
  }
}

function structureStorageKey(): string {
  const tenant = tokenStore.getTenantId() || 'default'
  return `sms_fee_structure:${tenant}`
}

function clearLocalStructure(): void {
  try { localStorage.removeItem(structureStorageKey()) } catch { /* ignore */ }
}

function fromApiWire(raw: unknown, opts: FeeStructureMetaInput = {}): FeeStructureDocument {
  if (!raw || typeof raw !== 'object') return normalizeFeeStructure(raw, opts)
  const row = raw as Record<string, unknown>
  const amountsJson = row.amounts_json ?? row.amountsJson
  if (typeof amountsJson === 'string' && amountsJson.trim()) {
    let amounts: unknown = {}
    try { amounts = JSON.parse(amountsJson) } catch { amounts = {} }
    return normalizeFeeStructure({ ...row, amounts }, opts)
  }
  return normalizeFeeStructure(row, opts)
}

function readLocalStructure(opts: FeeStructureMetaInput): FeeStructureDocument | null {
  try {
    const raw = localStorage.getItem(structureStorageKey())
    if (!raw) return null
    return normalizeFeeStructure(JSON.parse(raw), opts)
  } catch {
    return null
  }
}

function writeLocalStructure(doc: FeeStructureDocument): void {
  try { localStorage.setItem(structureStorageKey(), JSON.stringify(doc)) } catch { /* ignore */ }
}

export async function getFeeStructure(opts: FeeStructureMetaInput = {}): Promise<FeeStructureDocument> {
  try {
    const raw = await request<unknown>('/fees/structure')
    clearLocalStructure()
    return fromApiWire(raw, opts)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return readLocalStructure(opts) ?? { ...defaultFeeStructureMeta(opts), amounts: {} }
    }
    throw e
  }
}

export async function saveFeeStructure(doc: FeeStructureDocument): Promise<FeeStructureDocument> {
  const name = doc.name.trim()
  if (!name) throw new Error('Fee structure name is required')
  if (!doc.academicYear.trim()) throw new Error('Academic year is required')
  if (!doc.effectiveFrom.trim()) throw new Error('Effective from date is required')
  if (!doc.currency.trim()) throw new Error('Currency is required')
  const normalized: FeeStructureDocument = {
    ...doc,
    name,
    academicYear: doc.academicYear.trim(),
    classGrade: doc.classGrade.trim(),
    section: doc.section.trim(),
    currency: doc.currency.trim(),
    effectiveFrom: doc.effectiveFrom.trim(),
    description: doc.description.trim(),
  }
  try {
    const wire = await request<unknown>('/fees/structure', { method: 'PUT', body: toWire(normalized) })
    clearLocalStructure()
    return fromApiWire(wire, { currency: normalized.currency, academicYear: normalized.academicYear })
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      const saved: FeeStructureDocument = { ...normalized, id: normalized.id ?? `local-${Date.now()}` }
      writeLocalStructure(saved)
      return saved
    }
    throw e
  }
}

/** @deprecated Prefer FeeStructureDocument.amounts — kept for call sites mid-migration. */
export function amountsOnly(doc: FeeStructureDocument | FeeStructureMatrix): FeeStructureMatrix {
  if (doc && typeof doc === 'object' && 'amounts' in doc) return (doc as FeeStructureDocument).amounts
  return coerceAmounts(doc)
}

/** One fee head's projected revenue for a saved structure version — e.g. "Exam Fee — ₹8,000",
 *  summed (rate × enrolled students) across every class that charges it. */
export interface FeeStructureHeadAmount {
  headId: string | null
  headName: string
  amount: number
  /** Per-student rate for this head (revenue ÷ enrolled students charged), e.g. ₹6,500. */
  perStudentAmount: number
}

/** One saved version in the Fee Structure history list — metadata only, no per-class amounts
 *  (kept light) — but does include the per-fee-head totals. */
export interface FeeStructureHistoryEntry {
  id: string
  name: string
  academicYear: string
  classGrade: string
  section: string
  currency: string
  status: FeeStructureStatus
  createdAt: string
  /** Sum of every class's every fee head (rate × enrolled students) for this version — a
   *  quick total for the list, not a substitute for the full per-class breakdown (see
   *  getFeeStructureVersion). */
  totalAmount: number
  /** Per-fee-head breakdown of totalAmount, e.g. [{ headName: 'Exam Fee', amount: 8000 }]. */
  headAmounts: FeeStructureHeadAmount[]
  /** True only for a version that was never published — the only ones that can be deleted. A
   *  version that was ever published is treated as "used" (it may have been billed) and kept. */
  deletable: boolean
}

interface ListEnvelope { data: Record<string, unknown>[]; next_cursor: string | null }

function toHeadAmount(row: Record<string, unknown>): FeeStructureHeadAmount {
  return {
    headId: row.head_id ? String(row.head_id) : null,
    headName: String(row.head_name ?? '').trim(),
    amount: Number(row.amount) || 0,
    perStudentAmount: Number(row.per_student_amount) || 0,
  }
}

function toHistoryEntry(row: Record<string, unknown>): FeeStructureHistoryEntry {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? '').trim(),
    academicYear: String(row.academic_year ?? '').trim(),
    classGrade: String(row.class ?? '').trim(),
    section: String(row.section ?? '').trim(),
    currency: String(row.currency ?? 'INR').trim(),
    status: String(row.status ?? 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active',
    createdAt: String(row.created_at ?? '').trim(),
    totalAmount: Number(row.total_amount) || 0,
    headAmounts: Array.isArray(row.head_amounts) ? row.head_amounts.map(toHeadAmount) : [],
    // Only never-published versions are deletable; default to not-deletable if the field is absent.
    deletable: row.deletable === true,
  }
}

/** Every version ever saved, newest first — every explicit Save creates a new one instead of
 *  overwriting the last, so nothing here ever silently disappears. */
export async function listFeeStructureHistory(): Promise<FeeStructureHistoryEntry[]> {
  const env = await listRequest<ListEnvelope>('/fees/structures')
  return env.data.map(toHistoryEntry).filter((h) => h.id)
}

/** A specific past version's full document (including amounts), read-only by convention —
 *  there is no update-by-id endpoint; editing always creates a new version via saveFeeStructure. */
export async function getFeeStructureVersion(id: string): Promise<FeeStructureDocument> {
  const wire = await request<unknown>(`/fees/structures/${id}`)
  return fromApiWire(wire)
}

/** Publishes this draft. Any number of versions can be published at once — this never
 *  changes any other version's status; invoice generation bills every currently-Published
 *  version together. */
export async function publishFeeStructureVersion(id: string): Promise<void> {
  await request<void>(`/fees/structures/${id}/publish`, { method: 'POST' })
}

/** Explicitly un-publishes this version. This is the only way a version stops being billed —
 *  publishing another version never does it automatically. */
export async function unpublishFeeStructureVersion(id: string): Promise<void> {
  await request<void>(`/fees/structures/${id}/unpublish`, { method: 'POST' })
}

/** Archives (soft-deletes) a version that was never published. The backend refuses (409) any
 *  version that was ever published — unpublishing does NOT make it deletable, since it may have
 *  been billed against. Only rows with `deletable === true` can be removed. */
export async function deleteFeeStructureVersion(id: string): Promise<void> {
  await request<void>(`/fees/structures/${id}`, { method: 'DELETE' })
}
