# CATRE Seat Limit + Usage-Based Billing — Design Spec

**Date:** 2026-10-17
**Status:** Draft for approval
**Repos:** `sms-api` (backend / data model / billing) and `sms-admin` (owner + school UI)

---

## 1. Goal & intent

The platform (CATRE) team sells schools a plan with a **billed/licensed seat count**
(e.g. 340 students). That billed count is distinct from the **actual students
enrolled** in the school's SIS.

What we want, end to end:

1. Keep the **billed seat count** and the **actual enrolled count** as two separate,
   clearly-labelled numbers everywhere they appear.
2. **Warn** when a school is approaching its billed seat limit (a configurable gap,
   default 5 seats left), and **hard-block** new enrolment once the limit is reached,
   until the seats are increased.
3. Let the **CATRE team increase seats both automatically and manually.**
4. Support **both plan types** — flat-monthly and per-student — and give **both** a
   student count that drives the limit/increase flow.
5. Let the customer choose a **billing cycle** (monthly / quarterly / yearly) at
   onboarding, and generate bills on that cycle.

This is an **extension of the existing Catre billing module**, not a rebuild.

### Decisions locked in during brainstorming
- **Per-student amount** = `rate × count × months-in-cycle` (quarterly ×3, yearly ×12).
- **At the limit** = **hard block** new enrolment until seats increased.
- **Warning threshold** = **configurable per plan and per school** (default 5).
- **Mid-cycle seat increase** = **prorate the added seats for the remaining period now,
  then full amount from the next cycle.**
- **Seat increase** = **both auto and manual**, controlled by the CATRE team.

---

## 2. What already exists (baseline — build on this)

Verified in `sms-api`:

- **Billed vs enrolled already split.** `Tenants.StudentsCount` = billed/committed
  count; `EnrolledStudents` (live `count(*)` of active students) is computed on the
  read path. Read path returns `GREATEST(live, stored)`
  (`ClientRepository.cs:18-35`, `CatreContracts.cs:9-17`).
- **Plans** have `Pricing` (`flat` | `per_student`, free-text string), `Price`,
  `PerStudent`, `MinStudents`, `LimitsStudents` (capacity), and an **unused**
  `Period` label (`db/postgres/04_tables.sql:866-887`, `CatreContracts.cs:92-111`).
- **Pricing helper** `CatreMappers.ComputeMonthlyAmount` / `BillableSeats`
  (`CatreContracts.cs:135-155`): per-student → `PerStudent × max(students, seats,
  MinStudents, 1)`; flat → `Price`.
- **Invoices / Subscriptions** exist (`M0007_Catre_Billing_Tables.cs`) and are created
  **event-driven only** — on activation (`TenancyService.EnsureBillingOnActivateAsync:275-325`)
  and on plan upgrade (`PlanUpgradeService`). `RenewsAt` is hardcoded `+1 month`; due
  date hardcoded `+14 days`. **No recurring billing job exists** (only absence/transport
  workers).
- **80% usage alert** is read-only on the dashboard
  (`18_catre_procs.sql:181-197`) — **nothing blocks enrolment or billing.**
- **Create-client** `POST /v1/clients` → `CreateClientRequest` already accepts
  `StudentsCount` (documented "null for flat plans"), but **ignores `TrialDays`** and
  has **no billing-cycle field** (`CatreContracts.cs:19-26`,
  `0022_client_create_students_count.sql`).
- **Admin UI:** owner Subscriptions tab shows a generic "Students" column from
  `students_count` (`billing.tsx:277`, `ownerMap.ts:28`); the school dashboard already
  shows live enrolled students + staff via `GET /crm/dashboard/people`
  (`dashboard.tsx:114-119`).

### Gaps this spec closes
| Need | Gap today |
|---|---|
| (a) Seat limit + near-limit detection | No hard limit, no enforcement, no "approaching" event |
| (b) Flat plan carrying a student count | Flat ignores the count; documented "null for flat" |
| (c) Billing cycle monthly/quarterly/yearly | Only an unused `Period` label; renewal hardcoded monthly |
| (d) Bill generation on the cycle | No recurring job; one invoice per event, always monthly |
| (e) Auto vs manual seat increase | No seat-set endpoint, no auto-sync policy |

---

## 3. Data model changes

> Postgres is authoritative (`db/postgres/migrations/00NN_*.sql`). The FluentMigrator
> C# set is mirrored where the project keeps both in sync.

### 3.1 `Plans` (new columns)
- `IncludedStudents int NULL` — seats bundled into a **flat** plan's price.
  (Per-student plans keep using `PerStudent` + the tenant's seat count.)
- `SeatAlertThreshold int NULL` — default near-limit warning gap for schools on this
  plan (falls back to a global default of 5 when null).
- `AllowedCycles varchar` (CSV of `month,quarter,year`) — which cycles this plan offers
  at onboarding. (Pricing stays `rate × count × months`; no per-cycle price columns.)

### 3.2 `Tenants` (new columns)
- `SeatLimit int` — the **billed/licensed** seat count (the "340"). For per-student =
  committed count; for flat = plan's `IncludedStudents` (copied at create / change-plan).
- `BillingCycle varchar(12)` — `month` | `quarter` | `year`, chosen at onboarding.
- `SeatAlertThreshold int NULL` — per-school override of the warning gap.
- `SeatIncreaseMode varchar(8)` — `auto` | `manual` (default `manual`), set by CATRE.

### 3.3 `Subscriptions` (new columns)
- `BillingInterval varchar(12)` — snapshot of the tenant's cycle at creation.
- `PeriodStart timestamptz`, `PeriodEnd timestamptz` — the window the current invoice
  covers. `RenewsAt` advanced by the interval instead of hardcoded `+1 month`.

### 3.4 `Invoices` (new columns)
- `PeriodStart timestamptz`, `PeriodEnd timestamptz` — the billed window.
- `Seats int` — seat count snapshot the invoice was priced on.
- `Kind varchar(16)` — `cycle` | `proration` (to distinguish recurring bills from
  mid-cycle seat-increase charges).

---

## 4. Pricing rules

Let `months(cycle)` = 1 (month), 3 (quarter), 12 (year).

- **Per-student plan:** `amount = PerStudent × SeatLimit × months(cycle)`
  (`SeatLimit` is the billed count; `MinStudents` remains the floor).
- **Flat plan:** `amount = Price × months(cycle)`; `SeatLimit = IncludedStudents` acts
  as the enrolment cap (does not change the price).

`CatreMappers.ComputeMonthlyAmount` is generalised to `ComputeCycleAmount(plan, seats,
cycle)`; existing call sites (activation, upgrade, dashboard MRR) updated. MRR
continues to be stored **normalised to monthly** (`amount / months(cycle)`) so existing
MRR/revenue reporting stays correct.

---

## 5. Seat-limit enforcement & warnings

### 5.1 Enrolment check (hard block)
When a student is created/activated in the SIS, enforce against the school's own
`SeatLimit`:

- `activeEnrolled >= SeatLimit` → **block** (HTTP 403, machine-readable code
  `seat_limit_reached`) with message: *"Seat limit reached (N/N). Increase the plan to
  add more students."*
- `SeatLimit - activeEnrolled <= threshold` (threshold = tenant override → plan default
  → global 5) → **allow**, but the response carries a `seatWarning { remaining, limit }`
  payload so the UI can show the near-limit popup.

Enforcement lives in the SIS student-create path (server-side, authoritative). The
read-side 80% dashboard alert is kept but re-pointed at `SeatLimit` for consistency.

### 5.2 Auto vs manual increase (CATRE)
- **`SeatIncreaseMode = manual`** (default, and the only mode for **flat** plans):
  enrolment is blocked at the limit until CATRE raises seats. Flat plans need a bigger
  `IncludedStudents` / tier, so auto does not apply.
- **`SeatIncreaseMode = auto`** (per-student only): reaching the limit auto-bumps
  `SeatLimit` to `activeEnrolled` (+ an optional buffer), recomputes the subscription,
  and raises a **prorated** charge for the remaining period (see §6). The school is not
  blocked.

---

## 6. Seat increase — manual endpoint & proration

New endpoint (platform-authorised): `POST /v1/clients/{id}/seats`
`{ seatLimit: int, reason?: string }`.

On increase (manual or auto):
1. Update `Tenants.SeatLimit`; recompute and store MRR (normalised monthly).
2. Update the active `Subscription` seats.
3. **Prorate now:** `proration = (newSeats − oldSeats) × perSeatRate ×
   (daysRemainingInPeriod / daysInPeriod)` — issue a `Kind = proration` invoice for the
   remaining part of the current cycle.
4. **Next cycle** bills the full new amount automatically via the recurring worker (§7).

(For flat plans a seat/tier increase changes `Price`/`IncludedStudents`; proration uses
the price delta over the remaining period.)

---

## 7. Recurring bill generation (new worker)

Add a `BackgroundService` (alongside `AbsenceAlertWorker` /
`TransportOfflineSweepWorker`) that runs on an interval and, for each **active**
subscription where `RenewsAt <= now`:

1. Compute `amount = ComputeCycleAmount(plan, SeatLimit, BillingCycle)`.
2. Create a `Kind = cycle` invoice (`PeriodStart = old RenewsAt`,
   `PeriodEnd = old RenewsAt + cycle`, `Seats = SeatLimit`), status `open`, due in the
   existing +14-day window.
3. Advance `RenewsAt`, `PeriodStart/End` by `months(cycle)`.

Idempotent per period (guard on an existing `cycle` invoice for the same
`(subscription, PeriodStart)`), so re-runs never double-bill.

---

## 8. Onboarding / create-client

`CreateClientRequest` (`CatreContracts.cs:19-26`) gains:
- `StudentsCount` now accepted for **both** plan types (drops the "null for flat" rule);
  for flat it seeds `SeatLimit` from the plan's `IncludedStudents` if omitted.
- `BillingCycle` (`month` | `quarter` | `year`), validated against the plan's
  `AllowedCycles`.
- `SeatAlertThreshold?` (optional per-school override).

`client_create` proc + `TenancyService.CreateClientAsync` persist `SeatLimit`,
`BillingCycle`, threshold, and set `SeatIncreaseMode` default. Activation billing
(`EnsureBillingOnActivateAsync`) uses the cycle amount and seeds
`Subscription.BillingInterval` + period window.

---

## 9. Admin UI (`sms-admin`)

1. **Create-School wizard** (`src/screens/owner/portfolio.tsx`): show the student-count
   field for **both** plan types; add a **billing-cycle selector** (monthly / quarterly
   / yearly, limited to the plan's allowed cycles); send `students_count` + `billing_cycle`.
2. **Owner Subscriptions tab** (`src/screens/owner/billing.tsx`) + Account Report:
   show **Billed seats** vs **Enrolled** side by side, the **cycle** and **next charge**,
   a **near-limit badge**, an **"Increase seats"** action (calls the new endpoint), and
   an **auto/manual mode** toggle. Relabel the current generic "Students" column.
3. **School SIS / add-student** (`src/screens/school/*`): near-limit **popup**; hard
   **block dialog** at the limit (reads the `seat_limit_reached` / `seatWarning`
   responses).
4. **Plan editor:** `IncludedStudents` (flat), `SeatAlertThreshold`, `AllowedCycles`.
5. API types (`src/api/ownerTypes.ts`, `src/api/billing.ts`) extended for the new fields.

---

## 10. Phasing (for the implementation plan)

1. **Backend data model + pricing** — migrations (Plans/Tenants/Subscriptions/Invoices),
   `ComputeCycleAmount`, activation path, create-client (count for both types + cycle).
2. **Seat enforcement + warnings** — SIS block/warn, threshold resolution, re-point
   dashboard alert.
3. **Seat increase** — manual endpoint + proration; auto-mode rule.
4. **Recurring billing worker.**
5. **Admin UI** — wizard, subscription tab, SIS popups, plan editor.

Each phase gets tests (the repos use xUnit integration tests + vitest; follow TDD).

---

## 11. Out of scope / assumptions
- No change to the Razorpay payment/webhook flow beyond pricing the invoices it already
  consumes.
- MRR stays stored as a monthly-normalised figure; existing reports unchanged.
- Staff/storage limits keep their current (non-blocking) behaviour; only **students**
  get hard enforcement.
- Backfill: existing tenants get `SeatLimit` initialised from current `StudentsCount`
  (or plan limit) and `BillingCycle = month` in the migration.
