---
description: Drive one end-to-end pass through the slice → task → review → fix → close → PR → merge lifecycle for a single feature milestone. Run the `task-finder.sh` script once (read-only, no LLM in the loop) to identify every eligible candidate across the nine lifecycle stages, then perform the per-stage label flips + `TaskCreate` + `Agent` dispatch (or merge + memory capture) directly. Within a stage, candidates fan out in parallel — but at most one implement-type agent (implement / fix / E2E) runs per slice at a time, while review tasks have no per-slice limit; across stages, processing is sequential. Each pass is a snapshot. Run it under self-paced `/loop /implement-feature <feature-name>`: every backgrounded agent's completion re-invokes the orchestrator to run the next pass (event-driven fast path), and a long backstop `ScheduleWakeup` runs a full reconcile pass to catch dead agents that never signaled and merge-driven `Blocked by` cascades. The loop ends only when a pass dispatches nothing and no tracking tasks remain.
argument-hint: <feature-name>
---

# implement-feature

Run one full sweep across the lifecycle stages, in order, for a single feature milestone.

- **Discovery** is owned by the `task-finder.sh` script (read-only, single run, no LLM).
- **Every state mutation** — label flips, `TaskCreate`, `Agent` dispatch, `TaskUpdate(owner)` assignment, draft → ready promotion, squash-merge — is owned by this command.

The `task-finder-stage-<n>-<name>.sh` scripts under `skills/operation-git/scripts/` (the reconcile stage 0 plus the nine lifecycle stages) are pure discovery and emit eligible-candidate lists only; they never flip labels, never dispatch agents, never merge PRs.

This command does **not** wait for backgrounded sub-agents to finish *within* a pass. Once an agent is dispatched, the command moves on to the next candidate and ends the pass. What carries the milestone forward *across* passes is the trigger model in **Step 4** — an agent finishing re-invokes the orchestrator (event-driven fast path), backstopped by a long `ScheduleWakeup`. Run the command under self-paced `/loop /implement-feature <feature-name>` (no interval) so those re-invocations re-enter this command.

## Arguments

Exactly one positional argument: `<feature-name>` — the GitHub milestone name created by `/deep-dive-feature` and used by `create-issues` to group every slice / task issue and inherited by every slice PR.

If `<feature-name>` is missing or empty, stop and ask the user for it before dispatching anything.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### Step 0.5 — Close finished agents' tracking tasks

If this pass was re-invoked by one or more `<task-notification>` messages, each
names an agent dispatched in a prior pass that has now finished. Before Step 1,
call `TaskList`; for each notification, find the open tracking task whose `owner`
matches the finished agent's name (both encode the same issue/PR number) and
`TaskUpdate({ taskId, status: "completed" })`. A notification with no matching
open task is benign; skip silently.

### Step 1 — Run `task-finder.sh` (single shot, no LLM)

Run the discovery script **once** with `<feature-name>` so its report is available before any mutation. The script is pure shell — no agent dispatch, no `Skill` invocations, no LLM round-trips. Each per-stage script (`task-finder-stage-<n>-<name>.sh`) under `skills/operation-git/scripts/` runs the prescribed `gh` queries + gates and emits its candidate lines; the umbrella driver concatenates them into the canonical report:

```
Bash({
  command: "bash skills/operation-git/scripts/task-finder.sh '<feature-name>'",
  description: "Discover lifecycle candidates for the <feature-name> milestone"
})
```

The script returns ONE markdown report covering the reconcile stage (Stage 0) and all nine lifecycle stages on stdout. Parse positionally:

- Each stage section is `## Stage <N>: <stage-name>` followed by one or more `- ...` lines.
- Every listed candidate is ELIGIBLE — `task-finder.sh` and its delegated per-stage scripts drop ineligible candidates silently.
- Pipe-delimited fields per candidate are positional (see the corresponding `task-finder-stage-<n>-<name>.sh` header comment for field order).
- A stage whose only line is `- (none)` has no work this pass.

If the script exits non-zero, stderr carries a diagnostic (`task-finder: not a GitHub repo`, `task-finder: milestone "<n>" not found`, `task-finder: stage <n> (<name>) failed: …`). Surface that verbatim and stop. Do not improvise.

### Step 2 — Process the report, stage by stage

Process the stages **in order, Stage 0 first** (cross-stage cascade *within* a pass is not preserved — the snapshot is frozen at `task-finder.sh` time; the `/loop` wrapper carries it across passes). Within each stage, eligible candidates **fan out in parallel** — emit all per-candidate `Agent` + `TaskUpdate(owner)` calls together in one batched response — **except where the per-slice implement budget below collapses same-slice implement-type candidates**.

If a stage's candidate list is `- (none)`, log `Stage <N> (<stage-name>): nothing to pick up` and move on.

Use the `operation-git` skill's `gh-commands` reference and `dispatch-prompt` template as the source of truth for query / mutation shapes.

Fill **only** the issue/PR number into the chosen `dispatch-prompt.md` skeleton — never add failure context, CI output, or diagnosis to the prompt. The agent rediscovers everything from the ID; extra context goes stale and duplicates the agent's work.

---

#### Stage 0 — `reconcile` (release orphaned locks; no agent dispatch)

Process this stage **first, before Stage 1**, and **before initializing `claimed_slices`** — it dispatches nothing and is exempt from the per-slice implement budget.

Stage 0 lists work frozen in an in-flight label state by a sub-agent that died mid-run (SIGKILL under memory pressure, a killed process tree, a hung agent) without advancing the label. Nothing in Stages 1–9 ever re-picks such an item, so it stalls permanently — and a stale `status:in-progress` task keeps blocking its slice's siblings via `slice-in-flight.sh`. This stage **releases the lock**; it does NOT resurrect the dead agent. The next `/loop` pass re-discovers the released item in its normal ready state and re-dispatches a **fresh** agent, which resumes from durable state (the slice branch's WIP commits + the issue body + any handoff doc). Releasing a lock this pass therefore does NOT make the item eligible for Stages 1–9 *this* pass — the snapshot is frozen; recovery lands next pass, exactly like every other cross-stage cascade.

For each orphan line, apply the label flip named by its `release:<action>` token, then (best-effort) clean up the dead agent's tracking task:

| `release:<action>` | Line prefix | Label flip |
|--------------------|-------------|------------|
| `ready-to-implement` | `task:#<n>`  | `gh issue edit <n> --remove-label "status:in-progress" --add-label "status:ready-to-implement"` |
| `need-fix`           | `task:#<n>`  | `gh issue edit <n> --add-label "review:need-fix"` |
| `review-pending`     | `task:#<n>`  | `gh issue edit <n> --remove-label "review:running" --add-label "review:pending"` |
| `clear-e2e`          | `slice:#<n>` | `gh issue edit <n> --remove-label "e2e:running"` |
| `review-pending`     | `slice:#<n>` | `gh issue edit <n> --remove-label "review:running" --add-label "review:pending"` |
| `need-fix`           | `slice:#<n>` | `gh issue edit <n> --add-label "review:need-fix"` |
| `clear-fix-pr`       | `pr:#<n>`    | `gh pr edit <n> --remove-label "status:fix-in-progress"` |

Each flip exactly reverses the lock the orchestrator applied at dispatch, restoring the item to its pre-dispatch state. The `release:need-fix` cases re-add the gate label the fix-stage lock stripped (`status:in-progress` is left untouched — the fix lock never removed it). After flipping, if a tracking task whose `owner` encodes this issue number is still open in `TaskList` (e.g. `engineer-implement-<n>`, `reviewer-review-task-<n>`, `engineer-e2e-<n>`, `engineer-fix-pr-<n>`), `TaskUpdate({ taskId, status: "deleted" })` — its agent is gone. A missing tracking task (different session) is benign; skip silently.

Treat a `422` from a flip (label already moved by a concurrent fire) as benign and skip. Stage 0 never dispatches, never merges, never adds `claimed_slices`.

The death gate is owned by the script: a runtime-telemetry liveness heartbeat (authoritative for engineer / reviewer dispatches — a fresh `last_seen` proves the agent is alive and is never reaped, no matter how quiet GitHub is) with GitHub-activity staleness as the fallback for agents without a telemetry record (`RECONCILE_HEARTBEAT_STALE_MINUTES` / `RECONCILE_STALE_MINUTES`, both default 30). Do NOT second-guess a listed orphan — `task-finder.sh` already applied the gate; every Stage 0 line is eligible.

---

#### Per-slice implement budget (cross-stage, whole pass)

Stages divide into two kinds by what the dispatched agent does to the slice's shared `/tmp/harness-claude-code/<repo>/worktrees/<slice-branch>` worktree:

- **Implement-type** — Stage 2 `implement-task`, Stage 4 `fix-task`, Stage 5 `prepare-slice`, Stage 7 `fix-slice`, Stage 8 `fix-pr`. The dispatched engineer / e2e-author **checks out and edits** the slice worktree. **At most one implement-type agent may be in flight per slice** — a second one races on the same working tree, no matter whether it is authoring E2E specs, implementing a task, fixing a task, fixing the slice, or fixing the PR.
- **Review-type** — Stage 3 `review-task`, Stage 6 `review-slice`. The reviewer checks out the worktree **read-only** and never writes. **No per-slice limit** — multiple reviews run concurrently, including several on the same slice.

Stages 1 `kickoff-slice` and 9 `close-pr` dispatch no agent and are exempt.

Maintain one per-pass set, `claimed_slices`, **initialized empty at the start of Step 2**. It enforces the implement budget across the whole pass — both within a single stage (two sibling tasks on the same slice) and across stages (e.g. a slice with one task to implement and another to fix).

Before locking / dispatching any **implement-type** candidate, resolve its slice number `S`:

| Stage | How to read `S` |
|-------|-----------------|
| 2 `implement-task` | the line's `slice:<slice-#>` field |
| 4 `fix-task`       | the line's `slice:<slice-#>` field |
| 5 `prepare-slice`  | the candidate **is** the slice — `S = <slice-#>` |
| 7 `fix-slice`      | the candidate **is** the slice — `S = <slice-#>` |
| 8 `fix-pr`         | the line's `slice:<slice-#>` field |

Then:

- If `S ∈ claimed_slices` → **skip this candidate this pass** (`slice <S> already has an implement-type agent in flight this pass`). Do NOT lock, do NOT `TaskCreate`, do NOT dispatch. The `/loop` wrapper re-discovers it next pass once the in-flight agent has released the slice (its label state no longer reads "in flight").
- Otherwise → add `S` to `claimed_slices`, then lock + `TaskCreate` + dispatch exactly as the stage prescribes.

Consequence: **implement-type candidates no longer fan out unconditionally.** Group a stage's candidates by slice — distinct slices still dispatch in parallel in one batched response; same-slice candidates collapse to the first, the rest skipped this pass. **Review-type stages are unaffected — fan every candidate out in parallel.**

---

#### Stage 1 — `kickoff-slice` (label-only; no agent dispatch)

For each eligible slice `#<slice-#>` (line format: `- #<slice-#> | "<title>"`):

1. Flip the slice itself: `gh issue edit <slice-#> --remove-label "status:ready-to-implement" --add-label "status:in-progress"`.
2. Pull the slice's sub-issues via GraphQL (`repository.issue.subIssues.nodes`), filter to nodes carrying both `level:task` and `kind:feature`, and for each, `gh issue edit <sub-issue-#> --add-label "status:ready-to-implement"`.

No `TaskCreate`, no `Agent`. If a label add is a no-op because the label is already present, that's benign. Any other failure → surface verbatim and stop further candidates for this stage.

---

#### Stage 2 — `implement-task` (lock + `TaskCreate` + `Agent`)

For each eligible task (line format: `- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<title>"`):

0. **Slice budget gate first** (see *Per-slice implement budget*): read `S` from the line's `slice:<slice-#>` field. If `S ∈ claimed_slices`, skip this candidate this pass; otherwise add `S` to `claimed_slices` and continue.
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

0. **Slice budget gate first** (see *Per-slice implement budget*): read `S` from the line's `slice:<slice-#>` field. If `S ∈ claimed_slices`, skip this candidate this pass; otherwise add `S` to `claimed_slices` and continue.
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

0. **Slice budget gate first** (see *Per-slice implement budget*): `S = <slice-#>`. If `S ∈ claimed_slices`, skip this candidate this pass; otherwise add `S` to `claimed_slices` and continue.
1. **Lock**: `gh issue edit <slice-#> --add-label "e2e:running"`. If already present (race), benign skip.
2. **TaskCreate**:
   ```
   subject:     E2E-validate slice #<slice-#>: <slice-title>
   description: <slice-url>. Dispatching engineer to run the slice's E2E
                specs against a real stack via testcontainers.
                On pass: engineer removes e2e:running and adds e2e:validated + review:pending.
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
   description: <slice-url>. Invoking the review-slice workflow to fan out
                dimension reviewers, dedup, adversarially verify, then post the
                verdict + (on pass) the draft PR (merge:manual) / (on fail) flip
                review:running → review:need-fix.
   activeForm:  Reviewing slice #<slice-#>
   ```
3. **`Workflow` + `TaskUpdate(owner)`**: dispatch the review as a fan-out workflow rather than a single `reviewer` agent. The workflow runs in the background, returns a task id immediately, and notifies on completion — the same lifecycle as a backgrounded agent, so the loop-continuation accounting below is unchanged (it keys off the `reviewer-review-slice-<slice-#>` tracking owner and the terminal label flip the workflow performs itself).
   - **Tool**: `Workflow`
   - `scriptPath`: `${CLAUDE_PLUGIN_ROOT}/workflows/review-slice.mjs` (the script is plugin-shipped, not a consuming-project `.claude/workflows/` entry — resolve `$CLAUDE_PLUGIN_ROOT` from the environment the same way the plugin's hooks do, then pass the absolute path)
   - `args`: `{ "slice": <slice-#>, "today": "<YYYY-MM-DD>" }` (pass today's date explicitly — the workflow runtime has no clock; it stamps the PR body's review-verdict line with it)
   - Pair with `TaskUpdate({ taskId, owner: "reviewer-review-slice-<slice-#>" })` in the same batched response, exactly as the agent-dispatch stages do.

   The workflow owns the full review internally — read-only worktree setup, touched-path dimension selection, the Phase-1 spec gate, the Phase-2 quality fan-out, cross-dimension dedup, adversarial verification, the `# Slice Review` comment, the terminal `review:running` → `review:passed` / `review:need-fix` flip, and (on APPROVE) the idempotent `merge:manual` draft PR. Its mechanism lives in `${CLAUDE_PLUGIN_ROOT}/workflows/review-slice.mjs`; the per-dimension catalogues remain the `pattern-reviewer-*` skills (each dimension agent reads exactly one). On a blocked run it posts a diagnostic and leaves `review:running` for human triage, matching `workflow-reviewer-review-slice`.

   > **Fallback.** If `Workflow` is unavailable in the running harness, dispatch the single `reviewer` agent instead (`subagent_type: reviewer`, `name: reviewer-review-slice-<slice-#>`, `run_in_background: true`, prompt = the "Review a task or slice" skeleton with `slice` + `<slice-#>`). The `reviewer` agent + `workflow-reviewer-review-slice` skill are retained unchanged as this degraded path; behaviour is identical minus the dimension isolation and adversarial-verify pass.

Roll back lock + tracking task on synchronous failure.

---

#### Stage 7 — `fix-slice` (strip-label lock + `TaskCreate` + `Agent`)

For each eligible slice (line format: `- #<slice-#> | "<title>"`):

0. **Slice budget gate first** (see *Per-slice implement budget*): `S = <slice-#>`. If `S ∈ claimed_slices`, skip this candidate this pass; otherwise add `S` to `claimed_slices` and continue.
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

For each eligible draft PR (line format: `- PR #<pr-#> | slice:<slice-#> | "<title>"`):

0. **Slice budget gate first** (see *Per-slice implement budget*): read `S` from the line's `slice:<slice-#>` field. If `S ∈ claimed_slices`, skip this candidate this pass; otherwise add `S` to `claimed_slices` and continue.
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

#### Stage 9 — `close-pr` (sequential, no agent dispatch)

Process PRs **sequentially** — concurrent `gh pr merge` calls race on the base branch.

For each eligible draft PR (line format: `- PR #<pr-#> | slice:<slice-#> | merge:<auto|manual> | "<title>"`):

1. **Defense-in-depth re-check** against live state: `gh pr view <pr-#> --json mergeable,statusCheckRollup`. If `mergeable != "MERGEABLE"` OR any rollup state is not SUCCESS / NEUTRAL / SKIPPED → skip (`merge race / no longer eligible`).
2. **Promote draft → ready — always**: `gh pr ready <pr-#>`. Every mergeable draft is opened, regardless of merge-mode.
3. **Auto-close only when `merge:auto`.** If the line's merge-mode is `manual`, stop here: the PR is now open for the user to merge — do NOT merge. If the merge-mode is `auto`, continue.
4. **Squash-merge with branch deletion** (`merge:auto` only): `gh pr merge <pr-#> --squash --delete-branch`. Slice closure happens automatically via the PR body's `Closes #<slice-#>` line (filled in by `workflow-reviewer-review-slice` when the draft was created).
5. **On merge race** (GitHub recomputed mergeability between step 1 and 4): undo the ready promotion with `gh pr ready <pr-#> --undo` and skip.

No `TaskCreate`, no `Agent`. Never `--force`; never push directly to `main`; never override branch protection.

---

### Step 3 — Emit one summary line

After Stage 9, print exactly one summary line:

```
implement-feature(<feature-name>): pass complete (reconcile <RC> / kickoff <K> / implement <I> / review-task <RT> / fix-task <FT> / prepare-slice <PS> / review-slice <RS> / fix-slice <FS> / fix-pr <FPR> / close-pr <CP>)
```

Each count is the number of candidates *processed* in this fire (lock releases for stage 0, label flips for stage 1, dispatches for stages 2–8, draft → ready promotions for stage 9 — whether or not the PR was also auto-merged). Skipped candidates (failed the defense-in-depth re-check, lost a merge race, or collapsed by the per-slice implement budget) are NOT counted. `prepare-slice` and `fix-slice` dispatch engineers in the background — their count is "dispatched this fire", not "finished validating".

### Step 4 — Arm the next trigger (event-driven fast path + slow backstop)

A "pass" is everything Steps 0–3 just did. This step decides what triggers the *next* pass. The labels-as-truth contract is unchanged — every trigger does the same thing: run `task-finder.sh` and dispatch the newly-eligible successors. The only question is **when** to run it. There are three triggers:

- **Fast path (event-driven, primary).** When a sub-agent dispatched in any prior pass finishes, the harness re-invokes the orchestrator with a `<task-notification>`. Under the `/loop` wrapper that re-enters this command — a fresh pass. The just-finished agent has already flipped its labels (`review:pending`, `e2e:validated`, `review:passed`, …), so this pass's `task-finder.sh` surfaces the successor stage for that agent's slice, plus any slice its completion unblocked. **Do NOT schedule a short-interval wakeup to poll for in-flight agents** — completion re-invocation is automatic and immediate; a short poll just burns passes and cache.
- **Slow backstop (timer, safety net).** Three things produce no completion notification, so the fast path is blind to them: (1) an agent SIGKILLed under memory pressure never signals "done" — its orphaned lock is only recoverable by **Stage 0 reconcile**; (2) a `Blocked by` chain unblocks when *this command* merges a slice PR (Stage 9), not when any agent finishes; (3) the orchestrator session itself may be lost. Cover all three with one long backstop wake, armed at the end of every pass that still has work in flight:

  ```
  ScheduleWakeup({
    delaySeconds: 1800,
    prompt: "/loop /implement-feature <feature-name>",
    reason: "implement-feature backstop for <feature-name>: reconcile orphaned locks + flow merge-driven cascades"
  })
  ```

  1800s is a backstop, not a poll — the fast path fires far sooner whenever an agent actually finishes. Keep it long; do not drop it toward a poll interval.
- **Manual.** `/implement-feature <feature-name>` invoked directly runs exactly one pass and arms the same backstop.

**Choosing the trigger at the end of a pass** — count work still in flight: open tracking tasks in `TaskList` whose `owner` matches this command's dispatch naming (`*-implement-*`, `reviewer-review-task-*`, `engineer-e2e-*`, `*-fix-task-*`, `engineer-fix-slice-*`, `reviewer-review-slice-*`, `engineer-fix-pr-*`), unioned with anything dispatched this pass.

- **Work in flight** → arm the backstop `ScheduleWakeup` above and end the turn. The fast path re-invokes you the moment an agent finishes; the backstop only fires if nothing does within 30 min.
- **Nothing in flight AND this pass's finder report was all `- (none)` across every stage** → the milestone is **quiescent**. Emit the summary line, arm **no** wakeup, and end the loop. This is the sole stop condition.

Never stop the loop while any tracking task is still open — a quiet GitHub is not quiescence if an agent is mid-run.

## Iron rules

- **Reconcile (Stage 0) runs first, releases locks, dispatches nothing.** It only flips an orphaned in-flight label back to its pre-dispatch state so the next `/loop` pass re-dispatches a fresh agent from durable state (WIP commits + issue body). It never resurrects the dead agent, never merges, never touches `claimed_slices`. Released items are NOT eligible for Stages 1–9 this pass — recovery lands next pass.
- **The next pass is triggered by an agent finishing, not by a clock.** A dispatched agent's completion re-invokes the orchestrator (fast path); a single long `ScheduleWakeup` (default 1800s) is the *backstop* that catches dead agents, merge-driven `Blocked by` cascades, and a lost session — never a poll. Do NOT add a short-interval wakeup to watch in-flight agents. The loop stops only on **quiescence**: a pass that dispatches nothing AND has zero open tracking tasks. See Step 4.
- **One milestone per invocation.** Run `/implement-feature <feature-name>` once per feature; `<feature-name>` flows into the `task-finder.sh` invocation and into every per-stage mutation.
- **One `task-finder.sh` run per pass.** Single shot, no LLM. Do NOT call it once per stage; do NOT call it again mid-pass; do NOT dispatch an agent to wrap the call.
- **The `task-finder.sh` report is the SOLE source of truth for what to process.** Do not re-query GitHub for candidate lists — the report is the snapshot. Per-stage defense-in-depth re-checks (Stage 9 step 1) remain in scope.
- **Stages run in order; candidates within a stage fan out in parallel — except implement-type candidates sharing a slice.** Cross-stage cascade *within* a pass is not preserved (the snapshot is frozen at `task-finder.sh` time); the `/loop` wrapper carries it across passes.
- **At most one implement-type agent in flight per slice, across the whole pass.** Implement-type stages (2 `implement-task`, 4 `fix-task`, 5 `prepare-slice`, 7 `fix-slice`, 8 `fix-pr`) all edit the slice's shared worktree; track dispatched slices in the per-pass `claimed_slices` set and skip any later implement-type candidate whose slice is already claimed (it is re-discovered next `/loop` pass). Review-type stages (3 `review-task`, 6 `review-slice`) are read-only and carry **no** per-slice limit — fan them out without restriction.
- **Lock before dispatch, every stage.** The label flip (or `--add-label "status:fix-in-progress"` / `e2e:running`) is the lock. On synchronous `Agent` failure, roll back BOTH the lock AND the tracking task. Do NOT roll back on internal agent failure — once backgrounded, the agent owns the lifecycle.
- **One tracking task per dispatched sub-agent.** Never reuse a `taskId`; never spawn an `Agent` without a paired `TaskCreate` + `TaskUpdate(owner)` in the same batched response.
- **Close a tracking task the moment its agent finishes.** A `<task-notification>`
  is the close signal: at pass entry match it to the open tracking task by `owner`
  and mark it `completed`. Stage 0 reconcile only `deleted`s tasks for agents that
  *died*; this covers agents that *completed normally*.
- **`type:*` decides the agent type, never the body.** Malformed `type:*` is dropped silently by the discovery skill; do not invent a routing.
- **`kind:feature` only.**
- **No code-changing work in this command itself.** Every code change, push, comment, and PR merge beyond `gh pr ready` / `gh pr merge` (Stage 9) is owned by the dispatched sub-agent.
- **Detect-and-dispatch, never analyze.** The orchestrator never inspects code, CI logs, test output, diffs, or failing files to diagnose a candidate. `task-finder.sh` has already gated eligibility (a fix-pr candidate *means* CI failed or there's a conflict — that is all the orchestrator needs to know). All discovery and diagnosis belong to the dispatched agent. Do NOT run `gh run view` / `gh run view --log-failed` / `gh pr checks` / log greps, and do NOT read the slice's source to understand a failure. The one read the orchestrator may do is the Stage 9 defense-in-depth `gh pr view --json mergeable,statusCheckRollup` re-check — a go/no-go gate, not a diagnosis.
- **Stage 9 promotes every mergeable draft to ready; it auto-closes only `merge:auto`.** `gh pr ready` runs for all mergeable drafts regardless of merge-mode; `gh pr merge --squash --delete-branch` runs only when the candidate line's merge-mode is `auto`. `merge:manual` drafts are left open for the user. Never `--force`, never push to `main`, never override branch protection.
- **Skip, don't fail, on benign outcomes** at every stage — `422` from a label flip race, `merge race` from a recomputed mergeability, `nothing to pick up` from a stage whose only line is `- (none)`.
- **`status:need-attention` is a user-owned halt — never block, never recover it.** When an engineer flips a slice to `status:need-attention`, the orchestrator does nothing to it: never call `AskUserQuestion`, never pause the loop for a decision, never flip the label back. `task-finder.sh` already drops it from every stage, so the pass flows past it untouched. Recovery is the user's — they comment on the slice and flip `status:need-attention` → `status:in-progress`, after which the loop re-discovers it normally.
