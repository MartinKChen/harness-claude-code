---
name: workflow-task-finder-fix-task
description: "Discovery-only. List `level:task`+`kind:feature`+`status:in-progress` tasks carrying `review:need-fix` and no sibling currently editing the same slice worktree, classified by `type:*` into the matching agent type (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-task

Discovery slice for Stage 4 of `/implement-feature`. Identify every task issue whose reviewer verdict came back as `need-fix` that is not currently slice-locked, classify by `type:*`, and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 4 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List task issues filtered by `level:task` + `kind:feature` + `status:in-progress` + `review:need-fix` + milestone `<feature-name>`.

### 3. Apply the slice-in-flight gate

Same predicate as `workflow-task-finder-implement-task` step 4 — sibling tasks on the same slice share a worktree. Count sibling tasks currently being edited (`status:in-progress` AND no `review:*` label). Drop when `in_flight > 0`.

### 4. Apply the `type:*` gate

Map identically to `workflow-task-finder-implement-task` step 5. Malformed `type:*` (none, or more than one) drops silently.

### 5. Resolve the parent slice

Resolve via GraphQL parent relationship, not body parsing.

### 6. Emit the eligible list

```
- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<task-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **Only `review:need-fix` triggers this skill.** `review:running` means a review cycle is still in flight — drop.
- **One agent per slice worktree.** Step 3 enforces.
- **`type:*` decides the agent type.**
- **Drop silently on every gate.** No `SKIPPED:` block.
- **`kind:feature` only.**
- **Milestone-scoped.** `<feature-name>` is mandatory.
