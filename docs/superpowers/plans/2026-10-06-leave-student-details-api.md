# Leave Student Details — `sms-api` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This plan lives in the `sms-admin` repo's docs for convenience, but every path below is in the `sms-api` repo (`D:\convert\SMS backend\sms-api`). Run all commands from there.**

**Goal:** On the leave/approvals read path, resolve each leave's `ChildId` → `Students` and return the student's name/admission/class/section/roll; stop a requester from deciding their own leave (so a principal's leave routes to the owner/admin); and (Phase 2) let a class-teacher see the student leaves of their own class.

**Architecture:** Phase 1 is a read-path join plus a guard — the student LEFT JOIN is added only to `LeaveRepository.ListByStatusAsync`'s inline SQL (the sole client-facing list); the `LeaveResponse` record gains trailing init-only student properties and one new exact-arity constructor (Dapper materializes by exact column count — see the record's own comments). The self-approval guard is a single check in `DecideLeaveAsync` using the `RequesterId` already returned by `GetAsync`. Phase 2 adds teacher scoping: the approvals endpoint opens to teachers, and when the caller is a plain teacher the list is filtered to the student ids of the classes they are `ClassTeacherId` of, reusing the existing Grade/Section/ClassLabel student-match predicate.

**Tech Stack:** .NET (C#), Dapper, PostgreSQL. Tests: xUnit + FluentAssertions integration tests against a real Postgres (`PostgresFixture`, `WebApplicationFactory<Program>`), `[Collection("sql")]`.

**Spec:** `sms-admin/docs/superpowers/specs/2026-10-06-leave-student-details-design.md`

## Global Constraints

- Table/column quoting is PostgreSQL double-quoted PascalCase, schema `dbo` (e.g. `"dbo"."Students"."AdmissionNo"`). Follow the existing SQL style in `LeaveRepository.cs`.
- Dapper requires a `LeaveResponse` constructor whose parameter count **exactly** matches the query's column count. The list query column count changes in Task 2 — add the matching constructor in Task 1 first.
- Wire serialization is snake_case: `StudentName → student_name`, `AdmissionNo → admission_no`, `StudentClass → student_class`, `StudentSection → student_section`, `StudentRoll → student_roll`. The `sms-admin` plan reads exactly these names.
- `ChildId` has **no FK**; the join must be `LEFT JOIN` and tenant-scoped (`AND st."TenantId" = lr."TenantId"`) so a dangling/cross-tenant child yields nulls, never a leak.
- Student↔class linkage is **string-based** (no `ClassId` on `Students`): match `Students.Grade=Classes.Grade AND Students.Section=Classes.Section`, OR `Students.ClassLabel=Classes.Name`. Reuse the predicate already in `PeriodAttendanceQueryRepository.cs:248-252`.
- `ITenantContext` exposes only `TenantId` and `UserId` (no role) — manager-vs-teacher must be decided from the `ClaimsPrincipal` in the controller (`User.IsInRole(...)`).
- Run tests: `dotnet test tests/Sms.Tests.Integration` (requires the test Postgres the fixture spins up). Build: `dotnet build`.

## Review Focus

- **Dangling / cross-tenant `ChildId`:** a leave whose `ChildId` matches no active student (or another tenant's) must return null student fields, not error or leak. (Task 2 test.)
- **Staff self-leave (null `ChildId`):** must still return exactly the pre-existing shape with null student fields. (Task 2 test.)
- **Self-approval:** a requester deciding their own leave (`RequesterId == caller`) must be rejected with 403, even if they hold the Principal/admin role. (Task 3 test.)
- **Teacher over-reach (Phase 2):** a teacher must NOT see student leave for a class they do not own, nor any staff/teacher self-leave. (Task 6 test.)
- **Teacher with no class (Phase 2):** a teacher who is not a `ClassTeacherId` of any class sees an empty approvals list, not everyone's. (Task 6 test.)

---

## Phase 1 — Student details on the leave list + self-approval guard

### Task 1: Add student properties and a 22-column constructor to `LeaveResponse`

**Files:**
- Modify: `src/Sms.Modules.Staffing/Contracts/LeaveContracts.cs:9-40`

**Interfaces:**
- Produces: `LeaveResponse { StudentName, AdmissionNo, StudentClass, StudentSection, StudentRoll (int?) }` init-only props + a constructor of arity 22 (14 base + RequesterName + DecidedByName + RequesterRole + 5 student) — consumed by Task 2's query.

- [ ] **Step 1: Add the five init-only student properties**

In `LeaveContracts.cs`, inside the `LeaveResponse` record body (after `RequesterRole`, line 16), add:

```csharp
    public string? StudentName { get; init; }
    public string? AdmissionNo { get; init; }
    public string? StudentClass { get; init; }
    public string? StudentSection { get; init; }
    public int? StudentRoll { get; init; }
```

- [ ] **Step 2: Add the 22-param constructor (chains to the existing 17-param one)**

After the existing 17-param constructor (ends line 39), add:

```csharp
    // ListByStatusAsync with the Students join (22 columns: 17 above + 5 student fields).
    // Dapper needs an exact-arity constructor match, same reasoning as the constructors above.
    public LeaveResponse(
        Guid Id, Guid TenantId, Guid? RequesterId, Guid? ChildId, string Type, DateTime? FromDate, DateTime? ToDate,
        string? Reason, string? Substitute, string Status, DateTime? AppliedOn, string? DecidedNote, string Priority,
        string? AttachmentUrls, string? RequesterName, string? DecidedByName, string? RequesterRole,
        string? StudentName, string? AdmissionNo, string? StudentClass, string? StudentSection, int? StudentRoll)
        : this(Id, TenantId, RequesterId, ChildId, Type, FromDate, ToDate, Reason, Substitute, Status, AppliedOn, DecidedNote, Priority, AttachmentUrls, RequesterName, DecidedByName, RequesterRole)
    {
        this.StudentName = StudentName;
        this.AdmissionNo = AdmissionNo;
        this.StudentClass = StudentClass;
        this.StudentSection = StudentSection;
        this.StudentRoll = StudentRoll;
    }
```

- [ ] **Step 3: Build**

Run: `dotnet build`
Expected: PASS (new members unused so far).

- [ ] **Step 4: Commit**

```bash
git add src/Sms.Modules.Staffing/Contracts/LeaveContracts.cs
git commit -m "feat(leave): add student fields + 22-col ctor to LeaveResponse"
```

---

### Task 2: Join `ChildId → Students` in `ListByStatusAsync`

**Files:**
- Modify: `src/Sms.Modules.Staffing/Data/LeaveRepository.cs:37-60`
- Test: `tests/Sms.Tests.Integration/Staffing/ApprovalsStudentDetailsTests.cs` (new)

**Interfaces:**
- Consumes: the 22-param `LeaveResponse` ctor (Task 1).
- Produces: `/v1/approvals` rows carry `student_name`/`admission_no`/`student_class`/`student_section`/`student_roll` when `ChildId` resolves.

- [ ] **Step 1: Write the failing tests**

Create `tests/Sms.Tests.Integration/Staffing/ApprovalsStudentDetailsTests.cs`, modeled on `ApprovalsRequesterNameTests.cs`:

```csharp
using System.Net;
using System.Text.Json;
using Dapper;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Sms.Shared.Kernel.Authz;
using Sms.Shared.Kernel.Time;
using Sms.Shared.Kernel.Auth;
using Xunit;

namespace Sms.Tests.Integration.Staffing;

[Collection("sql")]
public class ApprovalsStudentDetailsTests(PostgresFixture fx)
{
    private const string Key = "integration-test-signing-key-32-bytes-min!!";

    private static WebApplicationFactory<Program> MakeApp(PostgresFixture fx) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("environment", "Production");
            b.UseSetting("ConnectionStrings:Sql", fx.ConnectionString);
            b.UseSetting("Jwt:SigningKey", Key);
        });

    [Fact]
    public async Task Approvals_list_includes_student_details_for_a_child_leave()
    {
        var app = MakeApp(fx);
        var tenantId = Guid.NewGuid();
        var requesterId = Guid.NewGuid();   // the parent
        var studentId = Guid.NewGuid();

        await using (var conn = new Npgsql.NpgsqlConnection(fx.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync("SELECT set_config('app.tenant_id', @tenantId::text, false)", new { tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"Users\" (\"Id\", \"TenantId\", \"Name\") VALUES (@requesterId, @tenantId, 'Asha Parent')",
                new { requesterId, tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"Students\" (\"Id\", \"TenantId\", \"AdmissionNo\", \"Name\", \"Grade\", \"Section\", \"ClassLabel\", \"Roll\", \"Status\") " +
                "VALUES (@studentId, @tenantId, 'ADM-012', 'Rahul Sharma', 'Grade 5', 'A', 'Grade 5 - A', 12, 'active')",
                new { studentId, tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"LeaveRequests\" (\"TenantId\", \"RequesterId\", \"ChildId\", \"Type\", \"Status\") " +
                "VALUES (@tenantId, @requesterId, @studentId, 'sick', 'pending')",
                new { tenantId, requesterId, studentId });
        }

        var jwt = new JwtTokenService(new JwtOptions { Issuer = "sms", Audience = "sms-apps", SigningKey = Key, AccessTokenMinutes = 15 }, new SystemClock());
        var token = jwt.IssueAccess(Guid.NewGuid(), tenantId, new[] { Policies.Principal }, isPlatform: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var res = await client.GetAsync("/v1/approvals?status=pending");
        res.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var row = doc.RootElement.GetProperty("data")[0];
        row.GetProperty("student_name").GetString().Should().Be("Rahul Sharma");
        row.GetProperty("admission_no").GetString().Should().Be("ADM-012");
        row.GetProperty("student_class").GetString().Should().Be("Grade 5 - A");
        row.GetProperty("student_section").GetString().Should().Be("A");
        row.GetProperty("student_roll").GetInt32().Should().Be(12);
    }

    [Fact]
    public async Task Staff_self_leave_has_null_student_fields()
    {
        var app = MakeApp(fx);
        var tenantId = Guid.NewGuid();
        var requesterId = Guid.NewGuid();

        await using (var conn = new Npgsql.NpgsqlConnection(fx.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync("SELECT set_config('app.tenant_id', @tenantId::text, false)", new { tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"Users\" (\"Id\", \"TenantId\", \"Name\") VALUES (@requesterId, @tenantId, 'Rajesh Teacher')",
                new { requesterId, tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"LeaveRequests\" (\"TenantId\", \"RequesterId\", \"Type\", \"Status\") VALUES (@tenantId, @requesterId, 'casual', 'pending')",
                new { tenantId, requesterId });
        }

        var jwt = new JwtTokenService(new JwtOptions { Issuer = "sms", Audience = "sms-apps", SigningKey = Key, AccessTokenMinutes = 15 }, new SystemClock());
        var token = jwt.IssueAccess(Guid.NewGuid(), tenantId, new[] { Policies.Principal }, isPlatform: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var res = await client.GetAsync("/v1/approvals?status=pending");
        using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
        var row = doc.RootElement.GetProperty("data")[0];
        row.GetProperty("student_name").ValueKind.Should().Be(JsonValueKind.Null);
        row.GetProperty("admission_no").ValueKind.Should().Be(JsonValueKind.Null);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~ApprovalsStudentDetailsTests`
Expected: FAIL — `student_name` property missing from the JSON (and/or Dapper arity error once columns are added mid-way).

- [ ] **Step 3: Add the join + columns to `ListByStatusAsync`**

In `src/Sms.Modules.Staffing/Data/LeaveRepository.cs`, extend the `from` and `select` consts in `ListByStatusAsync`:

```csharp
        const string from = """
            FROM "dbo"."LeaveRequests" lr
            LEFT JOIN "dbo"."Users" u ON u."Id" = lr."RequesterId"
            LEFT JOIN "dbo"."Users" d ON d."Id" = lr."DecidedBy"
            LEFT JOIN "dbo"."Students" st ON st."Id" = lr."ChildId" AND st."TenantId" = lr."TenantId"
            """;
        const string select = """
            SELECT lr."Id", lr."TenantId", lr."RequesterId", lr."ChildId", lr."Type", lr."FromDate", lr."ToDate",
                   lr."Reason", lr."Substitute", lr."Status", lr."AppliedOn", lr."DecidedNote", lr."Priority", lr."AttachmentUrls",
                   u."Name" AS "RequesterName", d."Name" AS "DecidedByName",
                   (SELECT "Role" FROM "dbo"."UserRoles" WHERE "UserId" = lr."RequesterId" ORDER BY "Role" LIMIT 1) AS "RequesterRole",
                   st."Name" AS "StudentName", st."AdmissionNo" AS "AdmissionNo",
                   COALESCE(st."ClassLabel", st."Grade") AS "StudentClass",
                   st."Section" AS "StudentSection", st."Roll" AS "StudentRoll"
            """;
```

(The `where`/`order by`/arg construction below is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~ApprovalsStudentDetailsTests`
Expected: PASS.

- [ ] **Step 5: Regression — the existing approvals tests still pass**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~ApprovalsRequesterNameTests`
Expected: PASS (requester_name/decided_by_name path unaffected; `Decide` still returns 16 cols via the proc — unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/Sms.Modules.Staffing/Data/LeaveRepository.cs tests/Sms.Tests.Integration/Staffing/ApprovalsStudentDetailsTests.cs
git commit -m "feat(leave): resolve ChildId to student details on the approvals list"
```

---

### Task 3: Self-approval guard in `DecideLeaveAsync`

**Files:**
- Modify: `src/Sms.Application/Services/Staffing/StaffingService.cs:300-309`
- Test: `tests/Sms.Tests.Integration/Staffing/LeaveSelfApprovalTests.cs` (new)

**Interfaces:**
- Consumes: `leave.GetAsync(id)` returns a `LeaveResponse` with `RequesterId`; `tenant.UserId` is the caller.
- Produces: `PATCH /v1/approvals/{id}` returns 403 when the caller is the requester.

- [ ] **Step 1: Write the failing test**

Create `tests/Sms.Tests.Integration/Staffing/LeaveSelfApprovalTests.cs`:

```csharp
using System.Net;
using System.Net.Http.Json;
using Dapper;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Sms.Shared.Kernel.Authz;
using Sms.Shared.Kernel.Time;
using Sms.Shared.Kernel.Auth;
using Xunit;

namespace Sms.Tests.Integration.Staffing;

[Collection("sql")]
public class LeaveSelfApprovalTests(PostgresFixture fx)
{
    private const string Key = "integration-test-signing-key-32-bytes-min!!";

    [Fact]
    public async Task A_principal_cannot_decide_their_own_leave()
    {
        var app = new WebApplicationFactory<Program>().WithWebHostBuilder(b =>
        {
            b.UseSetting("environment", "Production");
            b.UseSetting("ConnectionStrings:Sql", fx.ConnectionString);
            b.UseSetting("Jwt:SigningKey", Key);
        });
        var tenantId = Guid.NewGuid();
        var principalId = Guid.NewGuid();
        var leaveId = Guid.NewGuid();

        await using (var conn = new Npgsql.NpgsqlConnection(fx.ConnectionString))
        {
            await conn.OpenAsync();
            await conn.ExecuteAsync("SELECT set_config('app.tenant_id', @tenantId::text, false)", new { tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"Users\" (\"Id\", \"TenantId\", \"Name\") VALUES (@principalId, @tenantId, 'Priya Principal')",
                new { principalId, tenantId });
            await conn.ExecuteAsync(
                "INSERT INTO \"dbo\".\"LeaveRequests\" (\"Id\", \"TenantId\", \"RequesterId\", \"Type\", \"Status\") VALUES (@leaveId, @tenantId, @principalId, 'casual', 'pending')",
                new { leaveId, tenantId, principalId });
        }

        var jwt = new JwtTokenService(new JwtOptions { Issuer = "sms", Audience = "sms-apps", SigningKey = Key, AccessTokenMinutes = 15 }, new SystemClock());
        // The caller IS the requester (same user id) and holds Principal.
        var token = jwt.IssueAccess(principalId, tenantId, new[] { Policies.Principal }, isPlatform: false);
        var client = app.CreateClient();
        client.DefaultRequestHeaders.Authorization = new("Bearer", token);

        var res = await client.PatchAsJsonAsync($"/v1/approvals/{leaveId}", new { status = "approved" });
        res.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~LeaveSelfApprovalTests`
Expected: FAIL (currently returns 200 OK — no guard).

- [ ] **Step 3: Add the guard**

In `StaffingService.cs`, replace the body of `DecideLeaveAsync` (lines 300-309):

```csharp
    public async Task<ApiResult<LeaveResponse>> DecideLeaveAsync(
        Guid id, DecideLeaveRequest req, CancellationToken ct = default)
    {
        if (await leave.GetAsync(id, ct) is not { } existing)
            return ApiResult<LeaveResponse>.Fail(new Error("not_found", "resource not found"), 404);
        if (existing.RequesterId is { } reqId && reqId == tenant.UserId)
            return ApiResult<LeaveResponse>.Fail(
                new Error("forbidden", "You cannot decide your own leave request."), 403);
        var decided = (await leave.DecideAsync(id, req.Status, tenant.UserId, req.DecidedNote, ct))!;
        if (tenant.TenantId is { } tid)
            await live.PublishAsync(tid, LiveEventTypes.Leave, ct: ct);
        return ApiResult<LeaveResponse>.Ok(decided);
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~LeaveSelfApprovalTests`
Expected: PASS.

- [ ] **Step 5: Regression — a principal can still decide someone else's leave**

Run: `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~ApprovalsRequesterNameTests`
Expected: PASS (in `Decide_returns_decided_by_name_of_the_principal`, requester ≠ principal, so the guard does not trigger).

- [ ] **Step 6: Commit**

```bash
git add src/Sms.Application/Services/Staffing/StaffingService.cs tests/Sms.Tests.Integration/Staffing/LeaveSelfApprovalTests.cs
git commit -m "feat(leave): forbid deciding your own leave request (routes principal leave to owner/admin)"
```

---

## Phase 2 — Class-teacher sees their own class's student leave

> **Gate:** Phase 2 adds new authorization surface (the approvals endpoint opens to teachers). Confirm with the user before implementing; Phase 1 ships independently and delivers the student-details + self-approval asks. The teacher↔class data is verified present (`Classes.ClassTeacherId → Teachers.Id`, teacher via `Teachers.UserId`, student via Grade/Section or ClassLabel match).

### Task 4: Repo method — student ids for a teacher's own classes

**Files:**
- Modify: `src/Sms.Modules.Staffing/Data/LeaveRepository.cs`
- Test: `tests/Sms.Tests.Integration/Staffing/ClassTeacherStudentIdsTests.cs` (new)

**Interfaces:**
- Produces: `Task<IReadOnlyList<Guid>> StudentIdsForClassTeacherAsync(Guid teacherUserId, Guid tenantId, CancellationToken ct)` — the active students in classes the teacher is `ClassTeacherId` of.

- [ ] **Step 1: Write the failing test**

Create `tests/Sms.Tests.Integration/Staffing/ClassTeacherStudentIdsTests.cs`. Seed: a tenant; a `Teachers` row with `UserId = teacherUserId`; a `Classes` row with `ClassTeacherId = teacher.Id`, `Grade='Grade 5'`, `Section='A'`, `Name='Grade 5 - A'`; two `Students` (one in Grade 5/A → should match, one in Grade 6/B → should not); assert the method returns exactly the matching student id. Use the `PostgresFixture` + raw `Dapper` seeding idiom from `ApprovalsRequesterNameTests.cs`, and resolve the repo from the app's service provider (see `StaffingTests.cs` for how repositories/services are obtained in this suite — follow that pattern exactly).

```csharp
// Shape of the assertion once seeded (full seeding mirrors ApprovalsStudentDetailsTests):
var ids = await repo.StudentIdsForClassTeacherAsync(teacherUserId, tenantId, default);
ids.Should().ContainSingle().Which.Should().Be(matchingStudentId);
```

- [ ] **Step 2: Run to verify it fails** — `dotnet test ... --filter ...ClassTeacherStudentIdsTests` → FAIL (method missing).

- [ ] **Step 3: Implement the method** in `LeaveRepository.cs`, reusing the verified predicate:

```csharp
    public Task<IReadOnlyList<Guid>> StudentIdsForClassTeacherAsync(
        Guid teacherUserId, Guid tenantId, CancellationToken ct = default) =>
        QueryInlineAsync<Guid>("""
            SELECT s."Id"
            FROM "dbo"."Teachers" t
            JOIN "dbo"."Classes" c ON c."ClassTeacherId" = t."Id"
            JOIN "dbo"."Students" s ON (
                (c."Grade" IS NOT NULL AND c."Section" IS NOT NULL
                   AND s."Grade" = c."Grade" AND s."Section" = c."Section")
                OR (c."Name" IS NOT NULL AND s."ClassLabel" = c."Name"))
            WHERE t."UserId" = @teacherUserId
              AND s."Status" = 'active'
              AND s."TenantId" = @tenantId
            """, new { teacherUserId, tenantId }, ct);
```

- [ ] **Step 4: Run to verify it passes.** **Step 5: Commit.**

> NOTE: if `QueryInlineAsync<Guid>` does not materialize a bare scalar column in this codebase, select `s."Id" AS "Value"` into a `record ScalarId(Guid Value)` and map — check one existing scalar inline query in the repo layer first and follow that idiom.

---

### Task 5: Scoped list variant — approvals filtered to a set of child ids

**Files:**
- Modify: `src/Sms.Modules.Staffing/Data/LeaveRepository.cs` (`ListByStatusAsync`)
- Test: covered via Task 6's endpoint test.

**Interfaces:**
- Produces: `ListByStatusAsync(string? status, IReadOnlyCollection<Guid>? childScope, CancellationToken ct)` — when `childScope` is non-null, the query adds `AND lr."ChildId" = ANY(@childScope)` (which also excludes null-ChildId staff leave). When null, behavior is exactly as today.

- [ ] **Step 1:** Add an optional `childScope` parameter to `ListByStatusAsync`. Build the WHERE by composing the existing status clause with, when `childScope is not null`, `lr."ChildId" = ANY(@childScope)`. Pass `childScope` as a `Guid[]` in the Dapper args (Npgsql maps a `Guid[]` to `uuid[]` for `= ANY`). Keep the no-scope path byte-for-byte as today (default `childScope = null`). Preserve the 22-column select from Task 2.

- [ ] **Step 2:** Build (`dotnet build`) → PASS. Behavior is exercised by Task 6. **Commit** with Task 6.

> An empty `childScope` (teacher owns no class) must produce an empty result: pass an empty `Guid[]`; `= ANY('{}')` matches nothing. Do NOT treat empty as "no filter".

---

### Task 6: Open approvals to teachers, scoped to their class

**Files:**
- Modify: `src/Sms.Api/Controllers/LeaveController.cs` (GET `approvals`), `src/Sms.Application/Services/Staffing/StaffingService.cs` (`ListApprovalsAsync` + interface), `src/Sms.Shared.Kernel/Authz/AuthorizationPolicies.cs` (reuse `TeacherApp` policy)
- Test: `tests/Sms.Tests.Integration/Staffing/TeacherApprovalsScopeTests.cs` (new)

**Interfaces:**
- Consumes: `StudentIdsForClassTeacherAsync` (Task 4), scoped `ListByStatusAsync` (Task 5), `tenant.UserId`/`tenant.TenantId`.
- Produces: a teacher calling `GET /v1/approvals` sees only their class's student leaves; managers see all; the service learns manager-vs-teacher from a bool the controller derives from `User`.

- [ ] **Step 1: Write the failing tests** in `TeacherApprovalsScopeTests.cs` (full seeding mirrors earlier tests):
  - **Teacher sees own-class student leave only:** seed teacher T (class teacher of Grade5/A), student S1 in Grade5/A with a pending child-leave, student S2 in Grade6/B with a pending child-leave, and a staff self-leave. Issue a JWT with role `Policies.Teacher` and `sub = T.UserId`. `GET /v1/approvals?status=pending` → exactly one row, S1's leave; S2's leave and the staff leave absent.
  - **Teacher with no class sees nothing:** teacher with no `ClassTeacherId` → empty `data`.
  - **Manager unchanged:** a `Policies.Principal` token still sees all three.

```csharp
// Teacher token:
var token = jwt.IssueAccess(teacherUserId, tenantId, new[] { Policies.Teacher }, isPlatform: false);
// ... assert data length == 1 and data[0].child_id == s1Id
```

- [ ] **Step 2: Run to verify it fails** — teacher currently gets 403 (endpoint is Principal-only).

- [ ] **Step 3: Open the endpoint and thread the scope**
  1. In `LeaveController.cs`, change the GET approvals attribute from `[Authorize(Policy = Policies.Principal)]` to `[Authorize(Policy = AuthorizationPolicies.TeacherApp)]` (the policy already = Teacher/Principal/Admin/Owner; confirm the exact constant name/namespace — it is wired at `AuthorizationPolicies.cs:17`). **Leave the PATCH decide endpoint on `Policies.Principal`** — teachers do not decide.
  2. Derive manager-tier in the controller and pass it down:
     ```csharp
     [HttpGet("approvals")]
     [Authorize(Policy = AuthorizationPolicies.TeacherApp)]
     public async Task<IActionResult> ListApprovals([FromQuery] string? status, CancellationToken ct)
     {
         var isManager = User.IsInRole(Policies.Principal)
             || User.IsInRole(Policies.SchoolAdmin) || User.IsInRole(Policies.SchoolOwner);
         return FromResult(await staffing.ListApprovalsAsync(status, isManager, ct));
     }
     ```
  3. In `IStaffingService` + `StaffingService.ListApprovalsAsync`, add the `bool isManager` parameter:
     ```csharp
     public async Task<ApiResult<IReadOnlyList<LeaveResponse>>> ListApprovalsAsync(
         string? status, bool isManager, CancellationToken ct = default)
     {
         if (isManager)
             return ApiResult<IReadOnlyList<LeaveResponse>>.Ok(await leave.ListByStatusAsync(status ?? "pending", null, ct));
         if (tenant is not { UserId: { } uid, TenantId: { } tid })
             return ApiResult<IReadOnlyList<LeaveResponse>>.Fail(new Error("forbidden", "no tenant context"), 403);
         var childIds = await leave.StudentIdsForClassTeacherAsync(uid, tid, ct);
         var rows = await leave.ListByStatusAsync(status ?? "pending", childIds.ToArray(), ct);
         return ApiResult<IReadOnlyList<LeaveResponse>>.Ok(rows);
     }
     ```
     Update the interface signature and any other caller/mocks accordingly.

- [ ] **Step 4: Run the tests to verify they pass.**

- [ ] **Step 5: Full regression** — `dotnet test tests/Sms.Tests.Integration --filter FullyQualifiedName~Staffing`
Expected: PASS (all staffing tests; the manager path is unchanged behavior).

- [ ] **Step 6: Commit**

```bash
git add src/Sms.Api/Controllers/LeaveController.cs src/Sms.Application/Services/Staffing/StaffingService.cs src/Sms.Modules.Staffing/Data/LeaveRepository.cs tests/Sms.Tests.Integration/Staffing/TeacherApprovalsScopeTests.cs
git commit -m "feat(leave): class-teacher sees their own class's student leave"
```

---

## Self-Review

- **Spec coverage:** student fields on the list (Tasks 1-2) ✓; SIS data source available to admin (the five fields) ✓; principal/CRM leave → owner via self-approval guard (Task 3) ✓; admin/owner visibility already correct server-side (Principal policy) — no task needed ✓; teacher sees own-class student leave (Tasks 4-6) ✓; submission apps untouched ✓; `ListMineAsync`/`GetAsync` student join — **deliberately omitted** (GetAsync result is internal-only; ListMine is the parent's own history and the `sms-admin` feature does not consume it) — noted as a conscious deviation from the spec's "optional, for consistency" §4.1a.
- **Placeholder scan:** Tasks 1-3 have full code. Tasks 4-6 give full SQL/signatures and exact seeding analogues; two spots deliberately say "follow the existing idiom" (scalar Dapper materialization; how the suite resolves a repo) with a concrete file to copy from — these are codebase-idiom confirmations, not undefined behavior.
- **Type consistency:** `LeaveResponse` 22-col ctor (Task 1) matches the 22-col select (Task 2); `StudentIdsForClassTeacherAsync` (Task 4) feeds `childScope` (Task 5) feeds `ListApprovalsAsync(status, isManager)` (Task 6); wire names (`student_*`, `admission_no`) match the `sms-admin` plan.
- **Review Focus:** dangling/cross-tenant child (Task 2 — LEFT JOIN + tenant guard; add a dangling-id assertion to Task 2's second test if not already covered), staff self-leave nulls (Task 2), self-approval 403 (Task 3), teacher over-reach + no-class-empty (Task 6). All owned.
