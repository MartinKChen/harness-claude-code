<!--
Used in step 4 of the create-issues skill — present this breakdown to the user
for explicit approval before any issues are created. Local task IDs
(`<slice#>.<type-code>[.<index>]`) are translated into real GitHub issue
numbers as each issue is created in step 5.
-->

## Proposed breakdown for <feature-name>

1. **<Slice title>**
   - Has UI?: <yes | no>
   - Blocked by: <none | slice #N>
   - User stories covered: <story id(s) or "—">
   - Tasks (sequential — each blocked by the immediately preceding task):
     - `1.e2e` — `e2e` — <one-line delivery summary, framed as a UI user flow>. Blocked by: none
     - `1.be.1` — `backend` — <one-line delivery summary>. Blocked by: `1.e2e`
     - `1.be.2` — `backend` — <one-line delivery summary>. Blocked by: `1.be.1`
     - `1.fe.1` — `frontend` — <one-line delivery summary>. Blocked by: `1.be.2`

2. **<Slice title>**
   - Has UI?: ...
   - Blocked by: ...
   - User stories covered: ...
   - Tasks (sequential):
     - `2.be.1` — `backend` — ... Blocked by: none
     - ...

(…)

Notes the reader should verify before approving:
- Tasks within a slice are implemented **sequentially**: order is `e2e` (when present) → `backend` tasks in index order → `frontend` tasks in index order. Each task lists exactly the immediately preceding task as `Blocked by` (or none, for the first task).
- `e2e` deliveries should read as **user flows through the UI**, not API contracts.
- Task IDs are local to this breakdown; they are translated into real GitHub issue numbers after creation.

Does the slice granularity feel right? Are slice-level and task-level dependencies correct? Are the tasks per slice complete and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
