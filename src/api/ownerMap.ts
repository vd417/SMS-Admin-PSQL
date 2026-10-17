/* Map API Client rows onto the School UI shape used by Owner screens. */
import type { School, SchoolStatus, Tier } from '@/types'
import type { Client } from '@/api/ownerTypes'

const TIER_SET = new Set(['silver', 'gold', 'platinum'])

function asTier(t: string | null): Tier {
  const v = (t ?? 'gold').toLowerCase()
  return (TIER_SET.has(v) ? v : 'gold') as Tier
}

function asStatus(s: string): SchoolStatus {
  if (s === 'active' || s === 'trial' || s === 'past_due') return s
  if (s === 'suspended' || s === 'cancelled') return 'past_due'
  return 'trial'
}

const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6']

export function clientToSchool(c: Client, i = 0): School {
  return {
    id: c.id,
    name: c.name,
    /** Human school id (tenant slug) set at create. */
    slug: c.slug,
    city: c.country ?? c.address ?? '—',
    plan: asTier(c.tier),
    students: c.students_count ?? 0,
    enrolled: c.enrolled_students ?? undefined,
    seatLimit: c.limits?.students ?? null,
    billingCycle: c.billing_cycle,
    staff: c.staff_count ?? 0,
    status: asStatus(c.status),
    mrr: Number(c.mrr) || 0,
    attendance: 0,
    fees: Math.min(100, Math.max(0, c.health_score || 0)),
    payroll: 0,
    currency: 'INR',
    tz: 'Asia/Kolkata',
    logo: c.name.slice(0, 2).toUpperCase(),
    logoUrl: c.logo_url ?? null,
    imageUrl: c.image_url ?? null,
    color: COLORS[i % COLORS.length],
  }
}

/** Normalize a user-entered school id into a slug (no random suffix). */
export function normalizeSchoolId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/** School id: 3–40 chars, lowercase letters/digits/hyphens (no leading/trailing hyphen). */
export function isValidSchoolId(raw: string): boolean {
  const id = normalizeSchoolId(raw)
  return id.length >= 3 && id.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)
}

export function slugify(name: string): string {
  const base = normalizeSchoolId(name)
  /* Suffix avoids IX_Tenants_Slug collisions when recreating similarly named schools. */
  const suffix = Date.now().toString(36).slice(-4)
  return base ? `${base}-${suffix}` : `school-${Date.now().toString(36)}`
}
