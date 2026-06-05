---
name: create-feature-issues
description: "Decompose a locked-in feature's PRD into release-safe vertical-slice GitHub issues — ONE issue per slice, whose body inlines the typed task breakdown (e2e → backend → frontend) as a static-ID checklist (no task sub-issues). Verifies the merged `feature-lockin` PR, reads PRD pair, critical paths, glossary, ADRs (via index), C4 diagrams, API contracts, data models, and the design system's surface + navigation inventory; emits a foundation/shell slice first for frontend-bearing features and a page-reachability gate (each page task declares its entry source); quizzes user; on approval opens slice issues labeled `kind:feature` + `status:ready-to-review` with a `feature/<slice#>-<intent>` branch and 1-up slice-level `Blocked by` chains; then archives the now-spent PRD pair (`requirement.md` + `implement-detail.md`) into `_archive/<feature>/` so they never contaminate later agent reasoning. Activate on 'create/slice issues for <feature-name>'; require `<feature-name>`."
---

# create-feature-issues

Turn a locked-in feature into a set of release-safe **vertical slice** GitHub issues. Each slice becomes **one** issue whose body inlines its typed task breakdown (e2e / backend / frontend) as a **static-ID checklist** — there are no task sub-issues. The skill is always invoked with a `<feature-name>` that points at `docs/product-requirement-document/<feature-name>/` — there is no free-form / ad-hoc input path. It decomposes the work, quizzes the user for explicit approval, creates one issue per slice (with its branch), then **archives the spent PRD pair**.

**The task checklist is the task ledger.** Inside each slice issue body, the `## Tasks` section is a checklist of static-ID entries (`e2e.1`, `be.1`, `fe.1`, …). Those IDs are **permanent keys** — they are never translated to issue numbers and never become their own issues. The fully-qualified permanent key is `s<slice#>.<type>.<n>` (the slice number comes from the slice issue); inside one slice body the short form (`e2e.1`) is unambiguous because the issue number already scopes it. The downstream workflow reads this checklist to know what to build, ticks each box on completion, and references the qualified key in commit trailers (`Task: s<slice#>.<id>`). Task-level dependencies are expressed in each entry's `blocked-by:` field as static IDs — not as GitHub `Blocked by` relationships.

**The PRD pair is a single-use input.** `requirement.md` + `implement-detail.md` exist for exactly one purpose: to be sliced into issues here. Once the issues carry the work, nothing re-reads those two files as a load-bearing input (engineers work from issue bodies; the durable contracts — ADR / data-model / api-contract / runbooks — carry every canonical fact). Leaving them in the live tree only lets a stale or superseded intent silently contaminate later agent reasoning. So this skill's **last act** is to relocate the pair into `docs/product-requirement-document/_archive/<feature-name>/` (step 6). The two governing rules that fall out: **`create-feature-issues` reads only *active* features** (those still under the live PRD root), and **nothing globs `_archive/`**.

## When to activate

Activate this skill whenever the user:

- Asks to "create issues", "open issues", "scaffold tickets", or "generate the backlog" for a feature.
- Hands over a `<feature-name>` and asks for issues — interpret as "read the PRD under `docs/product-requirement-document/<feature-name>/` and slice it".
- Asks to "break this down into vertical slices" or "slice this work into tracer bullets" for a named feature.

Do NOT activate when the user is asking for a single one-off issue with no decomposition needed, when they want to update an existing issue, when they are asking for a roadmap/PRD instead of issues, or when no `<feature-name>` is in play (the skill has no free-form mode — ask the user to point at a feature first).

## Workflow

### 1. Verify feature lock-in

The skill always kicks off with a `<feature-name>`. Before any issues are created, the feature MUST be **locked in** — meaning `/deep-dive-feature` (see `commands/deep-dive-feature.md`) has merged a PR labeled `feature-lockin` on the feature's milestone. That single merged-PR signal IS the lock-in contract — do not also probe milestone existence or PRD file presence; both are implicitly covered (a lock-in PR can't exist without its milestone, and the PRD files land in that same merge).

Run the check inline; fail closed (halt and surface) on any failure:

```bash
feature="<feature-name>"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo

# Lock-in PR merged on the feature's milestone? mergedAt must be non-null.
gh pr list \
  --repo "${repo_slug}" \
  --label "feature-lockin" \
  --milestone "${feature}" \
  --state all \
  --json number,title,state,mergedAt,url
```

Decide based on the result:

| Outcome | Decision |
|---------|----------|
| Output is `[]` | **STOP.** No `feature-lockin` PR on milestone `<feature-name>`. Either the milestone doesn't exist, the feature was never put through `/deep-dive-feature`, or the lock-in PR was never opened. Surface and ask the user to run `/deep-dive-feature <feature-name>` or correct the feature name. |
| Output has a row but `mergedAt` is `null` | **STOP.** Lock-in PR is open or was closed without merge. Print its `url` and ask how to proceed. |
| Output has a row with non-null `mergedAt` | Proceed to Step 2. |

Do not silently widen the check (e.g. don't accept an open PR, don't match by title). The merged `feature-lockin` PR is the contract the rest of the workflow assumes.

### 2. Analyze the context

Read every source listed below in full — partial reads will skew the slice breakdown.

- **PRD pair (mandatory).** Both files together are the source of truth for what to build:
  - `docs/product-requirement-document/<feature-name>/requirement.md`
  - `docs/product-requirement-document/<feature-name>/implement-detail.md`

  Read the on-disk copies. The merged `feature-lockin` PR (verified in Step 1) is what guarantees these files are present and current — do not re-check, and do not fall back to a different ref or a free-form description if a read returns empty. Note any user stories present in the source — they will be carried into the slice breakdown.

  **Archived-feature guard.** If `docs/product-requirement-document/<feature-name>/` is absent, check `docs/product-requirement-document/_archive/<feature-name>/` before treating it as a lock-in violation:

  ```bash
  ls docs/product-requirement-document/<feature-name>/ 2>/dev/null || \
    ls docs/product-requirement-document/_archive/<feature-name>/ 2>/dev/null
  ```

  - If the live directory is present → proceed normally.
  - If it's absent **but** `_archive/<feature-name>/` exists → this feature was **already sliced** (step 6 archives the PRD pair at the end of a successful run). **STOP** and surface:

    > Feature `<feature-name>` has already been sliced and its build docs are archived under `_archive/`. `create-feature-issues` only operates on active features. If you intend to re-slice it, restore the pair from `_archive/<feature-name>/` (e.g. `git mv` it back) first.

  - If **neither** exists → genuine lock-in contract violation: halt and surface, do not invent context.

  This keeps the single governing rule explicit: **`create-feature-issues` reads only active features.** No other skill needs `_archive/` awareness — the graveyard is read by nothing.

- **Critical paths (mandatory).** List `docs/critical-path/` and read every critical-path file whose `## Summary` or `## Journey (Gherkin)` touches the surface this feature is changing. Critical paths are organized by user flow, not by feature, so a single feature can touch one, several, or zero of them — list first, then decide which to read.

  ```bash
  ls docs/critical-path/
  ```

  Each critical-path file holds a **frozen `## Journey (Gherkin)` golden path** that spans several slices — it is the milestone's release-gate spec and the **seam-decider**: where a slice closes (a segment of) that journey is exactly where an `e2e.*` task is earned. When a slice closes a journey segment, record **which step(s) of which critical-path Journey** its segment-E2E realizes (carried onto the e2e task — milestone-close composition in Phase 4 stitches these). A slice that touches no journey segment gets **no** e2e task; its ACs are discharged at their backend/frontend owning layers. If the feature introduces a brand-new critical path, flag it — that's typically a sign that `/deep-dive-feature` should have produced one and the lock-in is incomplete.

- **Glossary (mandatory if present).** Read `docs/GLOSSARY.md` (and `knowledges/GLOSSARY.md` if it exists). Slice titles and issue bodies MUST use glossary vocabulary verbatim — no synonyms, no rephrasings.

- **ADRs (via the index).** Always read `docs/architecture-decision-record/README.md` first — it is the index of accepted decisions. Then open an individual ADR file (`docs/architecture-decision-record/ADR-NNNN.md`) only when its index entry tells you it constrains the surface this feature touches. Do not bulk-load every ADR — it pollutes context. Respect every ADR decision; if a slice would contradict one, halt and surface it before quizzing the user.

- **Architecture diagrams (when present).** List `docs/architecture/` and read whichever C4-PlantUML diagrams (`c4-context.puml`, `c4-container.puml`, `c4-component-<container>.puml`) cover the containers / components this feature changes. They pin down which deployable units and which internal modules exist — slice and task boundaries must respect that shape.

  ```bash
  ls docs/architecture/ 2>/dev/null
  ```

- **API contracts (when present).** List `docs/api-contract/` and read every per-resource file (`docs/api-contract/<entity>.yaml`) and `_shared.yaml` whose resource is touched by this feature. These OpenAPI 3.1 contracts are the binding source of truth for path, verb, status codes, request / response shape, error envelope, idempotency, and rate-limit policy — each `backend` task delivers an endpoint that already exists in (or must be added to) one of these files. The contract is iron; if a slice would require contradicting a contract entry, halt and surface it.

  ```bash
  ls docs/api-contract/ 2>/dev/null
  ```

- **Data models (when present).** List `docs/data-model/` and read every per-entity file (`docs/data-model/<entity>.yaml`) whose entity is touched by this feature. These ODCS v3.1 contracts pin down table names, column types, constraints, defaults, FKs, and indexes — the data-model change that rides along with the first endpoint introducing an entity MUST match the contract verbatim. The contract is iron; if a slice would require contradicting an entity, halt and surface it.

  ```bash
  ls docs/data-model/ 2>/dev/null
  ```

- **Design system + surface inventory (mandatory for any frontend-bearing feature).** List `docs/design-system/` and read `surfaces.md` (the surface + navigation inventory locked by `design-lead`), plus `overview.md` / `components.md` / `tokens.md` as the UI work warrants. `surfaces.md` is the contract that closes the orphan-page gap: it enumerates **every routed surface** with its `kind`, **entry source(s)**, global-nav membership, and auth posture, plus the global navigation model. It drives two things downstream: the **foundation/shell slice** (step 3) and the **page-reachability gate** (each frontend page task declares its entry source from this table in its checklist entry — step 3). If the feature has UI but `docs/design-system/surfaces.md` is absent, halt and surface — lock-in is incomplete; the design phase of `/deep-dive-feature` must have produced it.

  ```bash
  ls docs/design-system/ 2>/dev/null
  ```

### 3. Draft the slice + task breakdown

Decompose the source into thin vertical slices following these rules:

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Each slice must be release-safe: merging it on its own does not break the product.
</vertical-slice-rules>

<foundation-shell-slice>
**Emit a foundation/shell slice for any frontend-bearing feature — always, as the first slice.** Vertical-slice decomposition splits by *feature*; the cross-cutting **app shell** has no standalone user story, so without a dedicated slice it falls through the cracks and feature pages ship unreachable (no global nav to link into, an empty `/dashboard`). Derive this slice directly from `docs/design-system/surfaces.md` and the architect's app-shell C4 component. It owns:

- The **global navigation container** (the `Navigation` component pattern in `components.md`) — every `top-level` surface in the inventory's nav model gets a nav entry.
- The **authenticated layout** that wraps protected surfaces.
- The **landing / dashboard** surface (the `redirect-system` `/` target and the authenticated home).
- **Error boundaries** per route and the not-found (`*`) view.

Emit it **first** so later feature-page slices plug into an existing shell rather than inventing nav ad hoc. Its tasks follow the normal e2e → backend → frontend typing (e.g. an e2e flow asserting the nav renders and routes, a frontend task per shell component). Only skip the foundation slice when the feature is genuinely backend/database-only (no UI surfaces in the inventory) — then say so explicitly in the quiz rather than silently omitting it.
</foundation-shell-slice>

<page-reachability-gate>
**Every routed page task declares an entry source, and the gate verifies that inbound path exists in code.** The invariant is **reachability, not menu-membership** — real apps reach most pages from *other* pages; the global nav is only for top-level destinations. For each frontend task that delivers a **page**, look the page up in `docs/design-system/surfaces.md` and carry its declared **entry source(s)** onto the task's checklist entry (the `entry-source:` / `reached-from:` fields on a page task's follow-on line). The page is not "done" until that inbound path exists in code — the reviewer (`pattern-reviewer-frontend-standard`) enforces it per this table:

| Page kind | Reached from | In global nav? |
|---|---|---|
| `top-level` section | global nav | **yes** |
| `detail-child` | a row/link on its parent | no |
| `contextual` (new/edit/dialog) | a control on a parent | no |
| `external-entry` (login, magic-link) | URL typed / email link | no — exempt from in-app linking |
| `redirect-system` (`/`→home, 404) | redirect or error | no |

A **parentless (top-level)** page MUST be in the global nav *or* be an explicit redirect target — its only valid in-app entry is the shell, which is exactly why the foundation slice must exist first. A page **with a parent** must be linked from that parent (the linking control ships in the same slice as the page). **External-entry** pages declare "entered via URL/email" and are exempt. If a page in the breakdown has no entry source in `surfaces.md`, halt and surface — it's an orphan and the inventory is incomplete.
</page-reachability-gate>

For each **slice** (which becomes one GitHub issue), decide:

- **Title** — short, descriptive, uses glossary vocabulary.
- **Has UI?** — does this slice introduce or change a UI surface? (Drives the foundation-shell + page-reachability gates.) Backend-only / database-only slices have no UI.
- **Closes a cross-surface journey segment?** — does this slice make reachable (a segment of) a critical-path `## Journey` worth walking end-to-end through the browser? This — NOT "has UI" — is what earns an `e2e.*` task. A slice can have UI yet close no journey segment (a pure-layout slice) and so own zero e2e tasks; record which Journey step(s) a segment-closing slice realizes.
- **Blocked by** — which sibling slices (if any) must complete first. Most slices should have ≤1 blocker; a long blocker chain usually means the slices are too thick.
- **Touches app composition?** — does this slice add to the application's central wiring surface (backend `create_app` / `main.py` router mounts + middleware registration; frontend root router / provider tree)? Mark it. This is the one surface that parallel slices reliably clash on: two slices each mounting a new router or registering middleware in the same `create_app` produce a merge conflict — or, worse, a silent contract break where one slice's wiring drops out — when the second merges to `main`. See the app-composition serialization rule below.
- **User stories covered** — which user stories from the source this addresses, if the source has them. Omit if the source has no user stories.

<app-composition-serialization>
**Serialize slices that mutate the same app-composition surface.** When two or more sibling slices both touch the central wiring (`create_app` / `main.py` for the backend, the root router / provider tree for the frontend), they MUST NOT be left as parallel siblings. Chain them with a 1-up `Blocked by` edge so they merge one at a time and the second integrates on top of the first's wiring. Order the chain by the rest of the dependency graph (or lowest slice number when otherwise independent). This serialization is *only* for the composition surface — slices that add routes/components in their own modules without editing the shared wiring stay parallel. If serializing would create a long chain (3+ slices all editing `create_app`), that's a signal the composition surface should be owned by a contract instead: flag it for the architect to pin the `create_app` signature in an ADR / C4-component doc so reviewers enforce it, rather than forcing a fully serial backlog.
</app-composition-serialization>

For each slice, then decompose into **tasks** (which become entries in the slice body's `## Tasks` checklist — not separate issues). Pick whichever of the three types apply to the slice. **Tasks MUST be atomic** — each task delivers exactly one unit of work (one test case, one endpoint, one entity change, one utility, one page, one component, one hook). A slice typically has multiple tasks of the same type (e.g. three `e2e` tasks for three distinct user flows, two `backend` tasks for two distinct endpoints, three `frontend` tasks for three components), so each task needs a stable static **ID** for the dependency graph to be unambiguous.

**First, classify every AC clause by its owning layer (Principle 1 of `docs/test-layering-and-gates.md`).** An EARS AC is the *specification*, not a test — and it is routinely compound. The thing that owns a layer is the **assertion (the SHALL/THEN clause)**, not the whole AC. Classify **per clause**:

- a clause observable at the **HTTP endpoint / worker tick** (ledger deltas, "same transaction", token state, outbox enqueue, DB-constraint rejection, "no row created", 4xx/429, server-rendered zero-JS HTML) → **backend** owning layer → discharged by a `backend` task.
- a clause observable at the **rendered/routed tree** (the UI shows…, hook guards, cache invalidation, error display from a stubbed status, layout/a11y, derived display math) → **frontend** owning layer → discharged by a `frontend` task.
- a *user-visible cross-surface* result that requires both layers wired together and sits on a **journey worth walking** → **true E2E** → discharged by an `e2e` task.

A compound AC fans across layers: split it into the tasks that discharge each clause at its layer (e.g. one `backend` + one `frontend`, NOT an E2E — a two-layer AC does not earn a browser walk; E2E is earned by being on a journey). Push each clause to the lowest layer that can prove it, and assert it once.

Types — each task delivers **exactly one atomic unit**:

- **e2e** — present **only when this slice closes (a segment of) a cross-surface journey** worth walking (a critical-path `## Journey` segment). It is NOT emitted just because the slice has UI, and NOT to "cover" a backend invariant. Each `e2e` task is **one E2E test case = one user-visible cross-surface flow through the UI**. A journey whose segment spans multiple scenarios (happy path, validation error, edge case) MUST become multiple `e2e` tasks — one per scenario. Do not bundle scenarios into a single task. A backend-only or pure-layout slice legitimately has **zero** e2e tasks.
- **backend** — present when the slice touches API endpoints or backend utilities. Each `backend` task delivers **exactly one** of: a single API endpoint, or a single utility function/module. **Data-model entity changes are not their own task.** A model + migration delivers nothing in isolation (no caller, no acceptance test reaches it), and the schema is almost always discovered alongside the first endpoint that uses it. The model change rides along with the first endpoint (or other consumer) that introduces it, in the same task. When a second endpoint in the slice uses the same model, it depends on the first endpoint's task via `Blocked by` — not on a separate model task. Do not cluster two endpoints or two utilities into one task — split them and order via `Blocked by`.
- **frontend** — present when the slice touches pages, components, or hooks. Each `frontend` task delivers **exactly one** of: a single page, a single component, or a single hook. Do not bundle multiple components, or "page + its components", into one task — split them and order via `Blocked by`.

For each task, decide:

- **ID** — a stable static identifier. Inside the slice's checklist, write the **short form** `<type-code>.<index>` where `type-code` is one of `e2e` / `be` / `fe`, and `index` is `1`, `2`, … . Examples: `e2e.1`, `e2e.2`, `be.1`, `be.2`, `fe.1`. The slice issue number already scopes these, so the short form is unambiguous within one slice body. The index is always required (even when a slice happens to have only one task of a given type) so atomic decomposition stays visually consistent across slices. The **fully-qualified permanent key** is `s<slice#>.<type>.<n>` (e.g. task `be.1` on slice issue #42 is `s42.be.1`) — used in commit trailers (`Task: s42.be.1`). These IDs are **permanent**: they key the inline checklist for the slice's whole life and are NEVER translated to issue numbers.
- **Type** — `e2e` | `backend` | `frontend`.
- **Delivery** — the **single** unit being created/modified:
  - `e2e` → **one** E2E test case, expressed as **one** user flow through the UI (e.g. "user navigates to /entities, clicks 'New', fills the form, submits, then sees the new row in the list"). E2E validates behavior end-to-end via the UI — never as direct API calls or backend assertions. One task = one flow = one mapped acceptance-criteria scenario.
  - `backend` → **one** API endpoint, **or** **one** utility. The endpoint task carries any data-model + migration changes it introduces; do not split the model into its own task. If a task description needs the word "and" between two endpoints, two utilities, or two distinct models, split it.
  - `frontend` → **one** page, **or** **one** component, **or** **one** hook. If a task description needs the word "and" between two of these, split it.
- **Spec pointer** — each task's checklist follow-on line tags, **uniformly across all three types**, the AC clause(s) it discharges and the scenario it walks at its layer; it does NOT duplicate the AC text. The slice-level AC (EARS + Gherkin) is the only AC ceremony.
  - `covers:` (every type) — the AC clause id(s) this task discharges (e.g. `AC1, AC3`). This is what lets the reviewer tick an AC box once every task tagged with it passes.
  - `scenario:` (every type) — the Gherkin scenario this task walks at **its owning layer** (the §2 obligation, named "scenario"): for `backend`, what the endpoint/worker proves (a ledger delta, a 409, "no row created"); for `frontend`, what the rendered tree shows; for `e2e`, the user-visible journey step.
  - `backend` → also `contract:` the binding `docs/api-contract/<entity>.yaml` (+ `docs/data-model/<entity>.yaml` when this task introduces the entity). The contract is the unit spec — the task delivers the endpoint that file already describes.
  - `e2e` → also the mapped journey scenario (plus the pattern-mandated non-happy-path the spec must also exercise), and which **critical-path Journey step(s)** the segment realizes.
  - `frontend` → also `design:` `docs/design-system/tokens.md`; a **page** task additionally carries `entry-source:` (route) and `reached-from:` (the inbound nav/control), copied verbatim from `docs/design-system/surfaces.md` per the page-reachability gate.
  - **contract-less utility** task → a single `done:` one-line criterion *in place of* `contract:`. This is the **only** place a task carries its own acceptance criterion — when there is no contract to point at; it still carries `covers:` + `scenario:`.
- **Blocked by** — the `blocked-by:` field on the checklist entry, listing the static IDs of tasks that must complete first. Record every **real** upstream dependency, no more and no less; use `—` for none. The within-slice graph is a DAG, not a strict chain:
  1. `e2e` tasks (**when the slice has any** — they exist only for a journey-closing slice) remain strictly sequential among themselves — they author tests in the same spec area: `e2e.1` ← `e2e.2` ← … . The first `e2e` task has no within-slice blocker.
  2. **When the slice HAS e2e tasks** (red-first drives the design), the first `backend` task and the first `frontend` task are each blocked by the last `e2e` task. **When the slice has NO e2e task** (backend-only, pure-layout — the common case under the new layering), there is no e2e blocker: the first `backend`/`frontend` task has no within-slice blocker (`—`). Either way, subsequent backend tasks are blocked only by real upstream needs — typically the prior task that introduced the model they now consume, or the utility they call; independent endpoints are siblings. Frontend works against the contract; within frontend, components are blocked by the hook(s) they consume, pages by the primary component(s) they compose; independent hooks and components are siblings. The first frontend task is **never** blocked by anything in backend.

  Example for a journey-closing slice with two e2e cases, one backend endpoint (which introduces its model), one frontend hook, and one frontend component that uses the hook:

  ```
  e2e.1   blocked-by: —
  e2e.2   blocked-by: e2e.1
  be.1    blocked-by: e2e.2
  fe.1    blocked-by: e2e.2          ← sibling of be.1, parallels backend
  fe.2    blocked-by: fe.1           ← real dep: component uses the hook
  ```

  Example for a backend-only slice (no journey segment, so no e2e task) with two independent endpoints, the first introducing the model:

  ```
  be.1    blocked-by: —
  be.2    blocked-by: be.1          ← real dep: reuses be.1's model
  ```

  After `e2e.2` is checked (or immediately, when there is no e2e task), the unblocked tasks become pickable. The downstream workflow dispatches one at a time per slice (worktree-per-slice is serial within the slice); the deterministic tiebreaker for which-comes-first is enforced at dispatch time, not in the checklist.

  Cross-slice task dependencies are handled at the slice level: when a task genuinely depends on work in a prior slice, that prior slice is the upstream slice's `Blocked by` edge (step 5a) — a task's `blocked-by:` field only ever names IDs **within the same slice**. Stay **1-up** inside the slice: never include a transitive ancestor.

### 4. Quiz the user

Present the full breakdown using [`templates/slice-task-breakdown.md`](templates/slice-task-breakdown.md) as the format reference: a numbered list of slices, with each slice's task checklist shown beneath it. For each slice show: **Title**, **Acceptance criteria** (every slice has them — list the AC ids + the owning layer you classified each clause into), **Closes a journey segment?** (which drives whether it gets an e2e task), **Blocked by**, **Touches app composition?**, **User stories covered**. For each task show: its static **ID**, **Type**, **Delivery (one-line summary)**, **blocked-by**, **`covers:`** (AC clause ids), **`scenario:`** (walked at its layer), and the type-specific pointer (`contract:` for backend, the realized critical-path Journey step for e2e, `entry-source:` for pages, or a `done:` line for a contract-less utility). When two or more slices are marked "Touches app composition? yes", show the serialization edge you added between them and call it out explicitly so the user can confirm or correct it.

Then ask the user explicitly:

- Does the slice granularity feel right? (too coarse / too fine)
- Are the slice-level dependencies correct (including the app-composition serialization chain, if any)?
- Are the tasks per slice complete and correctly typed?
- Are the inter-task dependencies correct?
- Should any slices or tasks be merged, split, added, or removed?

Iterate. Re-present the updated breakdown each round. Do not move on until the user gives an explicit approval ("looks good", "ship it", "approved", etc.). Soft acknowledgments ("ok", "sure") don't count — confirm.

### 5. Create the slice issues

Once approved, create **one issue per slice** in dependency order using the inline `gh` commands shown. There are no task sub-issues — each slice's task breakdown is inlined into its body as a static-ID checklist. Keep a running mapping `<slice#> → #<real issue number>` so the slice-level `Blocked by` chain can be wired as we go (e.g. `1 → #150`, `2 → #151`). Task static IDs (`e2e.1`, `be.1`, …) need **no** mapping — they stay static, scoped by the slice issue's number, for the slice's whole life.

**Slice dependency rule (1-up only).** When the breakdown has a chain `s1 → s2 → s3`, only mark `s3` `Blocked by s2` and `s2` `Blocked by s1`. Do **not** also mark `s3` `Blocked by s1` — transitive blockers are inferred by GitHub. (Within a slice, task dependencies live in each checklist entry's `blocked-by:` field as static IDs, also 1-up — they are *not* GitHub relationships.)

#### 5a. Create the slice issue (the only issue), its branch, and its slice-level Blocked by

For each slice, in dependency order (slices with no blockers first, then slices whose blockers are already created):

```bash
gh issue create \
  --title "<slice title using glossary vocabulary>" \
  --body-file <slice-body.md> \
  --milestone "<feature-name>" \
  --label "kind:feature" \
  --label "status:ready-to-review"
```

Notes:
- **Body** follows [`templates/slice-body.md`](templates/slice-body.md) — the single issue body for the slice. Fill the `## Tasks` checklist from the approved breakdown: one entry per task, short static ID (`e2e.1`, `be.1`, `fe.1`), a `blocked-by:` field, the one-line delivery, and the follow-on line carrying `covers:` + `scenario:` plus the type-specific pointer (`contract:` / journey step / `entry-source:` / `done:`). The **Acceptance criteria** section is **always present** — every slice carries ACs as **ticked checkboxes** (`- [ ] AC1 — …`), a peer ledger to the task checklist. A backend-only slice's ACs are backend invariants (ledger deltas, "same tx", "no row created") with a backend owning layer — write them, do not omit them. The reviewer ticks each AC box at end-of-slice review; `create-feature-issues` writes them unchecked.
- After creation, record the mapping `<slice#> → #<real issue number>`. The task IDs in the body are already scoped by this number — their fully-qualified permanent keys are `s<issue#>.<id>` (e.g. `s150.be.1`).
- **Create the slice's development branch immediately** — every task in the slice commits onto this single branch. Use `gh issue develop`, which creates the branch off the current `origin/main` AND records the GitHub-native development link on the issue (no local checkout, no `git push`):

  ```bash
  # <intent> is YOUR call — a short kebab-case phrase (≤40 chars) that conveys
  # what the slice DOES, not the literal title. Examples:
  #   slice "Allow drafts to be saved without a title"   → drafts-without-title
  #   slice "Show empty entities page behind a flag"     → empty-entities-shell
  #   slice "Persist a single entity end-to-end"         → entity-persistence
  # The leading <slice#> guarantees uniqueness even if two slices land on the
  # same intent phrase, and lets anyone reverse-look up the issue from a branch.
  branch="feature/${slice_number}-<intent>"

  gh issue develop "${slice_number}" \
    --base main \
    --name "${branch}"
  ```

  Naming guidance: do NOT mechanically slugify the issue title. Choose an intent phrase that's short, reads as a noun-phrase summary of the slice's behavioral change, uses glossary vocabulary, and stays meaningful when seen in isolation (`git branch`, PR list, CI logs). Avoid filler verbs ("add", "implement"), tense markers, and stop-words. The prefix table and broader naming conventions live in [`templates/branch-naming.md`](templates/branch-naming.md) — this skill is the only entrypoint that creates branches in the Automated Engineer Flow, so that template is the canonical reference. If `gh issue develop` reports "a branch already exists for this issue" (e.g. a concurrent run got there first), treat it as benign and continue.
- **Wire 1-up slice-level `Blocked by` immediately**, before moving to the next slice. If this slice's breakdown lists an upstream slice as its blocker, run:

  ```bash
  # 1. Resolve issue numbers to GraphQL node IDs:
  this_id=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
    -f o=<owner> -f r=<repo> -F n=<this-slice-#> --jq '.data.repository.issue.id')
  blocker_id=$(gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){id}}}' \
    -f o=<owner> -f r=<repo> -F n=<upstream-slice-#> --jq '.data.repository.issue.id')

  # 2. Wire the blocked-by relationship:
  gh api graphql -f query='
    mutation($issue: ID!, $blocker: ID!) {
      addBlockedBy(input: {issueId: $issue, blockingIssueId: $blocker}) {
        issue { number }
      }
    }
  ' -f issue="$this_id" -f blocker="$blocker_id"
  ```

  Only the **immediate** upstream slice — never transitive ancestors. This is the *only* `Blocked by` GraphQL the skill issues; intra-slice task dependencies are the checklist's `blocked-by:` fields, not GitHub relationships.

#### 5c. Report created issues

Report the created slice issue numbers/URLs back to the user, one per slice, with the linked development branch name and the count of inlined tasks each carries. Slice issues are in `status:ready-to-review` — the human is expected to review and (per the flow spec) flip them to `status:ready-to-implement` to release them to the loops. There are no task sub-issues to report; the task ledger lives in each slice body's checklist.

### 6. Archive the spent PRD pair

This is the skill's **last act**, and it runs **only after every slice issue from step 5 was created successfully** (with its branch and slice-level `Blocked by` wired). If issue creation failed partway, do **not** archive — surface the partial state instead, so a re-run can finish creating issues against the still-live PRD.

The PRD pair (`requirement.md` + `implement-detail.md`) has now done its entire job: the work lives in the issues. Relocate the pair out of the live read surface so no later agent globs a stale intent.

1. **Relocate the directory** with `git mv` so history follows:

   ```bash
   feature="<feature-name>"
   mkdir -p docs/product-requirement-document/_archive
   git mv "docs/product-requirement-document/${feature}" \
          "docs/product-requirement-document/_archive/${feature}"
   ```

2. **Stamp frontmatter** on both `_archive/<feature>/requirement.md` and `_archive/<feature>/implement-detail.md`:

   ```yaml
   ---
   status: sliced            # build docs consumed by create-feature-issues
   sliced_at: <YYYY-MM-DD>   # absolute date — today
   ---
   ```

   Plus a one-line human banner at the top of each body:
   `> **Archived (sliced <date>).** Build input only — not a live reference. Durable facts live in ADR / data-model / api-contract / runbooks.`

3. **Commit on the current branch** (no PR):

   ```bash
   git add -A docs/product-requirement-document/
   git commit -m "docs(prd): archive ${feature} build docs (sliced)"
   ```

   If the current branch is `main` and your repo protects it, branch first (`git switch -c chore/archive-${feature}`) and open a tiny PR instead — the relocation itself is the load-bearing part either way.

4. **Report** the archive move (old path → `_archive/<feature>/`) and the commit hash, alongside the issue summary from 5c.

Why archive here rather than in a separate skill: `requirement.md` and `implement-detail.md` are published together at lock-in but for one transient purpose — feeding this skill. The moment the issues exist they are spent, so the archive is a deterministic tail of the same operation, not a later human decision. Their durable counterparts (ADRs, data models, API contracts, runbooks) stay live and carry every canonical fact forward.

## Pattern

### Vertical slices, not horizontal layers

Bad — horizontal split, none of these is independently shippable:

```
#1 Build the schema for <feature>
#2 Build the API for <feature>
#3 Build the UI for <feature>
#4 Write the tests for <feature>
```

Good — vertical tracer bullets, each merge leaves the product working. Each slice is **one** issue; its task breakdown is inlined in the body as a static-ID checklist (the task ledger). Tasks form a DAG (`e2e` first, then `backend` / `frontend` against the contract the e2e pins down), each one **atomic** — one test case, one endpoint, one entity, one component, etc.:

```
#150  Show empty <feature> page behind a flag (slice issue — kind:feature + status:ready-to-review)
      ## Acceptance criteria (EARS)   ← always present; reviewer-ticked
      - [ ] AC1 — WHEN the flag is on, the page SHALL render the empty state.   (frontend layer)
      ## Tasks                         ← closes a journey segment ⇒ has an e2e task
      - [ ] `e2e.1` · **e2e** · blocked-by: — · "User opens the page behind the flag and sees the empty state"
            covers: AC1 · scenario: "Empty <entities> page renders" · realizes Journey step 1 of docs/critical-path/<flow>.md
      - [ ] `be.1`  · **backend** · blocked-by: `e2e.1` · "GET /<entities> returning an empty list"
            covers: AC1 · scenario: "GET returns []" · contract: docs/api-contract/<entity>.yaml
      - [ ] `fe.1`  · **frontend** · blocked-by: `e2e.1` · "page shell behind the feature flag"
            covers: AC1 · scenario: "Shell renders empty state" · design: docs/design-system/tokens.md
            entry-source: route /<entities> · reached-from: global-nav "Entities"

#151  Hold a credit when a <session> is scheduled (slice issue — backend-only, NO e2e task)
      ## Acceptance criteria (EARS)   ← backend invariants ARE ACs (backend owning layer)
      - [ ] AC1 — WHEN a <session> is scheduled, the system SHALL move 1 credit from available to held in the same transaction.
      - [ ] AC2 — IF the trainer has 0 available credits, THEN the system SHALL reject with 409 and create no row.
      ## Tasks                         ← no journey segment closed ⇒ no e2e task
      - [ ] `be.1`  · **backend** · blocked-by: — · "POST /<sessions> (introduces <Session> model + migration)"
            covers: AC1, AC2 · scenario: "Schedule moves 1 credit to held; 0-credit rejects 409, no row" · contract: docs/api-contract/session.yaml · docs/data-model/session.yaml
```

### Iron rules

- **One GitHub issue per slice; tasks are an inlined checklist, not sub-issues.** Each slice is a single issue created with `gh issue create`, labeled `kind:feature` + `status:ready-to-review`. Its `## Tasks` section is a static-ID checklist that *is* the task ledger — there are no task sub-issues. Titles are short, descriptive, and use glossary vocabulary.
- **Vertical slices only.** Each slice issue is a tracer bullet that cuts through every integration layer (schema, API, UI, tests) end-to-end. No horizontal "build the schema" / "build the API" splits at the slice level.
- **Tasks split a slice horizontally by type.** Within a single slice, the checklist tasks are typed (e2e/backend/frontend) — that horizontal split is fine because the slice as a whole is still vertical.
- **Release safe.** Each merged slice must leave the product in a working state. If a slice can't be merged independently without breaking the product, it's wrong — re-slice it (feature flags, no-op stubs, dark-launch, etc.).
- **Milestone-grouped.** Every slice issue created MUST be set to `--milestone "<feature-name>"`. The skill always runs against a locked-in feature, so the milestone is never optional.
- **Use the project's vocabulary.** Issue titles and descriptions must use terms from the project's domain glossary verbatim — no synonyms, no rephrasings. Respect ADRs in any area you touch.
- **Critical-path Journeys decide E2E existence AND design.** An `e2e.*` task is emitted **only when the slice closes (a segment of) a critical-path `## Journey`** — the frozen golden path is both the seam-decider and the release-gate spec. Each emitted `e2e` task maps onto that Journey and records which step(s) it realizes (so Phase-4 milestone-close composition can stitch the segments). Never invent an e2e task to "cover" a backend invariant — that invariant is discharged at the backend layer. A feature that introduces a brand-new critical path means lock-in is incomplete — halt and surface, do not invent the Journey inside an issue body.
- **Quiz before locking.** Never create issues until the user explicitly approves the slice + task breakdown.
- **Atomic tasks.** Each checklist task delivers **exactly one** unit of work — one E2E test case (= one user flow), one API endpoint, one utility, one page, one component, or one hook. Data-model + migration changes are NOT a unit on their own — they ride along with the first endpoint (or other consumer) that introduces them, in the same task. Splitting is mandatory: if a task description requires the word "and" to join two endpoints, two utilities, two components, two hooks, or two pages, it MUST be split into two tasks ordered via `blocked-by:`. Many small atomic tasks are correct; "bundled for convenience" tasks are not.
- **Tasks carry `covers:` + `scenario:` + a spec pointer, not their own AC.** AC lives on the slice (EARS + Gherkin) and only there. Each checklist task's follow-on line tags, uniformly across types, `covers:` (the AC clause ids it discharges) and `scenario:` (the Gherkin it walks at its owning layer), plus a type-specific pointer: `backend` → `contract:` its `docs/api-contract/<entity>.yaml` (+ `docs/data-model/<entity>.yaml` when it introduces the entity); `e2e` → the mapped journey scenario + the critical-path Journey step it realizes; `frontend` → `design:` tokens (pages also `entry-source:`/`reached-from:`). The one exception is a **contract-less utility** task, which carries a `done:` one-line criterion in place of `contract:` (still with `covers:`/`scenario:`) — the only place a task states its own AC.
- **Permanent static task IDs in the checklist.** Every task has a static ID written short as `<type-code>.<index>` (`e2e` / `be` / `fe`) inside the slice body; the index is always present, even when the slice has only one task of that type. The slice issue number scopes them, so the fully-qualified permanent key is `s<slice#>.<type>.<n>`. These IDs are **permanent** — they key the checklist, drive `blocked-by:` references and commit trailers (`Task: s<slice#>.<id>`), and are NEVER translated to issue numbers.
- **1-up dependencies only.** At the **slice** level, `Blocked by` is a GitHub relationship wired 1-up (record only the immediate upstream slice; GitHub infers transitive ancestors). At the **task** level, dependencies are the checklist `blocked-by:` fields — static IDs *within the same slice*, also 1-up. Task dependencies are never GitHub relationships, and a task never names a blocker outside its own slice (cross-slice dependency is captured by the slice-level `Blocked by`).
- **Serialize slices that mutate the same app-composition surface.** Two or more sibling slices that each edit the central wiring (backend `create_app` / `main.py` router-mount + middleware registration; frontend root router / provider tree) MUST be chained with a 1-up `Blocked by` edge, never left parallel — parallel composition edits clash on merge or silently drop one side's wiring. Serialize only the composition surface; module-local routes/components stay parallel. A 3+ slice chain all editing `create_app` is a smell — flag it for the architect to own the `create_app` signature in an ADR / C4-component doc instead of forcing a fully serial backlog.
- **Foundation/shell slice first for any frontend-bearing feature.** Always emit a foundation slice that owns the app shell — global-nav container, authenticated layout, landing/dashboard, error boundaries — derived from `docs/design-system/surfaces.md` and the architect's app-shell C4 component, and order it as the **first** slice so later feature pages plug into an existing nav. Skip it only when the feature has zero UI surfaces, and say so explicitly in the quiz rather than silently omitting it. The orphan-page failure mode (top-level pages shipped with no nav to reach them) is exactly what this prevents.
- **Every page task declares an entry source; reachability is the gate.** Each frontend task delivering a *page* carries the page's declared entry source(s) from `docs/design-system/surfaces.md` (route, kind, reached-from, in-global-nav) on its checklist entry (the `entry-source:` / `reached-from:` follow-on line). The invariant is **reachability, not menu-membership**: a `top-level` page must be in the global nav or be an explicit redirect target; a `detail-child` / `contextual` page must be linked from its parent (the linking control ships in the same slice); `external-entry` pages are exempt. The reviewer (`pattern-reviewer-frontend-standard`) verifies the declared inbound path exists in code before the page is done. A page with no entry source in `surfaces.md` is an orphan — halt and surface, do not invent the path.
- **DAG dependencies within a slice (checklist `blocked-by:`).** Tasks within a slice form a DAG, not a single chain, expressed by each checklist entry's `blocked-by:` field. `e2e` tasks (when the slice has any) stay sequential among themselves. **When the slice has e2e tasks**, the first `backend` and first `frontend` task are each blocked by the last `e2e` (red-first drives the design); **when it has none** (backend-only / pure-layout — the common case), they have no e2e blocker (`—`). Beyond that, `blocked-by:` records only real upstream needs (an endpoint blocked by the prior task that introduced its model; a component blocked by its hook; a page blocked by its primary component). Independent endpoints, hooks, and components are siblings. The runtime tiebreaker for multiple-ready tasks (`e2e` → `backend` → `frontend`, then lowest ID) is enforced at dispatch time, not in the checklist.
- **Slice branch is created at issue-creation time.** Step 5a opens the slice issue and immediately creates its `feature/<slice#>-<intent>` branch via `gh issue develop`. The slice is born ready for downstream work — there is no separate "pickup slice" loop that materializes branches afterwards.
- **All slice work shares the one slice branch.** There is no per-task branch — every task in the slice's checklist commits onto the single `feature/<slice#>-<intent>` branch from 5a. Commit trailers carry `Refs #<slice#>` plus `Task: s<slice#>.<id>` for per-task traceability.
- **Branch intent name is hand-picked, not auto-slugged.** The `<intent>` segment is a short kebab-case noun-phrase (≤40 chars) that conveys what the slice does, chosen during step 5a. Do NOT mechanically slugify the issue title — titles are written for humans scanning a list, branch names need to read well in isolation.
- **Acceptance criteria live on the slice only, and are ALWAYS present.** Every slice carries the AC section (EARS + Gherkin) — including a backend-only / database-only slice, whose ACs are backend invariants (ledger deltas, "same tx", token state, "no row created") with a **backend owning layer**. An AC is a *specification, not a test*; do not omit it because the slice has no UI (the old AC=E2E conflation). ACs are ticked checkboxes ticked by the **reviewer** at end-of-slice review (the verified gate); `create-feature-issues` writes them unchecked. Classify each AC clause by owning layer and split a compound AC into the tasks that discharge each clause at its layer; tasks point at the AC via `covers:` rather than duplicating it.
- **EARS + Gherkin for the slice's behavioral criteria.** The slice-level AC uses EARS, and non-trivial criteria add 1+ Gherkin scenarios with `Given` / `When` / `Then` steps. RFC 2119 keywords (MUST, SHALL, SHOULD, MAY, MUST NOT, SHOULD NOT) MUST appear in UPPERCASE in `Then` / `And` outcome lines. `Given` / `When` lines state facts and do not need RFC 2119 keywords.
- **Data-model + migration changes ride along, specified by the contract.** A `backend` task that introduces or changes a data model carries that change in the same task (never its own task) and points at both `docs/api-contract/<entity>.yaml` and `docs/data-model/<entity>.yaml` (`contract:`). The data-model contract is the binding spec for the migration; the downstream engineer derives upgrade/downgrade migration tests from it — `create-feature-issues` does not re-state migration Gherkin in the slice body.
- **The PRD pair is single-use; archive it after slicing.** `requirement.md` + `implement-detail.md` are inputs to this skill and nothing else re-reads them as load-bearing. After every slice issue is created (step 5), relocate the pair into `docs/product-requirement-document/_archive/<feature-name>/` via `git mv`, stamp `status: sliced` frontmatter, and commit (step 6). Physical relocation — not just a flag — is what keeps stale intent off the agent read surface; agents glob the live tree and would read a `status:`-flagged file left in place. Archive only on full success; never archive a partial run.
- **`create-feature-issues` reads only active features.** If the live `docs/product-requirement-document/<feature-name>/` is gone but `_archive/<feature-name>/` exists, the feature was already sliced — STOP and surface, do not re-slice from the archive. Nothing globs `_archive/`; it is the graveyard, read by no skill.

### EARS notation cheat sheet

| Pattern | Form |
|---------|------|
| Ubiquitous | The `<system>` SHALL `<response>`. |
| Event-driven | WHEN `<trigger>`, the `<system>` SHALL `<response>`. |
| State-driven | WHILE `<state>`, the `<system>` SHALL `<response>`. |
| Unwanted behavior | IF `<condition>`, THEN the `<system>` SHALL `<response>`. |
| Optional feature | WHERE `<feature is included>`, the `<system>` SHALL `<response>`. |

## Templates

Templates are stored as separate files under `templates/` so they can be edited and `cat`-loaded as `--body-file` payloads without round-tripping through the SKILL.md prose. Read the relevant file before drafting each artifact; copy it to a scratch file, fill in the `<…>` placeholders, then pass it to `gh issue create --body-file <scratch>`.

| Template file | Used in | Purpose |
|---------------|---------|---------|
| [`templates/slice-task-breakdown.md`](templates/slice-task-breakdown.md) | step 4 | Quiz format presented to the user for explicit approval of the slice + inlined-task-checklist breakdown. |
| [`templates/slice-body.md`](templates/slice-body.md) | step 5a | The single issue body for each slice — Context / Scope / Acceptance criteria (slice-only, ALWAYS present, ticked checkboxes) / the static-ID Tasks checklist / Notes. The task-body templates are gone; the checklist entry format lives here. |
| [`templates/branch-naming.md`](templates/branch-naming.md) | step 5a | Branch-naming conventions for the slice branch cut by `gh issue develop` (prefix table + intent-phrase guidance). This skill is the only entrypoint that creates branches in the Automated Engineer Flow. |
