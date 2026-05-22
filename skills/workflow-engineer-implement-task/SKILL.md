---
name: workflow-engineer-implement-task
description: "Implement one `type:backend`/`type:frontend` task on the parent slice branch via outside-in TDD. Read the issue body, set up the slice worktree, drive RED→GREEN→REFACTOR until the issue's done criteria are satisfied, commit with dual `Refs` trailers (task + slice), push, add `review:pending`. Activate when dispatched with `Implement GitHub task issue #<n>` for a `type:backend` or `type:frontend` task, or on '/workflow-engineer-implement-task'."
---

# workflow-engineer-implement-task

Take one assigned `type:backend` / `type:frontend` GitHub task issue and ship it through strict outside-in TDD on the parent slice's branch, inside a slice-scoped worktree at `/tmp/git-worktree/<repo>/<slice-branch>`. Stop the moment the issue's `Done criteria` are green; never bundle unrequested improvements.

The agent loads its own pattern set (TDD discipline, language-specific patterns, container conventions, security baseline, ADR/architecture context) at kickoff. This skill owns only the workflow primitives.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Implement GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `status:in-progress` + (`type:backend` or `type:frontend`).
- The user types `/workflow-engineer-implement-task`, or phrases like "implement #<n>", "pick up the next ready task".

Do NOT activate when:

- The task carries `type:e2e` (use `workflow-e2e-author`).
- The unit is an open PR (use `workflow-engineer-fix-pr`).
- The task carries `review:need-fix` (use `workflow-engineer-fix-task`).

## Workflow

Input from the orchestrator: just the task issue ID. Discover everything else.

### 1. Read the issue body

Fetch the task issue (number, title, body, labels, milestone, state, url) via `gh issue view`. Halt if: closed, missing `Delivery` / `Done criteria`, no `type:*` label, or `type:e2e` (routing bug).

### 2. Set up the slice worktree

- Resolve the parent slice from the task and print its attached slice branch.
- Create-or-reuse the slice-scoped worktree on that branch (engineer flows do NOT rebase onto main — rebasing on every dispatch would create a merge maelstrom across sibling slices).
- `cd` into the worktree path before any reads / edits / runs.

All subsequent reads / edits / runs happen inside the worktree — never in the orchestrator's checkout.

### 3. Drive implementation via outside-in TDD

The agent's loaded TDD pattern (acceptance test → RED → GREEN → REFACTOR → wiring) and the project's architecture / data-model / api-contract docs are the contract. Read on demand:

- For each persistence entity the change touches → `docs/data-model/<entity>.yaml`.
- For each API resource → `docs/api-contract/<entity>.yaml`.
- For each architectural axis (error envelope, rate-limiting, idempotency, sessions/cookies, etc.) → the matching ADR detail file in `docs/architecture-decision-record/`.

Drive TDD on the slice branch inside the worktree. Stop when every `Done criteria` is satisfied by a passing test or observable behavior.

### 4. Commit at the TDD cadence with dual `Refs` trailers

Use the project's Conventional Commits format. Every commit body ends with:

```
Refs #<task-#>
Refs #<slice-#>
```

Never use `Closes` — closure happens after review passes.

### 5. Push and add `review:pending`

Push the slice branch to `origin`, then add the `review:pending` label to the task issue.

The pre-push hooks run the fullstack lint/format/type/test set against the worktree and deny the push on failure. If a hook denies → drop back to step 3 (RED→GREEN→REFACTOR cycle). Never force-push, never skip hooks.

Terminal action. Exit. Do NOT close the task, do NOT touch `status:in-progress`, do NOT open a PR.

## Iron rules

- **Treat the assigned issue as the contract.** If acceptance criteria are missing or ambiguous, stop and ask before writing code.
- **Never write production code without a failing test first; never write more production code than the failing test requires.**
- **Every commit carries BOTH `Refs` trailers.** Without `Refs #<task-#>` AND `Refs #<slice-#>`, the reviewer can't scope by task and the slice-level review can't aggregate per task.
- **Pull architecture context per-entity on demand — never bulk-load.** Read only the specific entity / ADR files the change actually touches.
- **Mirror an already-shipped sibling before inventing shape.** `rg` for an existing endpoint / hook / form that does the same kind of work and match its conventions exactly.
- **Cite file paths with line numbers** (`path/to/file.py:42`) when reporting what changed.
- **Commit at the TDD cadence.** One commit per RED / GREEN / REFACTOR step (where applicable). Scaffolding goes in discrete `chore(scaffold):` / `build:` commits BEFORE the first RED.
- **Stop and report when acceptance criteria are met.** Do not bundle unrequested improvements.
- **No PR creation.** The reviewer creates the slice PR after passing the slice-level review.
- **Truth is in Git and on the task labels.** No structured summaries returned to the orchestrator.
