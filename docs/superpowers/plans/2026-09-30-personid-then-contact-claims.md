# PersonId → Contact Claims Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable per-person identity (`Users.PersonId`), then enforce per-tenant email/mobile uniqueness across all person types via a `ContactClaims` registry — additively, with zero regression to auth/RLS/JWT/school-switch.

**Architecture:** Two sequenced parts. Part A adds `Users.PersonId` (nullable, backfilled, indexed) + a reviewed conflict report. Part B adds normalization SQL functions, a `ContactClaims` table with a per-tenant unique index, a `contact_claims_sync` DB function called inside existing create/update procs, and a shared `IContactValidator` for friendly pre-checks. Existing `Users` unique indexes and all provisioning exception-handling stay untouched.

**Tech Stack:** PostgreSQL 18 (runtime; `db/postgres/*.sql` baseline + `db/postgres/migrations/NNNN_*.sql` forward-only, applied by `db/Sms.PgMigrator`), .NET (Dapper + stored procs), xUnit integration tests under `tests/Sms.Tests.Integration/`.

**Specs:** [contact-claims](../specs/2026-09-30-contact-claims.md), [school-transfer-add-to-school](../specs/2026-09-30-school-transfer-add-to-school.md) (PersonId origin), [organisation-multiple-schools](../specs/2026-09-30-organisation-multiple-schools.md).

## Global Constraints (verbatim, apply to every task)

- Additive only. No `DROP`/`RENAME` of existing tables/columns/indexes. No RLS/JWT/auth/school-switch/nav rewrite. No role/permission change.
- **`UX_Users_Tenant_Email`, `UX_Users_Tenant_Phone`, `UX_Users_PlatformAdmin` MUST remain unchanged** — provisioning procs (`parent_ensurelogin`, `staff_ensurelogin`, `student_ensurelogin`, `users_bulkcreate`, invite) depend on their `unique_violation` behavior.
- `PersonId` is metadata only: **never** added to JWT claims or RLS policies.
- Email normalized for comparison only (`lower(trim)`), stored raw. Phone normalized to India last-10-digits for comparison only, stored raw. No international rules without a STOP.
- Guardian denormalized fields (`Students.GuardianEmail/GuardianPhone`) are **never** claimed.
- Migrations forward-only in `db/postgres/migrations/`. **Re-run the conflict scan immediately before creating the unique index; any genuine different-person conflict → STOP, no auto-resolve.**
- No production migration / data change / PersonId backfill / commit of implementation code until the user approves this plan and each deployment step.
- **Cross-repo reality:** these docs live in the `sms-admin` repo; **all DB/backend changes (migrations, procs, services) land in the separate `sms-api` repo.** The frontend (`sms-admin`) changes are only error-surfacing (reuse existing forms/toasts).
- **Migration-number verification (correction #5):** `0007–0011` are free in `sms-api/db/postgres/migrations/` as of 2026-09-30 (existing: `0001`–`0006`), but the `sms-api` repo is multi-branch. **Before creating any migration, re-run `ls db/postgres/migrations/` on the exact branch the work lands on and claim the next free numbers; do not assume 0007+.** The Organisation spec must claim different numbers to avoid a clash with this plan.

## Review Focus (spec-implied inputs no single task fully exercises)

1. **Phone with country code vs without** on two different people in one tenant (`+919876543210` vs `9876543210`) — must be detected as the same claim → BLOCK. (Pinned in Task B2 + B6 tests.)
2. **Uninvited profile then later invited** (Teacher created without a Users row, then invited with same email) — must be claim *reuse* by PersonId, not a false conflict. (Pinned in Task B5 tests.)
3. **NULL/empty email and empty-string phone** — must never collide with each other or reserve a slot. (Pinned in Task B2 tests.)
4. **Concurrent create of the same normalized contact by two different people** — DB index yields exactly one winner; the loser gets the mapped `conflict`. (Pinned in Task B4 tests.)
5. **Backfill grouping a phone-only person** (no email) across schools — must group by normalized phone, and never merge two different phone-less people. (Pinned in Task A3 tests.)

---

# PART A — PERSONID

## File structure (Part A)

- Create: `db/postgres/migrations/0007_users_personid.sql` (add column + indexes only; NO backfill).
- Create: `scripts/personid_conflict_report.sql` (read-only report; not applied by the migrator).
- Create: `db/postgres/migrations/0008_users_personid_backfill.sql` (backfill; run ONLY after the report is confirmed clean).
- Modify (baseline, for fresh DBs only): `db/postgres/04_tables.sql` (add `PersonId` to the `Users` definition) — additive, mirrors the migration.
- Test: `tests/Sms.Tests.Integration/Identity/PersonIdBackfillTests.cs`.

### Task A1: Add `Users.PersonId` column + indexes (schema only)

**Files:** Create `db/postgres/migrations/0007_users_personid.sql`; Modify `db/postgres/04_tables.sql` (`Users` block).

**Interfaces:**
- Produces: `dbo."Users"."PersonId" uuid NULL`; indexes `IX_Users_PersonId`, `IX_Users_Tenant_PersonId`.

- [ ] **Step 1:** Write `0007_users_personid.sql`:
```sql
ALTER TABLE dbo."Users" ADD COLUMN IF NOT EXISTS "PersonId" uuid NULL;
CREATE INDEX IF NOT EXISTS "IX_Users_PersonId" ON dbo."Users" ("PersonId");
CREATE INDEX IF NOT EXISTS "IX_Users_Tenant_PersonId" ON dbo."Users" ("TenantId","PersonId");
```
- [ ] **Step 2:** Mirror the column into `04_tables.sql` `Users` definition (fresh-DB parity), additive.
- [ ] **Step 3:** Apply to a scratch/dev DB via `db/Sms.PgMigrator`; verify column + indexes exist (`\d dbo."Users"`). Nullable, so all existing rows keep `NULL` — zero behavior change.
- [ ] **Step 4:** Commit `feat(identity): add nullable Users.PersonId + indexes (no backfill)`.

**Deliverable:** column exists, everything still works (PersonId unused = today's behavior).

### Task A2: PersonId conflict report (read-only)

**Files:** Create `scripts/personid_conflict_report.sql`.

- [ ] **Step 1:** Write the report query (per person-identity group, flag conflicts). Groups a person's rows by normalized email (fallback normalized phone) **across tenants**; classifies benign vs conflict:
```sql
-- Run with SET app.is_platform='1'; read-only.
WITH ident AS (
  SELECT "Id" AS user_id, "TenantId", dbo.normalize_email("Email") AS nemail,
         dbo.normalize_phone("Phone") AS nphone, "Name"
  FROM dbo."Users"
)
SELECT coalesce(nemail, 'phone:'||nphone) AS identity_key,
       count(*) AS user_rows,
       count(DISTINCT "TenantId") AS tenants,
       string_agg(DISTINCT "Name", ' | ') AS names
FROM ident
WHERE nemail IS NOT NULL OR nphone IS NOT NULL
GROUP BY coalesce(nemail, 'phone:'||nphone)
ORDER BY user_rows DESC;
```
(Requires `dbo.normalize_email/normalize_phone` from Task B1; if running before Part B, inline the `lower(trim(...))` / `right(regexp_replace(...),10)` expressions.)
- [ ] **Step 2:** Run it; save output. **Classify:** same-name-across-tenants = candidate same-person; differing names on one identity_key = **manual review**. Present to the user. **STOP if any genuine different-person conflict.**
- [ ] **Step 3:** No commit (report only) — attach output to the deployment ticket.

**Deliverable:** a reviewed conflict report; go/no-go for A3.

### Task A3: PersonId backfill (only after A2 is clean)

**Files:** Create `db/postgres/migrations/0008_users_personid_backfill.sql`; Test `PersonIdBackfillTests.cs`.

**Interfaces:**
- Consumes: `Users.PersonId` (A1), normalize fns (B1).
- Produces: every eligible `Users` row has a `PersonId`; the same real person shares one across tenants.

- [ ] **Step 1 (failing test):** In `PersonIdBackfillTests.cs`, seed two tenants with the same email for one name, and two different names sharing a phone; assert post-backfill: same-email rows share a `PersonId`; the two different-name phone-sharers get **distinct** `PersonId`s (never merged); a phone-less/email-less row gets its own `PersonId`.
- [ ] **Step 2:** Run; expect FAIL (backfill not written).
- [ ] **Step 3:** Write `0008_users_personid_backfill.sql` using the **linkage-first strategy (correction #1) — never merge by email/phone alone:**
  1. **Authoritative within-tenant linkage first.** A profile and its own login are the same person: assign a shared `PersonId` where an existing FK proves it — `Teachers.UserId → Users.Id`, `Staff.UserId → Users.Id`, and `Users.StudentId = Students.AdmissionNo`. This linkage is evidence, not email/phone.
  2. **Cross-tenant grouping is candidate-only and conservative.** The same person across schools is inferred from normalized email/phone **plus** a corroborating signal (identical `Name`, or an existing owner-portfolio relationship). Group across tenants **only when unambiguous** (e.g. same normalized email AND same name). 
  3. **Different-person → separate.** Records that don't meet the authoritative or unambiguous-candidate bar get **their own** `PersonId`.
  4. **Ambiguous → leave `PersonId` NULL and report** (differing names on one email/phone, phone-only groups with >1 name, etc.). Never auto-assign a shared id to ambiguous rows.
  Idempotent (`WHERE "PersonId" IS NULL`). Records the rule applied per row for the report.
- [ ] **Step 4:** Run test; expect PASS. Verify no `Users` row lost/edited beyond `PersonId`.
- [ ] **Step 5:** Commit `feat(identity): safe PersonId backfill (email/phone grouping, no merge of distinct people)`.

**Deliverable:** PersonId populated safely; login/provisioning untouched (verified by running the existing auth integration suite green).

**Part A rollback (non-destructive first — correction #6):** `PersonId` is inert metadata, so the primary rollback is simply **to stop relying on it** (revert any app code that reads it) — the column and its data stay. `PersonId`/person data is **never** dropped as part of an emergency rollback. Dropping the column/indexes is a deliberate, separately-approved cleanup only, never automatic.

---

# PART B — CONTACT CLAIMS

## File structure (Part B)

- Create: `db/postgres/migrations/0009_contact_claims.sql` (normalize fns, table, RLS, grants, `contact_claims_sync` — **no unique index yet**).
- Create: `db/postgres/migrations/0010_contact_claims_backfill.sql` (populate claims).
- Create: `db/postgres/migrations/0011_contact_claims_unique_index.sql` (the unique index — **after** a clean re-scan).
- Modify: `db/postgres/11_sis_procs.sql` (`student_create`, `student_update`); `db/postgres/13_staffing_procs.sql` (`teacher_create`/`update`, `staff_create`/`update`) — add a `contact_claims_sync` call.
- Create: `src/Sms.Application/Services/Contacts/ContactValidator.cs` (+ `IContactValidator`), `ContactNormalizer.cs`.
- Modify: `SisService.cs`, `StaffingService.cs`, `UserService.cs`, `StudentBulkImportService.cs`; the repos that call the changed procs (map sentinel → `conflict`).
- Test: `tests/Sms.Tests.Integration/Contacts/ContactUniquenessTests.cs`, `ContactBulkImportTests.cs`.

### Task B1: Normalization functions

**Files:** part of `0009_contact_claims.sql`.

**Interfaces:** Produces `dbo.normalize_email(text) → text`, `dbo.normalize_phone(text) → text` (both `IMMUTABLE`).

- [ ] **Step 1 (test):** Add `ContactUniquenessTests.NormalizeEmail/Phone` asserting `NormalizeEmail(' ABC@X.com ')='abc@x.com'`, `NormalizeEmail('')=NULL`; `NormalizePhone('+91 98765 43210')='9876543210'`, `'919876543210'→'9876543210'`, `'09876543210'→'9876543210'`, `'9876543210'→'9876543210'`, `''→NULL`.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Write the functions:
```sql
CREATE OR REPLACE FUNCTION dbo.normalize_email(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT nullif(lower(btrim(p)), '') $$;

CREATE OR REPLACE FUNCTION dbo.normalize_phone(p text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    (WITH d AS (SELECT regexp_replace(coalesce(p,''),'\D','','g') AS x)
     SELECT CASE
       WHEN length(x)=12 AND left(x,2)='91' THEN right(x,10)
       WHEN length(x)=11 AND left(x,1)='0'  THEN right(x,10)
       WHEN length(x)>=10 THEN right(x,10)
       ELSE x END
     FROM d), '') $$;
```
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(contacts): email/phone normalization functions`.

### Task B2: ContactClaims table + RLS + grants (no unique index)

**Files:** part of `0009_contact_claims.sql`; Modify `04_tables.sql`, `07_rls_policies.sql`, `99_app_role_grants.sql` (fresh-DB parity).

**Interfaces:** Produces `dbo."ContactClaims"(Id, TenantId, Kind, NormalizedValue, OwnerType, OwnerId, PersonId, CreatedAt)`; RLS as existing tables.

**RLS behavior (correction #3 — documented explicitly, not "same as others"):**
- **Tenant isolation:** `SELECT`/`ALL` policies gate on `rls.is_platform() OR "TenantId" = rls.current_tenant_id()` — a connection stamped for tenant A sees only tenant-A claims; tenant B is invisible. Fail-closed (NULL tenant ⇒ 0 rows).
- **Normal app writes:** create/update procs run on a per-tenant-stamped connection, so their `INSERT`/`UPDATE` into `ContactClaims` satisfies `WITH CHECK ("TenantId" = current_tenant_id())` for the acting tenant — no elevation needed.
- **Elevated path (provisioning / cross-tenant transfer):** flows that already elevate to `is_platform=true` (e.g. `parent_ensurelogin` context, the transfer transaction) satisfy the policy via `rls.is_platform()`, so they can write claims for the target tenant inside the existing safe transaction. **No new elevation, no standing bypass, no RLS weakening.**

- [ ] **Step 1 (tests):** (a) a plain connection stamped for tenant A **cannot read** a `ContactClaims` row written under tenant B; (b) a per-tenant-stamped write for the acting tenant **succeeds**; (c) a `WITH CHECK` violation (writing another tenant's id on a non-platform connection) **is rejected**; (d) a platform-elevated write for a target tenant **succeeds** (provisioning path). Mirror the existing tenant-isolation test helpers.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** DDL:
```sql
CREATE TABLE IF NOT EXISTS dbo."ContactClaims" (
  "Id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "TenantId" uuid NOT NULL,
  "Kind" varchar(10) NOT NULL CHECK ("Kind" IN ('email','phone')),
  "NormalizedValue" varchar(320) NOT NULL,
  "OwnerType" varchar(16) NOT NULL,   -- user|student|teacher|staff
  "OwnerId" varchar(64) NOT NULL,
  "PersonId" uuid NULL,
  "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IX_ContactClaims_Person" ON dbo."ContactClaims" ("PersonId");
ALTER TABLE dbo."ContactClaims" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ContactClaims_select" ON dbo."ContactClaims" FOR SELECT
  USING (rls.is_platform() OR "TenantId" = rls.current_tenant_id());
CREATE POLICY "ContactClaims_modify" ON dbo."ContactClaims" FOR ALL
  USING (rls.is_platform() OR "TenantId" = rls.current_tenant_id())
  WITH CHECK (rls.is_platform() OR "TenantId" = rls.current_tenant_id());
-- grants mirroring 99_app_role_grants.sql (SELECT/INSERT/UPDATE/DELETE to the app role)
```
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(contacts): ContactClaims table + RLS (no unique index yet)`.

### Task B3: `contact_claims_sync` function

**Files:** part of `0009_contact_claims.sql`.

**Interfaces:** Produces `dbo.contact_claims_sync(p_tenant uuid, p_owner_type text, p_owner_id text, p_person_id uuid, p_email text, p_phone text) RETURNS void`. Sentinel on conflict: `RAISE EXCEPTION USING ERRCODE='SMSDC', MESSAGE='contact_conflict:'||kind`.

- [ ] **Step 1 (test):** call sync for tenant T, personId P1, email `a@x.com`; then call again tenant T, personId P2, email `A@X.com` → expect the sentinel raised (mapped later). Same call with P1 again → no error (reuse).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement: for each of email/phone, compute normalized value; skip NULL; `SELECT` existing claim by `(TenantId, Kind, NormalizedValue)`; if none → `INSERT`; if found with same `PersonId` (or NULL→adopt P) → `UPDATE` owner fields (idempotent); if found with a **different non-null** `PersonId` → `RAISE EXCEPTION USING ERRCODE='SMSDC', MESSAGE='contact_conflict:'||kind`. Delete this owner's stale claims whose value changed. Wrap the insert in a `BEGIN … EXCEPTION WHEN unique_violation` that re-reads and applies the same same/different-PersonId rule (covers the concurrent race).
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(contacts): contact_claims_sync with PersonId-aware conflict + race handling`.

### Task B4: `ContactNormalizer` + `IContactValidator` (app pre-check + sentinel mapping)

**Files:** Create `src/Sms.Application/Services/Contacts/ContactNormalizer.cs`, `IContactValidator.cs`, `ContactValidator.cs`.

**Interfaces:**
- Produces: `IContactValidator.CheckAsync(Guid tenantId, string? email, string? phone, Guid? personId, ct) → Error?` (returns the existing `conflict` `Error` or null). Sentinel `SMSDC` from any proc → mapped to the same `conflict` error at the repo boundary.

- [ ] **Step 1 (test):** `ContactUniquenessTests`: with a claim held by P1 in tenant T, `CheckAsync(T, "a@x.com", null, P2)` returns a `conflict` Error with message *"Email is already registered to another person in this school."*; `CheckAsync(T, "a@x.com", null, P1)` returns null (self).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Implement `ContactNormalizer` (mirror the SQL rules exactly) and `ContactValidator` (query `ContactClaims` by normalized value + tenant, exclude same `PersonId`; return the existing `conflict` `Error` codes/messages used at `UserService.cs:82/84`). Add sentinel→`conflict` mapping in the repo helper that executes the changed procs (catch `PostgresException` where `SqlState=="SMSDC"`).
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(contacts): ContactValidator pre-check + sentinel mapping`.

### Task B5: Wire procs + services (create/update)

**Files:** Modify `11_sis_procs.sql` (`student_create`, `student_update`), `13_staffing_procs.sql` (`teacher_create`/`update`, `staff_create`/`update`); `SisService.cs`, `StaffingService.cs`, `UserService.cs`. **Executor MUST read each existing proc/method first and add only the sync call — remove nothing.**

- [ ] **Step 1 (tests):** in `ContactUniquenessTests`: create Teacher `a@x.com` (P1); create Staff `a@x.com` (P2) same tenant → 409 `conflict`; create Teacher `a@x.com` in another tenant (same P1) → allowed; edit Teacher P2 phone to P1's phone → 409; **uninvited Teacher `b@x.com` then invite `b@x.com` (same PersonId)** → allowed (reuse, Review Focus #2); NULL email + NULL email two people → allowed (Review Focus #3).
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Add `PERFORM dbo.contact_claims_sync(TenantId,'student'/'teacher'/'staff', <id>, <personId>, <email>, <phone>)` at the end of each create/update proc's transaction (email+phone; guardian excluded). In services, call `IContactValidator.CheckAsync` before the DB write for the friendly error; extend `StaffingService.SyncLinkedEmailAsync` to also run on **create** and for **phone** and **unlinked** rows.
- [ ] **Step 4:** Run; PASS. Then run the full auth/provisioning integration suite → must stay green (existing `Users` indexes + ensure-login exception handling unaffected).
- [ ] **Step 5:** Commit `feat(contacts): enforce per-tenant email/phone uniqueness in student/teacher/staff create+update`.

### Task B6: Bulk import

**Files:** Modify `StudentBulkImportService.cs` (remove client-only carve-out at `:104-108`); Test `ContactBulkImportTests.cs`.

- [ ] **Step 1 (tests) — dedicated bulk-import regression set (correction #7):** (a) two file rows, same normalized email, different students → second row `skipped` with `conflict`; (b) a row whose email already exists for a **different** person in the school → `skipped` conflict; (c) a row matching an existing person with the **same** `PersonId` → allowed (no false conflict); (d) two sibling rows sharing the same **guardian** email → both `created` (guardian exempt); (e) phone `+91…` vs `…` for two different people → detected (Review Focus #1); (f) **partial-import behavior:** one conflicting row `skipped` while all valid rows in the batch are still `created` (per-row model preserved, batch not aborted); row-level `Error` reported for each skip.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3:** Route each row through `IContactValidator` + rely on `contact_claims_sync` for the atomic guarantee; keep per-row `status:"skipped"`+`Error` reporting (do not change batch idempotency/transport handling).
- [ ] **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `feat(contacts): bulk import enforces contact uniqueness (row-level, guardian-exempt)`.

### Task B7: Claims backfill + unique index (gated)

**Files:** Create `0010_contact_claims_backfill.sql`, `0011_contact_claims_unique_index.sql`.

- [ ] **Step 1:** Write `0010` backfill: insert one claim per `(TenantId, Kind, normalized value)` from `Users`(email/phone) + `Students`(own Email) + `Teachers` + `Staff`, carrying `PersonId`, collapsing a profile + its own `Users` row (same `PersonId`) to one row, **skipping guardian fields**. Idempotent (`ON CONFLICT DO NOTHING` is unavailable pre-index → use `WHERE NOT EXISTS`).
- [ ] **Step 2:** **Verify collapse + re-run the fresh conflict scan (correction #2).** Confirm (a) every profile row + its linked `Users` row (same `PersonId`) produced exactly **one** claim, not two — query `ContactClaims` for any `(TenantId, Kind, NormalizedValue)` with `count(*)>1` and verify each such group is a single `PersonId`; (b) **no** claim rows originated from `Students.GuardianEmail/GuardianPhone` (guardian fields excluded); (c) no `(tenant, kind, value)` maps to two **different** `PersonId`s. Any different-`PersonId` collision, or any accidental double-claim for one person → **STOP, report, no auto-fix.** The unique index (Step 3) is created only after this verification is clean, so it can never reject valid existing data.
- [ ] **Step 3:** Only if clean, write `0011`: `CREATE UNIQUE INDEX "UX_ContactClaims_Tenant_Kind_Value" ON dbo."ContactClaims" ("TenantId","Kind","NormalizedValue");` (optionally `NOT VALID`→`VALIDATE` pattern if you prefer).
- [ ] **Step 4:** Verify inserts now conflict as expected; run full suite green.
- [ ] **Step 5:** Commit `feat(contacts): backfill claims + per-tenant unique index (post clean-scan)`.

### Task B8: Move/Add-to-School integration (only if the transfer feature exists at implementation time)

**Files:** the transfer service from the transfer spec.

- [ ] **Step 1 (tests):** Add to School with same `PersonId` → allowed; with a different `PersonId` already owning the target contact → 409; Move into a school whose contact is held by a different `PersonId` → **whole move rolls back** (source stays active).
- [ ] **Step 2–5:** call `contact_claims_sync` for the target-tenant owner inside the existing atomic transfer transaction; map sentinel → rollback + `conflict`. Commit.

**Part B rollback (non-destructive first — correction #6):** emergency rollback **disables enforcement, preserves data**, in this order: (1) **revert the application enforcement** — deploy the prior app build so services stop calling `IContactValidator`; (2) **revert the proc bodies** to their prior versions (removing only the added `contact_claims_sync` call) so writes no longer raise the sentinel; (3) optionally **drop only the unique index** if it is actively blocking a legitimate write — this stops enforcement while **keeping** the `ContactClaims` rows, `PersonId`, all `Users` data/indexes, RLS, and JWT intact. **Dropping the `ContactClaims` table or the functions is NOT part of emergency rollback** — it is a deliberate, separately-approved cleanup performed only after investigation/reconciliation. No production data is ever deleted automatically.

---

## Migration / deployment order (Phase 15)

1. `0007` PersonId column+indexes → 2. run conflict report (A2) → 3. **review/approve** → 4. `0008` PersonId backfill → 5. verify PersonId + auth suite green → 6. `0009` normalize fns + ContactClaims table + RLS + sync fn → 7. `0010` claims backfill → 8. **re-run conflict scan; STOP if conflict** → 9. `0011` unique index → 10. proc changes (B5) → 11. app changes (B4/B5/B6) → 12. tests → 13. staging validation → 14. production preflight (backup) → 15. production migration → 16. app deploy → 17. smoke tests. Each DB step is its own forward-only migration; app code deploys after its DB dependency.

## Performance (Phase 18)

- Lookups are single-row on `UX_ContactClaims_Tenant_Kind_Value` (unique btree) — O(log n), no full scans, no N+1 (one sync call per person write). Backfill is a bounded one-time insert (current data: dozens of rows). No caching as source of truth.

## Rollback triggers (Phase 19)

Any failed post-deploy smoke test on login/switch/create/parent-multi-child → **first revert the last app deploy** (disables enforcement immediately, no data change). If a DB-level issue persists → revert the proc bodies, and drop **only** the unique index if it is blocking legitimate writes — **preserving** `ContactClaims`, `PersonId`, and all `Users` data/indexes. Investigate and reconcile before any destructive DB change; destructive drops and any data deletion require separate explicit approval and are never automatic. Backup taken at preflight regardless.

## Final regression matrix (Phase 20)

| Existing flow | Before | After | Risk | Verification |
|---|---|---|---|---|
| Login / logout / refresh | Working | Unchanged | None | Auth integration suite |
| School switch / portfolio / authorized list | Working | Unchanged | None | MeSchools tests |
| PostgreSQL RLS / tenant isolation | Working | Unchanged (+ new table follows same policy) | None | Isolation tests |
| `UX_Users_Tenant_Email/Phone`, PlatformAdmin | Working | Unchanged | None | Provisioning suite (invite/ensure-login) |
| parent_ensurelogin / staff_ensurelogin / student_ensurelogin | Working | Unchanged | Low | Ensure-login tests |
| Student create/update | Working | Extended (uniqueness) | Low | ContactUniquenessTests |
| Teacher create/update | Working | Extended | Low | ContactUniquenessTests |
| Staff create/update | Working | Extended | Low | ContactUniquenessTests |
| Bulk import | Working | Extended (row-level conflict) | Medium | ContactBulkImportTests |
| Parent multi-child / siblings sharing contact | Working | Unchanged (guardian exempt) | **Medium** | Dedicated parent tests |
| Move / Add-to-School | (future) | Target contact validated | Medium | Transfer tests (B8) |

**Medium-risk items:** bulk import (behavior change: now rejects duplicates it previously accepted — intended) and parent multi-child (must stay allowed — pinned by guardian-exempt claims + tests).

## Self-review notes

- Spec coverage: normalization (B1), table/RLS (B2), sync+concurrency (B3), pre-check+mapping (B4), all create/update paths + unlinked + phone (B5), bulk import + guardian-exempt (B6), backfill+index gate (B7), move/add (B8), PersonId (A1–A3). ✔
- No placeholders: DDL and function bodies are literal; C# tasks specify exact file/method/insertion point + the test that pins them, and instruct the executor to read the existing method before editing (signatures not fabricated). ✔
- Review Focus five each pinned to a task (B2/B5/B6 + A3). ✔
