---
name: workflow-orchestrator-fix-pr
description: "Scan draft PRs for any merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` or `status:need-attention`; lock with `status:fix-in-progress` and dispatch a background `engineer` to fix. The engineer determines the specific fix scope (conflict, CI, or both) from the live PR state. Activate on 'fix the failing PRs', '/workflow-orchestrator-fix-pr'."
---

# workflow-orchestrator-fix-pr

Drive the fix-routing pass for draft PRs that can't merge yet — either at least one Actions workflow check failed on the head branch, or the branch conflicts with its merge target. Decide whether each PR needs a fix at all, lock it so concurrent fires don't double-pick, and dispatch a background `engineer`. The engineer determines what to fix (conflict, CI, or both) by inspecting the live PR state itself.

This skill does NOT review PRs, does NOT flip `review:*` labels, and does NOT merge PRs. Reviews live on issues; merging is `workflow-orchestrator-close-pr`'s lane.

The skill never checks out, edits, or pushes to any branch.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-fix-pr` (with or without arguments).
- Asks to "fix the failing PRs", "clear CI / conflict blockers on draft PRs", "dispatch engineers against red PRs".

Do NOT activate to merge clean draft PRs (`workflow-orchestrator-close-pr`), to review code (`workflow-orchestrator-review-*`), or to fix issue-level reviewer findings (`workflow-orchestrator-fix-task` / `workflow-orchestrator-fix-slice`).

## Arguments

`[<milestone-name>] [<cap>]`.

## Workflow

### 1. Resolve the repo

### 2. List broken draft PRs

List draft PRs whose `--status broken` predicate matches (mergeability `CONFLICTING` OR any check rollup state of FAILURE / CANCELLED / TIMED_OUT), excluding any PR already carrying `status:fix-in-progress` or `status:need-attention`.

If the list is empty, report `nothing to pick up` and stop.

### 3. Defense-in-depth re-check

For each candidate, re-pull live state and confirm both signals are terminal and at least one is still a blocker:

- `mergeable == "UNKNOWN"` OR `checks == "PENDING"` → skip (still moving; a later fire re-checks).
- `mergeable == "MERGEABLE"` AND `checks == "SUCCESS"` → skip (clean now; close-pr will pick it up).
- Otherwise → blocker present, continue to step 4.

### 4. Lock the PR with `status:fix-in-progress`

Add the `status:fix-in-progress` label to the PR.

If the label was just added by a concurrent fire (`422`), benign — skip. Anything else → surface and stop.

The lock MUST happen before the dispatch in step 5. On synchronous dispatch failure, roll back by removing `status:fix-in-progress`.

### 5. Create tracking task, then dispatch the engineer

Name pattern: `engineer-fix-pr-<pr-#>`.

**5a. TaskCreate**

```
subject:     Fix PR #<pr-#>: <pr-title>
description: <pr-url>. Engineer determines fix scope (conflict/CI/both)
             from live PR state. Agent owns the lifecycle until it pushes
             and removes status:fix-in-progress from the PR.
activeForm:  Fixing PR #<pr-#>
```

If TaskCreate fails synchronously → roll back lock, skip.

**5b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Fix PR" dispatch-prompt skeleton with `<pr-#>`. Dispatch:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — `engineer-fix-pr-<pr-#>`
- `run_in_background` — `true`
- `prompt` — the filled skeleton

Pair with `TaskUpdate({ taskId, owner })` in the same batched response. Independent PRs fan out in parallel.

On synchronous `Agent` failure → roll back lock + delete tracking task.

### 6. Honor cap and report

`Dispatched <X> PR fix(es); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Drafts only.** Ready-to-review PRs are not in scope here.
- **Skip `status:need-attention` PRs.** A prior engineer fix bailed for human-in-the-loop work (typically an E2E spec rewrite) — leave them alone until the user clears the label.
- **No review handling, no merging.**
- **Lock before dispatch.** `status:fix-in-progress` is the lock. The engineer removes it as the terminal step of its push.
- **One orchestrator tracking task per dispatched engineer.**
- **Background dispatch + same-message owner assignment.**
- **Lock only when both signals are terminal AND at least one is a blocker.** Mid-flight signals (`UNKNOWN` mergeability, `PENDING` checks) → skip and let a later fire re-check.
- **Do not classify the fix scope.** The engineer inspects the live PR itself.
- **One engineer per PR.**
- **Skip clean PRs.** close-pr handles those.
- **Skip, don't fail, on benign outcomes.**
