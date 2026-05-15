---
name: author-e2e-tests
description: "Author Playwright E2E test cases for a single GitHub task issue (`type:e2e`) in implement mode. Resolve the parent slice issue, fetch the slice branch attached to that parent, set up (or reuse) a slice-scoped worktree rebased onto `origin/main`, translate the task's test cases into Playwright specs that drive the UI through the critical path with semantic selectors, smoke-run each touched spec to confirm it reaches a real assertion, commit on the slice branch using the Conventional Commits format from `templates/commit-messages.md`, push, and flip `review:code-pending` onto the task issue so `review-task-issue` dispatches the `code-reviewer`. Activate when the dispatch prompt opens with `Implement GitHub task issue #<n>` and the issue carries `type:e2e`, or when the user types phrases like 'author E2E tests for #<n>', 'write the E2E specs for this task', '/author-e2e-tests'. Do NOT activate to address reviewer findings on a `type:e2e` task (use `fix-e2e-tests`), to author E2E tests outside the slice-task lifecycle, or to author production code (that is `engineer`'s lane via `implement-feature-task`)."
---

# author-e2e-tests

Translate a single `type:e2e` GitHub task issue into Playwright specs in implement mode. The work is self-driven from the task issue ID: discover the parent slice issue and its slice branch, set up (or reuse) the slice-scoped worktree, write tests that mirror the user-visible critical path, smoke-run them so we know they reach a real assertion, commit on the slice branch using the Conventional Commits format from `templates/commit-messages.md`, push, and add `review:code-pending` to request review. PR creation is owned outside this lane — the push updates the remote slice branch and the label flip is enough to trigger `code-reviewer`.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Implement GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`.
- The user types `/author-e2e-tests`, or phrases like 'author E2E tests for #<n>', 'write the Playwright specs for this task', 'translate the test cases on this task into specs'.
- The labels on the task disagree with the prompt: presence of `review:code-need-fix` (and absence of `review:code-pending`/`review:code-running`) means a fix is in flight — stop and surface the disagreement rather than authoring fresh tests.

Do NOT activate when:

- The dispatched gate is `code` returning `need-fix` — use `fix-e2e-tests` instead.
- The task carries `type:backend` or `type:frontend` — those are `engineer`'s lane via `implement-feature-task`.
- The user wants to write production code to make a red E2E test pass — production fixes belong to `engineer`.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every commit produced during authoring. Subject line is `<type>(<scope>): <subject>`; the trailer rules for this skill (use `Refs #<task-#>`, never `Closes`) are spelled out in step 6 below. |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <task-#>` | Resolve the parent slice issue from the task and print the slice branch attached to that parent. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and rebase it onto `origin/main`; prints the worktree path. Non-zero exit on rebase conflict. |
| `scripts/handle-rebase-conflict.sh <task-#> <slice-branch> <worktree-path>` | Abort the rebase, flip `status:in-progress` → `status:need-attention`, post a diagnostic comment with the conflicting paths. |
| `scripts/push-and-request-code-review.sh <task-#> <slice-branch>` | Push the slice branch and add `review:code-pending` to the task issue. Terminal action. |

## Workflow

Inputs from the orchestrator: just the **task issue ID, title, and URL**. Everything else (issue body, slice branch, worktree path) you discover yourself.

### 1. Find the parent slice issue, then the slice branch attached to it

The slice branch is attached to the parent slice issue (set by `create-issues`), not to each task sub-issue. Resolve and print the slice branch:

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <task-#>)"
```

If the script exits non-zero, STOP and surface the diagnostic it printed (either "task has no parent slice issue" or "parent slice issue has no linked branch yet").

### 2. Create-or-reuse a slice-scoped worktree and rebase onto main

The worktree path is keyed on the slice branch (one worktree per slice, shared across the slice's tasks):

```bash
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

All subsequent reads, edits, smoke runs, and commits MUST happen inside `$worktree_path`.

On rebase conflict against `main`, `setup-worktree.sh` aborts the rebase and exits non-zero. Surface the conflict and STOP — do not force-push, do not skip conflicting commits, do not proceed to authoring. Run the conflict handler first so the task issue carries the diagnostic:

```bash
bash scripts/handle-rebase-conflict.sh <task-#> "${slice_branch}" "${worktree_path}"
```

### 3. Fetch the task issue body

Pull the body to read the test cases to write:

```bash
gh issue view <task-#> --json title,body,labels,url
```

For Gherkin / EARS scenarios behind each test case, also fetch the parent slice issue body if needed using the `${parent_number}` already resolved in step 1: `gh issue view "${parent_number}" --json body`.

### 4. Implement the E2E test cases inside the worktree

Translate each test case in the issue body into a Playwright spec. Drive the browser through the UI: every spec starts with `page.goto(...)` and exercises rendered elements; assertions are on user-visible state, never on raw HTTP responses. Default to semantic selectors (`getByRole`, `getByLabel`, `getByText`); justify any `data-testid` use in a one-line comment. Extend an existing spec if the flow continues an already-covered segment; otherwise create a new file. Keep one critical-path flow per spec file.

### 5. Smoke-execute the new/edited specs in the worktree

Bring up the docker-compose stack if needed and run only the touched specs (`npx playwright test <files>`). Confirm each spec loads, navigates, and reaches a real assertion. If a load/parse/locator-API error surfaces, fix and re-run; do not commit broken code. The intent here is to validate the spec is wired correctly — the implementation is expected to be missing, so assertion failures are the correct outcome.

### 6. Commit the changes directly on the slice branch

Format commit messages per `templates/commit-messages.md` (Conventional Commits) — one commit per logical test addition/extension. The commit message is the report; it must clearly state which test cases were authored and which acceptance criteria they map to. **Every commit MUST mention the task issue — include a `Refs #<task-#>` trailer (use `Refs`, not `Closes`, so the PR merge does not auto-close the task issue — closure is owned by `close-task-issue` once `review:code-passed` lands).** All commits land on `${slice_branch}` inside the worktree. Do not flip `status:in-progress` here — the label stays in place until `close-task-issue` clears it after the review gate passes.

### 7. Push the slice branch and add `review:code-pending` to the task issue

Push the slice branch to the remote so the new commits are visible. Then add `review:code-pending` to the task issue so `review-task-issue` dispatches the `code-reviewer` against the new tests. E2e tasks do not carry a security gate (test code has no production attack surface to review), so `review:security-pending` is NOT added. Do **not** open, promote, or otherwise touch the slice PR — PR creation is owned outside this lane.

```bash
bash scripts/push-and-request-code-review.sh <task-#> "${slice_branch}"
```

This is the terminal action in implement mode. Exit after the label add lands — do not close the task, do not open a PR, do not message reviewers, do not loop.

## Iron rules

- **E2E tests run against the full stack.** Always target the docker-compose environment with frontend + backend + Postgres up; never stub the backend or hit only the frontend dev server.
- **E2E tests start from the UI, always.** Every test case drives the browser through the frontend. Never author E2E tests that call backend HTTP endpoints directly. API-level coverage is the backend's integration-test responsibility. Using Playwright's `request` fixture purely as a setup/teardown shortcut (e.g. seeding a fixture user) is acceptable when unavoidable, but the assertions must be on UI state.
- **Prefer semantic selectors.** Default to `getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`. Reach for `data-testid` only when the DOM offers no stable accessible name, and note the justification in a one-line comment on that locator.
- **Extend, don't fragment.** If the issue's test cases advance an existing critical-path flow (e.g. existing test covers `a→b→c`, new criterion covers `c→d`), extend the existing spec to `a→b→c→d`. Create a new file only when the flow is genuinely independent.
- **Scope strictly to the issue's acceptance criteria.** The task issue body lists the test cases to write; the parent slice issue carries the matching Gherkin / EARS scenarios. Anything outside those is out of scope — skip it.
- **Red is expected; broken is not.** A test that fails because the feature is unimplemented is correct output. A test that fails to *load* (syntax error, bad import, wrong locator API) is not. Smoke-run each new/edited spec once and confirm the failure is an assertion failure, not a parse/load/locator error, before committing.
- **Never patch the implementation.** If a smoke run reveals a missing or broken implementation, that is the expected red state — do not "fix" production code to silence the failure. Production fixes belong to `engineer`.
- **Truth is in Git and on the task-issue labels.** Commit messages on the slice branch and the `review:code-*` label state on the task issue are the only report. Do not return a structured summary, do not `SendMessage` the orchestrator, do not post issue comments. After push and the terminal label flip, you are done.
- **Surface unrecoverable blockers, don't silently abandon.** If a precondition fails (no slice branch attached to the parent, rebase conflicts onto main, smoke run reveals a parse error you can't fix, etc.), STOP and surface back to whoever invoked you with the diagnostic — do not push half-baked work and do not pretend to succeed.
- **Format every commit per `templates/commit-messages.md`** when authoring produces test files; never skip hooks.
