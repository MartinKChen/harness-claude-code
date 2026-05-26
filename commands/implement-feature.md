---
description: Drive one end-to-end pass through the slice → task → review → fix → close → PR → merge lifecycle for a single feature milestone. Dispatch the `task-finder` agent once to identify every eligible candidate across the nine lifecycle stages, then perform the per-stage label flips + `TaskCreate` + `Agent` dispatch (or merge + memory capture) directly. Within a stage, candidates fan out in parallel; across stages, processing is sequential. Each pass is a snapshot — wrap with `/loop /implement-feature <feature-name>` to keep advancing the milestone end-to-end as backgrounded agents finish.
argument-hint: <feature-name>
---

# implement-feature

Run one full sweep across the lifecycle stages, in order, for a single feature milestone.

- **Discovery** is owned by the `task-finder` agent (read-only, single dispatch).
- **Every state mutation** — label flips, `TaskCreate`, `Agent` dispatch, `TaskUpdate(owner)` assignment, draft → ready promotion, squash-merge, per-slice memory signal — is owned by this command.

The nine `workflow-task-finder-*` skills are pure discovery and emit eligible-candidate lists only; they never flip labels, never dispatch agents, never merge PRs.

This command does **not** wait for backgrounded sub-agents to finish. Once an agent is dispatched, the command moves on. Wrap with `/loop /implement-feature <feature-name>` to keep advancing.

## Arguments

Exactly one positional argument: `<feature-name>` — the GitHub milestone name created by `/deep-dive-feature` and used by `create-issues` to group every slice / task issue and inherited by every slice PR.

If `<feature-name>` is missing or empty, stop and ask the user for it before dispatching anything.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### Step 1 — Dispatch `task-finder` (foreground, single shot)

Dispatch `task-finder` **once**, foreground, with `<feature-name>` so its report is available before any mutation:

```
Agent({
  subagent_type: "task-finder",
  mode: "auto",
  name: "task-finder-<feature-name>",
  prompt: "Find lifecycle candidates for GitHub milestone \"<feature-name>\". Invoke every workflow-task-finder-* skill in order against a single snapshot of current GitHub state. Read-only — do not flip labels, do not create tasks, do not dispatch agents. Emit your report in the canonical shape so the dispatcher can parse it positionally."
})
```

The agent returns ONE markdown report covering all nine stages. Parse positionally:

- Each stage section is `## Stage <N>: <stage-name>` followed by one or more `- ...` lines.
- Every listed candidate is ELIGIBLE — `task-finder` and its delegated skills drop ineligible candidates silently.
- Pipe-delimited fields per candidate are positional (see `agents/task-finder.md` § Report shape and the corresponding `workflow-task-finder-*` skill for field order).
- A stage whose only line is `- (none)` has no work this pass.

If `task-finder` surfaces a diagnostic (`milestone not found`, `skill failure`, etc.) instead of a report, surface that verbatim and stop. Do not improvise.

### Step 2 — Process the report, stage by stage

Process the nine stages **in order** (cross-stage cascade *within* a pass is not preserved — the snapshot is frozen at `task-finder` time; the `/loop` wrapper carries it across passes). Within each stage, eligible candidates **fan out in parallel** — emit all per-candidate `Agent` + `TaskUpdate(owner)` calls together in one batched response.

If a stage's candidate list is `- (none)`, log `Stage <N> (<stage-name>): nothing to pick up` and move on.

Use the `operation-git` skill's `gh-commands` reference and `dispatch-prompt` template as the source of truth for query / mutation shapes.

---

#### Stage 1 — `kickoff-slice` (label-only; no agent dispatch)

For each eligible slice `#<slice-#>` (line format: `- #<slice-#> | "<title>"`):

1. Flip the slice itself: `gh issue edit <slice-#> --remove-label "status:ready-to-implement" --add-label "status:in-progress"`.
2. Pull the slice's sub-issues via GraphQL (`repository.issue.subIssues.nodes`), filter to nodes carrying both `level:task` and `kind:feature`, and for each, `gh issue edit <sub-issue-#> --add-label "status:ready-to-implement"`.

No `TaskCreate`, no `Agent`. If a label add is a no-op because the label is already present, that's benign. Any other failure → surface verbatim and stop further candidates for this stage.

---

#### Stage 2 — `implement-task` (lock + `TaskCreate` + `Agent`)

For each eligible task (line format: `- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<title>"`):

1. **Lock**: `gh issue edit <task-#> --remove-label "status:ready-to-implement" --add-label "status:in-progress"`. On `422` (label already removed by a concurrent fire) treat as benign and skip; anything else → surface and stop.
2. **TaskCreate** (capture `taskId`):
   ```
   subject:     Implement #<task-#>: <task-title>
   description: <task-url>. Dispatching <subagent_type> to implement.
                Agent owns the lifecycle until it pushes and adds review:pending.
   activeForm:  Implementing #<task-#>
   ```
3. **`Agent` + `TaskUpdate(owner)` in the same batched response**:
   - `subagent_type`: `<subagent_type>` (from report)
   - `mode`: `auto`
   - `name`: `<subagent_type>-implement-<task-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Implement / author a task" skeleton from `operation-git/templates/dispatch-prompt.md` with `<task-#>`
   - Pair with `TaskUpdate({ taskId, owner: "<subagent_type>-implement-<task-#>" })` in the same batched response.

Roll back on synchronous dispatch failure: restore `status:ready-to-implement` AND `TaskUpdate({ taskId, status: "deleted" })`. Do NOT roll back on internal agent failure — once backgrounded, the agent owns the lifecycle.

---

#### Stage 3 — `review-task` (lock + `TaskCreate` + `Agent`)

For each eligible task (line format: `- #<task-#> | "<title>"`):

1. **Lock**: `gh issue edit <task-#> --remove-label "review:pending" --add-label "review:running"`.
2. **TaskCreate**:
   ```
   subject:     Review #<task-#>: <task-title>
   description: <task-url>. Dispatching reviewer to grade the task.
                Agent owns the lifecycle until it posts a verdict and flips
                review:running to passed or need-fix.
   activeForm:  Reviewing #<task-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `reviewer`
   - `mode`: `auto`
   - `name`: `reviewer-review-task-<task-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Review a task or slice" skeleton with `task` and `<task-#>`

Roll back lock + tracking task on synchronous dispatch failure.

---

#### Stage 4 — `fix-task` (strip-label lock + `TaskCreate` + `Agent`)

For each eligible task (line format: `- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<title>"`):

1. **Lock** by stripping the gate label: `gh issue edit <task-#> --remove-label "review:need-fix"`. The absence of any `review:*` label marks the task as "agent owns it".
2. **TaskCreate**:
   ```
   subject:     Fix #<task-#>: <task-title>
   description: <task-url>. Dispatching <subagent_type> to address reviewer findings.
                Agent owns the lifecycle until it pushes and re-adds review:pending.
   activeForm:  Fixing #<task-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `<subagent_type>`
   - `mode`: `auto`
   - `name`: `<subagent_type>-fix-task-<task-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Fix reviewer findings on a task" skeleton with `<task-#>`

Roll back on synchronous dispatch failure by re-adding `review:need-fix` and deleting the tracking task.

---

#### Stage 5 — `prepare-slice` (lock `e2e:running` + `TaskCreate` + `Agent`)

For each eligible slice (line format: `- #<slice-#> | "<title>"`):

1. **Lock**: `gh issue edit <slice-#> --add-label "e2e:running"`. If already present (race), benign skip.
2. **TaskCreate**:
   ```
   subject:     E2E-validate slice #<slice-#>: <slice-title>
   description: <slice-url>. Dispatching engineer to run the slice's E2E
                specs against a real stack via testcontainers.
                On pass: engineer removes e2e:running and adds review:pending.
                On test-case constraint: engineer flips to status:need-attention.
   activeForm:  E2E-validating slice #<slice-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `engineer`
   - `mode`: `auto`
   - `name`: `engineer-e2e-<slice-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Validate E2E test cases on a slice" skeleton with `<slice-#>`

Roll back on dispatch failure by removing `e2e:running` and deleting the tracking task.

---

#### Stage 6 — `review-slice` (lock + `TaskCreate` + `Agent`)

For each eligible slice (line format: `- #<slice-#> | "<title>"`):

1. **Lock**: `gh issue edit <slice-#> --remove-label "review:pending" --add-label "review:running"`.
2. **TaskCreate**:
   ```
   subject:     Review slice #<slice-#>: <slice-title>
   description: <slice-url>. Dispatching reviewer to grade the slice.
                On pass the reviewer creates the draft PR (merge:manual).
                On fail it flips review:running → review:need-fix.
   activeForm:  Reviewing slice #<slice-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `reviewer`
   - `mode`: `auto`
   - `name`: `reviewer-review-slice-<slice-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Review a task or slice" skeleton with `slice` and `<slice-#>`

Roll back lock + tracking task on synchronous failure.

---

#### Stage 7 — `fix-slice` (strip-label lock + `TaskCreate` + `Agent`)

For each eligible slice (line format: `- #<slice-#> | "<title>"`):

1. **Lock** by stripping the gate label: `gh issue edit <slice-#> --remove-label "review:need-fix"`.
2. **TaskCreate**:
   ```
   subject:     Fix slice #<slice-#>: <slice-title>
   description: <slice-url>. Dispatching engineer to address slice-level
                reviewer findings. Agent owns the lifecycle until it pushes
                and re-adds review:pending to the slice.
   activeForm:  Fixing slice #<slice-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `engineer`
   - `mode`: `auto`
   - `name`: `engineer-fix-slice-<slice-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Fix reviewer findings on a slice (engineer re-runs E2E after the fix)" skeleton with `<slice-#>`

Roll back on dispatch failure by restoring `review:need-fix` and deleting the tracking task.

---

#### Stage 8 — `fix-pr` (lock + `TaskCreate` + `Agent`)

For each eligible draft PR (line format: `- PR #<pr-#> | "<title>"`):

1. **Lock**: `gh pr edit <pr-#> --add-label "status:fix-in-progress"`.
2. **TaskCreate**:
   ```
   subject:     Fix PR #<pr-#>: <pr-title>
   description: <pr-url>. Engineer determines fix scope (conflict/CI/both)
                from live PR state. Agent owns the lifecycle until it pushes
                and removes status:fix-in-progress from the PR.
   activeForm:  Fixing PR #<pr-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `engineer`
   - `mode`: `auto`
   - `name`: `engineer-fix-pr-<pr-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Fix a PR" skeleton with `<pr-#>`

Roll back on dispatch failure by removing `status:fix-in-progress` and deleting the tracking task.

---

#### Stage 9 — `close-pr` (sequential, no agent dispatch; includes per-slice memory capture)

Process PRs **sequentially** — concurrent `gh pr merge` calls race on the base branch.

For each eligible draft PR (line format: `- PR #<pr-#> | slice:<slice-#> | "<title>"`):

1. **Defense-in-depth re-check** against live state: `gh pr view <pr-#> --json mergeable,statusCheckRollup`. If `mergeable != "MERGEABLE"` OR any rollup state is not SUCCESS / NEUTRAL / SKIPPED → skip (`merge race / no longer eligible`).
2. **Promote draft → ready**: `gh pr ready <pr-#>`.
3. **Squash-merge with branch deletion**: `gh pr merge <pr-#> --squash --delete-branch`. Slice closure happens automatically via the PR body's `Closes #<slice-#>` line (filled in by `workflow-reviewer-review-slice` when the draft was created).
4. **On merge race** (GitHub recomputed mergeability between step 1 and 3): undo the ready promotion with `gh pr ready <pr-#> --undo` and skip.
5. **Per-slice memory signal (post-merge, fire-and-forget).** After a successful merge, write the slice's lifetime churn summary if the consuming project has opted into memory by creating `.claude/memory/`:

   ```bash
   MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
   MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
   if [ -d "$MEMORY_ROOT" ]; then
     mkdir -p "$MEMORY_ROOT/signals/cycles"
     # ... write the summary file (see below) ...
   fi
   ```

   Read `slice:<slice-#>` from the `task-finder` line for this PR. Resolve the slice's task sub-issues via GraphQL. Compose `$MEMORY_ROOT/signals/cycles/slice-<slice-#>.json` per the `memory-convention` skill's "per-slice lifetime summary" schema:

   - `ts`: ISO-8601 timestamp.
   - `slice`: `<slice-#>`.
   - `task_count`: number of closed task sub-issues of the slice.
   - `task_review_cycles_sum`: sum of `total_cycles` read from each `$MEMORY_ROOT/signals/cycles/<task-#>.json`; skip tasks with missing cycle files.
   - `slice_review_cycles`: `gh pr view <pr-#> --json commits --jq '[.commits[] | select((.messageHeadline + "\n" + .messageBody) | contains("Refs #<slice-#>"))] | length'`.
   - `pr_review_cycles`: `gh pr view <pr-#> --json comments --jq '[.comments[] | select(.body | test("^# (Review|Code Review)"))] | length'`.

   Errors in step 5 are swallowed — never let signal capture block PR processing or the next PR's merge. Skip the entire block if `$MEMORY_ROOT` does not exist (opt-in by directory presence).

No `TaskCreate`, no `Agent`. Never `--force`; never push directly to `main`; never override branch protection.

---

### Step 3 — Emit one summary line

After Stage 9, print exactly one summary line:

```
implement-feature(<feature-name>): pass complete (kickoff <K> / implement <I> / review-task <RT> / fix-task <FT> / prepare-slice <PS> / review-slice <RS> / fix-slice <FS> / fix-pr <FPR> / close-pr <CP>)
```

Each count is the number of candidates *processed* in this fire (label flips for stage 1, dispatches for stages 2–8, merges for stage 9). Skipped candidates are NOT counted. `prepare-slice` and `fix-slice` dispatch engineers in the background — their count is "dispatched this fire", not "finished validating".

## Iron rules

- **One milestone per invocation.** Run `/implement-feature <feature-name>` once per feature; `<feature-name>` flows into the `task-finder` dispatch and into every per-stage mutation.
- **One `task-finder` dispatch per pass.** Foreground, single shot. Do NOT call it once per stage; do NOT call it again mid-pass.
- **The `task-finder` report is the SOLE source of truth for what to process.** Do not re-query GitHub for candidate lists — the report is the snapshot. Per-stage defense-in-depth re-checks (Stage 9 step 1) remain in scope.
- **Stages run in order; candidates within a stage fan out in parallel.** Cross-stage cascade *within* a pass is not preserved (the snapshot is frozen at `task-finder` time); the `/loop` wrapper carries it across passes.
- **Lock before dispatch, every stage.** The label flip (or `--add-label "status:fix-in-progress"` / `e2e:running`) is the lock. On synchronous `Agent` failure, roll back BOTH the lock AND the tracking task. Do NOT roll back on internal agent failure — once backgrounded, the agent owns the lifecycle.
- **One tracking task per dispatched sub-agent.** Never reuse a `taskId`; never spawn an `Agent` without a paired `TaskCreate` + `TaskUpdate(owner)` in the same batched response.
- **`type:*` decides the agent type, never the body.** Malformed `type:*` is dropped silently by the discovery skill; do not invent a routing.
- **`kind:feature` only.**
- **No code-changing work in this command itself.** Every code change, push, comment, and PR merge beyond `gh pr ready` / `gh pr merge` (Stage 9) is owned by the dispatched sub-agent.
- **Squash-merge with branch deletion in Stage 9.** Never `--force`, never push to `main`, never override branch protection.
- **Per-slice memory signal is fire-and-forget.** Errors in Stage 9 step 5 are swallowed; missing `$MEMORY_ROOT/.claude/memory/` skips the block entirely (opt-in by directory presence).
- **Skip, don't fail, on benign outcomes** at every stage — `422` from a label flip race, `merge race` from a recomputed mergeability, `nothing to pick up` from a stage whose only line is `- (none)`.
