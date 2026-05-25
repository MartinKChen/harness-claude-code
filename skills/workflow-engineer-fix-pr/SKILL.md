---
name: workflow-engineer-fix-pr
description: "Fix merge-blocking issues on one open draft slice PR. Determine the scope (conflict, CI, or both) from live PR state, read every PR-issue comment newer than the slice branch's last commit, set up the slice worktree, merge main first to resolve conflicts, drive RED→GREEN for CI failures, commit with `Refs #<pr-#>` + `Refs #<slice-#>` trailers, push, remove `status:fix-in-progress`. Activate when dispatched with `Fix PR #<pr-#>` or '/workflow-engineer-fix-pr'."
---

# workflow-engineer-fix-pr

Address `{conflict, ci}` blockers on a single open draft slice PR dispatched by `workflow-orchestrator-fix-pr`. The orchestrator has added `status:fix-in-progress` as its lock; this skill determines the specific scope from the live PR state, fixes it, pushes, and removes the lock.

When a CI failure is confirmed to require modifying an E2E spec rather than production code, STOP and flip the PR to `status:need-attention` — the user owns spec rewrites.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix PR #<pr-#>` and the PR carries `status:fix-in-progress`.
- The user types `/workflow-engineer-fix-pr`, or phrases like "fix the failing CI on PR #<n>", "resolve the merge conflict on this PR".

Do NOT activate to merge a clean PR (use `workflow-orchestrator-close-pr`), to review code (reviewer's lane), or to fix issue-level reviewer findings (use `workflow-engineer-fix-task`).

## Workflow

### 1. Determine the fix scope from live PR state

Pull the PR's mergeability, check status, head ref, and last-commit timestamp. The fix scope is the non-empty subset of `{conflict, ci}`:

- `mergeable == "CONFLICTING"` → `conflict`.
- `checks == "FAILED"` → `ci`.
- Both → both, with `conflict` addressed first (merging main may also fix CI by pulling in the canonical fix).

If neither is present, the PR has gone clean since dispatch — remove the `status:fix-in-progress` label and exit.

### 2. Read PR-issue comments newer than the last commit (user directives override)

Fetch every comment on the PR issue newer than the PR's last-commit timestamp. Any user-posted comment in this window is binding — apply explicit instructions over default fix paths.

### 3. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the PR's head branch (no rebase — this skill explicitly merges main itself), then `cd` into the worktree path.

### 4. Address `conflict` first (when in scope)

Merge `origin/main` into the slice branch directly inside the worktree (fetch first).

Resolve conflicts by union when the intent is clear. If union resolution would require expanding scope, STOP and bail by posting a diagnostic comment on the PR and flipping the PR from `status:fix-in-progress` to `status:need-attention`.

If a regression surfaces after the merge, drop into RED→GREEN with `Refs #<pr-#>` + `Refs #<slice-#>` trailers, commit the fix, then proceed.

### 5. Address `ci` (when in scope)

Pull the failing workflow run's logs (`gh pr checks <pr-#>` to find the failing workflow, `gh run view <run-id> --log` to inspect the failure).

Keep the failing test failing first (confirm RED). Drive the minimum production change to GREEN. Propagate equivalent sites via `rg` (each gets its own RED→GREEN).

**E2E-spec bail.** If the failing test is an E2E spec whose assertions need to change (not the production code under test), STOP. The user owns spec rewrites. Bail to `status:need-attention` per step 4.

### 6. Audit container surface and `.env.example` for drift

The agent's loaded patterns own the rules. Commit any drift fixes with `Refs #<pr-#>` + `Refs #<slice-#>` trailers.

### 7. Push and remove the lock

Push the slice branch to `origin`, then remove the `status:fix-in-progress` label from the PR.

Pre-push hooks gate as usual; a hook failure drops back to RED→GREEN. Never force-push, never skip hooks.

Terminal action. Exit. Do NOT promote draft → ready.

## Iron rules

- **Determine the scope from live PR state.** Inspect mergeability + checks yourself.
- **User directives in the comment window override everything else.**
- **`conflict` before `ci`.** Merging main may resolve the CI failure too.
- **Resolve conflicts by union when possible; bail to `status:need-attention`** when union resolution would require scope expansion.
- **Bail to `status:need-attention`** when a CI failure points at an E2E spec that needs rewriting.
- **Every commit carries `Refs #<pr-#>` + `Refs #<slice-#>`** (the unit of work is the PR).
- **Each ci-track fix starts with a failing test.** Propagate equivalents via `rg`.
- **No promotion to ready.** Lock removal is the terminal action.
- **Truth is in Git and on the PR labels.**
