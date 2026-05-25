---
name: workflow-engineer-fix-task
description: "Fix reviewer findings on one `type:backend`/`type:frontend` task. Read the task body and every comment newer than the last `Refs #<task-#>` commit, set up the slice worktree, drive RED→GREEN per finding, commit with dual `Refs` trailers, push, add `review:pending`. Activate when dispatched with `Fix the review feedback on GitHub task issue #<n>` for a backend/frontend task, or on '/workflow-engineer-fix-task'."
---

# workflow-engineer-fix-task

Address reviewer findings on a single `type:backend` / `type:frontend` GitHub task issue dispatched by the orchestrator. The orchestrator has stripped `review:need-fix` as its lock; scope is read from the most recent reviewer comment on the task issue (newer than the slice branch's last `Refs #<task-#>` commit).

User directives in the comment window override reviewer suggestions, ADRs, and default conventions — read those before reading the reviewer findings.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `status:in-progress` + (`type:backend` or `type:frontend`).
- The user types `/workflow-engineer-fix-task`, or phrases like "address the reviewer findings on #<n>".

Do NOT activate for `type:e2e` tasks (use `workflow-e2e-fix`), for PR-level blockers (use `workflow-engineer-fix-pr`), or for fresh implementation (use `workflow-engineer-implement-task`).

## Workflow

### 1. Read the task body

Fetch the task issue (number, title, body, labels, milestone, url) via `gh issue view`.

### 2. Read project context

Read the baseline product + architecture context before addressing findings:

- `docs/GLOSSARY.md` — domain vocabulary used by the issue body and the reviewer comment.
- `docs/architecture-decision-record/README.md` — index of architectural decisions.

Then pull entity- / decision-specific context on demand as the finding scope clarifies:

- `docs/architecture-decision-record/<adr-name>.md` — only when the index entry tells you the ADR constrains the fix.
- `docs/data-model/<entity>.yaml` — for each persistence entity the fix touches.
- `docs/api-contract/<entity>.yaml` — for each API resource the fix touches.

The two baseline reads happen up front; everything else stays on-demand. Never bulk-load every ADR / contract / data-model.

### 3. Determine the comment window and pull the in-scope comments

The cutoff is the authored timestamp of the most recent commit on the slice branch carrying `Refs #<task-#>` in its message. Comments created strictly after that timestamp are in scope.

- Resolve the parent slice's attached branch from the task.
- Fetch that branch from `origin`.
- Find the cutoff: authored timestamp of the latest commit on `origin/<slice-branch>` whose message contains `Refs #<task-#>`.

If no `Refs #<task-#>` commit exists on the branch yet, read all comments on the task.

Pull every comment on the task issue. Read **non-reviewer comments first** — user-posted directives in this window are binding and override reviewer suggestions, ADRs, and default conventions. Then read the latest reviewer comment (header `# Code Review` / `# Review`) newer than the cutoff.

If no in-scope reviewer comment exists, halt and surface `fix dispatched but no reviewer comment newer than the last Refs #<task-#> commit on the task`.

Triage findings: CRITICAL / HIGH / MEDIUM → must-fix. LOW / NIT → fix only when obviously small and in-scope.

### 4. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the slice branch (no rebase onto main), then `cd` into the worktree path.

### 5. Address each must-fix finding via TDD

The agent's loaded pattern set owns:
- The TDD cadence (RED before any production change).
- `rg`-driven pattern propagation (each equivalent site gets its own RED→GREEN so the regression suite locks the pattern out everywhere).
- The container surface + `.env.example` drift audit.

This skill owns only the workflow primitives.

### 6. Commit with dual `Refs` trailers

Use the project's Conventional Commits format. Every commit body ends with:

```
Refs #<task-#>
Refs #<slice-#>
```

Each commit message references the finding(s) it addresses and lists any additional sites fixed via pattern propagation.

### 7. Push and add `review:pending`

Push the slice branch to `origin`, then add the `review:pending` label to the task issue.

Pre-push hooks run lint/test/security; deny → drop back to step 5 (never force-push, never skip hooks).

Terminal action. Exit. Do NOT close the task, do NOT touch `status:in-progress`.

## Iron rules

- **User directives in the comment window override everything else.** Read non-reviewer comments first.
- **Scope from the comment window, not from labels.** The orchestrator's lock stripped the gate label.
- **Skip previously-addressed rounds.** Only consider reviewer comments created strictly after the last `Refs #<task-#>` commit.
- **Treat each finding as a class, not an instance — propagate via `rg`.** Each equivalent site gets its own RED→GREEN. List the additional sites in the commit body.
- **Every commit carries BOTH `Refs` trailers.**
- **Each must-fix finding starts with a failing test.**
- **Truth is in Git and on the task labels.**
