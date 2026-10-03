# Organisation → Multiple Schools (grouping over tenants)

**Date:** 2026-09-30
**Status:** Draft design — awaiting user review (no code yet)
**Repos:** `sms-api` (backend, PostgreSQL), `sms-admin` (CRM frontend)
**Spec 1 of 3** — foundation for [school-transfer-add-to-school](./2026-09-30-school-transfer-add-to-school.md) and [contact-claims](./2026-09-30-contact-claims.md).

## Problem / Goal

Group existing school-tenants under a named **Organisation** (e.g. ITM → ITM 1 / ITM 2 / ITM 3), give organisation-level admins a permitted school switcher and organisation-level aggregate views, **without** changing the meaning of `TenantId`, the JWT, RLS, or any existing access.

## Guiding rule (non-negotiable)

Additive only. `Tenant` stays the school. No `SchoolId` on operational tables. No RLS rewrite. No auth/JWT rewrite. No existing access removed or auto-expanded. (Master prompt Rules 1–5, 15–22.)

## Current state (from audit — verified against live PostgreSQL 18.3)

- **A School IS a `Tenants` row.** 3 tenants = 3 schools. No live Organisation entity (`Organization`/`Organizations` tables are dead legacy, 0 rows).
- **Isolation:** per-tenant Postgres RLS on every table — `USING (rls.is_platform() OR "TenantId" = rls.current_tenant_id())`, fail-closed. GUCs `app.tenant_id`/`app.is_platform` stamped per-connection in `NpgsqlConnectionFactory.StampTenantContextAsync` at `OpenAsync`.
- **Multi-school today:** one person = N per-tenant `Users` rows keyed by shared `Email`. `MeSchoolsService` calls this an owner "portfolio" (`ListByEmailAsync`). `SwitchTenantAsync` re-issues a **per-tenant JWT** (switch without logout). `GET /v1/me/schools/fee-summary` already aggregates across a user's schools.
- **Roles:** `platform.only`, `school.owner`, `school.owner.only`, `school.admin`, `school.principal`, `school.teacher`, `staff`, `student.parent`, `driver` (`Policies.cs`). **No organisation-level role exists.**
- **Frontend:** Owner console `workspace.tsx` already shows a "scope" (All schools / specific schools) — but it is a **mock** (component state, no backend gating; see `2026-06-15-multi-school-scope-design.md`). This spec makes it real.

## Non-goals

- No `SchoolId` dimension; no per-table schema changes to operational tables.
- No change to login, refresh, logout, JWT claims, RLS policies, or `SwitchTenantAsync`'s mechanism.
- No cross-tenant "super JWT". Org aggregation fans out over permitted tenants server-side.
- Transfer/Add-to-School (Spec 2) and duplicate prevention (Spec 3) are separate.

## Design

### Data model (additive — one forward migration `db/postgres/migrations/0007_organisations.sql`)

- **`dbo."Organisations"`**: `Id uuid PK`, `Name varchar`, `Slug varchar`, `Status varchar` (active/inactive), `CreatedAt timestamptz`.
- **`Tenants.OrganisationId uuid NULL`** → FK to `Organisations.Id`. Nullable; a tenant with no org behaves exactly as today (single independent school). Index `IX_Tenants_OrganisationId`.
- **`dbo."OrganisationMemberships"`**: `Id uuid`, `OrganisationId uuid`, `UserId uuid`, `Role varchar` (`org.admin` | `org.viewer`), `CreatedAt`. Unique `(OrganisationId, UserId)`. This grants **org-level visibility**, never school management by itself (Rule: org membership ≠ school access).

RLS: `Organisations` and `OrganisationMemberships` are **platform/owner-scoped** helper tables, not per-tenant operational data. `Organisations` readable by members of that org; `OrganisationMemberships` readable by the user themselves + platform. Policies added mirroring the existing style; **no change to existing table policies.**

### Authorization model — the key principle

Two independent axes, exactly as the master prompt demands:

1. **Org membership** (`OrganisationMemberships`) — determines which schools a user can *see listed / aggregated*.
2. **School access** — the EXISTING per-tenant `Users` row + roles. Determines which schools a user can *manage/enter*.

A user's **authorized schools** = the tenants where they already hold a `Users` row with a managing role (owner/admin/principal). Org membership never adds school access; it only scopes org-level list/aggregate views to the org's tenants. This guarantees Rules 1, 2, 6, 8, 37 (no silent expansion; Principal with ITM 1 stays ITM 1).

### New org-admin role

Add `org.admin` as an **org-membership role** (in `OrganisationMemberships.Role`), NOT a per-tenant `Policies` role. It grants org-level aggregate views over the org's tenants **that the user is separately authorized to manage**. It does not appear in JWT claims and does not touch RLS.

### Backend components

- **`IOrganisationService`** (new, `Sms.Application/Services/Tenancy/`):
  - `ListMyOrganisationsAsync()` — orgs the actor belongs to.
  - `ListSchoolsInOrgAsync(orgId)` — tenants in the org (name/slug/status), **filtered to the actor's authorized schools** for management contexts; full list only for org-level *view* where permitted.
  - `GetOrgSummaryAsync(orgId, schoolFilter)` — aggregate counts (schools/students/teachers/parents/staff) by fanning out over authorized tenants (scoped elevation per tenant, never blanket platform bypass; reuse the `tenant.Set(tid,...)` per-tenant pattern already used by workers). Generalizes the existing `fee-summary` fan-out.
- **Reuse** `MeSchoolsService.SwitchTenantAsync` unchanged for entering a specific school. Add an **org-membership + authorized-school check** only to *which* tenants the switcher offers.

### API (new; reuse conventions/versioning)

- `GET /v1/org` — orgs the actor belongs to.
- `GET /v1/org/{orgId}/schools` — schools in org (permission-filtered).
- `GET /v1/org/{orgId}/summary?school=all|<tenantId>` — aggregate, backend-enforced filter.
- School switch: **reuse** `POST /v1/me/switch-school`.

All authorization server-side; never trust submitted `OrganisationId`/`TenantId` (Rules 15, 16, 29).

### Frontend (reuse; no redesign)

- Make the Owner `workspace.tsx` scope real: source the school list from `GET /v1/org/{orgId}/schools`; the "All schools / specific" scope becomes backed by org membership + authorized schools.
- Org "All Schools" aggregate dashboard driven by `GET /v1/org/{orgId}/summary`.
- School switcher: reuse existing UI; options = authorized schools only.
- No routing/sidebar/nav rewrite (Rules 19, 43).

## Data migration / backfill

- Additive only; `OrganisationId` nullable. Existing tenants keep working un-orged.
- **Backfill is opt-in and reviewed:** produce a report grouping today's tenants by founding-owner email portfolio (candidate orgs). **Do not auto-create orgs** that merge portfolios which may not belong together — present the grouping for manual confirmation. With 3 tenants today this is trivial and reviewable.
- No destructive changes; no data moved.

## Security / RLS impact

- Existing per-tenant RLS **unchanged**. Cross-tenant leak remains impossible by construction.
- Org aggregates iterate only the actor's authorized tenants using the existing scoped-elevation pattern (set tenant → read → restore), never a standing platform bypass (Rule 4, 45).

## Testing

- Owner with ITM1+ITM2+ITM3 still sees exactly those (regression, Rule 37).
- Admin ITM1+ITM2 unchanged; Principal ITM1 stays ITM1.
- Org member with management rights on ITM1 only → org summary shows ITM1 data only; ITM2 denied even though same org.
- `GET /v1/org/{orgId}/summary?school=ITM2` by an actor not authorized for ITM2 → filtered out / denied (no leak).
- Tampered `OrganisationId`/`TenantId` → denied.
- All existing auth/switch/portfolio/RLS regression tests green.

## Rollout / rollback

- Ship behind the additive migration; nullable `OrganisationId` means instant rollback = ignore the new tables (no data loss). No existing flow depends on the new columns.

## Effort

~2–3.5 weeks (schema+migration 1–2d; org service + membership + authorized-school resolution 2–3d; aggregate summary APIs 2–3d; frontend real scope + org dashboard 2–4d; tests 2–3d; backfill report 0.5–1d).

## Open items for review

1. Org-admin as an `OrganisationMemberships.Role` (recommended) vs a new `Policies` role — recommend the former (keeps JWT/RLS untouched).
2. Whether org-level *viewers* may see aggregate numbers for schools they cannot manage, or only schools they manage. Recommend: **only schools they manage** (strictest, no leak) unless you want a true org-owner super-view.
