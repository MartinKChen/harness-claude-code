---
name: workflow-engineer-fix-slice
description: "Address slice-review findings on one slice. Read the slice body and EVERY slice-review + human comment newer than the last `Refs #<slice#>` commit (union their findings — newest does not supersede older un-actioned reviews), set up the slice worktree, drive TDD per findings (production code only — never modify E2E specs), commit with `Refs #<slice#>` + `Task: <id>` trailers, push, post a summary comment. Activate when dispatched with `Fix the review feedback on slice #<n>` or '/workflow-engineer-fix-slice'."
---

# workflow-engineer-fix-slice

Address slice-review findings on a single slice. Dispatched after the slice review (the `runReviewSlice()` fan-out in `implement-slice`) returns a BLOCK verdict. Scope is the **union of every slice-review comment newer than the slice branch's last `Refs #<slice#>` commit** — not just the newest one — with all user directives in the same window overriding. A later review never supersedes an earlier un-actioned review; only a landed fix commit retires findings and advances the window.

In the new model, E2E passing is a separate earlier phase (`workflow-engineer-diagnose-e2e` + `workflow-engineer-fix-e2e`); this fix loop only addresses the reviewer's findings. The calling workflow re-runs the slice review after the fix — this skill does no re-validation and flips no labels.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on slice #<n>`.
- The user types `/workflow-engineer-fix-slice`, or phrases like "fix slice #<n> per the reviewer findings".

Do NOT activate to pass E2E acceptance (use `workflow-engineer-diagnose-e2e` / `workflow-engineer-fix-e2e`), to fix a PR (use `workflow-engineer-fix-pr`), or to implement fresh tasks (use `workflow-engineer-implement-task`).

## Input contract

Read the slice issue #<n> body. Locate the task block(s) in the `## Tasks` checklist (each entry is a header `[ ] \`<id>\` · **<type>** · blocked-by <ids|—>`, the delivery on the next line, a `covers:` + `contract:`/`entry-source:`/`done:` pointer line, then `scenario:` and a fenced ```gherkin block of named Scenarios). The checklist is the durable task ledger — a box already checked `[x]` means that task is DONE. Read the slice's Acceptance criteria (EARS) and each touched task's own `scenario:` Gherkin for behavior; follow each touched task's pointer (api-contract / data-model / the task's `scenario:` Gherkin / design tokens) for the unit spec the finding bears on.

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

Pull every comment on the slice issue, then keep only those **newer than the cutoff** — that set is the in-scope window. Two comment kinds matter:

- **Human (non-reviewer) comments.** Read these first. EVERY user-posted comment in the window is binding and overrides reviewer suggestions, ADRs, and default conventions. There can be more than one — honor all of them, not just the latest.
- **Reviewer comments.** The fan-out posts **two** review headers — `# Slice Gate Review` (spec / contract / security — the gating verdict) and `# Slice Quality Review` (code-quality, advisory) — while the single-context fallback reviewer posts a combined `# Slice Review`; match any of `# Slice Gate Review` / `# Slice Quality Review` / `# Slice Review` / `# Review`. Your dispatch verb tells you which kind to act on: a **gating** fix targets `# Slice Gate Review` (plus `# Slice Review` / `# Review`), a **quality/polish** fix targets `# Slice Quality Review`.

**Take the UNION of every in-window review comment of your target kind — never just the newest one.** More than one un-actioned review can sit in the window: a killed-then-relaunched run, a re-review that fired before a fix landed, or a reviewer re-run can each post a fresh review with NO fix commit between them. Because the cutoff is the last `Refs #<slice#>` fix commit, *every* review newer than it is un-addressed by definition. Collect the must-fix findings from ALL of them and dedupe (same `file` + same finding ≈ same class → address once, preferring the newest comment's BAD/GOOD detail). A finding raised in an earlier in-window review but missing from the newest is STILL in scope — a fresh-look re-review routinely fails to re-surface a prior finding (or a fix introduces a new one), and silently dropping it is the exact failure mode this rule exists to prevent. Only a landed fix commit retires findings.

If no in-scope reviewer comment exists, halt and surface `fix dispatched but no reviewer comment newer than the last Refs #<slice#> commit on the slice`.

**Triage by the reviewer's fix-class, not by raw severity.** Every finding in the reviewer comment is tagged `[<class> · I:<x>/E:<y>] <title>` where `<class>` ∈ {`Fix now`, `Defer`, `Nit`}. The class is the reviewer's projection of (Impact, Effort/Risk) onto a single pickup decision (see `workflow-reviewer-review-slice` for the matrix). Pick up findings by class:

- **Fix now** — MUST address in this cycle. Each gets its own RED → GREEN (step 5).
- **Defer** — advisory; do NOT address this cycle. The reviewer explicitly traded impact against effort and decided it's not worth the churn now. Skipping it is the correct action. Defer is a **quality-lane** class: gate reviews class every gating I:H *and* I:M finding as `Fix now` (gating findings are never deferred — a skipped gating MEDIUM can be re-graded HIGH by a later round and read as a "new" blocker), so a `Defer` you encounter will almost always be in a `# Slice Quality Review`. Slice-level Defer findings are common there — cross-task integration fixes often demand multi-task or schema-level churn that doesn't earn its keep within a single slice cycle.
- **Nit** — optional. Fix only when obviously trivial AND already in-scope.

**Gate-fix dispatches inline a pickup set.** A gating fix dispatch (the `Fix the gating review feedback …` verb) usually carries the latest round's `Fix`-class findings inline in the dispatch prompt itself — the workflow holds them structurally. Treat that inlined list as a must-fix **floor, not a ceiling**: address EVERY finding on it this cycle (I:M included), AND union it with the must-fix findings you collected from every in-window review comment (the step above) so an earlier un-actioned review's findings are never dropped. Use the `# Slice Gate Review` comment(s) for full detail (BAD/GOOD snippets). If the dispatch carries no inlined list, the union of in-window must-fix findings IS the pickup set.

A user directive in the comment window can promote a `Defer` or `Nit` to must-fix, or demote a `Fix now` to skip — user directives always win. If no `Fix now` finding exists in any in-window review, no inlined dispatch list names anything, *and* no user directive promotes anything, halt and surface `fix dispatched but no Fix-now findings or promoting user directives in the in-scope window`.

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

### 6. Class-sweep gate (mandatory before commit)

Run this gate over every finding you addressed in step 5 before you push — any sibling it surfaces gets its own RED → GREEN commit at step 5's cadence.

A review finding names one instance of a class, never a lone defect. Fixing only the cited `file:line` is a failed fix — the reviewer will find the next sibling and re-BLOCK.

Before you commit, for each finding:

1. **Name the class in one sentence.** State the invariant the finding really tests (e.g. "every state-mutating service must reject terminal statuses", "every scoped `UPDATE` must be id-scoped so siblings survive", "every 4xx must rotate the idempotency key").
2. **Enumerate all sites that share that structure.** Use an explicit search — grep for the symbol/pattern (`_TERMINAL_STATUSES`, `find_conflicting_session`, `rotateOn4xx`, the `WHERE`-clause shape) across the whole slice surface, not just the cited file. List every hit.
3. **Fix or cover every site in this same round, not just the cited one.** If a sibling is already correct, add the test that makes it provably correct (deletable-code-proof).
4. **Stop only when the search returns no uncovered sibling.**

You may not mark the finding resolved until you can answer: "What was the class, what command did I run to find every sibling, and which sites did it return?"

### 7. Push and post a summary comment

Push the slice branch to `origin`, then post a comment on the slice issue summarizing the findings addressed and the fixes via `bash skills/operation-git/scripts/post-comment.sh <n> <file>`.

Each resolved finding in the comment MUST carry a `Class sweep:` line: the grep/command you ran, the full list of sibling sites it returned, and the coverage status of each. A fix comment with no sweep evidence is incomplete.

Pre-push hooks gate as usual; a hook failure drops back to step 5. Never force-push, never skip hooks.

Terminal action. Exit. Do NOT flip any label — the calling workflow re-runs the slice review. Do NOT close the slice.

## Iron rules

- **User directives in the comment window override everything else.**
- **Scope from the comment window, not from labels.** Only comments newer than the last `Refs #<slice#>` commit are in scope — but address the UNION of EVERY review comment (and every human comment) in that window, never just the newest. A later review does not supersede an earlier un-actioned one; only a landed fix commit retires findings and advances the cutoff.
- **Production-only fixes.** Never modify E2E specs from this lane. (E2E passing is the separate Pass-E2E phase — `workflow-engineer-diagnose-e2e` + `workflow-engineer-fix-e2e`; this loop only addresses review findings.)
- **Contracts are read-only in this lane.** Never edit `docs/api-contract/*` or `docs/data-model/*`. A finding that the implementation diverges from the contract is fixed by changing the CODE to match the contract — never the contract to match the code. If the contract itself is wrong/incomplete, flip the slice to `status:need-attention`, post a `# Contract change requested` comment (entity, exact clause, what's needed, why), and exit. Do not self-amend.
- **Every commit carries `Refs #<slice#>`** plus a `Task: <id>` trailer where the finding maps to one.
- **Resume from the checklist + WIP commits.** Reconcile against already-`[x]` tasks and prior `Refs #<slice#>` commits before re-touching code.
- **Pick up by the reviewer's `Fix now` class.** Effort is the reviewer's call — do not self-promote a `Defer` back to must-fix without a user directive.
- **Each Fix-now finding starts with a failing test.** Propagate equivalents via `rg`.
- **Sweep the class before resolving a finding.** A finding is one instance of a class — grep the slice surface for every sibling sharing its structure, fix or prove each in the same round, and record the sweep (command + sites returned) as a `Class sweep:` line in the summary comment. Fixing only the cited `file:line` is a failed fix the reviewer will re-BLOCK on.
- **Bail with `status:need-attention`** on unrecoverable blockers. Post a diagnostic comment first.
- **Truth is in Git, the checklist, and the comment.**
