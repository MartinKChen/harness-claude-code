---
name: workflow-e2e-author
description: "Author Playwright E2E specs for one `type:e2e` task on the parent slice branch. Read the issue body, set up the slice worktree, translate test cases into specs, commit with dual `Refs` trailers (task + slice), push, add `review:pending`. Activate when dispatched with `Implement GitHub task issue #<n>` for a `type:e2e` task, or on '/workflow-e2e-author'."
---

# workflow-e2e-author

Translate a single `type:e2e` GitHub task issue into Playwright specs. Self-driven from the task issue ID — the agent discovers the parent slice, the slice branch, the worktree path, and the test cases from the issue body itself.

The agent loads its own pattern set (E2E conventions, semantic selectors, fixture isolation, etc.) at kickoff. This skill owns only the workflow: read → worktree → write → push → flip the label.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Implement GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`.
- The user types `/workflow-e2e-author`, or phrases like "author E2E tests for #<n>", "write the Playwright specs for this task".

Do NOT activate to address reviewer findings on an E2E task (use `workflow-e2e-fix`), or to write production code (engineer's lane).

## Workflow

Input from the orchestrator: just the task issue ID. Discover everything else.

### 1. Read the issue body

Fetch the task issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Confirm `level:task` + `kind:feature` + `type:e2e` + `status:in-progress`. Wrong type → halt and surface (routing bug).

### 2. Resolve the slice branch and set up the worktree

- Resolve the parent slice's attached branch from the task.
- Create-or-reuse the slice-scoped worktree on that branch, rebased onto `origin/main`.
- `cd` into the worktree path.

On rebase conflict (worktree setup fails): post a diagnostic comment on the task issue naming the conflicting paths, then flip the task from `status:in-progress` to `status:need-attention`. Do NOT force-push, do NOT proceed.

### 3. Author / extend Playwright specs based on the issue body

Translate each test case in the issue body into a Playwright spec inside the worktree. The agent's loaded pattern set owns the conventions (semantic selectors, fixture identity, extend-vs-fragment, what to assert). Read the parent slice issue body for Gherkin / EARS context (resolve the parent via the issue's GraphQL `parent { number }` field, then `gh issue view <parent-#> --json body`).

Smoke-run touched specs (`npx playwright test <files>`) and confirm each spec reaches a real assertion. Parse / load / locator-API errors → fix and re-run. Assertion failures (production code missing) → expected; don't patch production code.

### 4. Commit with dual `Refs` trailers

Use the project's Conventional Commits format. Every commit body MUST end with:

```
Refs #<task-#>
Refs #<slice-#>
```

Commits land directly on the slice branch inside the worktree. Never use `Closes` — closure happens after review passes.

### 5. Push and add `review:pending` to the task issue

Push the slice branch to `origin`, then add the `review:pending` label to the task issue.

Terminal action. Exit. Do NOT close the task, do NOT open a PR (that's reviewer-review-slice's job after the slice review passes), do NOT message reviewers.

## Iron rules

- **E2E specs run against the full stack and start from the UI.** Never call backend HTTP endpoints directly from a spec's assertions.
- **Every commit carries BOTH `Refs` trailers.** Without `Refs #<task-#>` AND `Refs #<slice-#>`, the reviewer can't scope by task and the slice-level review can't aggregate per task.
- **Scope strictly to the issue's test cases.** Anything outside the task body + the parent slice's Gherkin / EARS scenarios is out of scope.
- **Red is expected; broken is not.** A test that fails on a missing implementation is correct output. A test that fails to load / parse / locate is not.
- **Never patch production code from this lane.** Production fixes are engineer's lane.
- **Bail with `status:need-attention`** on unrecoverable blockers (rebase conflict that touches scope, slice branch missing, unfixable smoke-run parse error). Post a diagnostic comment before flipping the label.
- **Truth is in Git and on the task labels.** No structured summaries returned to the orchestrator — the push + the `review:pending` flip are the only outputs.
