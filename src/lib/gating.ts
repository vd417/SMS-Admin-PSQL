/* ============================================================
   SchoolMate — Tier + role gating
   Ported from data.jsx. UI-side gating only; the future
   .NET API must enforce the same matrix server-side.
   ============================================================ */
import type { Tier, Role, GateRole, Cap, UserOverrides, CellState } from '@/types'
import type { RoleTemplateOverride } from '@/api/roleTemplates'
import { TIERS, FEATURE_TIER, PERMS } from '@/data/mockDb'

export function tierIncludes(plan: Tier, feature: string): boolean {
  const need = FEATURE_TIER[feature] || 'silver'
  return TIERS.indexOf(plan) >= TIERS.indexOf(need)
}

export function requiredTier(feature: string): Tier {
  return FEATURE_TIER[feature] || 'silver'
}

/** Normalize owner → admin for matrix lookups (owner inherits admin's row). */
export function gateRole(role: Role): GateRole {
  if (role === 'owner') return 'admin'
  if (role === 'receptionist') return 'staff'
  return role
}

const ALL_CAPS: Cap[] = ['V', 'E', 'A']

export function can(role: Role, module: string, cap: Cap): boolean {
  if (role === 'receptionist') return false
  // Founding owner has full access (admin + principal powers) — mirrors the backend,
  // where school.owner satisfies both the SchoolAdmin and Principal policies.
  if (role === 'owner') return true
  const m = PERMS[module]
  if (!m) return false
  return (m[gateRole(role)] || []).indexOf(cap) >= 0
}

export function caps(role: Role, module: string): Cap[] {
  if (role === 'receptionist') return []
  if (role === 'owner') return [...ALL_CAPS]
  return (PERMS[module] || {})[gateRole(role)] || []
}

const CAP_ORDER: Cap[] = ['V', 'E', 'A']

/** Next state when a per-user capability cell is clicked. */
export const NEXT_CELL_STATE: Record<CellState, CellState> = {
  inherit: 'grant',
  grant: 'revoke',
  revoke: 'inherit',
}

/** Override state of a single capability cell for a user (inherit if unset). */
export function cellState(module: string, cap: Cap, overrides: UserOverrides): CellState {
  return overrides[module]?.[cap] ?? 'inherit'
}

/** Effective caps for a user = role caps + tenant template overrides + per-user grants/revokes,
 *  ordered V→E→A. `tenantOverrides` defaults to none — existing 3-arg callers are unaffected. */
export function effectiveCaps(
  role: Role,
  module: string,
  overrides: UserOverrides,
  tenantOverrides: RoleTemplateOverride[] = [],
): Cap[] {
  const set = new Set<Cap>(caps(role, module))
  const gr = gateRole(role)
  for (const t of tenantOverrides) {
    if (t.role !== gr || t.module !== module) continue
    if (t.effect === 'grant') set.add(t.cap)
    else if (t.effect === 'revoke') set.delete(t.cap)
  }
  const mod = overrides[module]
  if (mod) {
    for (const cap of CAP_ORDER) {
      if (mod[cap] === 'grant') set.add(cap)
      else if (mod[cap] === 'revoke') set.delete(cap)
    }
  }
  return CAP_ORDER.filter((c) => set.has(c))
}

/** Count of non-inherit cells across all modules. */
export function overrideCount(overrides: UserOverrides): number {
  return Object.values(overrides).reduce((n, m) => n + Object.keys(m).length, 0)
}
