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

Do NOT activate when the user is asking for a single one-off issue with no decomposition needed, when they want to update an existing issue, or when they are asking for a roadmap/PRD instead of issues.

## Workflow

### 1. Verify feature lock-in (when `<feature-name>` is provided)

When the user supplies a `<feature-name>`, the feature must be **locked in** before any issues are created. Lock-in has two markers, both produced by `/deep-dive-feature` (see `commands/deep-dive-feature.md`):

1. A GitHub **milestone** whose title matches `<feature-name>`.
2. A **merged PR labeled `feature-lockin`** on that milestone. (PR title is human-readable — do **not** match by title.)

Check both via `gh`:

```bash
# 1. Milestone exists?
gh api repos/:owner/:repo/milestones \
  --jq ".[] | select(.title == \"<feature-name>\") | {number, title, state}"

# 2. Lock-in PR merged on that milestone?
gh pr list \
  --label "feature-lockin" \
  --milestone "<feature-name>" \
  --state all \
  --json number,title,state,mergedAt,url
```

Decide based on the combined result:

- **Milestone missing** → the feature has not been initialized. **STOP.** Surface to the user and ask how to proceed (e.g. run `/deep-dive-feature <feature-name>` first, or correct the feature name).
- **Milestone exists but no `feature-lockin` PR** → the lock-in PR was never opened. **STOP.** Surface to the user.
- **Lock-in PR exists but `mergedAt` is null** (open or closed-without-merge) → still in review or rejected. **STOP.** Surface the PR URL and ask the user how to proceed.
- **Milestone exists AND lock-in PR is merged** → proceed to Step 2.

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

Present the full breakdown using [`templates/slice-task-breakdown.md`](templates/slice-task-breakdown.md) as the format reference: a numbered list of slices, with each slice's tasks shown beneath it. For each slice show: **Title**, **Has UI?**, **Blocked by**, **User stories covered**. For each task show: **Type**, **Delivery (one-line summary)**, **Blocked by**.

Then ask the user explicitly:

- Does the slice granularity feel right? (too coarse / too fine)
- Are the slice-level dependencies correct?
- Are the tasks per slice complete and correctly typed?
- Are the inter-task dependencies correct?
- Should any slices or tasks be merged, split, added, or removed?

Iterate. Re-present the updated breakdown each round. Do not move on until the user gives an explicit approval ("looks good", "ship it", "approved", etc.). Soft acknowledgments ("ok", "sure") don't count — confirm.

### 5. Create the issues

Once approved, create issues in this order using the inline `gh` commands shown — do **not** delegate to the `git-workflow` skill. Throughout, keep a running mapping `<local task ID> → #<real issue number>` so dependency references can be translated as we go (e.g. `1.e2e → #142`, `1.be.1 → #143`, `2 → #150`).

**Dependency rule (1-up only).** When the breakdown has a chain `s1 → s2 → s3`, only mark `s3` `Blocked by s2` and `s2` `Blocked by s1`. Do **not** also mark `s3` `Blocked by s1` — transitive blockers are inferred by GitHub. Same rule applies to task chains within a slice (`t3.1 → t3.2 → t3.3`: only `t3.3 Blocked by t3.2` and `t3.2 Blocked by t3.1`). The E2E-first rule is independent of this and still applies: every `backend` / `frontend` task on a UI slice lists the slice's `e2e` task as a blocker (and that `e2e` link counts as the task's 1-up blocker — additional same-type predecessors stack only when the chain truly requires it).

#### 5a. Create slice issues (parent issues)

For each slice, in dependency order (slices with no blockers first, then slices whose blockers are already created):

```bash
gh issue create \
  --title "<slice title using glossary vocabulary>" \
  --body-file <slice-body.md> \
  --milestone "<feature-name>" \
  --label "level:slice" \
  --label "kind:feature" \
  --label "status:ready-to-review"
```

Notes:
- **Body** follows [`templates/parent-issue-body.md`](templates/parent-issue-body.md). The **Acceptance criteria** section is included **only when the slice has UI** (E2E-validatable behavior, EARS + Gherkin); omit it entirely for backend-only / database-only slices — those criteria live on the typed task sub-issues.
- **Milestone** is omitted only when the user supplied a free-form requirement instead of a `<feature-name>`.
- **`kind`** is `kind:feature` here (this skill produces the feature path); for the bug/enhancement fast-track described in the flow spec, the human creates a single issue manually with `kind:bug` or `kind:enhancement`.
- After creation, record the mapping `<slice#> → #<real issue number>`.
- **Wire 1-up `Blocked by` immediately**, before moving to the next slice. If this slice's breakdown lists an upstream slice as its blocker, run:

  ```bash
  gh issue edit <this-slice-#> --add-blocked-by-issue <upstream-slice-#>
  ```

  If your `gh` version lacks `--add-blocked-by-issue`, use the GraphQL fallback:

  ```bash
  gh api graphql -f query='
    mutation($issue: ID!, $blocker: ID!) {
      addIssueDependency(input: {issueId: $issue, blockingIssueId: $blocker}) {
        issue { number }
      }
    }
  ' -f issue=<this-slice-node-id> -f blocker=<upstream-slice-node-id>
  ```

  Only the **immediate** upstream — never transitive ancestors.

#### 5b. Create task issues (sub-issues) per slice

For each slice's tasks, in dependency order within the slice (E2E task first when present, then unblocked tasks, etc.):

```bash
gh issue create \
  --title "<task title>" \
  --body-file <task-body.md> \
  --milestone "<feature-name>" \
  --label "level:task" \
  --label "type:<e2e|backend|frontend>" \
  --label "status:ready-to-review"
```

Body follows the type-appropriate template ([`templates/e2e-task-body.md`](templates/e2e-task-body.md) / [`templates/backend-task-body.md`](templates/backend-task-body.md) / [`templates/frontend-task-body.md`](templates/frontend-task-body.md)). Type is carried by the `type:*` label — do not duplicate inside the body.

After creation:

1. **Link the task to its parent slice as a sub-issue.** GitHub's sub-issue API requires the parent's and child's numeric **node IDs** (not issue numbers):

   ```bash
   parent_id=$(gh api repos/:owner/:repo/issues/<slice-#> --jq .node_id)
   child_id=$(gh api repos/:owner/:repo/issues/<task-#>  --jq .node_id)
   gh api graphql -f query='
     mutation($parent: ID!, $child: ID!) {
       addSubIssue(input: {issueId: $parent, subIssueId: $child}) { issue { number } }
     }
   ' -f parent=$parent_id -f child=$child_id
   ```

2. **Wire 1-up `Blocked by` immediately**, using the same `gh issue edit --add-blocked-by-issue` (or GraphQL fallback) shown in 5a. For tasks, the immediate blocker(s) are:
   - The slice's `e2e` task (E2E-first rule), if the task is `backend` or `frontend` and the slice has an `e2e` task.
   - The immediate predecessor in any same-type chain (e.g. for `t3.1 → t3.2 → t3.3`, mark `t3.3 Blocked by t3.2` only — never also `t3.3 Blocked by t3.1`).
   - A sibling `backend` task ID when a `frontend` task needs that backend in place.

   Translate every local task ID (`1.be.1`, etc.) into a real issue number via the mapping before issuing the API call. Skip transitive ancestors.

#### 5c. Final summary

Report the created parent issue + task sub-issue numbers/URLs back to the user, grouped by slice. Issues are already in `status:ready-to-review` — the human is expected to review and (per the flow spec) flip them to `status:ready-to-implement` to release them to the loops.

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
- **Stable task IDs in the breakdown.** Every task has a local ID of the form `<slice#>.<type-code>[.<index>]` (`e2e` / `be` / `fe`). IDs are used in `Blocked by` references during steps 3–4 and are translated into real issue numbers as each issue is created in step 5.
- **1-up `Blocked by` only.** For chains `s1 → s2 → s3` (or `t3.1 → t3.2 → t3.3`), record only the immediate predecessor as the blocker. Never include transitive ancestors — GitHub infers them.
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

Templates are stored as separate files under `templates/` so they can be edited and `cat`-loaded as `--body-file` payloads without round-tripping through the SKILL.md prose. Read the relevant file before drafting each artifact; copy it to a scratch file, fill in the `<…>` placeholders, then pass it to `gh issue create --body-file <scratch>`.

| Template file | Used in | Purpose |
|---------------|---------|---------|
| [`templates/slice-task-breakdown.md`](templates/slice-task-breakdown.md) | step 4 | Quiz format presented to the user for explicit approval of the slice + task breakdown. |
| [`templates/parent-issue-body.md`](templates/parent-issue-body.md) | step 5a | Body for each slice (parent) issue. Include the Acceptance criteria section only when the slice has UI. |
| [`templates/e2e-task-body.md`](templates/e2e-task-body.md) | step 5b | Body for each `e2e` task sub-issue. Type is carried by the `type:e2e` label, not the body. |
| [`templates/backend-task-body.md`](templates/backend-task-body.md) | step 5b | Body for each `backend` task sub-issue. Migration scenarios block is mandatory when the task changes a data model. |
| [`templates/frontend-task-body.md`](templates/frontend-task-body.md) | step 5b | Body for each `frontend` task sub-issue. |
