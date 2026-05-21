---
name: workflow-orchestrator-fix-pr
description: "Scan draft PRs (skipping `status:fix-in-progress`/`status:need-attention`) for any merge-blocking signal (failing CI and/or merge conflict); lock with `status:fix-in-progress` and dispatch an engineer sub-agent — the engineer determines what to fix from the live PR state. `need-attention` PRs stay skipped until a human clears the label. Activate on 'fix the failing PRs', '/workflow-orchestrator-fix-pr'. Skip for clean PRs, task reviews, task fixes."
---

# workflow-orchestrator-fix-pr

Drive the fix-routing pass for draft PRs that can't merge yet — either at least one Actions workflow check failed on the head branch, or the branch conflicts with its merge target. Decide whether each PR needs a fix at all, lock it so concurrent fires don't double-pick, and dispatch a one-shot `engineer` to fix. The engineer determines **what** to fix (conflict, CI, or both) by inspecting the live PR state itself.

This skill does **not** review PRs, does **not** flip `review:*` labels, and does **not** merge PRs. It targets a single concern: clear the CI and merge-conflict blockers that stand between a draft slice PR and the merge sweep. Reviews live on task issues; merging happens in a separate lifecycle stage.

The skill never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched `engineer`.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-fix-pr` (with or without a numeric cap argument).
- Asks to "fix the failing PRs", "clear CI / conflict blockers on draft PRs", "dispatch engineers against red PRs", or "pick up draft PRs with failing checks".

Do NOT activate when the user wants to merge clean draft PRs, wants to review code or security on a task, or wants to address reviewer findings on a task issue.

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the draft-PR scan to PRs whose milestone matches (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone inherited from the slice issue). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N PRs have been dispatched. Empty / unset → process every eligible PR.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Scripts and templates

Every gh / shell operation below is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable). The dispatch-prompt skeleton lives under `templates/`.

| Asset | Purpose |
|-------|---------|
| `scripts/list-candidates.sh [--milestone <name>]` | List draft open PRs as JSON. |
| `scripts/wait-mergeability.sh <pr-#>` | Poll mergeability up to ~10 s; print MERGEABLE / CONFLICTING / UNKNOWN. Used only to gate on terminal state and detect blockers — the orchestrator does **not** classify the specific fix scope. |
| `scripts/inspect-checks.sh <pr-#>` | Emit `{running, failing}` for the head SHA's check rollup. Used only to gate on terminal state and detect blockers — the orchestrator does **not** classify the specific fix scope. |
| `scripts/lock-pr.sh <pr-#>` | Add the `status:fix-in-progress` lock label. |
| `scripts/unlock-pr.sh <pr-#>` | Remove the lock label (rollback on dispatch failure). |
| `templates/dispatch-prompt.md` | Skeleton for the engineer dispatch prompt; fill placeholders and pass as the `Agent` call's `prompt`. |

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. Pull candidate PRs

List every **draft** open PR. `list-candidates.sh` already excludes PRs carrying `status:fix-in-progress` (a concurrent fire owns them) or `status:need-attention` (a prior fix dispatch determined the failure needs human-in-the-loop — typically an E2E spec rewrite — and the PR stays skipped until the user clears the label):

```bash
bash scripts/list-candidates.sh ${milestone:+--milestone "${milestone}"}
```

Defense in depth on the orchestrator side: even though the search qualifier already filters, re-check each PR's `labels` array and drop any that still include either lock label (a `gh` cache could in theory hand back stale data). The `--search` qualifier is GitHub-side; the orchestrator does not need to re-check `milestone` locally.

If the filtered list is empty, report "nothing to pick up" and stop. When a milestone filter was applied, include it: `nothing to pick up (milestone: <milestone-name>)`.

### 3. Decide whether the PR needs a fix

For each candidate, gate on **terminal state** of both signals (mergeability and the head SHA's check rollup), then decide if any blocker is present. The orchestrator only answers "does this PR need a fix at all?" — it does **not** enumerate which fix scope applies. The engineer determines the specific scope (conflict, CI, or both) from the live PR state in its own step 2.

**Both signals must be in their terminal state before this PR is eligible for locking.** "Terminal" means: mergeability is `MERGEABLE` or `CONFLICTING` (never `UNKNOWN`), AND every workflow check on the head SHA is `completed` (never `IN_PROGRESS` / `QUEUED` / `PENDING` / `WAITING` / `null`). A PR with even one mid-flight signal is skipped this fire — the engineer mustn't be dispatched while either input is still moving, or it wastes a worktree inspecting incomplete data.

#### 3.1 Mergeability gate

```bash
status="$(bash scripts/wait-mergeability.sh <pr-#>)"
```

Cap at ~10 s. `UNKNOWN` past the cap → skip with `mergeability still UNKNOWN`. Otherwise record whether the value is `CONFLICTING` (a blocker) or `MERGEABLE` (clean on this axis).

#### 3.2 Workflow-check gate

```bash
checks_json="$(bash scripts/inspect-checks.sh <pr-#>)"
running="$(printf '%s' "$checks_json" | jq '.running')"

if [ "$running" -gt 0 ]; then
  # internally count as skipped (checks still running); do not print per-PR
  continue
fi

failing="$(printf '%s' "$checks_json" | jq -c '.failing')"
```

If `running > 0` → skip with `checks still running`. Otherwise record whether `failing` is non-empty (a blocker) or empty (clean on this axis).

#### 3.3 Needs-fix decision

- Both signals terminal **and** at least one is a blocker (`CONFLICTING` mergeability OR non-empty `failing`) → continue to step 4 (lock + dispatch). Pass no scope info to the engineer — it inspects the PR itself.
- Both signals terminal **and** neither is a blocker (`MERGEABLE` mergeability AND empty `failing`) → track as skipped (nothing to fix) and continue. Clean PRs are merged by a separate lifecycle stage.
- Either signal mid-flight (mergeability `UNKNOWN` or any workflow still running) → skip with the matching reason; a later fire re-checks once everything has landed.

### 4. Lock with `status:fix-in-progress` (only when both signals are terminal and at least one is a blocker)

Only PRs that made it through step 3.3 as `needs-fix` reach this step. Mergeability is decided (`MERGEABLE` / `CONFLICTING`, never `UNKNOWN`), every workflow check is `COMPLETED`, and at least one of those signals is a blocker. Now add the lock label in one atomic `gh` call:

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
- `description`: one short paragraph — the PR URL and a one-liner saying the engineer determines the fix scope itself and owns the lifecycle until it pushes and removes `status:fix-in-progress` from the PR.
- `activeForm`: `Fixing PR #<pr-#>`

Capture the returned `taskId`.

If `TaskCreate` fails synchronously, roll back the lock (per step 4) and track as skipped (TaskCreate failed).

**5b. Dispatch the engineer and assign the tracking task**

Spawn each PR with the `Agent` tool, passing:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — the chosen agent name (e.g. `engineer-pr-128`)
- `run_in_background` — `true` (mandatory; see below)
- `prompt` — minimal; only the **PR number and the orchestrator `taskId`**. The engineer determines the fix scope itself.

`run_in_background: true` is non-negotiable. A foreground `Agent` call blocks the orchestrator turn until the engineer fully terminates, which (a) serializes PRs that were supposed to fan out in parallel and (b) lets the engineer's own terminal `TaskUpdate({ status: "completed" })` land before the orchestrator's `TaskUpdate({ owner })` — at which point the owner assignment races a finalized task and the harness UI never shows who owned the row.

Immediately follow the `Agent` call — in the **same batched response** — with `TaskUpdate({ taskId, owner: <agent-name> })` so the task row reflects the assignment before the backgrounded engineer makes meaningful progress. Never split the `Agent` and `TaskUpdate(owner)` calls across turns.

Independent PRs fan out in parallel: emit all the `Agent` calls AND their matching `TaskUpdate(owner)` calls together in one batched response. `TaskCreate` calls in step 5a may be batched the same way per fire.

If the `Agent` dispatch fails synchronously (bad `subagent_type`, missing tool, etc.), roll back BOTH the lock (per step 4) and the tracking task via `TaskUpdate({ taskId, status: "deleted" })`. Once the engineer is running, ownership transfers — it owns the terminal `status:fix-in-progress` removal and the tracking task's `completed` flip.

Use `templates/dispatch-prompt.md` as the prompt skeleton. Fill placeholders (`<pr-#>`, `<taskId>`) and pass as the `Agent` call's `prompt`. The template carries no scenario list — the engineer reads the PR's live mergeability and CI state via `gh` in its own step 2.

### 6. Honor the cap and report

If the user passed a positive integer N, stop after N PRs have been dispatched this run. Already-skipped PRs do not count.

Track dispatched / skipped counts internally per PR; do **not** print per-PR decisions to the user. After every candidate has been processed (or the cap is hit), emit exactly one line:

`Dispatched <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Drafts only.** ready-to-review PRs are not in scope for this skill. The slice PR stays draft until a separate lifecycle stage promotes + merges it; an engineer fix dispatch never targets a ready PR.
- **Skip `status:need-attention` PRs.** A prior engineer fix pass flagged these as needing human-in-the-loop (typically an E2E-spec rewrite). They stay skipped until the user clears the label — never relock them, never re-dispatch an engineer against them.
- **No review handling, no merging.** This skill does not touch `review:*` labels (those live on task issues now) and does not call `gh pr merge` (that happens in a separate lifecycle stage).
- **Lock before dispatch.** `status:fix-in-progress` is added in step 4 before the `TaskCreate` + `Agent` calls in step 5. The label is the lock that prevents concurrent fires from picking up the same PR. The engineer removes it as the terminal step of its push.
- **One orchestrator tracking task per dispatched engineer.** Every dispatched PR gets exactly one `TaskCreate` row, and the same agent `name` is used as the task `owner`. Never reuse a `taskId` across PRs and never spawn an `Agent` without a paired tracking task.
- **Roll back lock AND tracking task on synchronous dispatch failure.** If `Agent` errors synchronously, remove `status:fix-in-progress` from the PR and call `TaskUpdate({ taskId, status: "deleted" })`. Once the agent is running, ownership transfers (engineer removes the lock label and flips the tracking task to `completed`).
- **Background dispatch + same-message owner assignment.** Every `Agent` call MUST set `run_in_background: true` and MUST be emitted in the same response as its `TaskUpdate({ taskId, owner: <agent-name> })`. Foreground dispatch blocks the turn, serializes parallel PRs, and races the orchestrator's owner assignment against the engineer's own terminal task update.
- **Lock only when both signals are terminal AND at least one is a blocker.** Mergeability and the workflow-check rollup must both be in a settled state before the lock + dispatch fires, and at least one of them must indicate a blocker (`CONFLICTING` mergeability or a non-empty `failing` array). `UNKNOWN` mergeability or any `IN_PROGRESS` / `QUEUED` / `PENDING` workflow check is benign — skip the PR and let a later fire re-check once everything has landed.
- **Do not classify the fix scope — the engineer determines it.** The orchestrator decides only whether a PR needs a fix at all. Which specific scope (conflict, CI, or both) applies is the engineer's job: it inspects the live PR via `gh` in its own step 2. Never enumerate `conflict` / `ci` in the dispatch prompt.
- **One engineer per PR.** Each `Agent` call owns one PR. Independent PRs fan out as parallel `Agent` + `TaskUpdate(owner)` calls in the same response.
- **Skip clean PRs.** If a PR has green CI and is mergeable, leave it alone — clean PRs are merged in a separate lifecycle stage.
- **Skip, don't fail, on benign outcomes.** "Nothing to fix", "mergeability UNKNOWN", "lock race", "cap reached", "TaskCreate failed" are all expected — track internally and continue, never surface per-PR.
