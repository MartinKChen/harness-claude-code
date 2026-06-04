---
name: workflow-engineer-implement-task
description: "Implement the named backend/frontend task ids on a slice branch via outside-in TDD. Read the slice body, locate the task block(s) in the `## Tasks` checklist, set up the slice worktree, drive RED→GREEN→REFACTOR per task until each delivery is satisfied, tick the implemented tasks' checkboxes, commit per task with `Refs #<slice#>` + `Task: <id>` trailers, push, post a summary comment. Activate when dispatched with `Implement slice #<n> tasks <ids>`, or on '/workflow-engineer-implement-task'."
---

# workflow-engineer-implement-task

Take the named `backend` / `frontend` tasks on a slice and ship them through strict outside-in TDD on the slice's branch, inside a slice-scoped worktree at `/tmp/harness-claude-code/<repo>/worktrees/<slice-branch>`. Dispatched with a (slice #, task ids) pair. Stop the moment each named task's delivery is green; never bundle unrequested improvements.

The agent loads its own pattern set (TDD discipline, language-specific patterns, container conventions, security baseline, ADR/architecture context) at kickoff. This skill owns only the workflow primitives.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Implement slice #<n> tasks <ids>`.
- The user types `/workflow-engineer-implement-task`, or phrases like "implement slice #<n> tasks be.1,fe.1".

Do NOT activate when:

- The named ids are `e2e` tasks (use `workflow-e2e-author`).
- The unit is an open PR (use `workflow-engineer-fix-pr`).
- The dispatch is to address slice-review findings (use `workflow-engineer-fix-slice`).

## Input contract

Read the slice issue #<n> body. Locate the task block(s) for <ids> in the `## Tasks` checklist (each entry is `[ ] \`<id>\` · **<type>** · blocked-by: … · "<delivery>"` with a `covers:`/`contract:`/`entry-source:`/`done:` pointer line). The checklist is the durable task ledger — a box already checked `[x]` means that task is DONE; skip it (resume safety). Read the slice's Acceptance criteria (EARS + Gherkin) for behavior; follow the pointer (api-contract / data-model / Gherkin scenario / design tokens) for the unit spec.

## Workflow

Input from the caller: the slice # and the task ids. Discover everything else.

### 1. Read the slice body and locate the named tasks

Fetch the slice issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — the helper wraps `gh issue view --json` to skip auto-rendered comments and reactions (3–8K of chrome on any chatty issue). Parse the `## Tasks` checklist; locate each id in <ids>. Drop any already checked `[x]` (resume safety). If every named id is already `[x]`, exit cleanly — nothing to implement. A named id of type `e2e` is a routing bug → halt.

### 2. Read project context

Read the baseline product + architecture context before implementation:

- `docs/GLOSSARY.md` — domain vocabulary used by the slice body and downstream.
- `docs/architecture-decision-record/README.md` — index of architectural decisions.

Then pull entity- / decision-specific context on demand as the change shape clarifies:

- `docs/architecture-decision-record/<adr-name>.md` — only when the index entry tells you the ADR constrains the change.
- `docs/data-model/<entity>.yaml` — for each persistence entity the change touches (the `contract:` pointer on a backend task names these).
- `docs/api-contract/<entity>.yaml` — for each API resource the change touches (the `contract:` pointer on a backend task names these).
- `docs/runbooks/dev/<procedure>.md` — when the task requires running a documented developer procedure (local environment setup, applying migrations, a common dev task the runbook covers) rather than re-deriving the steps. `docs/runbooks/ops/<procedure>.md` only when the change directly touches a release / deploy / enable-production surface. Runbooks are the durable home for *how to run a procedure*; consult the matching one instead of inventing or guessing the steps. Do not bulk-load `docs/runbooks/` — open only the procedure the task actually exercises.

The two baseline reads happen up front; everything else stays on-demand. Never bulk-load every ADR / contract / data-model / runbook.

### 3. Set up the slice worktree

- Resolve the slice's attached branch and print it.
- Create-or-reuse the slice-scoped worktree on that branch (engineer flows do NOT rebase onto main — rebasing on every dispatch would create a merge maelstrom across sibling slices).
- Check the slice branch for prior `Refs #<slice#>` WIP commits — a killed earlier run may have already advanced some named ids; reconcile against the checklist (`[x]` = done) and resume from the first unchecked task.
- `cd` into the worktree path before any reads / edits / runs.

All subsequent reads / edits / runs happen inside the worktree — never in the caller's checkout.

### 4. Drive implementation via outside-in TDD

The agent's loaded TDD pattern (acceptance test → RED → GREEN → REFACTOR → wiring) and the project context from step 2 are the contract. Each named task carries its own unit spec via its pointer (`contract:` → api-contract / data-model; `covers:` → the slice Gherkin scenario it serves; `done:` → the one-line criterion for a contract-less utility task). Pull additional per-entity / per-ADR files on demand as the change clarifies (see step 2's on-demand list).

Drive TDD on the slice branch inside the worktree, task by task. Stop a task when its delivery (and the AC / contract / done pointer it serves) is satisfied by a passing test or observable behavior.

### 5. Tick each implemented task's checkbox

As each named task goes green, flip its checklist box `[ ]` → `[x]` in the slice body (edit via `gh issue edit <n> --body-file`, or the operation-git helper). The checklist is the durable task ledger — within-slice work is serial, so this edit is race-free. Ticking is what lets a fresh dispatch skip the done task on resume.

### 6. Commit per task at the TDD cadence with `Refs` + `Task` trailers

Use the project's Conventional Commits format. Each task is its own commit stream; every commit body ends with:

```
Refs #<slice#>
Task: <static-id>
```

`<static-id>` is the checklist id the commit advances (e.g. `Task: be.1`). One `Task:` trailer per commit — never bundle two tasks' work behind one trailer. Never use `Closes`.

### 7. Push and post a summary comment

Push the slice branch to `origin`, then post a comment on the slice issue summarizing what was implemented per task (files, the deliveries satisfied) via `bash skills/operation-git/scripts/post-comment.sh <n> <file>`.

The pre-push hooks run the fullstack lint/format/type/test set against the worktree and deny the push on failure. If a hook denies → drop back to step 4 (RED→GREEN→REFACTOR cycle). Never force-push, never skip hooks.

Terminal action. Exit. Do NOT flip any label, do NOT close the slice, do NOT open a PR.

## Iron rules

- **Treat the slice AC + each task's pointer as the contract.** If a task's delivery, AC mapping, or contract pointer is missing or ambiguous, stop and ask before writing code.
- **Never write production code without a failing test first; never write more production code than the failing test requires.**
- **Every commit carries `Refs #<slice#>` + a single `Task: <id>` trailer.** The `Task:` trailer is the commit→checklist mapping the recovery story relies on; one task per commit.
- **Tick the box you implemented.** The checklist is the durable ledger; an implemented-but-unticked task looks un-done to the next dispatch.
- **Pull architecture context per-entity on demand — never bulk-load.** Read only the specific entity / ADR files the change actually touches. The same applies to runbooks: when the task requires a documented procedure (dev-environment setup, migrations, a common dev task, or a deploy/enable-prod surface), read the matching `docs/runbooks/{dev,ops}/<procedure>.md` and follow it rather than guessing the steps.
- **Mirror an already-shipped sibling before inventing shape.** `rg` for an existing endpoint / hook / form that does the same kind of work and match its conventions exactly.
- **Cite file paths with line numbers** (`path/to/file.py:42`) when reporting what changed.
- **Commit at the TDD cadence.** One commit per RED / GREEN / REFACTOR step (where applicable). Scaffolding goes in discrete `chore(scaffold):` / `build:` commits BEFORE the first RED.
- **Resume from the checklist + WIP commits.** On a fresh dispatch, skip already-`[x]` tasks and pick up from the first unchecked one; reconcile against prior `Refs #<slice#>` commits on the branch.
- **Stop and report when a task's delivery is met.** Do not bundle unrequested improvements.
- **No PR creation.** Draft-PR creation is the calling workflow's terminal phase.
- **Truth is in Git, the checklist, and the comment.** No structured summaries returned to the caller.
