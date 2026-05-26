---
name: workflow-task-finder-implement-task
description: "Discovery-only. List `level:task`+`kind:feature`+`status:ready-to-implement` tasks with zero open blockers and no sibling task currently editing the same slice worktree, classified by `type:*` into the matching agent type (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-implement-task

Discovery slice for Stage 2 of `/implement-feature`. Identify every task issue ready to be implemented + unblocked + not slice-locked, classify it by `type:*`, and emit the eligible list. This skill never flips labels, never dispatches agents.

## When to activate

Invoked by the `task-finder` agent during Stage 2 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidate task issues

List task issues filtered by `level:task` + `kind:feature` + `status:ready-to-implement` + milestone `<feature-name>`, excluding `status:need-attention`.

Sort order is fixed: `type:e2e` (0) → `type:backend` (1) → `type:frontend` (2), then by issue number.

### 3. Apply the open-blocker gate

Drop when `issueDependenciesSummary.blockedBy > 0`. Closed blockers do not count.

### 4. Apply the slice-in-flight gate

Sibling tasks under the same parent slice share one `/tmp/git-worktree/<repo>/<slice-branch>` directory. Count sibling tasks currently being EDITED (predicate: `status:in-progress` AND no `review:*` label). Drop when `in_flight > 0`. The dropped task remains eligible for a later snapshot once the in-flight agent finishes.

### 5. Apply the `type:*` gate

A task must carry exactly one of `type:e2e` / `type:backend` / `type:frontend`. Tasks with none — or with more than one — are dropped silently.

Map:

| `type:*` | `<subagent_type>` |
|----------|-------------------|
| `type:e2e`      | `e2e-author` |
| `type:backend`  | `engineer`   |
| `type:frontend` | `engineer`   |

### 6. Resolve the parent slice

For each eligible candidate, resolve the parent slice issue number. Prefer the GraphQL sub-issue / parent relationship over body-text parsing.

### 7. Emit the eligible list

One line per eligible candidate, in the sort order from step 2:

```
- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<task-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **`kind:feature` only.**
- **One agent per slice worktree.** Step 4 enforces by dropping any candidate whose parent slice already has a sibling task in flight.
- **`type:*` decides the agent type, never the body.**
- **Malformed `type:*` (none, or more than one) is dropped silently.** Do not invent the routing.
- **Drop silently on every gate.** No `SKIPPED:` block, no reason field.
- **Milestone-scoped.** `<feature-name>` is mandatory.
