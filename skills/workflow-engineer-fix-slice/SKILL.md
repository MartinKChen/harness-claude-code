---
name: workflow-engineer-fix-slice
description: "Address slice-review findings on one slice. Read the slice body and the newest slice-review comment (newer than the last `Refs #<slice#>` commit), set up the slice worktree, drive TDD per findings (production code only — never modify E2E specs), commit with `Refs #<slice#>` + `Task: <id>` trailers, push, post a summary comment. Activate when dispatched with `Fix the review feedback on slice #<n>` or '/workflow-engineer-fix-slice'."
---

# workflow-engineer-fix-slice

Address slice-review findings on a single slice. Dispatched after the slice review (the `runReviewSlice()` fan-out in `implement-slice`) returns a BLOCK verdict. Scope is read from the most recent slice-review comment on the slice (newer than the slice branch's last `Refs #<slice#>` commit), with user directives in the same window overriding.

In the new model, E2E passing is a separate earlier phase (`workflow-engineer-diagnose-e2e` + `workflow-engineer-fix-e2e`); this fix loop only addresses the reviewer's findings. The calling workflow re-runs the slice review after the fix — this skill does no re-validation and flips no labels.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on slice #<n>`.
- The user types `/workflow-engineer-fix-slice`, or phrases like "fix slice #<n> per the reviewer findings".

Do NOT activate to pass E2E acceptance (use `workflow-engineer-diagnose-e2e` / `workflow-engineer-fix-e2e`), to fix a PR (use `workflow-engineer-fix-pr`), or to implement fresh tasks (use `workflow-engineer-implement-task`).

## Input contract

Read the slice issue #<n> body. Locate the task block(s) in the `## Tasks` checklist (each entry is `[ ] \`<id>\` · **<type>** · blocked-by: … · "<delivery>"` with a `covers:`/`contract:`/`entry-source:`/`done:` pointer line). The checklist is the durable task ledger — a box already checked `[x]` means that task is DONE. Read the slice's Acceptance criteria (EARS + Gherkin) for behavior; follow each touched task's pointer (api-contract / data-model / Gherkin scenario / design tokens) for the unit spec the finding bears on.

## Workflow

### 1. Read the slice body

Fetch the slice issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Parse the `## Tasks` checklist and the Acceptance criteria.

### 2. Read project context

Read the baseline product + architecture context before addressing findings:

- `docs/GLOSSARY.md` — domain vocabulary used by the slice body and the reviewer comment.
- `docs/architecture-decision-record/README.md` — index of architectural decisions.

Then pull entity- / decision-specific context on demand as the finding scope clarifies:

- `docs/architecture-decision-record/<adr-name>.md` — only when the index entry tells you the ADR constrains the fix.
- `docs/data-model/<entity>.yaml` — for each persistence entity the fix touches.
- `docs/api-contract/<entity>.yaml` — for each API resource the fix touches.

The two baseline reads happen up front; everything else stays on-demand. Never bulk-load every ADR / contract / data-model.

### 3. Determine the comment window and pull in-scope comments

The cutoff is the authored timestamp of the most recent commit on the slice branch carrying `Refs #<slice#>`:

- Resolve the slice's attached branch.
- Fetch that branch from `origin`.
- Find the cutoff: authored timestamp of the latest commit on `origin/<slice-branch>` whose message contains `Refs #<slice#>`.

If no `Refs #<slice#>` commit exists on the branch yet, read all comments on the slice.

Pull every comment on the slice issue. Read **non-reviewer comments first** — user-posted directives in this window are binding and override reviewer suggestions, ADRs, and default conventions. Then read the latest slice-review comment (header `# Slice Review` / `# Review`) newer than the cutoff.

If no in-scope reviewer comment exists, halt and surface `fix dispatched but no reviewer comment newer than the last Refs #<slice#> commit on the slice`.

**Triage by the reviewer's fix-class, not by raw severity.** Every finding in the reviewer comment is tagged `[<class> · I:<x>/E:<y>] <title>` where `<class>` ∈ {`Fix now`, `Defer`, `Nit`}. The class is the reviewer's projection of (Impact, Effort/Risk) onto a single pickup decision (see `workflow-reviewer-review-slice` for the matrix). Pick up findings by class:

- **Fix now** — MUST address in this cycle. Each gets its own RED → GREEN (step 5).
- **Defer** — advisory; do NOT address this cycle. The reviewer explicitly traded impact against effort and decided it's not worth the churn now. Skipping it is the correct action. Slice-level Defer findings are common — cross-task integration fixes often demand multi-task or schema-level churn that doesn't earn its keep within a single slice cycle.
- **Nit** — optional. Fix only when obviously trivial AND already in-scope.

A user directive in the comment window can promote a `Defer` or `Nit` to must-fix, or demote a `Fix now` to skip — user directives always win. If no `Fix now` finding exists *and* no user directive promotes anything, halt and surface `fix dispatched but no Fix-now findings or promoting user directives in the in-scope window`.

**Legacy reviewer comments** (severity-only, no `[<class> · I:<x>/E:<y>]` prefix): treat CRITICAL / HIGH as `Fix now`, MEDIUM as `Defer`, LOW as `Nit`.

### 4. Set up the slice worktree

Create-or-reuse the slice-scoped worktree on the slice branch (no rebase). Check the branch for prior `Refs #<slice#>` WIP commits to ground what's already landed. `cd` into the worktree path.

### 5. Drive TDD on production code per the findings

Address each must-fix finding via the agent's loaded TDD pattern (RED before any production change, `rg`-driven pattern propagation, container + `.env.example` drift audit). Production code only — never modify E2E specs in this lane.

Commit at the TDD cadence using the project's Conventional Commits format. Every commit ends with:

```
Refs #<slice#>
Task: <static-id>
```

`<static-id>` is the checklist id the fix bears on (e.g. `Task: be.1`). When a finding is genuinely cross-task and maps to no single id, use the slice's lowest-numbered touched id or omit the `Task:` trailer — the `Refs #<slice#>` trailer is the load-bearing one for the fix loop's comment window.

### 6. Push and post a summary comment

Push the slice branch to `origin`, then post a comment on the slice issue summarizing the findings addressed and the fixes via `bash skills/operation-git/scripts/post-comment.sh <n> <file>`.

Pre-push hooks gate as usual; a hook failure drops back to step 5. Never force-push, never skip hooks.

Terminal action. Exit. Do NOT flip any label — the calling workflow re-runs the slice review. Do NOT close the slice.

## Iron rules

- **User directives in the comment window override everything else.**
- **Scope from the comment window, not from labels.** Only comments newer than the last `Refs #<slice#>` commit are in scope.
- **Production-only fixes.** Never modify E2E specs from this lane. (E2E passing is the separate Pass-E2E phase — `workflow-engineer-diagnose-e2e` + `workflow-engineer-fix-e2e`; this loop only addresses review findings.)
- **Every commit carries `Refs #<slice#>`** plus a `Task: <id>` trailer where the finding maps to one.
- **Resume from the checklist + WIP commits.** Reconcile against already-`[x]` tasks and prior `Refs #<slice#>` commits before re-touching code.
- **Pick up by the reviewer's `Fix now` class.** Effort is the reviewer's call — do not self-promote a `Defer` back to must-fix without a user directive.
- **Each Fix-now finding starts with a failing test.** Propagate equivalents via `rg`.
- **Bail with `status:need-attention`** on unrecoverable blockers. Post a diagnostic comment first.
- **Truth is in Git, the checklist, and the comment.**
