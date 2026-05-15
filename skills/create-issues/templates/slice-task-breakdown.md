<!--
Used in step 4 of the create-issues skill — present this breakdown to the user
for explicit approval before any issues are created. Local task IDs
(`<slice#>.<type-code>.<index>`) are translated into real GitHub issue
numbers as each issue is created in step 5.

Tasks MUST be atomic: one E2E test case (= one user flow), one API endpoint,
one data-model entity change, one utility, one page, one component, or one
hook per task. If a task description requires the word "and" to join two of
those units, split it into two tasks.
-->

## Proposed breakdown for <feature-name>

1. **<Slice title>**
   - Has UI?: <yes | no>
   - Blocked by: <none | slice #N>
   - User stories covered: <story id(s) or "—">
   - Tasks (atomic, sequential — each blocked by the immediately preceding task):
     - `1.e2e.1` — `e2e` — <one UI user flow, mapped to one parent-issue AC scenario>. Blocked by: none
     - `1.e2e.2` — `e2e` — <a second, distinct UI user flow>. Blocked by: `1.e2e.1`
     - `1.be.1`  — `backend` — `<Entity>` data model + migration. Blocked by: `1.e2e.2`
     - `1.be.2`  — `backend` — `POST /<entities>` endpoint. Blocked by: `1.be.1`
     - `1.fe.1`  — `frontend` — `useCreate<Entity>` hook. Blocked by: `1.be.2`
     - `1.fe.2`  — `frontend` — `<Entity>CreateForm` component. Blocked by: `1.fe.1`

2. **<Slice title>**
   - Has UI?: ...
   - Blocked by: ...
   - User stories covered: ...
   - Tasks (atomic, sequential):
     - `2.be.1` — `backend` — <single endpoint / entity / utility>. Blocked by: none
     - ...

(…)

Notes the reader should verify before approving:
- **Each task is atomic** — exactly one test case / endpoint / entity / utility / page / component / hook. Bundled tasks ("X and Y") MUST be split.
- Tasks within a slice are implemented **sequentially**: order is all `e2e` tasks in index order (when present) → `backend` tasks in index order → `frontend` tasks in index order. Each task lists exactly the immediately preceding task as `Blocked by` (or none, for the first task).
- `e2e` deliveries should read as **a single user flow through the UI**, not API contracts. One `e2e` task = one test case = one mapped acceptance-criteria scenario.
- Task IDs are local to this breakdown; they are translated into real GitHub issue numbers after creation.

Does the slice granularity feel right? Are slice-level and task-level dependencies correct? Are the tasks atomic and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
