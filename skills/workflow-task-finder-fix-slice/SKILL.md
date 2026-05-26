---
name: workflow-task-finder-fix-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:in-progress` slices carrying `review:need-fix` — these are slices whose slice-level reviewer verdict came back as need-fix and must be picked up by `engineer`. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-slice

Discovery slice for Stage 7 of `/implement-feature`. Identify every slice whose slice-level reviewer flagged integration / cross-task issues and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 7 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List slice issues filtered by `level:slice` + `kind:feature` + `status:in-progress` + `review:need-fix` + milestone `<feature-name>`.

### 3. Emit the eligible list

```
- #<slice-#> | "<slice-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **Slice-level only.** Task-level fixes are `workflow-task-finder-fix-task`'s lane; PR-level fixes are `workflow-task-finder-fix-pr`'s lane.
- **`review:running` means a review is still in flight — drop.**
- **Drop silently on a gate miss.** No `SKIPPED:` block.
- **`kind:feature` only.**
- **Milestone-scoped.** `<feature-name>` is mandatory.
