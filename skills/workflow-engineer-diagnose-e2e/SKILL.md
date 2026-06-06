---
name: workflow-engineer-diagnose-e2e
description: "Integrate origin/main, boot the slice's stack, run every E2E spec created or modified on the slice branch via testcontainers, and CATEGORIZE any failures into correlated production-fix groups — without writing a fix. Returns the diagnosis structurally (green | failures + groups | need-attention); the calling workflow dispatches one engineer per group. Edits no code or specs. Activate when dispatched with `Diagnose E2E acceptance for slice #<n>` or '/workflow-engineer-diagnose-e2e'."
---

# workflow-engineer-diagnose-e2e

The **diagnose half** of the Pass-E2E phase. Run the slice's E2E specs against a real
stack and report *what is failing and why* — grouped by shared root cause — so the
calling `implement-slice` workflow can dispatch one focused engineer fix per group.

This step **writes no production code and no specs**. It reproduces failures and
categorizes them; the actual TDD fix is a separate dispatch (`workflow-engineer-fix-e2e`),
one per correlated group, run serially on the shared slice worktree. Keeping diagnose
fix-free is what lets each fix run in a fresh, narrow context scoped to one root cause
instead of one mega-context juggling the whole suite.

The single exception to "no writes": the mandatory `origin/main` integration merge
(step 2) is committed and pushed, exactly as the old combined skill did — integration
must persist so the fixers and the next diagnose round see it.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Diagnose E2E acceptance for slice #<n>`.
- The user types `/workflow-engineer-diagnose-e2e`, or "diagnose the slice's E2E failures".

Do NOT activate to FIX a failure (that is `workflow-engineer-fix-e2e`), to author / modify
E2E specs (`workflow-e2e-author` / `workflow-e2e-fix`), to fix reviewer findings on a slice
(`workflow-engineer-fix-slice`), or to fix a PR (`workflow-engineer-fix-pr`).

## Input contract

Read the slice issue #<n> body. The slice's Acceptance criteria (EARS) plus each `e2e` task's own `scenario:` Gherkin are the
behavior the E2E specs assert; the `## Tasks` checklist's `e2e` entries name the specs under
test. The checklist is the durable task ledger — this phase does not tick boxes (it drives
nothing in the checklist).

## Workflow

Input from the caller: the slice #. Everything else discovered.

### 1. Read the slice body

Fetch the slice issue (number, title, body, labels, url) via
`bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Read the
Acceptance criteria (the behavior under test) and the `## Tasks` checklist's e2e entries.

### 2. Set up the slice worktree and integrate `origin/main` (push-safe merge)

Resolve the slice's attached branch, then create-or-reuse the slice-scoped worktree on that
branch **and integrate the latest `origin/main` into it before any validation runs**:

```bash
bash skills/operation-git/scripts/setup-worktree.sh "$slice_branch" --merge-main
```

`--merge-main` merges `origin/main` INTO the slice branch with an explicit merge commit (it
does **not** rebase — merge keeps history append-only and push-safe). This is the integration
point: every other slice that merged to `main` since this branch was cut lands here, so
cross-slice contract breaks surface during E2E with full context, not as a PR-time scramble.

- **Clean merge (default):** the helper prints the worktree path and exits 0. `cd` in, continue.
- **Merge conflict (exit 3):** resolve by intent (a slice at E2E time has full context), `git
  commit` the merge with a `Refs #<slice#>` trailer, push, and proceed. Do **not** abort or
  force-push. A conflict that needs scope expansion beyond this slice is a `need-attention`
  return (status `need-attention`, `reason` naming the conflicting files + sibling slice).

Push the merge commit before running the specs so the integrated state is on `origin`.
**This merge is the only write this skill performs** — no other commit, no production edit.

### 3. Find the E2E specs created or modified on the slice branch

The step-2 merge already fetched and integrated `origin/main`. Collect specs:

```bash
git diff --name-only origin/main..HEAD -- 'e2e/**/*.spec.*' '**/e2e/**/*.spec.*' | sort -u
```

If the list is empty, return `need-attention` with `reason: slice has no E2E specs to
validate` (an upstream issue-creation bug — every `kind:feature` slice should ship E2E coverage).

### 4. Boot gate, then run every touched spec

**Pre-flight — prove the full stack boots before the first spec.** Bring the slice's stack up
with a fresh build (so any production fixes from prior rounds are picked up) and wait for every
service to report healthy:

```bash
docker compose -p <slug> up -d --build --wait
```

Derive `<slug>` from the slice branch name (lowercase, non-alphanumeric → `-`). Include a
stand-in for every external dependency the flow exercises (mail catcher, object-store emulator,
fake gateway, broker). A stack that can't reach healthy is a **wiring** failure — surface it as
a failure group with `rootCause` naming the wiring defect (missing service double, wrong
connection scheme, bad proxy block); it is production-fixable, not a spec failure.

Once healthy, run **all** the touched specs with Playwright (never a partial subset — the whole
suite's pass/fail picture is the diagnosis). Capture each failure's spec file, test title, and
the assertion / error.

### 5. Categorize the failures

For each failing test, decide its class:

- **Production-code bug (default).** The spec asserts correct AC behavior and production code is
  wrong. Trace the mechanism to `file:line`; `rg` for sibling sites exhibiting the same defect.
- **Test-case constraint.** The failure can only be addressed by editing a spec — a bad
  assertion, a broken fixture identity, a wrong selector, or a race that can't be removed
  without spec changes. The user / `e2e-author` owns spec corrections, not this lifecycle.

Then **group the production-code failures by shared root cause** (correlation): failures that a
single fix resolves go in one group. For each group set `complexity` (L localized ≲30min /
M multi-file or new tests / H design/contract-adjacent rework) and a concrete `fixHint` (the
corrective action + every sibling site to propagate to). `failingTests` lists each failure as
`spec-file::test-title`.

### 6. Return the diagnosis

Return the `E2E_DIAGNOSIS` object to the caller:

- **All specs green →** `status: green`, `groups: []`, `reason: null`. The phase is done.
- **Production-fixable failures →** `status: failures` with one entry in `groups` per correlated
  root cause. `reason: null`.
- **Any test-case constraint present →** `status: need-attention` (this **takes precedence**
  over production failures in the same run). Set `reason` naming the spec file + the
  assertion/fixture at fault + what the user / `e2e-author` must change. `groups: []`.

Post NO comment. Flip NO label. The calling workflow owns gating and (on a `need-attention`
return) the `status:need-attention` halt; the slice stays `status:in-progress` here otherwise.

## Iron rules

- **Diagnosis only.** Never edit production code or E2E specs. The only write is the step-2
  `origin/main` integration merge (committed + pushed). The return value is the diagnosis.
- **Integrate `origin/main` before the first spec — by merge, never rebase.** Cross-slice
  contract breaks must surface here with full context. A conflict needing scope expansion → a
  `need-attention` return.
- **Boot gate before the first spec, `--build` every round.** Bring the whole stack (with a
  double for every external dependency) to healthy first. A stack that can't reach healthy is a
  wiring failure group, not a spec failure. `--build` so prior-round fixes are picked up.
- **Run the whole touched suite, never a subset.** The complete pass/fail picture is the diagnosis.
- **Group by shared root cause.** Correlated failures collapse into one group so the caller
  dispatches one focused fix; class-of-bug sibling sites go in that group's `fixHint`.
- **Test-case constraint takes precedence → `need-attention`.** A spec only the user /
  `e2e-author` can fix halts the slice; never propose a production workaround that fights the spec.
