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

### 2. Set up the slice worktree and integrate `origin/main` (push-safe merge)

Resolve the slice's attached branch, then create-or-reuse the slice-scoped worktree on that branch **and integrate the latest `origin/main` into it before any validation runs**:

```bash
bash skills/operation-git/scripts/setup-worktree.sh "$slice_branch" --merge-main
```

`--merge-main` merges `origin/main` INTO the slice branch with an explicit merge commit (it does **not** rebase — merge keeps history append-only and push-safe, honoring the never-force-push iron rule). This is the integration point: every other slice that has merged to `main` since this branch was cut now lands here, so cross-slice contract breaks (e.g. a sibling slice that changed `create_app` / `main.py` composition) surface during E2E validation with full context — not as a PR-time scramble at Stage 8.

- **Clean merge (default):** the helper prints the worktree path and exits 0. `cd` into it and continue to step 3.
- **Merge conflict (exit 3):** the helper leaves the conflicted worktree in place and prints its path. `cd` in, resolve the conflicts now (resolve by intent — a slice at E2E-validation time has full context for what each side meant), `git commit` the merge with a `Refs #<slice-#>` trailer, and proceed. Do **not** abort or force-push. If a conflict cannot be resolved without expanding scope beyond this slice, bail loud: post a diagnostic comment on the slice naming the conflicting files + sibling slice, flip `e2e:running` + `status:in-progress` → `status:need-attention`, and exit.

Push the merge commit before running the specs so the integrated state is on `origin` (the same push cadence as step 6 applies — pre-push hooks gate it). Then run E2E against the integrated state.

### 3. Find the E2E specs created or modified on the slice branch

- The merge in step 2 already fetched and integrated `origin/main`.
- Collect specs: `git diff --name-only origin/main..HEAD -- 'e2e/**/*.spec.*' '**/e2e/**/*.spec.*' | sort -u`.

If the list is empty, halt and surface `slice has no E2E specs to validate` (an upstream issue-creation bug — every `kind:feature` slice should ship E2E coverage).

### 4. Boot gate, then run the specs via testcontainers and iterate on production-code fixes

**Pre-flight — prove the full stack boots before the first spec.** Bring the slice's stack up and wait for every service to report healthy (`docker compose -p <slug> up -d --wait`, or poll each `/healthz`) — including a stand-in for every external dependency the flow exercises (mail catcher, object-store emulator, fake gateway, broker). Derive `<slug>` from the slice branch name (lowercase, non-alphanumeric → `-`). The first E2E run is also the first integration smoke test: if the stack can't reach healthy, the failure is **wiring** (a missing service double, the wrong connection scheme, a bad proxy block) — fix that first; do not read it as a spec failure.

Once the stack is healthy, run only the touched specs with Playwright.

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

- **Integrate `origin/main` before the first spec — by merge, never rebase.** Run `setup-worktree.sh <branch> --merge-main` so the slice is current with main before E2E validation, slice review (Stage 6), and the PR (Stage 8). Merge keeps history append-only and push-safe; never rebase + force-push a slice branch. Cross-slice contract breaks must surface here, with full context, not at PR time. A merge conflict that needs scope expansion beyond this slice is a `status:need-attention` bail.
- **Never modify the E2E specs.** Production-only fixes here. A failing E2E that requires spec changes is a `status:need-attention` bail, not a fix.
- **Boot gate before the first spec.** Bring the whole stack — including a double for every external dependency the flow touches — to healthy before running any spec. A stack that can't reach healthy is a wiring bug (missing service double, wrong connection scheme, bad proxy block), not a spec failure; fix the wiring first.
- **Every commit carries `Refs #<slice-#>`** (single trailer — slice-level work, no task context).
- **Each fix starts with a failing unit/integration test** in production-code land that mirrors the E2E's symptom. Drive RED→GREEN with the minimum change.
- **Propagate via `rg`** when the E2E's symptom is a class of bug (multiple endpoints with the same missing rate-limit decorator, multiple forms with the same missing CSRF wiring). Each equivalent site gets its own RED→GREEN.
- **Bail loud on test-case constraints.** Post a diagnostic comment naming the spec + assertion + suggested change, flip to `status:need-attention`, exit.
- **Container isolation**: derive a slug from the slice branch for the compose project name and image tag so parallel slice validations don't collide on ports.
- **Truth is in Git and on the slice labels.** Push commits + the terminal label flip are the only output.
