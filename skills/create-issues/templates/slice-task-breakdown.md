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
   - Tasks:
     - `1.e2e` — `e2e` — <one-line delivery summary>. Blocked by: none
     - `1.be.1` — `backend` — <one-line delivery summary>. Blocked by: `1.e2e`
     - `1.be.2` — `backend` — <one-line delivery summary>. Blocked by: `1.e2e`, `1.be.1`
     - `1.fe.1` — `frontend` — <one-line delivery summary>. Blocked by: `1.e2e`, `1.be.1`

2. **<Slice title>**
   - Has UI?: ...
   - Blocked by: ...
   - User stories covered: ...
   - Tasks:
     - `2.be.1` — `backend` — ... Blocked by: ...
     - ...

(…)

Notes the reader should verify before approving:
- Every `backend` and `frontend` task on a UI slice MUST list that slice's `e2e` task in `Blocked by` (E2E-first rule).
- Task IDs are local to this breakdown; they are translated into real GitHub issue numbers after creation.

Does the slice granularity feel right? Are slice-level and task-level dependencies correct? Are the tasks per slice complete and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
