---
name: workflow-engineer-e2e
description: "Run every E2E spec created or modified on a slice branch against the slice's stack via testcontainers; iterate to GREEN by driving TDD on production code only (NEVER modify the E2E specs themselves). On every spec green: remove `e2e:running` and add the sticky `e2e:validated` marker plus `review:pending` to the slice. On a test-case constraint that can't be addressed without modifying the spec: flip the slice to `status:need-attention` and exit. Activate when dispatched with `Validate E2E test cases on GitHub slice issue #<n>` or '/workflow-engineer-e2e'."
---

# workflow-engineer-e2e

Validate the slice's E2E specs end-to-end before the slice goes into slice-level review. The dispatcher (`/implement-feature` command's prepare-slice stage) has added `e2e:running` as its lock; this skill runs the specs against a real stack via testcontainers, drives TDD on production code to green every failure, and only ever modifies production code — never the E2E specs themselves.

When a spec's failure cannot be addressed via production-code changes (a real test-case constraint — bad assertion, wrong selector, broken fixture identity), STOP and flip the slice to `status:need-attention`. The user / `e2e-author` owns spec corrections.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Validate E2E test cases on GitHub slice issue #<n>` and the slice carries `level:slice` + `kind:feature` + `status:in-progress` + `e2e:running`.
- The user types `/workflow-engineer-e2e`, or phrases like "validate the E2E for slice #<n>", "run the slice's E2E against testcontainers".

Do NOT activate to author / modify E2E specs (use `workflow-e2e-author` or `workflow-e2e-fix`), to fix reviewer findings on a slice (use `workflow-engineer-fix-slice`), or to fix a PR (use `workflow-engineer-fix-pr`).

## Workflow

Input from the orchestrator: just the slice issue ID. Everything else discovered.

### 1. Read the slice body + verify the lock

Fetch the slice issue (number, title, body, labels, url) via `bash skills/operation-git/scripts/issue-body.sh <n>` — skips comment chrome. Confirm `level:slice` + `kind:feature` + `status:in-progress` + `e2e:running`. Missing `e2e:running` → halt and surface `no e2e:running lock on this slice — refusing to invent a result`.

### 2. Set up the slice worktree

Resolve the slice's attached branch, create-or-reuse the slice-scoped worktree on that branch (no rebase — the slice branch already carries the closed-task work and the latest E2E specs), then `cd` into the worktree path.

### 3. Find the E2E specs created or modified on the slice branch

- Fetch `origin/main`.
- Collect specs: `git diff --name-only origin/main..HEAD -- 'e2e/**/*.spec.*' '**/e2e/**/*.spec.*' | sort -u`.

If the list is empty, halt and surface `slice has no E2E specs to validate` (an upstream issue-creation bug — every `kind:feature` slice should ship E2E coverage).

### 4. Run the specs via testcontainers, iterate on production-code fixes

Bring up the slice's stack via testcontainers (the agent's loaded patterns own the specifics — `docker compose -p <slug>` is typical) using a slug derived from the slice branch name (lowercase, non-alphanumeric → `-`), then run only the touched specs with Playwright.

For each failure:

- **Production-code bug (default)**: drive TDD — write the unit/integration test that proves the production bug, drive RED → GREEN with the minimum production change, commit (`Refs #<slice-#>` trailer), re-run the E2E.
- **Test-case constraint** (bad assertion, broken fixture, wrong selector, race that can't be removed without spec edits): STOP. Bail by posting a diagnostic comment on the slice issue and flipping the slice from `e2e:running` + `status:in-progress` to `status:need-attention`. The diagnostic names the spec file, the assertion / fixture that's at fault, and what the user / `e2e-author` would need to change. Then exit.

**Never modify the E2E specs.** This skill only touches production code.

Iterate until every spec is green. The pre-push hooks will deny pushes that break lint/test/security; drop back into RED→GREEN if a hook denies.

### 5. Commit cadence and trailers

Every production-code commit uses the project's Conventional Commits format and ends with:

```
Refs #<slice-#>
```

Single `Refs` trailer here (no task-level context — this is slice-level work).

### 6. Push and flip the labels

Push the slice branch to `origin`, then flip the slice issue's labels: remove `e2e:running` and add **both** `e2e:validated` and `review:pending`.

`e2e:validated` is a **sticky** marker — it records that the slice has cleared full E2E validation once, and it must never be removed afterward. It is what keeps `prepare-slice` from re-adopting the slice during the slice-level review/fix loop (when the slice transiently carries no `review:*` label). `e2e:running` is the transient lock; `e2e:validated` is the permanent "has been validated" marker. Do not conflate them.

Terminal action. Exit. Do NOT close the slice, do NOT touch `status:in-progress`, do NOT open or promote a PR.

## Iron rules

- **Never modify the E2E specs.** Production-only fixes here. A failing E2E that requires spec changes is a `status:need-attention` bail, not a fix.
- **Every commit carries `Refs #<slice-#>`** (single trailer — slice-level work, no task context).
- **Each fix starts with a failing unit/integration test** in production-code land that mirrors the E2E's symptom. Drive RED→GREEN with the minimum change.
- **Propagate via `rg`** when the E2E's symptom is a class of bug (multiple endpoints with the same missing rate-limit decorator, multiple forms with the same missing CSRF wiring). Each equivalent site gets its own RED→GREEN.
- **Bail loud on test-case constraints.** Post a diagnostic comment naming the spec + assertion + suggested change, flip to `status:need-attention`, exit.
- **Container isolation**: derive a slug from the slice branch for the compose project name and image tag so parallel slice validations don't collide on ports.
- **Truth is in Git and on the slice labels.** Push commits + the terminal label flip are the only output.
