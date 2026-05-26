---
name: workflow-task-finder-fix-pr
description: "Discovery-only. List draft PRs in the milestone with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` or `status:need-attention`. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-pr

Discovery slice for Stage 8 of `/implement-feature`. Identify every draft PR that's blocked on CI failure or a merge conflict and emit the eligible list. The dispatched engineer (owned by `/implement-feature`) determines whether the fix is conflict, CI, or both — this skill does not classify.

## When to activate

Invoked by the `task-finder` agent during Stage 8 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List broken draft PRs

List draft PRs in milestone `<feature-name>` whose `--status broken` predicate matches (mergeability `CONFLICTING` OR any check rollup state of FAILURE / CANCELLED / TIMED_OUT), excluding any PR already carrying `status:fix-in-progress` or `status:need-attention`.

### 3. Apply the defense-in-depth re-check

For each candidate, re-pull live state and confirm both signals are terminal AND at least one is still a blocker:

- `mergeable == "UNKNOWN"` OR `checks == "PENDING"` → drop (still moving; a later snapshot re-checks).
- `mergeable == "MERGEABLE"` AND `checks == "SUCCESS"` → drop (clean now; close-pr discovery will pick it up).
- Otherwise → blocker present, keep the candidate.

### 4. Emit the eligible list

```
- PR #<pr-#> | "<pr-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **Drafts only.** Ready-to-review PRs are out of scope.
- **Skip `status:need-attention` PRs.** A prior engineer fix bailed for human-in-the-loop work.
- **Lock only when both signals are terminal AND at least one is a blocker.** Mid-flight signals (`UNKNOWN` / `PENDING`) → drop silently.
- **Drop silently on every gate.** No `SKIPPED:` block.
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Do not classify the fix scope.** The engineer dispatched by `/implement-feature` inspects the live PR itself.
