---
name: fix-e2e-tests
description: "Fix Playwright E2E test cases on a single GitHub task issue (`type:e2e`) per the code reviewer's findings. Resolve the parent slice issue and its slice branch, set up (or reuse) a slice-scoped worktree rebased onto `origin/main`, read the most recent `# Code Review` comment on the task, address each must-fix finding against the cited test files, smoke-run each touched spec to confirm it still reaches a real assertion, commit using the Conventional Commits format from `templates/commit-messages.md`, push, and flip `review:code-passed` / `review:code-need-fix` back to `review:code-pending` so `review-task-issue` dispatches a fresh `code-reviewer`. Activate when the dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `type:e2e`, or when the user types phrases like 'address the E2E reviewer findings on #<n>', 'fix the code-review on this E2E task', '/fix-e2e-tests'. Do NOT activate to author fresh E2E specs from scratch (use `author-e2e-tests`), or to fix production code (that is `engineer`'s lane via `fix-task-feedback`)."
---

# fix-e2e-tests

Address the `code-reviewer`'s findings on a single `type:e2e` GitHub task issue. The work is self-driven from the task issue ID: discover the parent slice issue and its slice branch, set up (or reuse) the slice-scoped worktree, read the most recent `# Code Review` comment as the source-of-truth fix list, edit only test code (never production code), smoke-run each touched spec, commit using the Conventional Commits format from `templates/commit-messages.md`, push, and reset the `review:code-*` label back to `review:code-pending` so a fresh review cycle picks up the fix.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`, with `review:code-need-fix` present (or already flipped to `review:code-pending` by the orchestrator's lock).
- The user types `/fix-e2e-tests`, or phrases like 'address the E2E reviewer findings on #<n>', 'rework the Playwright specs per the code review', 'fix the code-review on this E2E task'.

Do NOT activate when:

- The task has no `# Code Review` comment newer than the slice branch's last commit — stop and surface "fix dispatched but no reviewer comment newer than the last commit on the task".
- The task labels are inconsistent (e.g. `review:code-passed` present alongside `review:code-need-fix`) — stop and surface the disagreement.
- The dispatch is for fresh authoring without reviewer findings — use `author-e2e-tests`.
- The task is `type:backend` / `type:frontend` — those fixes go through `fix-task-feedback` under `engineer`.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every fix commit. Subject line is `<type>(<scope>): <subject>`; the trailer rule for this skill (use `Refs #<task-#>`, never `Closes`) is spelled out in step 6 below. |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <task-#>` | Resolve the parent slice issue from the task and print the slice branch attached to that parent. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and rebase it onto `origin/main`; prints the worktree path. Non-zero exit on rebase conflict. |
| `scripts/read-latest-review-comment.sh <task-#>` | Print the body of the most recent `# Code Review` comment on the task (the structured reviewer findings). |
| `scripts/push-and-reset-code-review.sh <task-#> <slice-branch>` | Push the slice branch and idempotently reset the task's `review:code-*` gate to `review:code-pending`. Terminal action. |

## Workflow

Inputs from the orchestrator: the **task issue ID, title, URL**, and that the `code` gate reported `need-fix`. Everything else (issue body, reviewer findings comment, slice branch, worktree path) you discover yourself.

### 1. Confirm the dispatch is fix-mode

Fetch the issue and verify the labels match: `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`, with `review:code-need-fix` present (the orchestrator may have already flipped it to `review:code-pending`; either is acceptable for fix mode). If the labels are inconsistent (e.g. `review:code-passed` is also present), stop and surface the disagreement.

```bash
gh issue view <task-#> --json title,body,labels,url
```

### 2. Read the reviewer's findings comment on the task

`code-reviewer` posts one structured comment on the task issue with severity/file:line/fix details. Pull the most recent `# Code Review` body — that's the source-of-truth for what to fix:

```bash
review_body="$(bash scripts/read-latest-review-comment.sh <task-#>)"
```

If the script exits non-zero, stop and surface "fix dispatch but no reviewer comment on the task" — guessing a fix from a blank tree would just churn the diff.

### 3. Materialize the slice branch in a worktree

Resolve the parent slice issue and its linked branch, then create-or-reuse the worktree rebased onto `origin/main`:

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <task-#>)"
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

On rebase conflict, `setup-worktree.sh` aborts the rebase and exits non-zero — surface the diagnostic and stop.

### 4. Apply each must-fix finding

Walk the reviewer comment top-to-bottom. For every CRITICAL/HIGH/MEDIUM finding the reviewer raised, edit the cited test file(s) to address the concrete bar (missing assertion, misused selector, missing critical-path step, etc.). LOW findings are addressed only when the effort is trivial and clearly in-scope; skip the rest and note them in the commit message body.

### 5. Smoke-execute the touched specs

Run only the specs you changed (`npx playwright test <files>`) — confirm they load, navigate, and reach a real assertion. Assertion failures against unimplemented behavior remain expected; load/parse/locator errors are not — fix and re-run.

### 6. Commit the fix

Format commit messages per `templates/commit-messages.md` — one commit per logical fix grouping. Each commit message must reference which reviewer finding(s) it addresses. Include a `Refs #<task-#>` trailer (use `Refs`, not `Closes`).

### 7. Push the slice branch and reset `review:code-*` to pending

Push the new commits to the remote slice branch and idempotently reset the task's `review:code-*` gate to `review:code-pending` so `review-task-issue` will dispatch a fresh `code-reviewer` against the fix:

```bash
bash scripts/push-and-reset-code-review.sh <task-#> "${slice_branch}"
```

`gh issue edit` silently ignores `--remove-label` targets that aren't currently set, so the script is safe regardless of which terminal verdict was actually present. This is the terminal action in fix mode. Exit after the label flip — do not close the task, do not loop, do not message reviewers.

## Iron rules

- **Never patch the implementation.** Reviewer findings on a `type:e2e` task always concern the test code itself, not the production code that's expected to be missing. If a finding seems to demand a production change, surface the misclassification rather than silently editing production code.
- **Scope strictly to the reviewer's must-fix list.** Findings are the contract — anything outside them is out of scope. LOW / nit / suggestion items get addressed only when trivial; skipped items are noted in the commit body so the reviewer can audit the call.
- **Red is expected; broken is not.** After a fix, assertion failures against unimplemented behavior remain correct output. Load/parse/locator errors are not — re-run the touched specs and confirm each reaches a real assertion before committing.
- **Truth is in Git and on the task-issue labels.** Commit messages on the slice branch and the `review:code-*` label state on the task issue are the only report. Do not return a structured summary, do not message the orchestrator, do not post issue comments. After push and the terminal label flip, you are done.
- **Surface unrecoverable blockers, don't silently abandon.** If a precondition fails (no slice branch attached to the parent, no `# Code Review` comment on the task, rebase conflicts onto main, etc.), STOP and surface back to whoever invoked you with the diagnostic.
- **Format every fix commit per `templates/commit-messages.md`**; never skip hooks.
