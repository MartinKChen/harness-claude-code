---
name: workflow-task-finder-kickoff-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:ready-to-implement` slices with zero open blockers — these are the slices that the `/implement-feature` command should promote to `status:in-progress` and whose `kind:feature` task sub-issues should receive `status:ready-to-implement`. Read-only — never mutates labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-kickoff-slice

Discovery slice for Stage 1 of `/implement-feature`. Identify every slice issue in the milestone that is ready to be promoted (and whose task sub-issues are ready to be unlocked), apply the blocker-count gate, and emit the eligible list. This skill never flips labels, never mutates state.

The caller (`task-finder` agent) feeds the output into its aggregated report. The dispatcher (`/implement-feature` command) then performs the actual slice promotion and sub-issue label flips.

## When to activate

Invoked by the `task-finder` agent during Stage 1 discovery. Not user-invocable — the dispatcher chains it via `task-finder` rather than calling it standalone.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

List slice issues filtered by `level:slice` + `kind:feature` + `status:ready-to-implement` + milestone `<feature-name>`. Include `number`, `title`, `url`, `labels`, and `issueDependenciesSummary` in the response.

### 3. Apply the open-blocker gate

For each candidate, look up open-blocker count from `issueDependenciesSummary.blockedBy` (the authoritative GraphQL field — do NOT parse `Blocked by` text from issue bodies). Drop the candidate when `blocked_by > 0`. Closed blockers do not count.

### 4. Emit the eligible list

Emit one line per eligible candidate:

```
- #<slice-#> | "<slice-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No `gh issue edit`, no `gh issue close`, no label flips, no `TaskCreate`, no `Agent`.
- **Open-blocker count comes from `issueDependenciesSummary.blockedBy`.** Never parse `Blocked by` from issue bodies.
- **`kind:feature` only.** Bugs / enhancements out of scope.
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Drop silently on gate failure.** No `SKIPPED:` block, no reason field, no negative output.
- **One snapshot.** Run the query once and report; do not re-query.
