# Leave Student Details — `sms-admin` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the student's name/class/section/roll/admission on a student leave in the admin Approvals inbox, link it to the SIS Student 360 profile, and let `admin` (and, for student leaves, `teacher`) see leave — on top of the owner/principal who see it today.

**Architecture:** Frontend-only changes in `sms-admin`. The backend (`sms-api`) adds student fields to the `/v1/approvals` wire rows (separate plan); this plan reads them defensively so it degrades gracefully when they are absent. A nested optional `student` object on the `Approval` model carries the resolved student; the mapper populates it from the wire; the card renders a student row and a SIS deep-link; the role-visibility helpers widen to include `admin` (all leave) and `teacher` (student leave only).

**Tech Stack:** React, TypeScript, Vite, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-06-leave-student-details-design.md`

## Global Constraints

- Wire → model mapping uses `snakeToCamel` first (see `src/api/approvals.ts:87`); after that, fields are camelCase (`childId`, `studentName`, `admissionNo`, `studentClass`, `studentSection`, `studentRoll`).
- Leave wire rows have **no** `title`+`forRoles` pair (that branch is for canonical fee/exam approvals); student fields appear only on the **leave branch** of `mapWireToApproval` (`src/api/approvals.ts:111-134`).
- `owner` is a super-role: `approvalsForRole` returns the full list for owner and must stay that way (`src/api/approvals.ts:138`).
- Roll display uses `formatStudentRoll` from `@/lib/studentRoll` (never render a raw roll int).
- SIS deep-link is exactly `app.go('school.student', { focus: <studentId> })` (matches `src/screens/school/sis.tsx:1391`).
- All new fields are **optional**; a leave with no student (teacher/staff self-leave) must render exactly as today.
- Tests: `npm run test` (vitest run). Match the existing idiom in `src/api/approvals.test.ts`.

## Review Focus

- **Dangling / partial student data:** a wire row with `child_id` but missing name (deleted student) must not crash the card — render only present fields, no link without `studentId`. (Task 2 + Task 4 tests.)
- **Self-leave unchanged:** a leave row with no student fields must map to `student === undefined` and the card must look identical to today. (Task 2 + Task 4 tests.)
- **Owner still sees everything:** widening `LEAVE_FOR_ROLES` must not narrow owner. (Task 3 test asserts owner sees a student leave and a staff leave.)
- **Teacher sees student leave but not staff leave:** teacher visibility must be scoped to rows where `student` is set, not all leave. (Task 3 test.)
- **Viewer without SIS access:** the student *text* shows but the clickable link must be suppressed when the viewer can't open the profile. (Task 4 test.)

---

### Task 1: Add the optional `student` object to the `Approval` type

**Files:**
- Modify: `src/types/index.ts:439-458`

**Interfaces:**
- Produces: `Approval.student?: { id?: string; name?: string; cls?: string; section?: string; roll?: number; adm?: string }` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Add the nested optional field to the `Approval` interface**

In `src/types/index.ts`, inside `export interface Approval { ... }`, add after `attachmentUrls?: string[]`:

```ts
  /** Present only on a student leave (parent/student submitted). Resolved from the
   *  leave's ChildId → Student on the backend. Absent for teacher/staff self-leave. */
  student?: {
    id?: string
    name?: string
    cls?: string
    section?: string
    roll?: number
    adm?: string
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages yet; the field is optional).

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(approvals): add optional student object to Approval type"
```

---

### Task 2: Populate `student` in `mapWireToApproval`

**Files:**
- Modify: `src/api/approvals.ts:111-134`
- Test: `src/api/approvals.test.ts`

**Interfaces:**
- Consumes: `Approval.student` (Task 1); `snakeToCamel` (`src/api/mapper.ts`, already imported).
- Produces: leave rows now carry `student` when the wire has `child_id`/`student_name`.

- [ ] **Step 1: Write the failing tests**

Add to `src/api/approvals.test.ts` inside the `describe('mapWireToApproval', ...)` block:

```ts
it('populates student details on a parent/student leave row', () => {
  const row = mapWireToApproval({
    id: 'L1', type: 'sick', status: 'pending',
    requester_name: 'Asha (parent)', requester_role: 'parent',
    applied_on: '2026-10-01T10:00:00Z',
    child_id: 'stu-123', student_name: 'Rahul Sharma',
    student_class: 'Grade 5', student_section: 'A', student_roll: 12,
    admission_no: 'ADM-2024-012',
  })
  expect(row.student).toEqual({
    id: 'stu-123', name: 'Rahul Sharma', cls: 'Grade 5',
    section: 'A', roll: 12, adm: 'ADM-2024-012',
  })
})

it('leaves student undefined for a staff self-leave row', () => {
  const row = mapWireToApproval({
    id: 'L2', type: 'casual', status: 'pending',
    requester_name: 'Rajesh Kumar', applied_on: '2026-10-01T10:00:00Z',
  })
  expect(row.student).toBeUndefined()
})

it('includes only the student fields that are present (deleted/partial student)', () => {
  const row = mapWireToApproval({
    id: 'L3', type: 'sick', status: 'pending',
    requester_name: 'Asha (parent)', applied_on: '2026-10-01T10:00:00Z',
    child_id: 'stu-999',
  })
  expect(row.student).toEqual({ id: 'stu-999' })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/api/approvals.test.ts`
Expected: FAIL (the three new tests — `row.student` is `undefined`).

- [ ] **Step 3: Implement the student builder and attach it on the leave branch**

In `src/api/approvals.ts`, add this helper above `mapWireToApproval` (after `approvalExtras`, ~line 84):

```ts
function buildStudent(a: Record<string, unknown>): Approval['student'] | undefined {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const id = str(a.childId)
  const name = str(a.studentName)
  const cls = str(a.studentClass)
  const section = str(a.studentSection)
  const adm = str(a.admissionNo)
  const roll = typeof a.studentRoll === 'number' ? a.studentRoll : undefined
  const s: NonNullable<Approval['student']> = {}
  if (id) s.id = id
  if (name) s.name = name
  if (cls) s.cls = cls
  if (section) s.section = section
  if (roll != null) s.roll = roll
  if (adm) s.adm = adm
  return Object.keys(s).length > 0 ? s : undefined
}
```

Then, in the leave-request return object (`src/api/approvals.ts:120-133`), add `student` after `...extras`:

```ts
  return {
    id: String(a.id),
    type: 'Leave Request',
    module: 'hr',
    cap: 'A',
    title: `Leave — ${requester} (${leaveType})`,
    detail: detailParts.join('. ') || 'Leave request pending review.',
    requester,
    role: String(a.requesterRole ?? ''),
    amount: null,
    priority,
    forRoles: forRoles.length > 0 ? forRoles : LEAVE_FOR_ROLES,
    ...extras,
    ...(buildStudent(a) ? { student: buildStudent(a) } : {}),
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/api/approvals.test.ts`
Expected: PASS (all tests, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/api/approvals.ts src/api/approvals.test.ts
git commit -m "feat(approvals): map student details onto student leave rows"
```

---

### Task 3: Widen leave visibility — admin sees all leave, teacher sees student leave

**Files:**
- Modify: `src/api/approvals.ts:9` (`LEAVE_FOR_ROLES`), `src/api/approvals.ts:131` (leave branch), `src/api/approvals.ts:137-140` (`approvalsForRole`)
- Test: `src/api/approvals.test.ts`

**Interfaces:**
- Consumes: `Approval.student` (Task 1), `approvalsForRole(list, role)` (existing).
- Produces: `approvalsForRole` behavior — `admin` sees every leave; `teacher` sees leave rows where `student` is set; `owner` still sees all; `principal`/`vice_principal` unchanged.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `src/api/approvals.test.ts`:

```ts
describe('leave visibility', () => {
  const studentLeave = mapWireToApproval({
    id: 'SL', type: 'sick', status: 'pending', requester_name: 'Asha (parent)',
    applied_on: '2026-10-01T10:00:00Z', child_id: 'stu-1', student_name: 'Rahul',
  })
  const staffLeave = mapWireToApproval({
    id: 'TL', type: 'casual', status: 'pending', requester_name: 'Rajesh',
    applied_on: '2026-10-01T10:00:00Z',
  })
  const all = [studentLeave, staffLeave]

  it('admin sees both student and staff leave', () => {
    expect(approvalsForRole(all, 'admin').map((a) => a.id)).toEqual(['SL', 'TL'])
  })
  it('owner still sees everything', () => {
    expect(approvalsForRole(all, 'owner')).toHaveLength(2)
  })
  it('teacher sees student leave only, not staff leave', () => {
    expect(approvalsForRole(all, 'teacher').map((a) => a.id)).toEqual(['SL'])
  })
  it('principal still sees both (manager tier)', () => {
    expect(approvalsForRole(all, 'principal').map((a) => a.id)).toEqual(['SL', 'TL'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- src/api/approvals.test.ts`
Expected: FAIL (admin/teacher get `[]` because `LEAVE_FOR_ROLES` excludes them).

- [ ] **Step 3: Implement — add admin to the default, teacher to student leaves, and the teacher rule**

In `src/api/approvals.ts`, change line 9:

```ts
const LEAVE_FOR_ROLES: Role[] = ['admin', 'principal', 'vice_principal']
```

In the leave-request return object, replace the `forRoles` line so a **student** leave also admits `teacher`:

```ts
    forRoles: forRoles.length > 0
      ? forRoles
      : (buildStudent(a) ? [...LEAVE_FOR_ROLES, 'teacher'] : LEAVE_FOR_ROLES),
```

> `approvalsForRole` already filters by membership in `forRoles`, so no change is needed there — `teacher` is admitted only on rows where `buildStudent(a)` is truthy (student leaves). Keep `approvalsForRole` as-is; the owner super-role branch (`:138`) stays.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/api/approvals.test.ts`
Expected: PASS. Also re-run the pre-existing `mapWireToApproval` test that asserts `forRoles: ['principal','vice_principal']` for a **staff** leave — it must still pass (that row has no student, so the default is unchanged except for the added `admin`).

> NOTE: the pre-existing test at `approvals.test.ts:48` asserts `forRoles: ['principal', 'vice_principal']` via `toMatchObject` on a **staff** leave. Because `LEAVE_FOR_ROLES` now starts with `admin`, update that expectation to `['admin', 'principal', 'vice_principal']` in the same step.

- [ ] **Step 5: Commit**

```bash
git add src/api/approvals.ts src/api/approvals.test.ts
git commit -m "feat(approvals): admin sees all leave; teacher sees student leave"
```

---

### Task 4: Render the student row + SIS link on the leave card

**Files:**
- Modify: `src/screens/school/dashboard.tsx` (`ApprovalCard` ~630-718; its call sites in `ApprovalsInbox`)
- Test: `src/screens/school/dashboard.approvalCard.test.tsx` (new)

**Interfaces:**
- Consumes: `Approval.student` (Task 1); `formatStudentRoll` from `@/lib/studentRoll`; `app.go` from `useApp()`; `can('sis', 'V', role)` or the existing SIS-visibility check (see Step 3).
- Produces: a visible student row; an `onOpenStudent(id)` callback wired from `ApprovalsInbox` to `ApprovalCard`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/school/dashboard.approvalCard.test.tsx`. (If `ApprovalCard` is not exported, Step 3 exports it.)

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApprovalCard } from './dashboard'
import type { Approval } from '@/types'

const base: Approval = {
  id: 'SL', type: 'Leave Request', module: 'hr', cap: 'A',
  title: 'Leave — Asha (sick)', detail: 'Fever', requester: 'Asha (parent)',
  role: 'parent', amount: null, age: '2h', priority: 'medium',
  forRoles: ['admin', 'principal', 'vice_principal', 'teacher'], status: 'pending',
  student: { id: 'stu-1', name: 'Rahul Sharma', cls: 'Grade 5', section: 'A', roll: 12, adm: 'ADM-012' },
}

function noop() {}

it('shows the student name, class-section, roll and admission', () => {
  render(<ApprovalCard a={base} currency="INR" showActions={false}
    onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={noop} />)
  expect(screen.getByText(/Rahul Sharma/)).toBeInTheDocument()
  expect(screen.getByText(/Grade 5/)).toBeInTheDocument()
  expect(screen.getByText(/A/)).toBeInTheDocument()
  expect(screen.getByText(/ADM-012/)).toBeInTheDocument()
})

it('opens the SIS profile when the student row is clicked', async () => {
  const onOpenStudent = vi.fn()
  render(<ApprovalCard a={base} currency="INR" showActions={false}
    onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={onOpenStudent} />)
  await userEvent.click(screen.getByRole('button', { name: /Rahul Sharma/ }))
  expect(onOpenStudent).toHaveBeenCalledWith('stu-1')
})

it('shows student text but no link when the viewer lacks SIS access', () => {
  render(<ApprovalCard a={base} currency="INR" showActions={false}
    onApprove={noop} onReject={noop} canOpenStudent={false} onOpenStudent={noop} />)
  expect(screen.getByText(/Rahul Sharma/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Rahul Sharma/ })).toBeNull()
})

it('renders no student row for a staff self-leave', () => {
  const staff: Approval = { ...base, id: 'TL', student: undefined, title: 'Leave — Rajesh (casual)', requester: 'Rajesh' }
  render(<ApprovalCard a={staff} currency="INR" showActions={false}
    onApprove={noop} onReject={noop} canOpenStudent onOpenStudent={noop} />)
  expect(screen.queryByText(/Roll/)).toBeNull()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- src/screens/school/dashboard.approvalCard.test.tsx`
Expected: FAIL (`ApprovalCard` not exported / props `canOpenStudent`,`onOpenStudent` don't exist).

- [ ] **Step 3: Implement — export the card, add props, render the student row**

In `src/screens/school/dashboard.tsx`:

1. Add the import near the other `@/lib` imports:
```ts
import { formatStudentRoll } from '@/lib/studentRoll'
```
2. Export the component and extend its props:
```ts
export function ApprovalCard({
  a, currency, showActions, onApprove, onReject,
  canOpenStudent = false, onOpenStudent,
}: {
  a: Approval
  currency: string
  showActions: boolean
  onApprove: (a: Approval) => void
  onReject: (a: Approval) => void
  canOpenStudent?: boolean
  onOpenStudent?: (studentId: string) => void
}) {
```
3. Insert the student row immediately after the title/detail block (after `src/screens/school/dashboard.tsx:660`, before the attachments block):
```tsx
      {a.student && (() => {
        const s = a.student
        const parts = [
          s.cls ? `Class ${s.cls}${s.section ? `-${s.section}` : ''}` : (s.section ? `Section ${s.section}` : ''),
          s.roll != null ? `Roll ${formatStudentRoll(s.roll)}` : '',
          s.adm ? `Adm ${s.adm}` : '',
        ].filter(Boolean)
        const label = `${s.name ?? 'Student'}${parts.length ? ' · ' + parts.join(' · ') : ''}`
        const clickable = canOpenStudent && !!s.id && !!onOpenStudent
        return (
          <div className="t-sm" style={{ marginTop: 8 }}>
            <span className="muted3">For student: </span>
            {clickable ? (
              <button type="button" className="link-btn" onClick={() => onOpenStudent!(s.id!)}>
                {label}
              </button>
            ) : (
              <span className="fw6">{label}</span>
            )}
          </div>
        )
      })()}
```
> Use the codebase's existing link/button style. If no `link-btn` class exists, use the same ghost-button pattern used elsewhere in this file for inline nav (grep `app.go(` in this file for the idiom) — the test only asserts a `role="button"` with the student name, so a `<button>` satisfies it.

- [ ] **Step 4: Wire the callback from `ApprovalsInbox`**

In `ApprovalsInbox` (`src/screens/school/dashboard.tsx:733+`), where `app = useApp()` is available and where `<ApprovalCard ... />` is rendered, pass:
```tsx
            canOpenStudent={can('sis', 'V', app.role)}
            onOpenStudent={(id) => app.go('school.student', { focus: id })}
```
Use the same SIS view-permission check the rest of the app uses. Grep for how `can(` / `caps` is imported in sibling screens (`src/lib/gating.ts` exports `can`); import it here if not already. If `ApprovalsInbox` maps the list, add these two props inside that `.map(...)` render.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- src/screens/school/dashboard.approvalCard.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm run test`
Expected: PASS (whole suite).

- [ ] **Step 7: Commit**

```bash
git add src/screens/school/dashboard.tsx src/screens/school/dashboard.approvalCard.test.tsx
git commit -m "feat(approvals): show student details + SIS link on leave cards"
```

---

### Task 5: Manual end-to-end verification against the backend

**Files:** none (verification only)

- [ ] **Step 1: Run the app against a backend that returns the new student fields**

Run: `npm run dev`

- [ ] **Step 2: Verify as admin and as owner**

Log in as `admin`, open **Approvals**. Confirm:
- A parent-submitted (student) leave shows the **For student: Name · Class-Section · Roll · Adm** row.
- Clicking it opens the SIS Student 360 profile for that student.
- The pending / approved / rejected tabs and the "Student" category filter work.
Repeat as `owner` (sees all leave) and `teacher` (sees student leave only).

- [ ] **Step 3: Verify graceful degradation**

Point at a backend build **without** the student fields (or a staff self-leave): the card shows no student row and behaves exactly as before. No console errors.

---

## Self-Review

- **Spec coverage:** student fields on card (Tasks 1,2,4) ✓; SIS link (Task 4) ✓; admin visibility (Task 3) ✓; teacher-sees-student-leave (Task 3) ✓; pending/history unchanged (no task needed — existing tabs) ✓; submission apps untouched ✓; backend join is the separate `sms-api` plan. The self-approval guard is **backend-only** — not in this plan (correctly out of scope for `sms-admin`).
- **Placeholder scan:** no TBD/TODO; all code shown. The one soft spot (exact link CSS class) is bounded with a concrete fallback and a test that only needs a `<button>`.
- **Type consistency:** `student` shape identical across Tasks 1/2/3/4; `buildStudent` returns `Approval['student']`; `onOpenStudent(studentId: string)` consistent between card and inbox.
- **Review Focus:** dangling student (Task 2 "partial" test + Task 4 staff test), self-leave unchanged (Tasks 2,4), owner unaffected (Task 3), teacher scoped (Task 3), no-SIS-access (Task 4) — all have owning tests.
