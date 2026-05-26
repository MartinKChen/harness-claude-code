---
name: workflow-task-finder-review-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:in-progress` slices carrying `review:pending` — these are slices awaiting slice-level review. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-review-slice

Discovery slice for Stage 6 of `/implement-feature`. Identify every slice issue waiting on slice-level review and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 6 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List slice issues filtered by `level:slice` + `kind:feature` + `status:in-progress` + `review:pending` + milestone `<feature-name>`.

### 3. Emit the eligible list

```
- #<slice-#> | "<slice-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **Slice-level only.** Task reviews are `workflow-task-finder-review-task`'s lane.
- **`kind:feature` only.**
- **Drop silently on a gate miss.** No `SKIPPED:` block.
- **Milestone-scoped.** `<feature-name>` is mandatory.
