# School Transfer / Move + Add-to-School (with PersonId identity)

**Date:** 2026-09-30
**Status:** Draft design — awaiting user review (no code yet)
**Repos:** `sms-api` (backend, PostgreSQL), `sms-admin` (CRM frontend)
**Spec 2 of 3** — depends on [organisation-multiple-schools](./2026-09-30-organisation-multiple-schools.md) (org membership + authorized-school resolution).

## Problem / Goal

Let an authorized Owner/Admin/Principal **Move** a Student/Teacher/Staff from one school to another, or **Add** them to another school, without duplicating the real person and without moving historical data. Two distinct operations. (Master prompt §7–§25.)

## Current state (from audit)

- **No global person identity.** A person across schools is held together only by shared `Email` string. `Users` has `TenantId, Email, Status, Name` — **no `PersonId`, no cross-tenant link.**
- **A `Users` row already IS a per-school membership** (carries `TenantId` + roles + `Status` ∈ active/inactive/removed). `removed` already means "access removed from this school."
- **Profiles per-tenant:** `Teachers`/`Staff` (`TenantId`, `Status`, `UserId`); `Students` (`TenantId`, `Status`; linked by `Users.StudentId = AdmissionNo`, no `Students.UserId`).
- **Parents:** a `Users` row role `student.parent`; children via `ParentStudentLinks(ParentUserId, StudentId, TenantId)`. Sibling reuse already works, keyed on guardian email (`parent_ensurelogin`). Guardian contact denormalized on `Students.GuardianEmail/Phone`.
- **Cross-tenant transactions:** the connection factory stamps ONE tenant per connection; platform elevation (`tenant.Set(null,null,isPlatform:true)`) with save/restore is the existing safe cross-tenant mechanism (used by workers, `MeSchoolsService`, webhooks). **Reuse it — do not rewrite.**
- **Audit:** `AuditLogs(ActorUserId, Action, Module, EntityType, EntityId, BeforeData, AfterData, TimestampUtc)` — reuse.

## Design

### Identity — `Users.PersonId` (additive; approved)

- Add **`Users.PersonId uuid NULL`** — a stable real-person key; all of one person's per-tenant `Users` rows share it. Email stays the login credential. **`PersonId` is NOT in the JWT and NOT in RLS** — metadata for org/cross-school features only (no auth/RLS risk; Rules 3, 4, 20, 21).
- Index: `(TenantId, PersonId)` and a plain `PersonId` index for cross-tenant identity lookups.
- Backfill (Spec's own section) is safe/reviewed; nullable until then.

### Membership = the existing `Users` row (+ its profile)

- **Add to School:** create a new `Users` row (+ profile) for the same `PersonId` in the target tenant; source untouched. (Largely reuses existing invite/provisioning.)
- **Move/Transfer (atomic):** in ONE platform-elevated transaction — (1) ensure/create active target `Users` row + profile with the same `PersonId`; (2) set source `Users.Status='removed'` and source profile `Status` inactive — **never delete**; (3) insert `SchoolTransfers` row; (4) write `AuditLogs`. Rollback on any failure (Rules 24, 41).

### History — never moved (Rule 8, 22)

Source-tenant attendance/leave/fees/tasks/issues/payroll/transport/audit stay in the source tenant, attached to the persisted (`removed`) source `Users`/profile rows. Target starts fresh from the transfer point. The `SchoolTransfers` + `AuditLogs` records provide the link.

### `SchoolTransfers` table (additive)

`Id, PersonId, SourceTenantId, TargetTenantId, PersonType(student|teacher|staff), SourceUserId, TargetUserId, SourceProfileId, TargetProfileId, Role, Reason, PerformedByUserId, PerformedAt`. Not on any hot path.

### Per-type move details (reuse existing provisioning)

- **Student:** target needs Grade/Section (existing `student_create` fields). Source student `Status`→removed/left; target student created active with the chosen class/section; same `PersonId` on the linked student `Users` row.
- **Teacher / Staff:** target needs department/designation/role (existing `teacher_create`/`staff_create` fields). Source profile `Status`→inactive, source `Users`→removed; target profile+`Users` created active, same `PersonId`.
- **No new employee/student architecture** (Rules 13, 14).

### Parent handling — critical (§15–§21)

- A parent is a person with `PersonId`; children link via `ParentStudentLinks` per tenant. Parents are **never moved** by a student move.
- **Moving one child** changes ONLY that student's membership (source student removed, target student active + new class/section) and re-links the child to the parent's identity in the **target** tenant (the parent gets/keeps a `student.parent` `Users` row in the target tenant with the same `PersonId`, via the existing `parent_ensurelogin` reuse — keyed by guardian email, extended to also match by the parent's `PersonId`). Siblings untouched (Rule 11).
- Multi-child, cross-school, per-child class/section all preserved (Rules 9, 10, 12). Guardian denormalized fields are NOT the authoritative relationship — `ParentStudentLinks` is (Rule 20).

### API (new; reuse conventions)

- `POST /v1/org/people/{personId}/add-to-school` — `{ targetTenantId, role, profileFields }`.
- `POST /v1/org/people/{personId}/transfer` — `{ sourceTenantId, targetTenantId, personType, role, reason, destinationAssignment }`.
- `GET /v1/org/people/{personId}/memberships` — list a person's schools + status (permission-gated).
- Reuse `switch-school` post-move.

### Backend authorization (server-side; never trust client — §29, Rules 15, 16)

Verify: actor manages **source** school; actor manages **target** school; both tenants in the **same org** (Spec 1); target active; person exists in source; person eligible; no invalid duplicate; requested role/assignment allowed. Re-derive everything from the actor's own memberships; ignore submitted `TenantId/OrganisationId/UserId/PersonId` except as lookups to re-validate.

### Concurrency & atomicity (§24, §25)

Single transaction under platform elevation (reuse existing mechanism). Guard against double-move via a row lock on the source `Users` row + a status precondition (`Status='active'` at start; if already `removed`, abort). Two simultaneous moves of the same person → one wins, the other sees the precondition fail and rolls back — no half state.

## Frontend (reuse; no redesign — §27, §28)

- Student/Teacher/Staff detail → **Actions** with two clearly-separate items: **Add to School** and **Move to Another School**.
- Move wizard: current school (read-only) → target school (only actor-authorized schools) → destination assignment (student: class/section; teacher/staff: dept/designation) → optional reason → review → confirm. Only fields that already exist in the profile model.

## PersonId backfill (safe, reviewed — §11, §32)

Report per `Users` row: normalized email, UserId, TenantId, school, role, status, profile type, candidate identity group, conflict flag. Classify: clearly-same (link), clearly-different (do not merge), ambiguous (manual review). No auto-merge, no deletion, no login change. `PersonId` stays nullable until confirmed. (Detection query already available from the audit.)

## Testing (maps §35–§37)

Move sets source `removed` + target active; Add keeps source active; history stays in source (query source attendance after move); atomic rollback on injected target failure; concurrent double-move → one wins; unauthorized source/target actor → deny; cross-org move → deny; tampered IDs → deny; student move requires class/section; teacher move carries dept/designation; `PersonId` unchanged across move; parent NOT moved when child moves; siblings unchanged; multi-child/cross-school/per-child class-section; parent dashboard still lists authorized children; parent cannot access unrelated students; all existing access regression tests green.

## Rollback

Additive schema; `PersonId`/`SchoolTransfers` nullable/independent. A failed move rolls back in-transaction. Feature can be disabled without data loss.

## Effort

~2.5–3.5 weeks (PersonId+backfill report 1–2d; SchoolTransfers + atomic cross-tenant service 3–4d; add/move APIs+authz 2–3d; destination assignment 1–2d; CRM two-action wizard 3–4d; tests 2–3d).

## Open items for review

1. Parent identity in target on child-move: reuse `parent_ensurelogin` (email-keyed) extended with `PersonId` match — confirm.
2. Student `Status` value for a moved-out student (`removed` vs `left`/`withdrawn` — existing values include these). Recommend `left`.
