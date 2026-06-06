---
name: workflow-engineer-fix-e2e
description: "Fix ONE diagnosed E2E failure group on the slice branch via outside-in TDD on production code only — never the specs. The dispatch carries the group's root cause, failing tests, and fix hint. Write a failing unit/integration test mirroring the symptom, drive it green with the minimal change, propagate the class-of-bug to every sibling site, commit with a `Refs #<slice#>` trailer, and push. Activate when dispatched with `Fix E2E failures on slice #<n>` or '/workflow-engineer-fix-e2e'."
---

# workflow-engineer-fix-e2e

The **fix half** of the Pass-E2E phase. Take ONE correlated failure group that
`workflow-engineer-diagnose-e2e` identified and drive production code to resolve its root
cause via strict TDD. The calling `implement-slice` workflow dispatches one of these per
group, **serially** on the shared slice worktree (one edit at a time), then re-diagnoses to
verify — so this skill never boots the stack or runs the full E2E suite itself.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix E2E failures on slice #<n>` (it also carries the group's
  root cause, failing tests, and fix hint).
- The user types `/workflow-engineer-fix-e2e`, or "fix the diagnosed E2E failure group on slice #<n>".

Do NOT activate to run / categorize the suite (that is `workflow-engineer-diagnose-e2e`), to
author / modify E2E specs (`workflow-e2e-author` / `workflow-e2e-fix`), to fix reviewer findings
on a slice (`workflow-engineer-fix-slice`), or to fix a PR (`workflow-engineer-fix-pr`).

## Input contract

The dispatch prompt is the contract. It names:

- the slice #,
- `Root cause:` — the shared production-code defect for this group,
- `Failing tests:` — the `spec-file::test-title` of each E2E failure in the group,
- `Fix:` — the concrete corrective action plus any sibling sites to propagate to.

Read the slice issue #<n> body (`bash skills/operation-git/scripts/issue-body.sh <n>`) for the
Acceptance criteria the failing specs assert — they anchor what "correct" means.

## Workflow

### 1. Set up the slice worktree (reuse — do NOT re-merge main)

```bash
bash skills/operation-git/scripts/setup-worktree.sh "$slice_branch"
```

Reuse the slice-scoped worktree. **No `--merge-main`** — the diagnose step already integrated
`origin/main` this round. `cd` into the printed path.

**Resume before pressing on.** Cross-check the slice branch for prior `Refs #<slice#>` WIP
commits (`git -C <worktree> log --grep "Refs #<slice#>"`): a killed fixer that the reconcile
reaper relaunched leaves exactly that trail. Don't redo committed work.

### 2. Drive the fix via TDD — production code only

For the group's root cause:

- **RED.** Write the unit/integration test in production-code land that mirrors the E2E
  symptom (the assertion the failing spec makes, expressed at the unit/integration layer).
  Confirm it FAILS on the current code — a test that passes pre-fix proves nothing.
- **GREEN.** Make the minimal production-code change from the `Fix:` hint to turn it green.
- **Propagate the class-of-bug.** For each sibling site the diagnosis listed (and any equivalent
  site you find via `rg`), add its own RED → GREEN. List the propagated sites in the commit body.
- **REFACTOR** if needed, tests staying green.

**Never modify the E2E specs.** This skill only touches production code (and its unit/integration
tests). If the only way to make a failing spec pass is to edit the spec, that is a test-case
constraint the diagnose step should have caught — surface it (post a diagnostic comment naming the
spec + assertion, do not invent a production workaround that fights the spec) and stop.

### 3. Commit cadence and trailers

Every production-code commit uses the project's Conventional Commits format and ends with:

```
Refs #<slice#>
```

Single `Refs` trailer (no `Task:` trailer — this is slice-level production work serving the AC,
not one checklist task). Run only the targeted unit/integration tests you authored to confirm
green; **do not boot the stack or run the full E2E suite** — the next diagnose round owns the
suite re-run.

### 4. Push and report

Push the slice branch to `origin` (pre-push hooks gate lint/test/security — drop back into
RED→GREEN if a hook denies). The terminal signal is the pushed commits; the calling workflow
re-diagnoses to confirm the group is resolved. Flip no label, open no PR, close no slice.

## Iron rules

- **One group, production code only.** Fix exactly the dispatched group's root cause; never edit
  E2E specs; never expand scope to unrelated failures (the diagnosis split them deliberately).
- **Reuse the worktree, never re-merge main.** Diagnose owns integration; you resume on the
  already-integrated branch and resume from prior `Refs #<slice#>` WIP commits.
- **Each fix starts with a failing unit/integration test** that mirrors the E2E symptom. Drive
  RED→GREEN with the minimum change.
- **Class-of-bug, not one instance.** Propagate to every equivalent site, each its own RED→GREEN;
  list them in the commit body.
- **Never boot or run the full E2E suite.** The diagnose step re-runs it next round — running it
  here would duplicate the boot the split exists to avoid.
- **Every commit carries `Refs #<slice#>`** (single trailer — slice-level work, no task context).
- **A spec-level fault is not yours to fix.** If the group can't be closed without a spec edit,
  surface it and stop; the user / `e2e-author` owns spec corrections.
