---
name: create-issues
description: "Decompose a locked-in feature's PRD into release-safe vertical-slice GitHub issues, each split into sequential typed task sub-issues (e2e → backend → frontend). Always invoked with a `<feature-name>` pointing at `docs/PRDs/<feature-name>/`; no free-form mode. Verifies the merged `feature-lockin` PR on the milestone, reads the PRD pair, `docs/CRITICALPATHs/` (drives E2E user flows), `docs/GLOSSARY.md`, and `docs/ADRs/`; quizzes the user on a slice + task breakdown; on approval opens each slice issue + `feature/<slice#>-<intent>` branch via `gh issue develop` plus typed task sub-issues with 1-up `Blocked by` chains, grouped under the feature milestone. Activate on 'create issues for <feature-name>', 'turn this PRD into issues', 'slice this feature', 'open issues for <feature-name>'; verbs (create, scaffold, slice, break down, decompose) + nouns (issue, ticket, slice, backlog). Do NOT activate without a `<feature-name>`, for one-off issues, or PRD authoring."
---

# create-issues

Turn a locked-in feature into a set of release-safe **vertical slice** GitHub issues, each broken down into typed **task sub-issues** (e2e / backend / frontend). The skill is always invoked with a `<feature-name>` that points at `docs/PRDs/<feature-name>/` — there is no free-form / ad-hoc input path. It decomposes the work, quizzes the user for explicit approval, then creates the parent issue + task sub-issues per slice.

## When to activate

Activate this skill whenever the user:

- Asks to "create issues", "open issues", "scaffold tickets", or "generate the backlog" for a feature.
- Hands over a `<feature-name>` and asks for issues — interpret as "read the PRD under `docs/PRDs/<feature-name>/` and slice it".
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
  - `docs/PRDs/<feature-name>/requirement.md`
  - `docs/PRDs/<feature-name>/implement-detail.md`

  Read the on-disk copies. The merged `feature-lockin` PR (verified in Step 1) is what guarantees these files are present and current — do not re-check, and do not fall back to a different ref or a free-form description if a read returns empty. If a file genuinely fails to read, that's a lock-in contract violation: halt and surface, do not invent context. Note any user stories present in the source — they will be carried into the slice breakdown.

- **Critical paths (mandatory).** List `docs/CRITICALPATHs/` and read every critical-path file whose entry point, steps, or summary touches the surface this feature is changing. Critical paths are organized by user flow, not by feature, so a single feature can touch one, several, or zero of them — list first, then decide which to read.

  ```bash
  ls docs/CRITICALPATHs/
  ```

  Critical paths are the **primary input for designing E2E test cases**: each `e2e` task in step 3 should map its UI user flows onto an existing critical-path flow when one exists, and extend rather than fragment that flow. If the feature introduces a brand-new critical path, flag it — that's typically a sign that `/deep-dive-feature` should have produced one and the lock-in is incomplete.

- **Glossary (mandatory if present).** Read `docs/GLOSSARY.md` (and `knowledges/GLOSSARY.md` if it exists). Slice titles and issue bodies MUST use glossary vocabulary verbatim — no synonyms, no rephrasings.

- **ADRs (when relevant).** Scan `docs/ADRs/` and read any ADR that touches the affected areas. Respect every ADR decision; if a slice would contradict one, halt and surface it before quizzing the user.

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
  - `e2e` → the E2E test cases to write, **expressed as user flows through the UI** (e.g. "user navigates to /entities, clicks 'New', fills the form, submits, then sees the new row in the list"). E2E validates behavior end-to-end via the UI — never as direct API calls or backend assertions.
  - `backend` → the API endpoints / data models / utilities to create or modify.
  - `frontend` → the pages / components / hooks to create or modify.
- **Done criteria** — how we know the task is finished:
  - `e2e` → E2E test cases cover every scenario in the parent issue's acceptance criteria, exercised through the UI.
  - `backend` → behavior described with EARS + Gherkin notation. Tasks involving a data-model change MUST also describe migration test scenarios for both upgrade and downgrade.
  - `frontend` → behavior described with EARS + Gherkin notation.
- **Blocked by** — task IDs that must complete first. Tasks within a slice are implemented **strictly sequentially** — pick exactly one same-slice predecessor (the immediately preceding task in the slice's order), or none for the first task. The order within a slice is:
  1. The slice's `e2e` task (when present) ALWAYS comes first.
  2. Then `backend` tasks in index order (`be.1` → `be.2` → …).
  3. Then `frontend` tasks in index order (`fe.1` → `fe.2` → …).
  
  Example for a slice with all four kinds: `1.e2e` ← `1.be.1` ← `1.be.2` ← `1.fe.1` (each task lists only the one immediately to its left as `Blocked by`). Cross-slice blockers (a task that genuinely depends on a task in a prior slice) are still allowed when truly required, but should be rare — most cross-slice dependencies are already captured at the slice level.

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

**Dependency rule (1-up only).** When the breakdown has a chain `s1 → s2 → s3`, only mark `s3` `Blocked by s2` and `s2` `Blocked by s1`. Do **not** also mark `s3` `Blocked by s1` — transitive blockers are inferred by GitHub. The same rule applies to the sequential task chain within a slice (`1.e2e → 1.be.1 → 1.be.2 → 1.fe.1`): each task lists only its immediate predecessor in the chain as `Blocked by`, never an ancestor further back.

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
- After creation, record the mapping `<slice#> → #<real issue number>`.
- **Create the slice's development branch immediately**, so downstream task sub-issues have a target branch from birth. Use `gh issue develop`, which creates the branch off the current `origin/main` AND records the GitHub-native development link on the issue (no local checkout, no `git push`):

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

  Naming guidance: do NOT mechanically slugify the issue title. Choose an intent phrase that's short, reads as a noun-phrase summary of the slice's behavioral change, uses glossary vocabulary, and stays meaningful when seen in isolation (`git branch`, PR list, CI logs). Avoid filler verbs ("add", "implement"), tense markers, and stop-words. If `gh issue develop` reports "a branch already exists for this issue" (e.g. a concurrent run got there first), treat it as benign and continue.
- **Wire 1-up `Blocked by` immediately**, before moving to the next slice. If this slice's breakdown lists an upstream slice as its blocker, run:

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

  Only the **immediate** upstream — never transitive ancestors.

#### 5b. Create task issues (sub-issues) per slice

For each slice's tasks, in the slice's sequential order (`e2e` first when present, then `backend` tasks in index order, then `frontend` tasks in index order):

```bash
gh issue create \
  --title "<task title>" \
  --body-file <task-body.md> \
  --milestone "<feature-name>" \
  --label "level:task" \
  --label "kind:feature" \
  --label "type:<e2e|backend|frontend>"
```

Note: task issues are created **without** a `status:*` label. The `status:ready-to-review` gate exists at the slice level for human design approval; tasks are released the moment their slice is unblocked and their own `Blocked by` chain clears, so a status label on tasks would just be dead weight.

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

2. **Attach the slice's development branch to the task issue.** The slice branch created in 5a (`feature/<slice#>-<intent>`) is the single integration target for every task in the slice — task work commits onto it, not onto per-task branches. Linking it on the task issue surfaces that target in the GitHub UI ("Development" sidebar) and tooling. Use `gh issue develop` with the **existing** branch name, which links rather than creates:

   ```bash
   # ${branch} is the same feature/<slice#>-<intent> created in 5a for this slice.
   gh issue develop "<task-#>" --branch-repo "${repo_slug}" --name "${branch}"
   ```

   Every task sub-issue under the slice gets the same branch attached. If `gh issue develop` reports that a branch by that name already exists (it will — 5a just created it), that's the intended path: it links the existing branch to the task issue and exits cleanly.

3. **Wire 1-up `Blocked by` immediately**, using the same GraphQL `addBlockedBy` mutation shown in 5a. Per the sequential rule, every task except the first in its slice has exactly one same-slice blocker — the immediately preceding task in the slice's order (`e2e` → `be.1` → `be.2` → … → `fe.1` → `fe.2` → …). Translate every local task ID (`1.be.1`, etc.) into a real issue number via the mapping before issuing the API call.

   Cross-slice task blockers are allowed when truly required, but again only the immediate predecessor — never transitive ancestors.

#### 5c. Final summary

Report the created parent issue + task sub-issue numbers/URLs back to the user, grouped by slice, and include the linked development branch name for each slice. Slice issues are in `status:ready-to-review` — the human is expected to review and (per the flow spec) flip them to `status:ready-to-implement` to release them to the loops. Task sub-issues carry no `status:*` label; they're released automatically when the slice is unblocked and their own `Blocked by` chain clears.

## Pattern

### Vertical slices, not horizontal layers

Bad — horizontal split, none of these is independently shippable:

```
#1 Build the schema for <feature>
#2 Build the API for <feature>
#3 Build the UI for <feature>
#4 Write the tests for <feature>
```

Good — vertical tracer bullets, each merge leaves the product working. Tasks within a slice form a single sequential chain (`e2e` first, then `backend`, then `frontend`):

```
#1 Show empty <feature> page behind a flag (parent issue)
   1. task: e2e — UI smoke flow: navigate to page behind flag, see empty state
   2. task: backend — stub GET endpoint returning empty list   (blocked by 1)
   3. task: frontend — page shell behind feature flag           (blocked by 2)
#2 Persist a single <entity> end-to-end (parent issue)
   1. task: e2e — UI flow: open create form, submit, see new <entity> in list
   2. task: backend — schema column + POST endpoint (incl. migration) (blocked by 1)
   3. task: frontend — create form + optimistic update          (blocked by 2)
```

### Iron rules

- **One parent GitHub issue per slice + one task sub-issue per task.** Issues are created with `gh issue create`. Titles are short, descriptive, and use glossary vocabulary.
- **Vertical slices only.** Each parent issue is a tracer bullet that cuts through every integration layer (schema, API, UI, tests) end-to-end. No horizontal "build the schema" / "build the API" splits at the slice level.
- **Tasks split a slice horizontally by type.** Within a single slice, tasks are typed (e2e/backend/frontend) — that horizontal split is fine because the slice as a whole is still vertical.
- **Release safe.** Each merged slice must leave the product in a working state. If a slice can't be merged independently without breaking the product, it's wrong — re-slice it (feature flags, no-op stubs, dark-launch, etc.).
- **Milestone-grouped.** Every parent issue and task sub-issue created MUST be set to `--milestone "<feature-name>"`. The skill always runs against a locked-in feature, so the milestone is never optional.
- **Use the project's vocabulary.** Issue titles and descriptions must use terms from the project's domain glossary verbatim — no synonyms, no rephrasings. Respect ADRs in any area you touch.
- **Critical paths drive E2E design.** `e2e` task user-flow deliveries are mapped onto an existing `docs/CRITICALPATHs/` flow when one exists, and extend rather than fragment that flow. A feature that introduces a brand-new critical path means lock-in is incomplete — halt and surface, do not invent the critical path inside an issue body.
- **Quiz before locking.** Never create issues until the user explicitly approves the slice + task breakdown.
- **Stable task IDs in the breakdown.** Every task has a local ID of the form `<slice#>.<type-code>[.<index>]` (`e2e` / `be` / `fe`). IDs are used in `Blocked by` references during steps 3–4 and are translated into real issue numbers as each issue is created in step 5.
- **1-up `Blocked by` only.** For chains `s1 → s2 → s3` (or `1.e2e → 1.be.1 → 1.be.2`), record only the immediate predecessor as the blocker. Never include transitive ancestors — GitHub infers them.
- **Sequential tasks within a slice.** Tasks within a slice are implemented one at a time, in a single chain. Order: `e2e` (when present) → `backend` tasks in index order → `frontend` tasks in index order. Each task lists exactly the immediately preceding task in that chain as its same-slice blocker (or none, for the first task).
- **Slice branch is created at issue-creation time.** Step 5a opens the slice issue and immediately creates its `feature/<slice#>-<intent>` branch via `gh issue develop`. The slice is born ready for downstream task work — there is no separate "pickup slice" loop that materializes branches afterwards.
- **Task sub-issues share the slice branch.** Every task sub-issue created in 5b has the slice's `feature/<slice#>-<intent>` branch (from 5a) linked to it via `gh issue develop --name`. There is no per-task branch — all task work for a slice integrates onto the single slice branch, and the GitHub "Development" link on each task surfaces that shared target.
- **Branch intent name is hand-picked, not auto-slugged.** The `<intent>` segment is a short kebab-case noun-phrase (≤40 chars) that conveys what the slice does, chosen during step 5a. Do NOT mechanically slugify the issue title — titles are written for humans scanning a list, branch names need to read well in isolation.
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
