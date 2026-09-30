# RESUME — PersonId → Contact Claims (paused 2026-09-30)

Execution paused by user ("save rest do later"). Everything below is committed; nothing applied to any real DB; nothing pushed.

## Where we are
Plan: `docs/superpowers/plans/2026-09-30-personid-then-contact-claims.md` (11 tasks).
**Done: A1, A2, A3, B1, B2, B3 (6/11). Next: B4.** Cadence = subagent-driven, one task at a time, fresh reviewer per task, STOP for user approval before each next task.

## Branches (both LOCAL, NOT pushed)
- **Backend `sms-api`** — branch `feat/users-personid` (off `origin/main`). Commits:
  - `651c2b8` A1 — `Users.PersonId` nullable column + `IX_Users_PersonId`, `IX_Users_Tenant_PersonId` (migration `0007`, + baseline `04_tables.sql`).
  - `549ffc7` A3 — `0008_users_personid_backfill.sql` (corrected rule: StudentId is NOT a merge key; group by email/phone+name) + `PersonIdBackfillTests.cs` (7 tests).
  - `50147d1` B1 — `0009_contact_normalize_fns.sql` (`dbo.normalize_email`, `dbo.normalize_phone`) + tests (11).
  - `b7ff7e9` B2 — `0010_contact_claims_table.sql` (`dbo."ContactClaims"` + RLS ENABLE/FORCE mirroring Staff + GRANT to sms_app + `IX_ContactClaims_Person`; **NO unique index yet**) + RLS tests (4).
  - `ee1d407` B3 — `0011_contact_claims_sync_fn.sql` (`dbo.contact_claims_sync`, PersonId-aware conflict, SQLSTATE `SMSDC`) + tests (8). HEAD.
  - (A2 was read-only analysis — no commit; see `scratchpad/a2_findings.md`, `a3_simulation.txt`.)
- **Docs `sms-admin`** — branch `docs/org-personid-contact-claims`. Commits `5cd1892` (specs+plan), `9945c3c` (A3 rule correction). Plus this resume file.

## Migrations claimed on feat/users-personid: 0007–0011. Next free = **0012** (RE-VERIFY on the branch before creating).

## Next task — B4 (first C# change)
`IContactValidator.CheckAsync(tenantId, email?, phone?, personId?) → Error?` + `ContactNormalizer` in `src/Sms.Application/Services/Contacts/`. Queries `ContactClaims` (via the normalize SQL fns) and returns the EXISTING `conflict` error (reuse wording at `UserService.cs:82/84`) when a DIFFERENT PersonId holds the value. Plus the repo-boundary mapping: catch `PostgresException` with `SqlState=="SMSDC"` from `contact_claims_sync` → same `conflict` error. NOT wired into create/update yet (that's B5).
Then: B5 wire procs+services, B6 bulk import, B7 backfill claims + **unique index** (gated: re-scan first, STOP on conflict), B8 Move/Add integration.

## Standing constraints (from user, non-negotiable)
- Zero regression. Additive only. Do NOT change RLS/JWT/auth/existing `Users` indexes (`UX_Users_Tenant_Email/Phone`, `UX_Users_PlatformAdmin`)/stored-proc behavior/provisioning.
- NEVER apply migrations/backfill to `sms_dev` or production without explicit approval. PersonId column/backfill NOT applied to `sms_dev` (verified absent).
- Tests run ONLY on the harness's disposable `sms_test_*` DBs (guard: `TestPostgresServer.cs`).
- Do NOT push branches unless the user asks.
- If any different-person conflict or unexpected dependency appears → STOP and report, no auto-resolve.

## Environment gotchas
- Live PostgreSQL runtime; authoritative procs are `db/postgres/*.sql` (NOT the legacy T-SQL under `db/Sms.Migrations/`). Migrator: `db/Sms.PgMigrator` applies baseline + `db/postgres/migrations/NNNN_*.sql`.
- psql: `"C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U sms_app -d sms_dev` (PGPASSWORD `sms_app_dev_pw`). Reads need `SET app.is_platform='1'` (RLS). `sms_app` cannot do DDL.
- A running `Sms.Api` (PID ~15332) locks `src\Sms.Api\bin` → `dotnet test` in the repo dir fails MSB3027. Workaround used by implementers: copy repo minus `bin/obj/.git/TestResults` to scratch, run tests there. Do NOT kill that process.

## Open Low findings to fold into the eventual final review
- B3-L1: `contact_claims_sync` existing-claim SELECT is `LIMIT 1` no `ORDER BY` (only matters pre-unique-index; B7 removes the risk). Optional harden: order same-owner first.
- B3-L3: reuse test asserts row count only; reuse tested on email path only. A3 optional tests (idempotency/platform-exclusion/phone-key) not added.
