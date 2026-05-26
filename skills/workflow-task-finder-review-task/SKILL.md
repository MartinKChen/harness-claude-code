---
name: workflow-task-finder-review-task
description: "Discovery-only. List `level:task`+`kind:feature`+`status:in-progress` tasks carrying `review:pending` — these are tasks awaiting code review. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-review-task

Discovery slice for Stage 3 of `/implement-feature`. Identify every task issue waiting on review and emit the eligible list. This skill never flips labels, never dispatches agents.

## When to activate

Invoked by the `task-finder` agent during Stage 3 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List task issues filtered by `level:task` + `kind:feature` + `status:in-progress` + `review:pending` + milestone `<feature-name>`.

### 3. Emit the eligible list

One line per eligible candidate:

```
- #<task-#> | "<task-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no comments, no closes, no `TaskCreate`, no `Agent`.
- **Reviews live on task issues.** `review:*` is on `level:task` / `level:slice` issues, never on PRs.
- **`kind:feature` only.**
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Drop silently on a gate miss.** No `SKIPPED:` block.
