---
name: workflow-engineer-fix-slice
description: "Address reviewer findings on one slice issue, then re-validate the slice's E2E specs via testcontainers. Read the slice body and every comment newer than the last `Refs #<slice-#>` commit, set up the slice worktree, drive TDD per findings (production code only — never modify E2E specs), re-run E2E and iterate to GREEN, push, add `review:pending`. On a test-case constraint during the E2E re-run: flip to `status:need-attention` and exit. Activate when dispatched with `Fix the review feedback on GitHub slice issue #<n>` or '/workflow-engineer-fix-slice'."
---

# workflow-engineer-fix-slice

Slice-level counterpart of `workflow-engineer-fix-task`. Address reviewer findings on a single `level:slice` GitHub issue dispatched by `workflow-orchestrator-fix-slice`. The orchestrator has stripped `review:need-fix` as its lock; scope is read from the most recent reviewer comment on the slice issue (newer than the slice branch's last `Refs #<slice-#>` commit), with user directives in the same window overriding.

After production-code fixes land, this skill **re-runs the slice's E2E specs via testcontainers** — slice-level reviewer findings often introduce regressions, and the slice can't go back into review until the E2E suite is still green. Never modify the E2E specs; bail to `status:need-attention` if a spec failure cannot be addressed via production-code changes.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on GitHub slice issue #<n>` and the slice carries `level:slice` + `kind:feature` + `status:in-progress`.
- The user types `/workflow-engineer-fix-slice`, or phrases like "fix slice #<n> per the reviewer findings".

Do NOT activate to fix a task (use `workflow-engineer-fix-task`), to fix a PR (use `workflow-engineer-fix-pr`), or to validate a fresh slice (use `workflow-engineer-e2e`).

## Workflow

### 1. Read the slice body

Fetch the slice issue (number, title, body, labels, url) via `gh issue view`.

### 2. Determine the comment window and pull in-scope comments

The cutoff is the authored timestamp of the most recent commit on the slice branch carrying `Refs #<slice-#>`:

- Resolve the slice's attached branch.
- Fetch that branch from `origin`.
- Find the cutoff: authored timestamp of the latest commit on `origin/<slice-branch>` whose message contains `Refs #<slice-#>`.

If no `Refs #<slice-#>` commit exists on the branch yet, read all comments on the slice.

Pull every comment on the slice issue. Read **non-reviewer comments first** — user-posted directives in this window are binding and override reviewer suggestions, ADRs, and default conventions. Then read the latest reviewer comment (header `# Slice Review` / `# Review`) newer than the cutoff.

If no in-scope reviewer comment exists, halt and surface `fix dispatched but no reviewer comment newer than the last Refs #<slice-#> commit on the slice`.

Triage findings: CRITICAL / HIGH / MEDIUM → must-fix. LOW / NIT → fix only when obviously small and in-scope.

### 3. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the slice branch (no rebase), then `cd` into the worktree path.

### 4. Drive TDD on production code per the findings

Address each must-fix finding via the agent's loaded TDD pattern (RED before any production change, `rg`-driven pattern propagation, container + `.env.example` drift audit). Production code only — never modify E2E specs in this lane.

Commit at the TDD cadence using the project's Conventional Commits format. Every commit ends with `Refs #<slice-#>` (single trailer — slice-level work, no task context).

### 5. Re-run the slice's E2E specs via testcontainers

After the production-code fixes are GREEN at the unit/integration layer, re-validate the slice's E2E specs against a real stack:

- Fetch `origin/main`.
- Collect the slice's touched E2E specs: `git diff --name-only origin/main..HEAD -- 'e2e/**/*.spec.*' '**/e2e/**/*.spec.*' | sort -u`.
- Slug the slice branch name (lowercase, non-alphanumeric → `-`) for per-slice container isolation.
- Bring up the stack (pattern-owned details) and run Playwright against the collected specs.

### 6. Iterate on E2E failures (production-only fixes)

For each E2E failure:

- **Production-code regression introduced by the fix**: drop into RED→GREEN in production land (unit/integration test that mirrors the E2E symptom), commit with `Refs #<slice-#>`, re-run.
- **Test-case constraint** (the fix invalidated an assumption the spec encodes, but the right answer is to change the spec — different selector, different fixture identity, different flow): STOP. Bail by posting a diagnostic comment on the slice issue and flipping the slice from `status:in-progress` to `status:need-attention`. The diagnostic names the spec file, the failing assertion / fixture, what production change the reviewer demanded, and why the spec can't accommodate it without modification. Exit.

**Never modify the E2E specs.** If the production-code fix doesn't land cleanly without spec changes, that's a `status:need-attention` bail.

### 7. Push and add `review:pending`

Push the slice branch to `origin`, then add the `review:pending` label to the slice issue.

Pre-push hooks gate as usual; a hook failure drops back to step 4 or step 5 as appropriate. Never force-push, never skip hooks.

Terminal action. Exit. Do NOT close the slice, do NOT touch `status:in-progress`.

## Iron rules

- **User directives in the comment window override everything else.**
- **Scope from the comment window, not from labels.** The orchestrator's lock stripped the gate label.
- **Skip previously-addressed rounds.** Only comments newer than the last `Refs #<slice-#>` commit are in scope.
- **Production-only fixes.** Never modify E2E specs from this lane.
- **Re-validate E2E after the reviewer-driven fix.** A reviewer finding addressed in isolation is half done — confirm the slice's E2E suite is still green before flipping `review:pending`.
- **Bail loud on E2E test-case constraints.** `status:need-attention` + diagnostic comment, then exit.
- **Every commit carries `Refs #<slice-#>`** (single trailer).
- **Each must-fix finding starts with a failing test.** Propagate equivalents via `rg`.
- **Truth is in Git and on the slice labels.**
