---
name: workflow-task-finder-close-pr
description: "Discovery-only. List draft PRs in the milestone labeled `merge:auto` that are MERGEABLE with every check rollup state SUCCESS / NEUTRAL / SKIPPED, with their linked slice number resolved from the PR body's `Closes #<slice-#>` line. Read-only — never promotes draft → ready, never merges, never writes memory. `merge:manual` drafts are excluded. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-close-pr

Discovery slice for Stage 9 of `/implement-feature`. Identify every draft PR opted into auto-merge (`merge:auto`) that is currently clean (mergeable + all checks green) and resolve its linked slice number. Emit the eligible list.

The actual `gh pr ready` + `gh pr merge --squash --delete-branch` work — and the post-merge per-slice memory signal capture — are owned by `/implement-feature`'s Stage 9, NOT by this skill.

## When to activate

Invoked by the `task-finder` agent during Stage 9 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Resolve the repo

### 2. List candidate PRs

List draft PRs in milestone `<feature-name>` filtered by `merge:auto` AND `--status green` (mergeable `MERGEABLE` AND every check rollup state SUCCESS / NEUTRAL / SKIPPED).

`merge:manual` drafts are out of scope — those are left in draft for the user to promote and merge manually.

### 3. Resolve the linked slice for each candidate

For each candidate, parse the PR body's first `Closes #<slice-#>` line (added by `workflow-reviewer-review-slice` when the draft was created). Drop the candidate silently if no `Closes #<n>` line is found — that PR is malformed and the dispatcher cannot wire up slice closure.

### 4. Emit the eligible list

```
- PR #<pr-#> | slice:<slice-#> | "<pr-title>"
```

Empty result → emit the single line `- (none)`.

## Iron rules

- **Read-only.** No `gh pr ready`, no `gh pr merge`, no memory writes, no `TaskCreate`, no `Agent`.
- **`merge:auto` only.** `merge:manual` PRs are out of scope.
- **`SKIPPED` / `NEUTRAL` checks count as green.**
- **Defense-in-depth re-check at merge time is owned by `/implement-feature`** — not here.
- **Drop silently on a malformed PR body (no `Closes #<slice-#>` line).** No `SKIPPED:` block, no reason field.
- **Milestone-scoped.** `<feature-name>` is mandatory.
