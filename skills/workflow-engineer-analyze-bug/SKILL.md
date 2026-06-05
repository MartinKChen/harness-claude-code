---
name: workflow-engineer-analyze-bug
description: "Diagnose one kind:bug issue read-only: reproduce it (browser MCP first, Playwright fallback, both against a booted stack), root-cause it to file:line, and post a `# Bug Analysis` comment proposing the fix + regression-test plan, then flip status → ready-to-review for a human to approve. Writes NO production code, creates NO branch, opens NO PR. Activate when dispatched with `Analyze bug #<n>` or '/workflow-engineer-analyze-bug'."
---

# workflow-engineer-analyze-bug

The **front half** of the bug lifecycle: turn a reporter's symptom (the bug issue body, Zone A) into an approved, actionable fix plan. Dispatched by the unified implement command's analyze stage for a freshly-filed `kind:bug` issue (carries `kind:bug`, no `status:*`).

This step is **diagnosis only** — it reproduces, root-causes, and proposes; it writes no production code, creates no fix branch, and opens no PR. The human approves the proposed approach (by flipping a label) before any code is written, and the automatic `fix-bug` workflow does the actual regression-test + fix afterward. Keeping analyze read-only is what makes the human approval gate meaningful: nothing has been built yet.

## When to activate

- The dispatch prompt opens with `Analyze bug #<n>`.
- The user types `/workflow-engineer-analyze-bug`, or "analyze / triage / diagnose bug #<n>".

Do NOT activate to write the fix (that is `workflow-engineer-fix-bug`, post-approval), to fix a PR, or for slice work.

## Input contract

Read the bug issue #<n> body — the reporter's symptom (`operation-git/templates/bug-issue.md` shape): Summary, Environment, Steps to reproduce, Expected vs. actual, Evidence, Severity, Regression anchor. The Steps to reproduce + Evidence are your starting point for reproduction; the Environment (app version / commit) anchors where to look.

## Workflow

### 1. Read the bug body + light context

Fetch the issue via `bash skills/operation-git/scripts/issue-body.sh <n> number,title,body,labels,url`. Read `docs/GLOSSARY.md` (vocabulary) and `docs/architecture-decision-record/README.md` (ADR index) for orientation. Pull a specific ADR / `docs/api-contract/<entity>.yaml` / `docs/data-model/<entity>.yaml` only when the symptom points at that surface — never bulk-load.

### 2. Set up a read-only worktree on main + boot the stack

Reproduce against the current default branch (the bug exists on `main`):

```
bash skills/operation-git/scripts/setup-worktree.sh main
```

`cd` into the printed worktree path. **Boot the stack either way** (it is the precondition for both reproduction paths): bring the whole stack to healthy — `docker compose -p <slug> up -d --wait` (derive `<slug>` from a bug-scoped name, lowercase non-alphanumeric → `-`, e.g. `bug-<n>`), including a double for every external dependency the flow touches. A stack that can't reach healthy is a wiring problem to note, not the bug under analysis.

This worktree is a scratch reproduction sandbox — read-only with respect to committed code. Any repro script you write here is throwaway; its *output* (confirmation + evidence) goes into the analysis comment, not into a commit.

### 3. Reproduce — browser MCP first, Playwright fallback, always against the booted stack

Reproduce-first is mandatory: **do not propose a fix you have not confirmed reproduces.**

Choose the reproduction path in this order:

1. **Browser MCP (preferred).** If a browser MCP is available to you (discover via `ToolSearch` for browser tools, e.g. `chrome-devtools` / `playwright` MCP), use it to drive the booted stack's URL and replay the repro steps. If the MCP tool exists but needs permission, request it (this is the "ask the user to grant" path) — a live interactive browser gives the richest repro.
2. **Playwright fallback.** If no browser MCP is present, OR the user denies the permission, OR browser-MCP control fails for any reason, fall back to driving the booted stack with Playwright headlessly (the same machinery `workflow-engineer-diagnose-e2e` uses). When you fall back because no MCP is configured, note once in the analysis comment that adding a browser MCP would enable richer live-browser reproduction — but never block waiting on an install.
3. **Direct harness** (backend-only bugs). When the bug has no UI surface, reproduce with a direct API call / a throwaway unit harness against the booted stack.

Capture evidence of the reproduction: a screenshot / trace, or the failing request+response / stack trace. If you cannot reproduce after a genuine attempt, post the analysis comment with reproduction verdict **NOT-REPRODUCED** (steps tried + what you'd need), swap the lock to need-attention (`gh issue edit <n> --remove-label "status:in-progress" --add-label "status:need-attention"`), and stop — do not guess a root cause.

### 4. Root-cause to file:line

With the reproduction in hand, trace the defect to its source. `rg` for the handler / component / query on the failing path; read the cited code and its surroundings. State the *mechanism* — why the code produces the actual behavior — cited to `path/to/file.ext:line`. Look for the same anti-pattern at sibling sites (`rg` the pattern) — a class-of-bug, not a single instance.

### 5. Contract guard

A bug never changes an API contract or data model. If the only correct fix would require editing `docs/api-contract/*` or `docs/data-model/*`, the issue is misclassified: set **Contract impact: REQUIRES-CHANGE** in the comment, recommend reclassifying to a feature (architecture decision needed), swap the lock to need-attention (`gh issue edit <n> --remove-label "status:in-progress" --add-label "status:need-attention"`), and stop. Do NOT propose a contract-violating workaround to keep it a "bug".

### 6. Post the analysis comment + flip to ready-to-review

Fill `operation-git/templates/bug-analysis-comment.md` (header `# Bug Analysis`): Reproduction, Root cause, Proposed fix (+ class-of-bug sites), Regression-test plan (the exact RED test the fix-bug workflow will add first), Blast radius + Contract impact. Write it to a file and post:

```
bash skills/operation-git/scripts/post-comment.sh <n> <file>
```

Then release the bug from the analyze lock to the human approval gate:

```
gh issue edit <n> --remove-label "status:in-progress" --add-label "status:ready-to-review"
```

(The `/ship` analyze stage applied `status:in-progress` as the analyze lock before dispatching you — this swap releases it. If your reproduction verdict is NOT-REPRODUCED, or Contract impact is REQUIRES-CHANGE, swap to `status:need-attention` instead: `--remove-label "status:in-progress" --add-label "status:need-attention"`.) A human reviews the `# Bug Analysis` comment and approves the approach by flipping `status:ready-to-review` → `status:ready-to-implement`, which makes the bug eligible for the kickoff stage that launches `fix-bug`.

Terminal action. Exit. Do NOT write production code, create a fix branch, or open a PR — those belong to `fix-bug`, post-approval.

## Iron rules

- **Diagnosis only.** No production-code edits, no fix branch, no PR. The scratch repro in the worktree is throwaway; its output is the comment.
- **Reproduce-first.** Never propose a fix you have not confirmed reproduces. NOT-REPRODUCED → `status:need-attention`, stop.
- **Stack up either way.** Boot the full stack (with external-dependency doubles) before reproducing on either path.
- **Browser MCP preferred, Playwright fallback.** Try the MCP (request permission if needed); fall back to Playwright on absence / denial / any failure; note the fallback once. Never hard-block waiting on an MCP install.
- **Contract guard.** A fix needing a contract / data-model change → Contract impact REQUIRES-CHANGE, recommend feature reclassification, `status:need-attention`, stop.
- **Root-cause to file:line, class-of-bug aware.** Cite the mechanism; `rg` for sibling sites and list them for the fix step.
- **Flip to ready-to-review only on a real, reproduced analysis.** The label is the human's cue that an approvable plan exists.
