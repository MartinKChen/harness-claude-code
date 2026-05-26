---
name: workflow-task-finder-prepare-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:in-progress` slices whose sub-issues are ALL closed AND that carry no `review:*` or `e2e:*` label yet. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-prepare-slice

Discovery slice for Stage 5 of `/implement-feature`. Identify every slice whose tasks have all closed and is ready to enter the E2E validation phase, and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 5 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List `level:slice` + `kind:feature` + `status:in-progress` slices in milestone `<feature-name>` whose sub-issues are ALL closed AND that carry no `review:*` AND no `e2e:*` label. The absence guards are the idempotence guard — a re-snapshot never re-reports a slice that's mid-validation or settled.

### 3. Emit the eligible list

```
- #<slice-#> | "<slice-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **Predicate: all sub-issues closed AND no `review:*` AND no `e2e:*` label present.** All three conditions matter — they are the idempotence guard.
- **`kind:feature` slices only.**
- **Drop silently on a gate miss.** No `SKIPPED:` block.
- **Milestone-scoped.** `<feature-name>` is mandatory.
