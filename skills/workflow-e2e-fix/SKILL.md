---
name: workflow-e2e-fix
description: "Address reviewer findings on one `type:e2e` task on the parent slice branch. Read the task body and every comment newer than the last `Refs #<task-#>` commit, set up the slice worktree, modify specs per the comments, commit with dual `Refs` trailers, push, add `review:pending`. Activate when dispatched with `Fix the review feedback on GitHub task issue #<n>` for a `type:e2e` task, or on '/workflow-e2e-fix'."
---

# workflow-e2e-fix

Counterpart of `workflow-e2e-author` for the fix lane. Address reviewer findings on a single `type:e2e` task issue. The orchestrator has stripped `review:need-fix` as its lock; scope is read from the most recent reviewer comment on the task issue (newer than the slice branch's last commit referencing this task).

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`.
- The user types `/workflow-e2e-fix`, or phrases like "address the E2E reviewer findings on #<n>".

Do NOT activate to author fresh E2E specs (use `workflow-e2e-author`), or to fix production code (engineer's lane via `workflow-engineer-fix-task`).

## Workflow

### 1. Read the task body

Fetch the task issue (number, title, body, labels, url) via `gh issue view`.

### 2. Determine the comment window

The cutoff is the authored timestamp of the most recent commit on the slice branch carrying `Refs #<task-#>` in its message. Comments created strictly after that timestamp are in scope; comments at or before it belong to previously-addressed rounds.

- Resolve the parent slice's attached branch from the task.
- Fetch that branch from `origin`.
- Find the cutoff: authored timestamp of the latest commit on `origin/<slice-branch>` whose message contains `Refs #<task-#>`.

If no `Refs #<task-#>` commit exists on the branch yet, read all comments on the task.

Pull every comment on the task issue, filter to those newer than the cutoff. Both reviewer comments (`# Code Review` / `# Review` header) AND user-posted directives in this window are in scope. User directives override reviewer suggestions when they conflict.

If no in-scope comment exists, halt and surface `fix dispatched but no comment newer than the last Refs #<task-#> commit on the task`.

### 3. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the slice branch, rebased onto `origin/main`. `cd` into the worktree path.

Rebase conflict → bail to `status:need-attention` (post a diagnostic comment on the task first).

### 4. Modify / add specs per the in-scope comment(s)

The agent's loaded pattern set owns the E2E conventions; this skill owns only the workflow.

**Pickup by the reviewer's fix-class.** Reviewer comments tag every finding `[<class> · I:<x>/E:<y>] <title>` where `<class>` ∈ {`Fix now`, `Defer`, `Nit`} (see `workflow-reviewer-review-task` step 5 for the Impact × Effort/Risk matrix). Apply only `Fix now` findings in this cycle; treat `Defer` as advisory and `Nit` as optional unless obviously trivial and already in-scope. User directives in the same comment window override the class — they always win.

Legacy reviewer comments (severity-only, no `[<class>]` prefix): CRITICAL / HIGH → Fix now, MEDIUM → Defer, LOW → Nit.

Smoke-run each touched spec; confirm it reaches a real assertion.

### 5. Commit with dual `Refs` trailers

Use the project's Conventional Commits format. Every commit body ends with:

```
Refs #<task-#>
Refs #<slice-#>
```

Commits land on the slice branch inside the worktree.

### 6. Push and add `review:pending`

Push the slice branch to `origin`, then add the `review:pending` label to the task issue.

Terminal action. Exit.

## Iron rules

- **Scope from the comment window, not from labels.** The orchestrator stripped the gate label as its lock. Read the latest reviewer comment newer than the last `Refs #<task-#>` commit.
- **User directives override reviewer suggestions.** When a user-posted comment in the same window contradicts the reviewer's proposed fix, the user's instruction wins.
- **Every commit carries BOTH `Refs` trailers.**
- **Never patch production code from this lane.**
- **Bail with `status:need-attention`** on unrecoverable blockers.
- **Truth is in Git and on the task labels.**
