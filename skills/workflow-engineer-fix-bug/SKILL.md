---
name: workflow-engineer-fix-bug
description: "Fix one approved kind:bug on its fix branch. Two dispatch verbs: `Fix bug #<n>` writes the regression test FIRST (RED per the approved # Bug Analysis comment, fails on pre-fix code), drives it GREEN, refactors, and pushes; `Fix the (gating|quality) review feedback on bug #<n>` addresses the newest # Bug Fix Gate Review / # Bug Fix Quality Review findings via TDD. Production code only; every commit carries `Refs #<n>`. Activate when dispatched with either verb or '/workflow-engineer-fix-bug'."
---

# workflow-engineer-fix-bug

The **back half** of the bug lifecycle: turn an approved fix plan into committed, tested code. Dispatched by the `fix-bug` workflow (`workflows/fix-bug.mjs`), which runs only after a human approved the `# Bug Analysis` comment (flipping the bug to `status:ready-to-implement`, then the kickoff stage to `status:in-progress`).

The bug's defining discipline lives here: **the regression test is written first, fails on the pre-fix code, and passes after the fix** — locking the defect out so it can't silently return. The fan-out review's `pattern-test-coverage` (deletable-code) lens gates exactly this, so a fix without a locking regression test blocks the review.

## When to activate

- The dispatch prompt opens with `Fix bug #<n>` (initial regression-fix), OR
- The dispatch prompt opens with `Fix the review feedback on bug #<n>` (post-review fix), OR
- The user types `/workflow-engineer-fix-bug`.

Do NOT activate to diagnose a bug (that is `workflow-engineer-analyze-bug`, the read-only pre-approval step) or for slice / PR work.

## Input contract

The fix branch is `fix/<n>-<intent>`, already created on origin by the `fix-bug` workflow's Prep. Resolve it by prefix (the slug suffix is not load-bearing):

```
git ls-remote --heads origin "fix/<n>-*"
```

Take the single matching branch name. If zero or more than one match, halt and surface the ambiguity — do not guess.

## Workflow

### 1. Read the bug + the approved analysis

Fetch the bug via `bash skills/operation-git/scripts/issue-body.sh <n> number,title,body,labels,url`. Read the issue's **newest `# Bug Analysis` comment** — the approved spec. It carries Root cause (`file:line`), Proposed fix (+ class-of-bug sites), and the **Regression-test plan** (the exact RED test: kind, the observable it asserts, seed/setup). The reporter's symptom (issue body, Zone A) gives the expected-vs-actual the test pins.

Read light context only as the fix needs it: `docs/GLOSSARY.md`, the ADR index, and a specific `docs/api-contract/<entity>.yaml` / `docs/data-model/<entity>.yaml` **only to conform to** (never to change — a bug fix never edits a contract; if you discover the fix requires one, halt to `status:need-attention` for feature reclassification).

### 2. Set up the fix worktree

```
bash skills/operation-git/scripts/setup-worktree.sh <fix-branch> --merge-main
```

`--merge-main` integrates `origin/main` so the fix lands on current code. `cd` into the printed worktree path. Check the branch for prior `Refs #<n>` WIP commits (a relaunch resumes from them — don't redo committed work). On a merge conflict that needs scope beyond this bug, halt to `status:need-attention`.

### 3a. Initial fix (verb: `Fix bug #<n>`) — regression test first

1. **RED.** Write the regression test exactly per the analysis comment's Regression-test plan — the kind it specifies (Playwright E2E / API-integration / unit), asserting the bug's observable. Run it and **confirm it FAILS on the current (pre-fix) code** — that failure is the proof the test actually reproduces the defect. A regression test that passes before any fix is not locking anything; rewrite it until it fails for the right reason.
2. **GREEN.** Make the minimal production-code change from the Proposed fix to turn the test green. No more than the test requires.
3. **Propagate the class-of-bug.** For each sibling site the analysis listed (or that you find via `rg` for the same anti-pattern), add its own RED → GREEN so the regression suite locks the pattern out everywhere. List propagated sites in the commit body.
4. **REFACTOR** if needed, tests staying green.

### 3b. Post-review fix (verb: `Fix the review feedback on bug #<n>`)

The cutoff is the authored timestamp of the newest commit on the fix branch carrying `Refs #<n>`. Pull every comment newer than that: read **non-reviewer (user) directives first** (they override), then the newest review comment. The `fix-bug` workflow posts **two** review headers — `# Bug Fix Gate Review` (regression coverage / contract / security — the gating verdict) and `# Bug Fix Quality Review` (code-quality, advisory); match whichever your dispatch verb targets (a **gating** fix → the newest `# Bug Fix Gate Review`; a **quality/polish** fix → the newest `# Bug Fix Quality Review`). Triage by the reviewer's fix-class — address every **Fix now**, skip **Defer**, fix **Nit** only if trivially in-scope (a user directive can promote/demote). Each Fix-now finding gets its own RED → GREEN. If no Fix-now finding and no promoting directive exists, halt and surface it.

### 4. Commit, push

Commit at the TDD cadence using the project's Conventional Commits format. Every commit ends with:

```
Refs #<n>
```

(There is no `Task:` trailer — a bug has no slice checklist; `Refs #<n>` is the load-bearing trailer the review-fix comment window keys off.) Push the fix branch to `origin`. Pre-push hooks gate lint/type/security/test as usual — a hook failure drops back to the TDD loop. Never force-push, never skip hooks.

Terminal action. Exit. Do NOT flip any label, open a PR, or re-review — the `fix-bug` workflow re-runs the review (after an initial fix) or opens the draft PR + releases the lock (after the review approves).

## Iron rules

- **Regression test first, and it must fail before the fix.** A test that passes pre-fix proves nothing — rewrite it. This is the bug's acceptance criterion.
- **Minimal production change.** Implement no more than the failing test(s) require; no speculative refactors bundled in.
- **A bug never edits a contract.** Conform to `docs/api-contract/*` / `docs/data-model/*`; if the fix truly needs to change one, halt to `status:need-attention` (reclassify to feature) — never a contract-violating workaround.
- **Class-of-bug, not one instance.** Propagate the fix to every equivalent site, each with its own RED→GREEN; list them in the commit body.
- **Every commit carries `Refs #<n>`** (no `Task:` trailer for bugs).
- **Resume from WIP commits.** Reconcile against prior `Refs #<n>` commits before re-touching code.
- **Post-review: scope from the comment window, user directives override, pick up by `Fix now` class.**
- **Bail with `status:need-attention`** on unrecoverable blockers (post a diagnostic comment first). Truth is in Git and the comment thread.
