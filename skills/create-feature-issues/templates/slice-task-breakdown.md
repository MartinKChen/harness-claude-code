<!--
Used in step 4 of the create-feature-issues skill — present this breakdown to the user
for explicit approval before the slice issues are created. The static IDs shown
here (`<type-code>.<index>` scoped to the slice, e.g. `e2e.1`, `be.1`, `fe.2`)
are PERMANENT — they become the keys of the inline task checklist in each slice
issue body, and are NEVER translated to issue numbers. (The fully-qualified key
is `s<slice#>.<type>.<n>`; the short form is unambiguous inside one slice.)

There are NO task sub-issues — each slice is a single issue whose body inlines
this task breakdown as a static-ID checklist (the task ledger).

EVERY slice carries Acceptance criteria — including backend-only slices, whose
ACs are backend invariants with a backend owning layer. Show the AC ids and the
owning layer each clause was classified into (Principle 1 of
docs/test-layering-and-gates.md). An `e2e.*` task is emitted ONLY when the slice
closes a cross-surface journey segment — NOT merely because it has UI.

Tasks MUST be atomic: one E2E test case (= one user flow), one API endpoint,
one utility, one page, one component, or one hook per task. Data-model +
migration changes are NOT their own task — they ride along with the first
endpoint (or other consumer) that introduces them. If a task description
requires the word "and" to join two endpoints, two utilities, two components,
two hooks, or two pages, split it into two tasks.

Within-slice dependencies form a DAG, not a chain. When the slice HAS e2e tasks,
`e2e` tasks stay sequential among themselves and `be.1`/`fe.1` are each blocked
by the last `e2e`. When it has NONE (backend-only / pure-layout), `be.1`/`fe.1`
have no e2e blocker. Further edges only when a task truly consumes another.
-->

## Proposed breakdown for <feature-name>

1. **<Slice title>** *(closes a journey segment ⇒ has an e2e task)*
   - Acceptance criteria: AC1 (frontend), AC2 (backend) — every clause classified by owning layer
   - Has UI?: <yes | no>
   - Closes a cross-surface journey segment?: <yes — Journey step N of docs/critical-path/<flow>.md | no>
   - Blocked by: <none | slice #N>
   - Touches app composition?: <yes — edits `create_app` / `main.py` / root router | no>
   - User stories covered: <story id(s) or "—">
   - Tasks (atomic, DAG — `blocked-by` lists every real upstream, 1-up only; each tags `covers:` + `scenario:`):
     - `e2e.1` — `e2e` — <one user-visible cross-surface flow>. blocked-by: —  →  covers: AC1 · scenario: "<journey step>" · realizes Journey step N
     - `be.1`  — `backend` — `POST /<entities>` (introduces `<Entity>` model + migration). blocked-by: `e2e.1`  →  covers: AC2 · scenario: "<backend invariant>" · contract: docs/api-contract/<entity>.yaml · docs/data-model/<entity>.yaml
     - `fe.1`  — `frontend` — `useCreate<Entity>` hook. blocked-by: `e2e.1` *(sibling of `be.1`)*  →  covers: AC1 · scenario: "<rendered behavior>" · design: tokens.md
     - `fe.2`  — `frontend` — `<Entity>CreateForm` component. blocked-by: `fe.1` *(real dep: uses the hook)*  →  covers: AC1 · scenario: "<form renders/submits>" · entry-source: /<entities>/new · reached-from: control "New" on /<entities>

2. **<Slice title>** *(backend-only — closes no journey segment ⇒ NO e2e task)*
   - Acceptance criteria: AC1 (backend), AC2 (backend) — backend invariants ARE ACs
   - Has UI?: no
   - Closes a cross-surface journey segment?: no
   - Blocked by: ...
   - User stories covered: ...
   - Tasks (atomic, DAG — no e2e blocker since there is no e2e task):
     - `be.1` — `backend` — <single endpoint / utility, may introduce its model>. blocked-by: —  →  covers: AC1, AC2 · scenario: "<backend invariant>" · contract: docs/api-contract/<entity>.yaml
     - ...

(…)

Notes the reader should verify before approving:
- **One issue per slice** — each slice above becomes a single GitHub issue; its body inlines that slice's task list as a static-ID checklist. There are no task sub-issues.
- **Every slice has ACs; the reviewer ticks them.** ACs are a specification, not a test — present on every slice (backend-only included). Each clause is classified by owning layer and discharged by a task at that layer. The reviewer ticks the AC boxes at end-of-slice review; the engineer only ticks task boxes.
- **E2E is earned by a journey, not by UI.** An `e2e.*` task exists only when the slice closes a cross-surface journey segment worth walking. A pure-layout slice has UI but no e2e task; a backend-only slice has neither.
- **App-composition serialization** — any two slices marked "Touches app composition? yes" are chained with a 1-up `Blocked by` edge (never parallel), so they merge one at a time onto the same `create_app` / root-router surface. A 3+ slice chain all editing that surface is a smell — flag for the architect to pin the signature in an ADR / C4-component doc instead.
- **Each task is atomic** — exactly one test case / endpoint / utility / page / component / hook. Data-model changes ride along with the first endpoint/utility that introduces them — they are never their own task. Bundled tasks ("X and Y") MUST be split.
- **Each task carries `covers:` + `scenario:` + a spec pointer, not its own AC** — AC lives on the slice (EARS + Gherkin). Every task tags `covers:` (AC clause ids) and `scenario:` (Gherkin walked at its owning layer). A `backend` task also points at its `docs/api-contract/<entity>.yaml` (+ `docs/data-model/<entity>.yaml` when it introduces the model); an `e2e` task names the realized Journey step; a `frontend` page also carries an entry-source; only a contract-less utility task carries a one-line `done:` criterion of its own.
- Within-slice dependencies are a **DAG**, not a single chain. When the slice has e2e tasks, they stay sequential among themselves and the first `backend`/`frontend` task is blocked by the last `e2e`; when it has none, those tasks have no e2e blocker. Beyond that, `blocked-by` records only real upstream needs. Independent endpoints / hooks / components are siblings.
- `e2e` deliveries should read as **a single user-visible flow through the UI**, not API contracts or backend internals. One `e2e` task = one test case = one mapped journey scenario.
- The static IDs are **permanent** — they key the slice-body checklist and stay stable for the slice's whole life (commit trailers use `Task: s<slice#>.<id>`). They are never replaced with issue numbers.

Does the slice granularity feel right? Are the ACs complete and correctly classified by owning layer? Does each slice's journey-segment call (e2e or not) look right? Are slice-level and task-level dependencies correct? Are the tasks atomic and correctly typed? Reply with explicit approval ("approved" / "ship it") to lock.
