# Leave with Student Details — End-to-End Design

- **Date:** 2026-10-06
- **Author:** vd417 (with Claude)
- **Status:** Draft for review
- **Approach chosen:** A — backend join (resolve `ChildId` → `Students` in `sms-api`)
- **Repos touched:** `sms-api` (backend), `sms-admin` (admin console). Submission apps need **no** changes.

---

## 1. Intent (the agreed understanding)

When a leave application is reviewed in the admin console, the reviewer must be able to
see **who the leave is for** and open that person's full record:

- For a **student leave**, show the student's **name, class, section, and roll number or
  admission number**, and let the reviewer click through to the full **SIS student
  profile** (Student 360).
- A **leave must be visible to both `admin` and `owner`**, not only principal /
  vice-principal.
- For a **student leave** (submitted by a parent/student), the **teacher** and
  **principal** roles must also see the student's SIS details (name, class, section, roll)
  — the student context should be visible to the people who handle that student, not only
  admin/owner.
- When a **principal** — or anyone with CRM / admin-console access — applies for leave,
  that request must surface to the **owner** (there is no peer above them to approve it),
  and such a person must not be able to approve their own leave.
- The flow must work **end to end**: a leave submitted in an app → carried by the API with
  the student's identity resolved → displayed in the admin console with the details and
  the SIS link → under the correct visibility rules, with the existing
  pending / approved / rejected / history views intact.

Success = an admin or owner opening the Approvals inbox sees, on a student leave card, the
student's name · class-section · roll/admission, can click to the SIS profile, and a
principal's own leave appears for the owner and cannot be self-approved.

### Non-goals

- No change to how leave is **submitted** (parent/teacher/staff apps already send what is
  needed — see §3). No new leave-submission UI.
- No new leave *types*, balances, or approval-workflow stages.
- No change to attachments, substitute, or decision-note behaviour.
- `sms-catreadmin` is out of scope for this pass (the backend change benefits it for free;
  its UI is not modified here).

---

## 2. Current state (as found)

### 2.1 Backend — `sms-api` (.NET, Dapper, PostgreSQL; Staffing module; routes under `/v1`)

- Table `dbo.LeaveRequests` (`db/postgres/04_tables.sql:622-639`) already has:
  - `RequesterId uuid` — who submitted (set server-side from the JWT, **not** the payload).
  - `ChildId uuid NULL` — the student the leave is for (a parent-for-child leave). **No FK,
    never validated, never joined.**
  - `Type, FromDate, ToDate, Reason, Substitute, Status, AppliedOn, DecidedBy,
    DecidedNote, Priority, AttachmentUrls, Note`.
- `dbo.Students` (`04_tables.sql:1159-1183`) holds everything we want to show:
  `AdmissionNo, Name, Grade, Section, ClassLabel, Roll`, plus guardian fields.
- `LeaveResponse` DTO (`src/Sms.Modules.Staffing/Contracts/LeaveContracts.cs:9`) currently
  returns `RequesterName`, `DecidedByName`, `RequesterRole` (resolved by LEFT JOIN
  `dbo.Users`) but **nothing about the child/student**. `ChildId` is returned raw.
- Endpoints (`src/Sms.Api/Controllers/LeaveController.cs`):
  - `GET /v1/leave` — caller's own leaves.
  - `GET /v1/leave/balances`.
  - `POST /v1/leave` — `[Authorize]` only, **any authenticated user**. `ChildId` accepted
    from payload; `RequesterId` forced to the caller.
  - `GET /v1/approvals?status=` — `[Authorize(Policy = Policies.Principal)]`.
  - `PATCH /v1/approvals/{id}` — same policy; body `DecideLeaveRequest { Status, DecidedNote }`.
- **Visibility is already correct at the API:** `Policies.Principal` =
  `RequireRole(Principal, SchoolAdmin, SchoolOwner)`
  (`src/Sms.Shared.Kernel/Authz/AuthorizationPolicies.cs:14-17`). Admin and owner already
  see **every** leave in the tenant. The `for_roles` filtering described in
  `docs/api/admin-api.md:90-91` is **frontend/mock spec only — not implemented in the
  backend.**
- Repository: `LeaveRepository.ListByStatusAsync` (`.../Data/LeaveRepository.cs:37-53`)
  builds the approvals list inline, LEFT JOIN `dbo.Users` for requester/decider names and a
  scalar subquery for one `RequesterRole`. `CreateAsync`→proc `dbo.Leave_Create`,
  `DecideAsync`→proc `dbo.Leave_Decide`. Postgres functions in
  `db/postgres/13_staffing_procs.sql` (`leave_create:40`, `leave_decide:61`).
- **No self-approval guard**: `DecideLeaveAsync` (`StaffingService.cs:300`) 404s if missing,
  then decides — it does not check requester ≠ decider.

### 2.2 Admin console — `sms-admin` (React + TanStack Query)

- Leave is rendered only as generic **Approvals** items by `ApprovalCard`
  (`src/screens/school/dashboard.tsx:630-718`): it shows requester name + free-text role,
  **no student fields**.
- `Approval` model (`src/types/index.ts:439-458`) has no student/child fields; the wire
  mapper `mapWireToApproval` (`src/api/approvals.ts:111-133`) does not read `child_id`.
- Client-side visibility: `approvalsForRole` (`src/api/approvals.ts:137-140`) — **owner sees
  all**; everyone else sees only rows whose `forRoles` includes their role. Leave rows get a
  **client-side default** `LEAVE_FOR_ROLES = ['principal','vice_principal']`
  (`src/api/approvals.ts:9`) — so **admin does not see leave today**.
- Status tabs (pending / approved / rejected / all) and a **"Student"** requester-category
  filter already exist (`dashboard.tsx:803-824`, `requesterCategory:722-731`).
- SIS link target already exists: `app.go('school.student', { focus: <studentId> })` opens
  `Student360` (`src/screens/school/sis.tsx:1485+`), which shows admission/class/section/roll.

### 2.3 Submission apps (no change needed)

- **`sms-student-parent-app`** — parent submits for a selected child:
  `POST /leave { type, child_id, from_date, to_date, reason, note, attachment_urls? }`
  (`src/services/http/index.ts:600-609`). `child_id` from `useSelectedChild()`. No
  student-facing leave; this is the only source of **student** leave, and it already carries
  `child_id`.
- **`sms-teacher-app`** / **`sms-staff`** — self-leave: `POST /leave` with no child
  (`ChildId` null). Identity via `Authorization: Bearer` + `X-Tenant-Id`. Both have a
  History view already.

**Conclusion:** the only gaps are (1) the backend never resolves `ChildId`→student, and
(2) `sms-admin` neither reads/shows those details nor lets admin see leave.

---

## 3. End-to-end data flow (target)

```
Parent app  ──POST /v1/leave { child_id, ... }──▶  LeaveRequests (RequesterId=parent, ChildId=student)
Teacher/Staff ─POST /v1/leave { ... no child }─▶  LeaveRequests (RequesterId=staff,  ChildId=null)

Admin/Owner opens Approvals
  └▶ GET /v1/approvals?status=pending
       └▶ ListByStatusAsync: LEFT JOIN Users (requester/decider)
                             + LEFT JOIN Students ON Students.Id = LeaveRequests.ChildId   ◀── NEW
       └▶ LeaveResponse now carries StudentName/AdmissionNo/Class/Section/Roll (null for staff leave) ◀── NEW
  └▶ sms-admin mapWireToApproval reads child_id + student.* ──▶ Approval.student               ◀── NEW
  └▶ ApprovalCard shows "Name · Class-Section · Roll/Adm" and links to Student 360             ◀── NEW
  └▶ approvalsForRole lets admin + owner see leave                                             ◀── NEW

Decide (PATCH /v1/approvals/{id})
  └▶ reject if DecidedBy == RequesterId (self-approval guard)                                  ◀── NEW
```

---

## 4. Design

### 4.1 Backend (`sms-api`) — resolve the student, guard self-approval

**(a) Join `ChildId` → `Students` on the approvals read path.**
- Extend `ListByStatusAsync` (`LeaveRepository.cs:37-53`) with
  `LEFT JOIN dbo.Students st ON st."Id" = lr."ChildId" AND st."TenantId" = lr."TenantId"`
  and select `st."Name", st."AdmissionNo", st."Grade", st."ClassLabel", st."Section",
  st."Roll"`. All null when `ChildId` is null (staff/teacher self-leave) — expected.
- Mirror the same join on `GetAsync` (single row) so the detail/decider path is consistent.
- `ListMineAsync` (parent's own history) **may** also join so the parent sees the child
  name on their history row — low cost, improves the parent app's history labels, but
  strictly optional for this feature; include it for consistency.

**(b) Extend the `LeaveResponse` DTO** (`LeaveContracts.cs:9`) with init-only, nullable
fields: `StudentName, AdmissionNo, StudentClass` (map from `ClassLabel`/`Grade`),
`StudentSection, StudentRoll (int?)`. Add the Dapper ctor arity needed for the new column
count (the DTO already carries several ctors "to satisfy Dapper arity" — add the matching
one). Keep names snake_cased on the wire (`student_name`, `admission_no`, `student_class`,
`student_section`, `student_roll`) to match existing wire conventions.

**(c) Self-approval guard** in `DecideLeaveAsync` (`StaffingService.cs:300`): after loading
the request, if `request.RequesterId == tenant.UserId`, return a 403/validation error
("You cannot decide your own leave request"). This is what makes a principal's own leave
route up: admin/owner can still decide it, the principal cannot.
- *Note:* owner/admin already see all leave via the Principal policy, so a principal's leave
  is already visible to the owner; the guard is the missing enforcement piece.

**(d) `Note` field (optional, low-cost):** the table has a `Note` column the DTO doesn't
surface. Out of scope unless we want the parent's free-text note on the card — flag as an
open question (§7).

**No change** to `POST /v1/leave`, balances, `Leave_Create`/`Leave_Decide` procs (the join
is read-side only), or the submission apps.

### 4.2 Admin console (`sms-admin`) — read, display, link, and widen visibility

**(a) Model** — add to `Approval` (`src/types/index.ts:439-458`) an optional nested object:
```ts
student?: {
  id?: string;        // ChildId — used for the SIS deep link
  name?: string;
  cls?: string;       // class label
  section?: string;
  roll?: number;
  adm?: string;       // admission number
}
```
Nested keeps the existing flat requester fields untouched and makes "is this a student
leave?" a simple `a.student != null` check.

**(b) Mapper** — in `mapWireToApproval` (`src/api/approvals.ts:111-133`), when the wire row
has `child_id` (and/or `student_name`), populate `student` from
`child_id, student_name, student_class, student_section, student_roll, admission_no`.
Absent → leave `student` undefined (staff/teacher leave is unaffected).

**(c) Card display** — in `ApprovalCard` (`dashboard.tsx:630-718`), when `a.student` is
present, render a student row near the requester row:
`"<name> · Class <cls>-<section> · Roll <roll> · Adm <adm>"`, using existing
`formatStudentRoll`. Only render the fields that are present (defensive).

**(d) SIS link** — if `a.student?.id` is present, make that row a button that calls
`app.go('school.student', { focus: a.student.id })` (the exact pattern SIS already uses,
`sis.tsx:1391`). Gate on the viewer actually having SIS view access (the `sis` module is
viewable by admin/principal/vice_principal/teacher/staff per the PERMS matrix) so the link
isn't shown to someone who can't open the profile.

**(e) Visibility — admin sees leave; teacher/principal see student leave** — two parts:
- **Staff/own leave** stays visible to the manager tier: change `LEAVE_FOR_ROLES`
  (`src/api/approvals.ts:9`) from `['principal','vice_principal']` to
  `['admin','principal','vice_principal']`. Owner already sees all via `approvalsForRole`
  (`:138`). This mirrors the backend's Principal-policy reality (admin is already authorized
  server-side — see **backend note** below).
- **Student leave** (rows where `student` is set) should additionally be visible to
  **teacher** — so the people who handle the student see it, with the SIS details. Concretely,
  when a leave is a student leave, its effective `forRoles` includes `teacher` (and the
  manager tier). Teacher already has `sis` view access, so the student text + SIS link render
  for them.
- **Backend note (important):** `GET /v1/approvals` is gated by `Policies.Principal` =
  Principal / admin / owner only — **teacher is not authorized server-side today**. So
  teacher visibility of student leave requires a **backend authorization change** too, not
  just the `sms-admin` filter. See the open question in §7 on whether teacher visibility is
  all-student or class-scoped, which determines how much backend work this adds.
- The Sidebar pending-count badge (`src/components/shell/Sidebar.tsx:69-72`) uses the same
  `approvalsForRole`, so admin will also get the count — verify it reads correctly and stays
  suppressed for the owner console as today.

**(f) Pending / history** — no change; status tabs already provide pending vs
approved/rejected (history). Confirm the "Student" category filter now has real
student-linked rows to filter.

### 4.3 What explicitly does NOT change

- Submission apps (`sms-student-parent-app`, `sms-teacher-app`, `sms-staff`).
- Leave creation, balances, decision flow, attachments, substitute.
- `sms-catreadmin` UI (benefits from the backend fields when it chooses to read them).

---

## 5. Visibility & routing rules (consolidated)

| Who applies | Who sees it | Who can decide |
|---|---|---|
| Parent / student (for a student) | admin, owner, principal, vice-principal, **teacher** (sees SIS details: name/class/section/roll) | admin / owner / principal (not the parent) |
| Teacher / Staff | admin, owner, principal, vice-principal | admin / owner / principal |
| Principal / CRM-access user | admin, **owner** (sees all) | **owner / admin** — **not** the requester (self-approval guard) |

**Teacher scope caveat:** "teacher sees student leave" can mean *every* student leave in the
tenant, or only leaves for students in the teacher's own class/section. The second is the
safer default but needs a class-teacher→student mapping on the backend. This is an open
question (§7.5) and directly affects backend authorization scope for `GET /v1/approvals`.

- Admin visibility: backend already allows it; `sms-admin` gains it via `LEAVE_FOR_ROLES`.
- Principal's own leave → owner: enforced by the **self-approval guard** (§4.1c) plus the
  owner's see-all; no special routing column needed.

---

## 6. Error handling & edge cases

- **`ChildId` points at a deleted/absent student** (no FK): LEFT JOIN yields nulls; card
  simply shows no student row (or requester only). No crash.
- **Staff/teacher self-leave** (`ChildId` null): `student` undefined; card behaves exactly
  as today.
- **Cross-tenant safety:** the `Students` join is constrained by `TenantId` so a stray
  `ChildId` cannot leak another tenant's student.
- **Viewer lacks SIS access:** render the student *text* but not the clickable link.
- **Parent cannot approve:** parent is not in the Principal policy, so they never reach
  `PATCH /v1/approvals`; the guard additionally stops any requester (incl. principal).
- **Dapper arity:** adding columns requires the matching `LeaveResponse` ctor — a known
  footgun in this DTO; cover with a mapping test.

---

## 7. Open questions — RESOLVED (user approved defaults, 2026-10-06 "go")

> Decisions locked for planning: (1) parent note **not** shown on the card; (2) `ListMineAsync`
> join **included** (low cost); (3) class display prefers **`ClassLabel`**, falls back to
> `Grade`; (4) `sms-catreadmin` **deferred**; (5) teacher visibility is **class-scoped** — a
> teacher sees student leave only for students in their own class/section. **Planning must
> first verify a class-teacher→student mapping exists in `sms-api`**; if none exists cheaply,
> the plan surfaces it before committing to class-scoping (fallback: principal/admin/owner
> only for this pass, with teacher scope as a follow-up).

### Original questions (for reference)

1. **Parent's note on the card?** The backend has `Note` and the parent app sends it. Show
   it on the admin card, or leave it out of this pass? (Default: leave out.)
2. **`ListMineAsync` join** — also resolve child name on the parent's own history
   (nice-to-have), or keep the join strictly on the approvals/detail read paths?
   (Default: include it, low cost.)
3. **Class label source** — display `ClassLabel` (e.g. "Grade 5 - A") or compose from
   `Grade` + `Section`? (Default: prefer `ClassLabel`, fall back to `Grade`.)
4. **`sms-catreadmin`** — include its UI in this effort, or defer? (Default: defer.)
5. **Teacher visibility scope** — should a teacher see **every** student leave in the tenant,
   or only leaves for students in **their own class/section**? Class-scoped is safer but
   requires a class-teacher→student mapping and a scoped query on `GET /v1/approvals` (today
   that endpoint is Principal/admin/owner-only and returns the whole tenant). This choice is
   the single biggest driver of backend effort. (Default proposal: class-scoped, but confirm.)

---

## 8. Testing strategy

**Backend (`sms-api`):**
- Repository/integration test: a leave with a valid `ChildId` returns the student fields;
  a self-leave (`ChildId` null) returns nulls; a dangling `ChildId` returns nulls.
- DTO mapping test covering the new Dapper ctor arity.
- Decide test: requester == decider → rejected (403/validation); admin/owner decider → ok.

**Admin (`sms-admin`):**
- `mapWireToApproval` unit tests: wire with `child_id`+student fields → populated
  `student`; wire without → undefined.
- `approvalsForRole`: admin now sees leave rows; owner sees all; teacher/staff/principal
  unchanged.
- `ApprovalCard` render tests: student row shows name/class/section/roll/adm; link fires
  `app.go('school.student', {focus})`; no student → no row; no SIS access → text, no link.

**End-to-end (manual or `sms-api-e2e-wt`):**
- Parent submits leave for a child → admin Approvals shows the student details + working SIS
  link → admin approves. Principal submits own leave → visible to owner, principal blocked
  from self-approval.

---

## 9. Sequencing (when implementation is approved)

1. **`sms-api`** first (own branch): add the Students join + DTO fields + self-approval
   guard + tests. Deploy/verify the `/v1/approvals` payload carries the student fields.
2. **`sms-admin`** next (own branch): model + mapper + card + SIS link + `LEAVE_FOR_ROLES`
   + tests, against the extended payload.
3. Each repo reviewed and merged independently; `sms-admin` degrades gracefully if the
   backend fields are absent (fields simply don't render), so ordering is safe either way.

---

*This is a design for review. No implementation has been done. After approval, the next step
is the writing-plans skill to produce the per-repo implementation plan.*
