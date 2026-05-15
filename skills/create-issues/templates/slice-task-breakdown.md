<!--
Used in step 4 of the create-issues skill — present this breakdown to the user
for explicit approval before any issues are created. Local task IDs
(`<slice#>.<type-code>.<index>`) are translated into real GitHub issue
numbers as each issue is created in step 5.

Tasks MUST be atomic: one E2E test case (= one user flow), one API endpoint,
one utility, one page, one component, or one hook per task. Data-model +
migration changes are NOT their own task — they ride along with the first
endpoint (or other consumer) that introduces them. If a task description
requires the word "and" to join two endpoints, two utilities, two components,
two hooks, or two pages, split it into two tasks.

Within-slice dependencies form a DAG, not a chain: `e2e` tasks stay
sequential among themselves; `be.1` and `fe.1` are each blocked by the last
`e2e`; further edges only when a task truly consumes another (endpoint
introduces a model used by a later endpoint; component uses a hook; page
composes a component).
-->

## Proposed breakdown for <feature-name>

1. **<Slice title>**
   - Has UI?: <yes | no>
   - Blocked by: <none | slice #N>
   - User stories covered: <story id(s) or "—">
   - Tasks (atomic, DAG — `Blocked by` lists every real upstream, 1-up only):
     - `1.e2e.1` — `e2e` — <one UI user flow, mapped to one parent-issue AC scenario>. Blocked by: none
     - `1.e2e.2` — `e2e` — <a second, distinct UI user flow>. Blocked by: `1.e2e.1`
     - `1.be.1`  — `backend` — `POST /<entities>` endpoint (introduces `<Entity>` model + migration). Blocked by: `1.e2e.2`
     - `1.fe.1`  — `frontend` — `useCreate<Entity>` hook. Blocked by: `1.e2e.2` *(sibling of `1.be.1`)*
     - `1.fe.2`  — `frontend` — `<Entity>CreateForm` component. Blocked by: `1.fe.1` *(real dep: uses the hook)*

2. **<Slice title>**
   - Has UI?: ...
   - Blocked by: ...
   - User stories covered: ...
   - Tasks (atomic, DAG):
     - `2.be.1` — `backend` — <single endpoint / utility, may introduce its model>. Blocked by: none
     - ...

(…)

Notes the reader should verify before approving:
- **Each task is atomic** — exactly one test case / endpoint / utility / page / component / hook. Data-model changes ride along with the first endpoint/utility that introduces them — they are never their own task. Bundled tasks ("X and Y") MUST be split.
- Within-slice dependencies are a **DAG**, not a single chain. `e2e` tasks remain sequential among themselves. The first `backend` task and the first `frontend` task are each blocked by the last `e2e`. Beyond that, `Blocked by` records only real upstream needs (endpoint that consumes the model introduced by a prior task; component that uses a hook; page that composes a component). Independent endpoints / hooks / components are siblings — same upstream, no edge between them.
- `e2e` deliveries should read as **a single user flow through the UI**, not API contracts. One `e2e` task = one test case = one mapped acceptance-criteria scenario.
- Task IDs are local to this breakdown; they are translated into real GitHub issue numbers after creation.

Does the slice granularity feel right? Are slice-level and task-level dependencies correct? Are the tasks atomic and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
