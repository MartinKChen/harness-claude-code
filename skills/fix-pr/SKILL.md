---
name: fix-pr
description: "Scan **draft** PRs for failing GitHub Actions workflow checks on the head branch and/or merge conflicts against the base branch. Lock each affected PR with a `status:fix-in-progress` label flip, and dispatch a one-shot `engineer` sub-agent in Mode B with the list of fix scenarios it must handle (any non-empty subset of `conflict` / `ci`). Activate on phrases like 'fix the failing PRs', 'pick up draft PRs blocked by CI or conflicts', 'dispatch engineers against red PRs', '/fix-pr', or whenever the orchestrator needs to clear CI / merge-conflict blockers on draft slice PRs. Do NOT activate to merge a clean PR (use `close-pr`), to review code (use `review-task-issue`), or to fix reviewer findings on a task (use `fix-task-issue`)."
---

# fix-pr

Drive the fix-routing pass for draft PRs that can't merge yet — either at least one Actions workflow check failed on the head branch, or the branch conflicts with its merge target. Classify each affected PR's scenarios, lock it so concurrent fires don't double-pick, and dispatch a one-shot `engineer` to fix.

This skill does **not** review PRs, does **not** flip `review:*` labels, and does **not** merge PRs. It targets a single concern: clear the CI and merge-conflict blockers that stand between a draft slice PR and `close-pr`'s merge sweep. Reviews live on task issues (`review-task-issue` + `fix-task-issue`); merging is owned by `close-pr`.

The skill never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched `engineer`.

## When to activate

Activate this skill whenever the user:

- Types `/fix-pr` (with or without a numeric cap argument).
- Asks to "fix the failing PRs", "clear CI / conflict blockers on draft PRs", "dispatch engineers against red PRs", or "pick up draft PRs with failing checks".

Do NOT activate when the user wants to merge clean draft PRs (use `close-pr`), wants to review code or security on a task (use `review-task-issue`), or wants to address reviewer findings on a task issue (use `fix-task-issue`).

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the draft-PR scan to PRs whose milestone matches (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone `create-draft-pr` inherits from the slice issue). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N PRs have been dispatched. Empty / unset → process every eligible PR.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Scripts

Every gh / shell operation below is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Script | Purpose |
|--------|---------|
| `scripts/list-candidates.sh [--milestone <name>]` | List draft open PRs as JSON. |
| `scripts/wait-mergeability.sh <pr-#>` | Poll mergeability up to ~10 s; print MERGEABLE / CONFLICTING / UNKNOWN. |
| `scripts/inspect-checks.sh <pr-#>` | Emit `{running, failing}` for the head SHA's check rollup. |
| `scripts/lock-pr.sh <pr-#>` | Add the `status:fix-in-progress` lock label. |
| `scripts/unlock-pr.sh <pr-#>` | Remove the lock label (rollback on dispatch failure). |

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. Pull candidate PRs

List every **draft** open PR and discard the ones that already carry the lock label `status:fix-in-progress` — a concurrent fire owns them.

```bash
bash scripts/list-candidates.sh ${milestone:+--milestone "${milestone}"}
```

Filter on the orchestrator side: keep PRs whose `labels` array does **not** include `status:fix-in-progress`. The `--search` qualifier is GitHub-side; the orchestrator does not need to re-check `milestone` locally.

If the filtered list is empty, report "nothing to pick up" and stop. When a milestone filter was applied, include it: `nothing to pick up (milestone: <milestone-name>)`.

### 3. Classify scenarios per PR

For each candidate, derive the fix scenario set — 0–2 of:

| Scenario   | Trigger                                                                                                                                                                                          |
|------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `conflict` | `wait-mergeability.sh <n>` returns `CONFLICTING`. `UNKNOWN` is benign — GitHub still computing; skip the PR this run and let a later fire re-classify.                                           |
| `ci`       | `inspect-checks.sh <n>` returns a non-empty `failing` array.                                                                                                                                     |

**Both signals must be in their terminal state before this PR is eligible for locking.** "Terminal" means: mergeability is `MERGEABLE` or `CONFLICTING` (never `UNKNOWN`), AND every workflow check on the head SHA is `completed` (never `IN_PROGRESS` / `QUEUED` / `PENDING` / `WAITING` / `null`). A PR with even one mid-flight signal is skipped this fire — the engineer mustn't be dispatched while either input is still moving (a `conflict`-only dispatch can become a `conflict`+`ci` dispatch as CI lands, and an engineer dispatched on incomplete data wastes a worktree on the wrong fix surface).

#### 3.1 Mergeability scan

```bash
status="$(bash scripts/wait-mergeability.sh <pr-#>)"
```

Cap at ~10 s. `UNKNOWN` past the cap → skip with `mergeability still UNKNOWN`.

#### 3.2 Workflow-check scan

The script returns two facets keyed off the head SHA's `statusCheckRollup`:

1. **Any check still running?** If so, the PR is not yet eligible — skip with `checks still running`.
2. **Among the completed checks, any non-`SUCCESS`/non-`SKIPPED` conclusion?** That populates the `ci` scenario.

```bash
checks_json="$(bash scripts/inspect-checks.sh <pr-#>)"
running="$(printf '%s' "$checks_json" | jq '.running')"

if [ "$running" -gt 0 ]; then
  echo "skipped PR #<n> — checks still running (${running})"
  continue   # next PR
fi

failing="$(printf '%s' "$checks_json" | jq -c '.failing')"
```

If `failing` is a non-empty JSON array → add `ci` to the scenario set.

#### 3.3 Scenario decision

- Both signals terminal **and** scenario set non-empty → continue to step 4 (lock + dispatch).
- Both signals terminal **and** scenario set empty → log `skipped PR #<n> — nothing to fix` and continue. (`close-pr` owns merging clean PRs.)
- Either signal mid-flight (mergeability `UNKNOWN` or any workflow still running) → skip with the matching reason; a later fire re-classifies once everything has landed.

### 4. Lock with `status:fix-in-progress` (only when both signals are terminal)

Only PRs that made it through step 3.3 with a non-empty scenario set reach this step. Mergeability is decided (`MERGEABLE` / `CONFLICTING`, never `UNKNOWN`), every workflow check is `COMPLETED`, and at least one of `conflict` / `ci` is in the scenario set. Now add the lock label in one atomic `gh` call:

```bash
bash scripts/lock-pr.sh <pr-#>
```

`status:fix-in-progress` must exist in the repo's label set as a prerequisite (`gh label create status:fix-in-progress`).

If the call fails because the label was just added by a concurrent fire (`422` / lock race), treat as benign and skip this PR. Anything else: surface the error verbatim, stop processing further candidates for this run.

The lock MUST happen **before** the `Agent` dispatch in step 5. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the lock back:

```bash
bash scripts/unlock-pr.sh <pr-#>
```

Do NOT roll back on internal sub-agent failure — once the engineer is running, it owns the lifecycle and removes `status:fix-in-progress` as part of its terminal push.

### 5. Create an orchestrator tracking task, then dispatch one `engineer` per PR

Each dispatched engineer gets a unique addressable name and a matching orchestrator-side `Task` (via `TaskCreate`) so the user can see fix progress in the harness task list.

Pick a unique agent name of the form `engineer-pr-<pr-#>` (e.g. `engineer-pr-128`). The same string is used as the `Agent`'s `name` field AND the tracking task's `owner` so spinner, task row, and spawned agent line up.

**5a. Create the orchestrator tracking task**

Call `TaskCreate` with:

- `subject`: `Fix PR #<pr-#>: <pr-title>`
- `description`: one short paragraph — the PR URL, the comma-list of scenarios (`conflict` and/or `ci`), and a one-liner saying the engineer owns the lifecycle until it pushes and removes `status:fix-in-progress` from the PR.
- `activeForm`: `Fixing PR #<pr-#>`

Capture the returned `taskId`.

If `TaskCreate` fails synchronously, roll back the lock (per step 4) and log `skipped PR #<n> — TaskCreate failed: <error>`.

**5b. Dispatch the engineer and assign the tracking task**

Spawn each PR with the `Agent` tool, passing:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — the chosen agent name (e.g. `engineer-pr-128`)
- `run_in_background` — `true` (mandatory; see below)
- `prompt` — minimal; only the **PR number, scenarios list, and the orchestrator `taskId`**

`run_in_background: true` is non-negotiable. A foreground `Agent` call blocks the orchestrator turn until the engineer fully terminates, which (a) serializes PRs that were supposed to fan out in parallel and (b) lets the engineer's own terminal `TaskUpdate({ status: "completed" })` land before the orchestrator's `TaskUpdate({ owner })` — at which point the owner assignment races a finalized task and the harness UI never shows who owned the row.

Immediately follow the `Agent` call — in the **same batched response** — with `TaskUpdate({ taskId, owner: <agent-name> })` so the task row reflects the assignment before the backgrounded engineer makes meaningful progress. Never split the `Agent` and `TaskUpdate(owner)` calls across turns.

Independent PRs fan out in parallel: emit all the `Agent` calls AND their matching `TaskUpdate(owner)` calls together in one batched response. `TaskCreate` calls in step 5a may be batched the same way per fire.

If the `Agent` dispatch fails synchronously (bad `subagent_type`, missing tool, etc.), roll back BOTH the lock (per step 4) and the tracking task via `TaskUpdate({ taskId, status: "deleted" })`. Once the engineer is running, ownership transfers — it owns the terminal `status:fix-in-progress` removal and the tracking task's `completed` flip.

Skeleton:

```
Fix PR #<pr-#> in Mode B.
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and removed `status:fix-in-progress` from the PR.

Scenarios to address (handle every one listed):
- conflict
- ci

Fetch any further context yourself via `gh` and `git` — you have the PR number.
```

Include only the scenarios that classified for this PR; never list one that didn't trigger.

### 6. Honor the cap and report

If the user passed a positive integer N, stop after N PRs have been dispatched this run. Already-skipped PRs do not count.

Print a one-line-per-PR summary:

- `dispatched  PR #<n> "<title>" → engineer (scenarios: <comma-list>)`
- `skipped     PR #<n> "<title>" — nothing to fix`
- `skipped     PR #<n> "<title>" — mergeability still UNKNOWN`
- `skipped     PR #<n> "<title>" — checks still running (<count>)`
- `skipped     PR #<n> "<title>" — lock race`
- `skipped     PR #<n> "<title>" — cap reached (dispatched N this run)`

End with one sentence: `Dispatched <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Drafts only.** ready-to-review PRs are not in scope for this skill. The slice PR stays draft until `close-pr` promotes + merges it; an engineer fix dispatch never targets a ready PR.
- **No review handling, no merging.** This skill does not touch `review:*` labels (those live on task issues now) and does not call `gh pr merge` (that's `close-pr`'s job).
- **Lock before dispatch.** `status:fix-in-progress` is added in step 4 before the `TaskCreate` + `Agent` calls in step 5. The label is the lock that prevents concurrent fires from picking up the same PR. The engineer removes it as the terminal step of its push.
- **One orchestrator tracking task per dispatched engineer.** Every dispatched PR gets exactly one `TaskCreate` row, and the same agent `name` is used as the task `owner`. Never reuse a `taskId` across PRs and never spawn an `Agent` without a paired tracking task.
- **Roll back lock AND tracking task on synchronous dispatch failure.** If `Agent` errors synchronously, remove `status:fix-in-progress` from the PR and call `TaskUpdate({ taskId, status: "deleted" })`. Once the agent is running, ownership transfers (engineer removes the lock label and flips the tracking task to `completed`).
- **Background dispatch + same-message owner assignment.** Every `Agent` call MUST set `run_in_background: true` and MUST be emitted in the same response as its `TaskUpdate({ taskId, owner: <agent-name> })`. Foreground dispatch blocks the turn, serializes parallel PRs, and races the orchestrator's owner assignment against the engineer's own terminal task update.
- **Lock only when both signals are terminal.** Mergeability and the workflow-check rollup must both be in a settled state before the lock + dispatch fires. `UNKNOWN` mergeability or any `IN_PROGRESS` / `QUEUED` / `PENDING` workflow check is benign — skip the PR and let a later fire re-classify once everything has landed.
- **One engineer per PR; pass scenarios in the prompt.** Each `Agent` call owns one PR and lists every scenario the engineer must handle (1–2 of `conflict` / `ci`). Independent PRs fan out as parallel `Agent` + `TaskUpdate(owner)` calls in the same response.
- **Skip clean PRs.** If a PR has green CI and is mergeable, leave it alone — `close-pr` owns merging.
- **Skip, don't fail, on benign outcomes.** "Nothing to fix", "mergeability UNKNOWN", "lock race", "cap reached", "TaskCreate failed" are all expected — log and continue.
