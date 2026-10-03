# Contact Claims — per-tenant duplicate email/phone prevention

**Date:** 2026-09-30
**Status:** Draft design — awaiting user review (no code yet)
**Repos:** `sms-api` (backend, PostgreSQL), `sms-admin` (CRM frontend)
**Spec 3 of 3** — sequenced after [organisation-multiple-schools](./2026-09-30-organisation-multiple-schools.md) and [school-transfer-add-to-school](./2026-09-30-school-transfer-add-to-school.md). Independent, but cleanest last: the scope decision (per-tenant = per-school) and `PersonId` are settled by then.

## Problem / Goal

Prevent two **unrelated** people from being saved with the same email or phone **within one school (tenant)**, across all person types — while explicitly allowing: the same real person across multiple schools (Spec 2 `PersonId`), one parent with multiple children, and a person's own profile-row + linked `Users` row sharing a contact. (Master prompt §33.)

## Scope decision (settled by audit + Specs 1–2)

Uniqueness is **per-tenant (= per-school)**, NOT global. Same email in ITM 1 and ITM 2 = valid when it's the same `PersonId`. Two unrelated people sharing a contact **inside one tenant** = blocked. Never a global `Email UNIQUE`/`Phone UNIQUE`.

## Current state (from audit)

- Contact identity spread across `Users`, `Students`(+denormalized `GuardianEmail/Phone`), `Teachers`, `Staff`.
- **Uniqueness enforced only on `Users`**, per-tenant: partial indexes `UX_Users_Tenant_Email`, `UX_Users_Tenant_Phone` (both `WHERE … IS NOT NULL`), plus global `UX_Users_PlatformAdmin(Email)`.
- **Person tables enforce nothing;** person **create** paths do no duplicate check (student/teacher/staff create). Only Teacher/Staff **edit** email (linked-user only) and Invite/User-import check.
- **Email** compared `lower(trim())` but **stored raw**; **phone** compared/stored with **exact string equality — no normalization** (`+91 98…` ≠ `98…`).
- Sibling parent-reuse exists (`parent_ensurelogin`, guardian-email keyed).

## Design

### Normalization (prerequisite; migration SQL functions)

- `dbo.normalize_email(text)` = `lower(trim())`, empty→NULL.
- `dbo.normalize_phone(text)` = strip non-digits; drop leading `0`; if 12 digits starting `91`, keep last 10; canonical = last 10 digits. (Indian-number data; confirm locale.)

### Contact registry (race-proof guarantee)

- **`dbo."ContactClaims"`**: `Id, TenantId, Kind('email'|'phone'), NormalizedValue, OwnerType('user'|'student'|'teacher'|'staff'), OwnerId, PersonId, CreatedAt`.
- **`CREATE UNIQUE INDEX UX_ContactClaims_Tenant_Kind_Value ON (TenantId, Kind, NormalizedValue)`** — atomic per-tenant guarantee. RLS mirrors existing tables (fail-closed).

### The denormalized-identity nuance (must handle)

A profile row (e.g. Teacher) and its **own** linked `Users` row legitimately share an email → **one claim, keyed by `PersonId`**, not two conflicting claims. A conflict is raised only when a **different `PersonId`** claims an already-claimed value in that tenant. Existing link-by-email flows (`parent_ensurelogin`, `staff_ensurelogin`) become claim **reuse**, not new claims. Guardian fields on `Students` are **never claimed** (siblings share them; the unique parent is the `Users` row).

### Enforcement + friendly pre-check

- `dbo.contact_claims_sync(tenant, ownerType, ownerId, personId, email, phone)` called inside each create/update proc's transaction; conflict with a different `PersonId` → `RAISE` with a sentinel SQLSTATE → C# maps to the existing `conflict` errors (`UserService.cs:82/84` wording).
- `IContactValidator.CheckAsync(...)` — app-level friendly pre-check for UX; the index is the authority.

### Wiring (close every gap from the audit)

`student_create`/`update`, `teacher_create`/`update`, `staff_create`/`update` (call sync, email + phone); `SisService`/`StaffingService`/`UserService` route through `IContactValidator`; extend `StaffingService.SyncLinkedEmailAsync` to create + phone + unlinked; `StudentBulkImportService` — remove the "client-only" carve-out, add per-row check + in-file dedupe with row-level errors.

## Interaction with Specs 1–2

- Uniqueness is per-tenant, so multi-school membership (same `PersonId`, many tenants) is unaffected.
- `PersonId` on the claim is what distinguishes "same person, second school" (allow) from "different person, same school" (block).
- Move/Add (Spec 2) create target-tenant claims for the moved person's `PersonId`; no false conflict with the source (different tenant).

## Data migration / backfill

- Backfill `ContactClaims` from `Users` + `Students`(own email) + `Teachers` + `Staff`, collapsing profile+own-`Users` (same `PersonId`) into one claim.
- **Existing genuine duplicates (different `PersonId`, same tenant) would violate the unique index** → produce a conflict report first; build the index over clean data (or `NOT VALID` then validate after cleanup). No auto-delete/merge.

## Testing (maps the earlier 18 cases)

Create teacher/staff/admin with existing email/phone in same tenant → block; update-without-change → pass; update-to-another's → block; sibling add same guardian → pass + reuse parent; bulk import siblings → pass; bulk import conflicting distinct → row-level block; concurrent same-email → one wins (index); null/empty contact → allowed; same email across tenants (same `PersonId`) → allowed; removed-account contact behavior per decision; cross-tenant isolation preserved.

## Open items for review

1. Phone locale/normalization rules (confirm `+91`/leading-0 handling).
2. Soft-deleted contacts: keep reserved (current) or release on removal.
3. Claim maintenance via procs (recommended, race-safe) vs app-only.

## Effort

~4–7 days (normalization + table + index + sync fn 1–2d; validator + wiring across create/update/import 2–3d; backfill + conflict report 0.5–1d; tests 1–2d).
