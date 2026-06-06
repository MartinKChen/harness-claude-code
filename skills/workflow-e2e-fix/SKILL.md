---
name: workflow-e2e-fix
description: "Address coverage-gate findings on a slice's authored E2E specs. Read the newest coverage-gate review comment on the slice (the one posted after the last `Refs #<slice#>` commit), set up the slice worktree, modify the specs per the comment, commit with `Refs #<slice#>` + `Task: <id>` trailers, push, post a summary comment. Activate when dispatched with `Fix E2E coverage feedback on slice #<n>`, or on '/workflow-e2e-fix'."
---

# workflow-e2e-fix

Counterpart of `workflow-e2e-author` for the fix lane. Address the coverage gate's findings on a slice's authored E2E specs. Scope is read from the most recent coverage-gate review comment on the slice (newer than the slice branch's last `Refs #<slice#>` commit). No label drives this — the calling workflow holds the slice lock and re-gates after the fix.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix E2E coverage feedback on slice #<n>`.
- The user types `/workflow-e2e-fix`, or phrases like "address the E2E coverage findings on slice #<n>".

Do NOT activate to author fresh E2E specs (use `workflow-e2e-author`), or to fix production code (engineer's lane via `workflow-engineer-fix-slice`).

## Input contract

Read the slice issue #<n> body. Locate the task block(s) in the `## Tasks` checklist (each entry is a header `[ ] \`<id>\` · **<type>** · blocked-by <ids|—>`, the delivery on the next line, a `covers:` + `contract:`/`entry-source:`/`done:` pointer line, then `scenario:` and a fenced ```gherkin block of named Scenarios). The checklist is the durable task ledger — a box already checked `[x]` means that task is DONE. Read the slice's Acceptance criteria (EARS) and each e2e task's own `scenario:` Gherkin for the behavior the specs must cover; follow each e2e task's `scenario:` Gherkin for the unit spec.

## Workflow

### 1. Read the slice body

Fetch the slice issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Parse the `## Tasks` checklist for the e2e tasks under review.

### 2. Determine the comment window

The cutoff is the authored timestamp of the most recent commit on the slice branch carrying `Refs #<slice#>` in its message. Comments created strictly after that timestamp are in scope; comments at or before it belong to previously-addressed rounds.

- Resolve the slice's attached branch.
- Fetch that branch from `origin`.
- Find the cutoff: authored timestamp of the latest commit on `origin/<slice-branch>` whose message contains `Refs #<slice#>`.

If no `Refs #<slice#>` commit exists on the branch yet, read all comments on the slice.

Pull every comment on the slice issue, filter to those newer than the cutoff. Read the newest coverage-gate review comment in this window (the verdict comment posted by the coverage gate after the last commit). User-posted directives in the same window are binding and override the reviewer's suggestions when they conflict.

If no in-scope comment exists, halt and surface `fix dispatched but no coverage-gate comment newer than the last Refs #<slice#> commit on the slice`.

### 3. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the slice branch (do **not** integrate `origin/main` — fixing happens on the slice branch as-is; main is integrated once, later, at the Pass-E2E phase via `workflow-engineer-diagnose-e2e`). Check the branch for prior `Refs #<slice#>` WIP commits to ground what's already landed. `cd` into the worktree path.

### 4. Modify / add specs per the in-scope comment(s)

The agent's loaded pattern set owns the E2E conventions; this skill owns only the workflow.

**Pickup by the reviewer's fix-class.** Coverage-gate findings are tagged `[<class> · I:<x>/E:<y>] <title>` where `<class>` ∈ {`Fix now`, `Defer`, `Nit`} (see `workflow-reviewer-review-slice` for the Impact × Effort/Risk matrix). Apply only `Fix now` findings in this cycle; treat `Defer` as advisory and `Nit` as optional unless obviously trivial and already in-scope. User directives in the same comment window override the class — they always win.

Legacy reviewer comments (severity-only, no `[<class>]` prefix): CRITICAL / HIGH → Fix now, MEDIUM → Defer, LOW → Nit.

Smoke-run each touched spec; confirm it reaches a real assertion.

### 5. Commit with `Refs` + `Task` trailers

Use the project's Conventional Commits format. Every commit body ends with:

```
Refs #<slice#>
Task: <static-id>
```

`<static-id>` is the checklist id whose specs the commit changes (e.g. `Task: e2e.1`). Commits land on the slice branch inside the worktree.

### 6. Push and post a summary comment

Push the slice branch to `origin`, then post a comment on the slice issue summarizing what was changed and which findings were addressed via `bash skills/operation-git/scripts/post-comment.sh <n> <file>`.

Terminal action. Exit. Do NOT flip any label — the calling workflow re-runs the coverage gate.

## Iron rules

- **Scope from the comment window, not from labels.** Read the newest coverage-gate comment newer than the last `Refs #<slice#>` commit.
- **User directives override reviewer suggestions.** When a user-posted comment in the same window contradicts the reviewer's proposed fix, the user's instruction wins.
- **Every commit carries `Refs #<slice#>` + `Task: <id>`.**
- **Never patch production code from this lane.**
- **Resume from the checklist + WIP commits.** Reconcile against already-`[x]` tasks and prior `Refs #<slice#>` commits before re-touching specs.
- **Bail with `status:need-attention`** on unrecoverable blockers. Post a diagnostic comment first.
- **Truth is in Git, the checklist, and the comment.**
