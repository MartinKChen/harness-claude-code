<!--
Used in step 4 of the create-issues skill — present this breakdown to the user
for explicit approval before the slice issues are created. The static IDs shown
here (`<type-code>.<index>` scoped to the slice, e.g. `e2e.1`, `be.1`, `fe.2`)
are PERMANENT — they become the keys of the inline task checklist in each slice
issue body, and are NEVER translated to issue numbers. (The fully-qualified key
is `s<slice#>.<type>.<n>`; the short form is unambiguous inside one slice.)

There are NO task sub-issues — each slice is a single issue whose body inlines
this task breakdown as a static-ID checklist (the task ledger).

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
   - Touches app composition?: <yes — edits `create_app` / `main.py` / root router | no>
   - User stories covered: <story id(s) or "—">
   - Tasks (atomic, DAG — `blocked-by` lists every real upstream, 1-up only):
     - `e2e.1` — `e2e` — <one UI user flow, mapped to one slice AC scenario>. blocked-by: —
     - `e2e.2` — `e2e` — <a second, distinct UI user flow>. blocked-by: `e2e.1`
     - `be.1`  — `backend` — `POST /<entities>` endpoint (introduces `<Entity>` model + migration). blocked-by: `e2e.2`  →  contract: docs/api-contract/<entity>.yaml · docs/data-model/<entity>.yaml
     - `fe.1`  — `frontend` — `useCreate<Entity>` hook. blocked-by: `e2e.2` *(sibling of `be.1`)*  →  covers: AC2; design: tokens.md
     - `fe.2`  — `frontend` — `<Entity>CreateForm` component. blocked-by: `fe.1` *(real dep: uses the hook)*  →  entry-source: /<entities>/new · reached-from: control "New" on /<entities>

2. **<Slice title>**
   - Has UI?: ...
   - Blocked by: ...
   - User stories covered: ...
   - Tasks (atomic, DAG):
     - `be.1` — `backend` — <single endpoint / utility, may introduce its model>. blocked-by: —  →  contract: docs/api-contract/<entity>.yaml
     - ...

(…)

Notes the reader should verify before approving:
- **One issue per slice** — each slice above becomes a single GitHub issue; its body inlines that slice's task list as a static-ID checklist. There are no task sub-issues.
- **App-composition serialization** — any two slices marked "Touches app composition? yes" are chained with a 1-up `Blocked by` edge (never parallel), so they merge one at a time onto the same `create_app` / root-router surface. A 3+ slice chain all editing that surface is a smell — flag for the architect to pin the signature in an ADR / C4-component doc instead.
- **Each task is atomic** — exactly one test case / endpoint / utility / page / component / hook. Data-model changes ride along with the first endpoint/utility that introduces them — they are never their own task. Bundled tasks ("X and Y") MUST be split.
- **Each task carries a spec pointer, not its own AC** — AC lives on the slice (EARS + Gherkin). A `backend` task points at its `docs/api-contract/<entity>.yaml` (+ `docs/data-model/<entity>.yaml` when it introduces the model); an `e2e`/`frontend` task points at the mapped slice Gherkin scenario (frontend pages also carry an entry-source); only a contract-less utility task carries a one-line `done:` criterion of its own.
- Within-slice dependencies are a **DAG**, not a single chain. `e2e` tasks remain sequential among themselves. The first `backend` task and the first `frontend` task are each blocked by the last `e2e`. Beyond that, `blocked-by` records only real upstream needs (endpoint that consumes the model introduced by a prior task; component that uses a hook; page that composes a component). Independent endpoints / hooks / components are siblings — same upstream, no edge between them.
- `e2e` deliveries should read as **a single user flow through the UI**, not API contracts. One `e2e` task = one test case = one mapped acceptance-criteria scenario.
- The static IDs are **permanent** — they key the slice-body checklist and stay stable for the slice's whole life (commit trailers use `Task: s<slice#>.<id>`). They are never replaced with issue numbers.

Does the slice granularity feel right? Are slice-level and task-level dependencies correct? Are the tasks atomic and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
