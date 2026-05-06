---
name: create-issues
description: "Decompose a requirement, enhancement description, or PRD into thin vertical-slice GitHub issues with typed task sub-issues. Activate when the user asks to create issues, turn a PRD into issues, slice work into tickets, generate issues from a feature spec, or break down a requirement into GitHub issues. Triggers on verbs like create, generate, scaffold, draft, slice, break down, decompose paired with nouns like issue, ticket, slice, work item, backlog. Triggers on phrases like 'create issues for X', 'turn this PRD into issues', 'break this down into tickets', 'create issues based on docs/PRDs/<feature-name>', 'slice this requirement', 'open issues for the <feature-name> feature'. Also activates when a `docs/PRDs/<feature-name>/requirement.md` or `docs/PRDs/<feature-name>/implement-detail.md` path is referenced as the source. Produces one parent GitHub issue per vertical slice (with EARS + Gherkin acceptance criteria for E2E/UI behavior) plus typed task sub-issues (e2e | backend | frontend) for the actual work, all created via `gh issue create` and grouped under the feature milestone."
---

# create-issues

Turn a feature/enhancement context into a set of release-safe **vertical slice** GitHub issues, each broken down into typed **task sub-issues** (e2e / backend / frontend). The context is either a free-form requirement description or a `<feature-name>` that points at `docs/PRDs/<feature-name>/`. The skill decomposes the work, quizzes the user for explicit approval, then creates the parent issue + task sub-issues per slice.

## When to activate

Activate this skill whenever the user:

- Asks to "create issues", "open issues", "scaffold tickets", or "generate the backlog" for a feature or requirement.
- Hands over a `<feature-name>` and asks for issues — interpret as "read the PRD under `docs/PRDs/<feature-name>/` and slice it".
- Hands over a free-form requirement / enhancement description and asks for issues.
- References `docs/PRDs/<feature-name>/requirement.md` or `docs/PRDs/<feature-name>/implement-detail.md` as the source for ticket creation.
- Asks to "break this down into vertical slices" or "slice this work into tracer bullets".

Do NOT activate when the user is asking for a single one-off issue with no decomposition needed (just use `gh issue create` via `git-workflow`), when they want to update an existing issue, or when they are asking for a roadmap/PRD instead of issues.

## Sub-skill routing

| Sub-skill | When to route to it |
|-----------|---------------------|
| `git-workflow` | All `gh` invocations (issue create, milestone assignment, sub-issue / parent linking, blocker linking) — defer to it for the canonical command shape, label conventions, and any auth / repo-detection concerns. |

## Workflow

### 1. Verify feature lock-in (when `<feature-name>` is provided)

When the user supplies a `<feature-name>`, the feature must be **locked in** before any issues are created. Lock-in is signaled by a **merged** PR titled `feature lockin` on the milestone whose title matches `<feature-name>` (this is the PR produced by `/deep-dive-feature`, see `commands/deep-dive-feature.md`).

Check it via `gh` (defer to `git-workflow` for the canonical command shape):

```bash
gh pr list \
  --search 'feature lockin in:title' \
  --milestone "<feature-name>" \
  --state all \
  --json number,title,state,mergedAt,url
```

Decide based on the result:

- **No PR returned** → the feature has not been locked in. **STOP.** Do not slice, do not draft, do not create issues. Surface the situation to the user and ask how they want to proceed (e.g. run `/deep-dive-feature <feature-name>` first, or correct the feature name).
- **PR exists but `mergedAt` is null** (open or closed-without-merge) → lock-in is still in review or was rejected. **STOP.** Surface the PR URL and ask the user how to proceed (e.g. wait for / drive the PR to merge, or pick a different feature).
- **PR exists and is merged** → proceed to Step 2.

Skip this step when the user supplied a free-form requirement instead of a `<feature-name>` — there is no milestone to check.

### 2. Analyze the context

- If the user supplied a free-form requirement/enhancement description, treat that text as the source.
- If the user supplied a `<feature-name>`, read both:
  - `docs/PRDs/<feature-name>/requirement.md`
  - `docs/PRDs/<feature-name>/implement-detail.md`
  Both files together are the source. If either is missing, surface that and ask the user how to proceed before slicing.
- Also scan the repo for a domain glossary (e.g. `docs/glossary.md`, `GLOSSARY.md`) and any ADRs under `docs/adr/` that touch the affected areas. Slice titles and issue bodies MUST use glossary vocabulary and respect ADR decisions.
- Note any user stories present in the source — they will be carried into the slice breakdown.

### 3. Draft the slice + task breakdown

Decompose the source into thin vertical slices following these rules:

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests).
- A completed slice is demoable or verifiable on its own.
- Prefer many thin slices over few thick ones.
- Each slice must be release-safe: merging it on its own does not break the product.
</vertical-slice-rules>

For each **slice** (which becomes a parent issue), decide:

- **Title** — short, descriptive, uses glossary vocabulary.
- **Has UI?** — does this slice introduce or change a UI surface? Backend-only / database-only enhancements/features have no UI.
- **Blocked by** — which sibling slices (if any) must complete first. Most slices should have ≤1 blocker; a long blocker chain usually means the slices are too thick.
- **User stories covered** — which user stories from the source this addresses, if the source has them. Omit if the source has no user stories.

For each slice, then decompose into **tasks** (which become sub-issues). Pick whichever of the three types apply to the slice. A slice with UI typically has multiple tasks of the same type (e.g. two `backend` tasks for two distinct endpoints, three `frontend` tasks for three components), so each task needs a stable local **ID** for the dependency graph to be unambiguous before real issue numbers exist.

Types:

- **e2e** — present whenever the slice has UI. Captures the E2E tests that validate the slice's acceptance criteria from the UI. There is at most one `e2e` task per slice.
- **backend** — present when the slice touches API endpoints, data models, or backend utilities. A slice may have multiple `backend` tasks (one per endpoint / model / utility cluster).
- **frontend** — present when the slice touches pages, components, or hooks. A slice may have multiple `frontend` tasks.

For each task, decide:

- **ID** — a stable local identifier of the form `<slice#>.<type-code>[.<index>]` where `type-code` is one of `e2e` / `be` / `fe`, and `index` is `1`, `2`, … when the slice has more than one task of that type. Examples: `1.e2e`, `1.be.1`, `1.be.2`, `1.fe.1`. The `e2e` task always uses the index-less form `<slice#>.e2e` since there is at most one. These IDs are used in the breakdown and quiz; they are replaced with real issue numbers (`#123`) during the post-creation passes.
- **Type** — `e2e` | `backend` | `frontend`.
- **Delivery** — what is being created/modified:
  - `e2e` → the E2E test cases to write.
  - `backend` → the API endpoints / data models / utilities to create or modify.
  - `frontend` → the pages / components / hooks to create or modify.
- **Done criteria** — how we know the task is finished:
  - `e2e` → E2E test cases cover every scenario in the parent issue's acceptance criteria.
  - `backend` → behavior described with EARS + Gherkin notation. Tasks involving a data-model change MUST also describe migration test scenarios for both upgrade and downgrade.
  - `frontend` → behavior described with EARS + Gherkin notation.
- **Blocked by** — list of task IDs (from the same slice, or from a prior slice) that must complete first. Two hard rules govern these dependencies:
  1. **E2E-first rule.** When a slice has an `e2e` task, **every `backend` and `frontend` task on that slice MUST list that slice's `e2e` task ID in its `Blocked by`.** The E2E test cases are written first; the implementation tasks are unblocked once the test scaffold exists. The `e2e` task itself is never blocked by sibling implementation tasks within the same slice.
  2. **Same-type chains.** Tasks of the same type within a slice can block each other (e.g. `1.be.2` blocked by `1.be.1` when one endpoint is a prerequisite for another), and `frontend` tasks may additionally be blocked by sibling `backend` task IDs when a UI piece needs the underlying API in place.

### 4. Quiz the user

Present the full breakdown as a numbered list of slices, with each slice's tasks shown beneath it. For each slice show: **Title**, **Has UI?**, **Blocked by**, **User stories covered**. For each task show: **Type**, **Delivery (one-line summary)**, **Blocked by**.

Then ask the user explicitly:

- Does the slice granularity feel right? (too coarse / too fine)
- Are the slice-level dependencies correct?
- Are the tasks per slice complete and correctly typed?
- Are the inter-task dependencies correct?
- Should any slices or tasks be merged, split, added, or removed?

Iterate. Re-present the updated breakdown each round. Do not move on until the user gives an explicit approval ("looks good", "ship it", "approved", etc.). Soft acknowledgments ("ok", "sure") don't count — confirm.

### 5. Create the issues

Once approved, create issues in this order. Defer to the `git-workflow` skill for the canonical `gh` invocations and label conventions throughout.

#### 5a. Create one parent issue per slice

Use `gh issue create` with `--milestone "<feature-name>"` (only when a `<feature-name>` was provided; for free-form sources, omit the milestone flag) and `--label "status:draft" --label "level:slice"`. Body follows the [Parent issue body template](#parent-issue-template).

- Title uses glossary vocabulary.
- The **Acceptance criteria** section is included **only when the slice has UI**, and only covers E2E behavior validatable from the UI. Use EARS notation, with non-trivial criteria expanded into 1+ Gherkin scenarios. RFC 2119 keywords (MUST, SHALL, SHOULD, MAY, MUST NOT, SHOULD NOT) appear in UPPERCASE in `Then` / `And` outcome lines. `Given` / `When` lines state facts and do not need RFC 2119 keywords.
- For backend-only / database-only slices (no UI), **omit the Acceptance criteria section entirely** from the parent issue — those criteria live on the typed task sub-issues instead.

#### 5b. Create task sub-issues per parent issue

For each parent issue, create one task issue per task with `--milestone "<feature-name>"` (when applicable) and `--label "status:draft" --label "level:task" --label "type:<type>"` where `<type>` is the task's type (`e2e` | `backend` | `frontend`). The type label replaces the in-body `## Type` section, so the templates below omit that section. Body follows the type-appropriate template:

- `e2e` → [E2E task body template](#e2e-task-template)
- `backend` → [Backend task body template](#backend-task-template)
- `frontend` → [Frontend task body template](#frontend-task-template)

#### 5c. Post-creation passes

Blocker references and parent links can only be filled in once every issue has a real number, so do these as a second pass. As issues are created in 5a/5b, keep a mapping table of `<task ID> → #<real issue number>` (e.g. `1.e2e → #142`, `1.be.1 → #143`, `1.be.2 → #144`, `1.fe.1 → #145`). Use that mapping to translate every `Blocked by` reference from the breakdown's task IDs into real issue numbers before editing.

1. **Update slice blockers.** Walk parent issues and edit each to link its blockers (e.g. `Blocked by #123`).
2. **Update task blockers.** Walk task sub-issues and edit each to link blockers among siblings, translating task IDs (`1.be.1`, etc.) into real issue numbers via the mapping. Verify the E2E-first rule: every `backend` / `frontend` sub-issue on a slice with an `e2e` task MUST list that `e2e` task's issue number as a blocker.
3. **Link tasks as sub-issues.** Set each task's parent to its corresponding slice's parent issue using GitHub's sub-issue mechanism via `gh` (route via `git-workflow`).

#### 5d. Promote issues from draft to ready

Once 5a–5c have completed cleanly (every parent + task issue has its blockers wired up and every task is linked to its parent), walk every issue created in this run and replace the `status:draft` label with `status:ready` (e.g. `gh issue edit <n> --remove-label "status:draft" --add-label "status:ready"`). This applies to both parent (slice) issues and task sub-issues. Do not promote partially — if any blocker / parent-link edit failed in 5c, fix it first, then promote.

Report the created parent issue + task sub-issue numbers/URLs back to the user as a final summary, grouped by slice.

## Pattern

### Vertical slices, not horizontal layers

Bad — horizontal split, none of these is independently shippable:

```
#1 Build the schema for <feature>
#2 Build the API for <feature>
#3 Build the UI for <feature>
#4 Write the tests for <feature>
```

Good — vertical tracer bullets, each merge leaves the product working:

```
#1 Show empty <feature> page behind a flag (parent issue)
   ├─ task: backend — stub GET endpoint returning empty list
   ├─ task: frontend — page shell behind feature flag
   └─ task: e2e — smoke test: page renders empty state
#2 Persist a single <entity> end-to-end (parent issue)
   ├─ task: backend — schema column + POST endpoint (incl. migration)
   ├─ task: frontend — create form + optimistic update
   └─ task: e2e — happy-path create + reload
```

### Iron rules

- **One parent GitHub issue per slice + one task sub-issue per task.** Issues are created with `gh issue create`. Titles are short, descriptive, and use glossary vocabulary.
- **Vertical slices only.** Each parent issue is a tracer bullet that cuts through every integration layer (schema, API, UI, tests) end-to-end. No horizontal "build the schema" / "build the API" splits at the slice level.
- **Tasks split a slice horizontally by type.** Within a single slice, tasks are typed (e2e/backend/frontend) — that horizontal split is fine because the slice as a whole is still vertical.
- **Release safe.** Each merged slice must leave the product in a working state. If a slice can't be merged independently without breaking the product, it's wrong — re-slice it (feature flags, no-op stubs, dark-launch, etc.).
- **Milestone-grouped.** When a `<feature-name>` is supplied, every parent issue and task sub-issue created MUST be set to `--milestone "<feature-name>"`.
- **Use the project's vocabulary.** Issue titles and descriptions must use terms from the project's domain glossary (if present). Respect ADRs in any area you touch.
- **Quiz before locking.** Never create issues until the user explicitly approves the slice + task breakdown.
- **Stable task IDs in the breakdown.** Every task has a local ID of the form `<slice#>.<type-code>[.<index>]` (`e2e` / `be` / `fe`). IDs are used in `Blocked by` references during steps 3–4 and are translated into real issue numbers in step 5c.
- **E2E-first rule.** When a slice has an `e2e` task, every `backend` and `frontend` task on that slice MUST list the `e2e` task as a blocker. E2E test scaffolding lands before implementation; implementation tasks become unblocked once the failing tests exist.
- **Acceptance criteria on the parent issue cover E2E/UI only.** Include the AC section on the parent issue **only when the slice has UI**, and scope it to behavior a user can validate from the UI. Backend/data-model behavior lives in the corresponding task's done criteria.
- **EARS + Gherkin for behavioral criteria.** Wherever EARS notation is used (parent-issue AC for UI slices, backend-task done criteria, frontend-task done criteria), non-trivial criteria add 1+ Gherkin scenarios with `Given` / `When` / `Then` steps. RFC 2119 keywords (MUST, SHALL, SHOULD, MAY, MUST NOT, SHOULD NOT) MUST appear in UPPERCASE in `Then` / `And` outcome lines. `Given` / `When` lines state facts and do not need RFC 2119 keywords.
- **Migration tests are mandatory for data-model tasks.** A backend task that changes a data model MUST include Gherkin scenarios for both upgrade and downgrade migrations in its done criteria.

### EARS notation cheat sheet

| Pattern | Form |
|---------|------|
| Ubiquitous | The `<system>` SHALL `<response>`. |
| Event-driven | WHEN `<trigger>`, the `<system>` SHALL `<response>`. |
| State-driven | WHILE `<state>`, the `<system>` SHALL `<response>`. |
| Unwanted behavior | IF `<condition>`, THEN the `<system>` SHALL `<response>`. |
| Optional feature | WHERE `<feature is included>`, the `<system>` SHALL `<response>`. |

## Templates

### Slice + task breakdown (presented to user during step 4)

```markdown
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
```

### Parent issue template

Used in step 5a. The **Acceptance criteria** block is included only when the slice has UI; omit it entirely for backend-only / database-only slices.

````markdown
## Context
<1–3 sentence summary tying this slice to the source requirement / PRD. Use glossary vocabulary.>

## User stories covered
- <story id / quoted line> — <short paraphrase>
<!-- omit this section entirely if the source has no user stories -->

## Scope
**In scope**
- <bullet>
- <bullet>

**Out of scope**
- <bullet>

<!-- INCLUDE the Acceptance criteria section ONLY when the slice has UI. -->
<!-- Scope: behavior a user can validate from the UI (E2E). -->
## Acceptance criteria (EARS)
- AC1 — The `<system>` SHALL `<response>`.
- AC2 — WHEN `<trigger>`, the `<system>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact>
  And <fact>
  When <trigger>
  Then the <system> MUST <response>
  And it SHOULD <secondary response>
```

## Dependencies
- Blocked by: #<issue> <!-- filled in during the post-creation slice-blocker pass -->

## Notes
<Any relevant ADRs, glossary terms, feature-flag names, or rollout caveats.>
````

### E2E task template

Used in step 5b for tasks of type `e2e`. The task's type is carried by the `type:e2e` label set in step 5b — do not duplicate it in the body.

```markdown
## Delivery
E2E test cases to write (each maps to an AC / Gherkin scenario on the parent issue):
- <test case 1>
- <test case 2>
- <test case 3>

## Done criteria
We have written E2E test cases that cover every scenario in the parent issue's acceptance criteria.

## Dependencies
- Blocked by: #<task> <!-- filled in during the post-creation task-blocker pass -->
```

### Backend task template

Used in step 5b for tasks of type `backend`. The task's type is carried by the `type:backend` label set in step 5b — do not duplicate it in the body. When the task changes a data model, the **Migration scenarios** block is mandatory.

````markdown
## Delivery
What is being created or modified:
- API endpoint: `POST /<resource>` — <purpose>
- Data model: `<Entity>` — <columns / relations added or changed>
- Utility: `<fn>` — <purpose>

## Done criteria (EARS)
- AC1 — The `<service>` SHALL `<response>`.
- AC2 — WHEN `<trigger>`, the `<service>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<service>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact about request / state>
  When <trigger>
  Then the <service> MUST <response>
  And it SHOULD <secondary response>
```

<!-- INCLUDE this Migration scenarios block ONLY when this task changes a data model. -->
### Migration scenarios (Gherkin)
```gherkin
Scenario: upgrade migration applies cleanly
  Given the database is at the previous schema version
  When the upgrade migration runs
  Then the schema MUST match the new version
  And existing rows MUST NOT be lost or corrupted

Scenario: downgrade migration reverts cleanly
  Given the database is at the new schema version
  When the downgrade migration runs
  Then the schema MUST match the previous version
  And rollback-relevant data MUST NOT be lost
```

## Dependencies
- Blocked by: #<task> <!-- filled in during the post-creation task-blocker pass -->
````

### Frontend task template

Used in step 5b for tasks of type `frontend`. The task's type is carried by the `type:frontend` label set in step 5b — do not duplicate it in the body.

````markdown
## Delivery
What is being created or modified:
- Page: `<path/to/page>` — <purpose>
- Component: `<ComponentName>` — <purpose>
- Hook: `use<Thing>` — <purpose>

## Done criteria (EARS)
- AC1 — The `<component>` SHALL `<response>`.
- AC2 — WHEN `<user action>`, the `<component>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<component>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact about UI state>
  When <user action>
  Then the <component> MUST <response>
  And it SHOULD <secondary response>
```

## Dependencies
- Blocked by: #<task> <!-- filled in during the post-creation task-blocker pass -->
````
