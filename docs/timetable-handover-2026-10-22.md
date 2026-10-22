# Timetable work — handover (2026-10-22)

Handover for continuing in Cursor. Covers what was done today, what's still
pending, and the one architectural gotcha that matters most.

**Scope today:** Phase A frontend only. All changes are in
`src/screens/school/academics.tsx` and are **uncommitted** (`git status` shows
it as modified: +34 / −7).

---

## ✅ Done today (Phase A — frontend, uncommitted)

### 1. Per-class timetable publish status
Previously one global flag marked *every* class as "published" the moment any
slot row existed anywhere in the school. Now each class is judged against its
own published baseline.

- New helpers in `academics.tsx`:
  - `canonicalClassGrid(grid)` — stable serialization of one class's grid
    (sorted slot keys → `[key, subject, teacherId]`), so comparisons ignore
    object key order.
  - `timetableClassStatus(published, current)` → `'empty' | 'draft' |
    'published' | 'unpublished'` for a **single** class.
- `TimetableTab` now computes `status` from
  `publishedGrids[cls]` vs `grids[cls]` instead of the whole-school
  `publishStatusOf(...)`.
- New `showPublishClass = status === 'draft' || status === 'unpublished'`
  drives the "Save & publish" button (replaces `showPublishButton(...)` at
  both call sites).

### 2. No generic-catalog fallback when generating
A class now generates/builds its timetable **only** from its own mapped
subjects. The old behaviour fell back to the generic subject catalog, which
let an unmapped class generate a bogus timetable.

- `subjectNames = assignedSubjects` (dropped the `: catalogSubjects` fallback).
- Empty state is now class-aware:
  - No subjects in the catalog at all → "No subjects yet" (add + map first).
  - Catalog has subjects but none mapped to this class → "No subjects mapped to
    {cls}" telling the admin to map under **Academics → Classes → Subjects**.

---

## Phase B — continued in Cursor (2026-10-22, uncommitted)

Timetable draft/publish now uses the same envelope as periods and tests.

- Postgres migration `sms-api/db/postgres/migrations/0032_timetable_schedule.sql`
  (`dbo.TimetableSchedules` + `timetableschedule_get` / `timetableschedule_upsert`).
  Applied on local `sms_dev` and recorded in `dbo.schema_migrations` (version 32).
- API: `GET/PUT /v1/class-routine` (not `/timetable`, which is the live slot list).
- `academicsPublish.ts` no longer keeps the timetable envelope only in session memory.
  Reload reads the saved draft and published snapshot.
- Schools that already published slot rows but have no envelope still hydrate from
  `GET /timetable` until the next save.
- Last 5 saves are kept in `dbo.TimetableScheduleHistory` (`GET /v1/class-routine/history`).
  A changed draft or publish is one row. Saving the same timetable again does not add a row.
  The current envelope still holds only the latest draft and the latest published copy.
- `Sms.Api` built clean. It was not running, so restart it before trying Save draft
  in the browser. Admin vitest: `academicsPublish.test.ts` and `timetableViews.test.tsx` passed.

## ⛔ Still open

- Not committed (admin or api). Do not push unless asked.
- Not clicked through in the running admin app (restart `Sms.Api` on :5262 to load history).
- PgMigrator still aborts on the 0021 checksum mismatch. 0032 was applied with psql
  and recorded in `schema_migrations`, so a later `migrate` should see it as done.

---

## Suggested next steps
1. Restart the API, then in Academics → Timetable confirm: unmapped class shows the
   empty state and class picker; a mapped class can Save draft, reload, and still
   show Draft or Published for that class only.
2. Commit on a branch when asked (don't push — merge to `main` locally).

## Key files
- `src/screens/school/academics.tsx` — Phase A frontend changes (uncommitted).
- `src/lib/academicsPublish.ts` — timetable draft/publish now goes to `GET/PUT /v1/class-routine`.
- `sms-api` `0032_timetable_schedule.sql`, `AcademicsPublishController`, `AcademicPublishRepository`.
