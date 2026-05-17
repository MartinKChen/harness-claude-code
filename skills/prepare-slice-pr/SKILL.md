---
name: prepare-slice-pr
description: "Prepare a draft slice PR for a single GitHub slice issue (`level:slice` + `kind:feature` + `status:in-progress` + `status:prepare-pr`) dispatched by `create-draft-pr`. Read the slice body, resolve the slice branch and its closed task sub-issue numbers, materialize the slice-scoped worktree, load the always-on security context and the full fullstack pattern set, merge the latest `origin/main` into the slice branch (resolving any conflicts by union and finalizing with a merge commit — bail to `status:need-attention` if union resolution would require scope expansion), then identify every E2E spec that was created or modified on the slice branch since `origin/main`, run those specs against the slice's runtime, triage each failure as production-code bug (drive the fix via TDD with `rg`-driven pattern propagation, commit, re-run) or E2E-spec bug (stop and flip the slice to `status:need-attention`, dropping `status:prepare-pr`, with a diagnostic comment). Once every E2E spec is green, compose the PR body from `templates/pr-body.md` (with `Closes #<slice-#>` first, then `Closes #<task-#>` for every closed task sub-issue), push the slice branch, open the draft PR with the slice's milestone, and remove `status:prepare-pr` from the slice. Activate when the dispatch prompt opens with `Prepare draft PR for slice issue #<n>`, or when the user types phrases like 'prepare the draft PR for slice #<n>', '/prepare-slice-pr'. Do NOT activate to implement task work (use `implement-feature-task`), to fix CI / merge-conflict on an open PR (use `fix-pr-blockers`), to address reviewer findings on a task (use `fix-task-feedback`), or to author E2E specs from scratch (use `author-e2e-tests`)."
---

# prepare-slice-pr

Prepare the draft slice PR for a single slice issue dispatched by `create-draft-pr`. The orchestrator added `status:prepare-pr` to the slice as a lock; this skill removes that label as part of its terminal action — either by opening the draft PR (success path) or by flipping the slice to `status:need-attention` (E2E-spec needs human editing).

This is the engineer's only mode that performs **production-code fixes driven by E2E test failures rather than reviewer findings or CI logs**, and the only engineer mode that **creates** a PR (every other mode operates on a slice branch whose PR either already exists or is created later).

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Prepare draft PR for slice issue #<n>` and the slice carries `level:slice` + `kind:feature` + `status:in-progress` + `status:prepare-pr` (the orchestrator added the prepare-pr label as its lock before dispatching).
- The user types `/prepare-slice-pr`, or phrases like 'prepare the draft PR for slice #<n>', 'run the slice E2E and open the PR', 'verify the slice's E2E and create the draft PR'.

Do NOT activate when:

- The task is a `level:task` issue — use `implement-feature-task` (backend/frontend) or `author-e2e-tests` (e2e).
- The unit of work is an open PR (`conflict` / `ci`) — use `fix-pr-blockers`.
- The slice is missing `status:prepare-pr` — the orchestrator did not pick this slice for prep; do not race the orchestrator by self-flipping the label.
- The slice's task sub-issues are not all closed yet — `create-draft-pr` is the only place that may dispatch this skill, and it only dispatches once every sub-issue is closed.

## References

| Skill | When to route to it |
|-------|---------------------|
| `tdd-workflow` | For each production-code fix driven by a red E2E spec. **Required when any spec fails for a production-side reason.** |
| `security-patterns` | At the start of every dispatch, before writing any code. **Required (always).** |

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every commit produced during this prep pass (`fix(...)` / `test(...)` RED→GREEN→REFACTOR commits, any drift-correcting `chore(docker)` / `chore(env)` commits). |
| `templates/pr-body.md` | PR-body skeleton (sections + trailing linked-issues block placeholders: `<slice-#>` and the `<task-#-N>` lines). Copy and fill before opening the PR. |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <slice-#>` | Print the slice branch attached to the slice issue (empty if none). |
| `scripts/list-task-subissues.sh <slice-#>` | Print one-line-per-task-# of every closed `level:task` + `kind:feature` sub-issue under the slice (for the PR body's linked-issues block). |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. |
| `scripts/merge-main.sh` | From the current worktree, fetch `origin/main` and merge it into the slice branch. Exits 0 on clean merge (fast-forward or a single merge commit); exits non-zero with the working tree mid-merge when conflicts surface — caller resolves hunks by union, `git add`s the resolved files, and `git commit --no-edit`s to finalize the merge. |
| `scripts/list-touched-e2e-specs.sh` | From the current worktree, print every E2E spec file added or modified on the slice branch since `origin/main`. Empty output means the slice introduced no E2E coverage (rare — surface it). |
| `scripts/open-draft-pr.sh <head-branch> <title> <body-file> [--milestone <name>]` | Create the draft PR; print the URL. |
| `scripts/push-create-pr-clear-prepare.sh <slice-#> <slice-branch> <title> <body-file> [--milestone <name>]` | Push the slice branch (merge preserves history — no force flag needed), open the draft PR, and remove `status:prepare-pr` from the slice. Terminal success action. |
| `scripts/mark-slice-need-attention.sh <slice-#> <comment-file>` | Remove `status:prepare-pr` from the slice, add `status:need-attention`, and post the diagnostic comment from `<comment-file>`. Terminal bail-out action. |

## Workflow

Inputs from the orchestrator: a slice issue number. The orchestrator (`create-draft-pr`) already labeled the slice with `status:prepare-pr` as its lock and confirmed every task sub-issue is closed and no PR exists on the slice branch — do not re-check those pre-conditions. Everything else (slice branch, milestone, task sub-issue numbers, touched E2E specs, runtime command, conflicts surfaced by merging `origin/main` into the slice branch) you discover yourself.

### 1. Fetch the slice body, resolve the slice branch, and gather closed task sub-issues

Read the slice body in full once — it is the contract every E2E spec under the slice was authored against:

```bash
gh issue view <slice-#> --json number,title,body,labels,milestone,url
```

Capture `milestone.title` for step 8 (open-draft-pr) and the slice's `title` for the PR title. If the slice has no milestone, the PR opens without one — never fabricate.

Resolve the slice branch and the list of closed task sub-issue numbers — both are reused in step 7 (PR body composition) and step 8 (push + open PR):

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <slice-#>)"
task_numbers="$(bash scripts/list-task-subissues.sh <slice-#>)"
```

If `slice_branch` is empty, surface "no slice branch attached to slice #<n>" and stop — the orchestrator's view and the live state disagree, and creating a branch here would race `create-issues`.

### 2. Materialize the slice branch in a worktree

Check the slice branch out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and **do all subsequent work inside that path** — never in the orchestrator's checkout.

```bash
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

### 3. Load always-on security context

Invoke `security-patterns` before any code is written, even if no production fix is required — a fix that does land must satisfy the checklist.

### 4. Load the full fullstack pattern set via `tdd-workflow`

A failing E2E spec can point at a bug in any layer of the slice. Instruct `tdd-workflow` to load `references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, and `references/docker-patterns.md` so the fix can land anywhere without a second round-trip.

### 5. Merge `origin/main` into the slice branch and resolve any conflicts

Before running any E2E specs, merge the latest `origin/main` into the slice branch. Two reasons:

- E2E specs running against a stale base can pass on the slice tree yet fail on the merged tree because of changes that landed on `main` while the slice was in flight — discovering that here is cheaper than discovering it after CI runs on an opened PR.
- The PR opened in step 8 will already include `main`'s latest commits, eliminating a `conflict` round-trip via `fix-pr-blockers`.

Merge (not rebase) is the intentional choice: it preserves the slice branch's commit history as-authored, avoids rewriting any commit the task sub-issues already reference by SHA, and lets the push in step 8 be a plain forward push — no force flag needed. When `main` hasn't diverged from the slice's base, `git merge` fast-forwards and produces no merge commit; when it has, exactly one merge commit lands at the tip of the slice branch.

```bash
bash scripts/merge-main.sh
```

If the merge completes cleanly (exit 0, no conflicts), continue to step 6.

If conflicts surface, the script exits non-zero with the working tree mid-merge. Resolve every conflicting hunk by reading both sides and producing the **union** that preserves the slice's intended behavior **and** the base's incoming change — never blindly take one side. After resolving every conflict, `git add <path>` the resolved files and finalize the merge with `git commit --no-edit` (or `git commit` with a clarifying message that lists the unioned paths). Do not amend or rewrite the original slice commits; the merge commit is the only new commit this step should produce.

If the merge brings a new pattern in from `main` (a new safety helper, a renamed import, a new validation hook), `rg` the slice's other touched files for clearly equivalent sites still on the old pattern and bring them onto the new one in the same prep pass — per the pattern-propagation rule in *Iron rules*. Each such site gets its own RED → GREEN via `tdd-workflow` after the merge completes, and each lands as its own commit on top of the merge commit.

If the merge introduces test-visible regressions (existing unit/integration tests fail because of merged-in code), drop into a fresh RED → GREEN → REFACTOR cycle for each broken test via `tdd-workflow` **before** continuing to E2E execution in step 6.

**If the conflict cannot be resolved without scope expansion** (e.g. `main` rewrote a module the slice also rewrites and the two intents are incompatible), `git merge --abort` and route to the bail-out path in step 6c with a diagnostic listing every conflicting path, both incoming and slice-side intents per path, and a one-line explanation of why union resolution would require scope expansion. The user resolves the divergence and re-dispatches by clearing `status:need-attention`.

Because the merge preserves history rather than rewriting it, the push in step 8 is a plain `git push` — no force flag needed and none permitted; see *Iron rules*.

### 6. Identify and run every E2E spec touched on the slice branch

Compute the set of E2E spec files added or modified on the slice branch since it diverged from `origin/main`:

```bash
touched_specs="$(bash scripts/list-touched-e2e-specs.sh)"
```

If `touched_specs` is empty, the slice introduced no E2E coverage. That is the expected shape only when the slice is purely backend or purely infrastructural and the parent task list contained no `type:e2e` task. Verify by re-reading the slice body — if any acceptance criterion clearly demanded E2E coverage that is missing, surface "slice #<n> has no touched E2E specs but acceptance criteria demand E2E coverage" and stop; otherwise continue to step 7 (skipping the test run).

Run every touched spec under the slice's runtime. The exact command is project-specific — discover it from the worktree's `package.json` `scripts` block (typically `npm run e2e`, `npm run test:e2e`, or `npx playwright test`). When in doubt, prefer the project's existing convention over inventing a new one. Pass the touched spec paths explicitly so unrelated specs don't run:

```bash
# Example — adapt to the project's actual e2e command:
npx playwright test ${touched_specs}
```

The container-stack-up rules from the engineer agent's guidance still apply: when a spec exercises a built image, derive a slug from `${slice_branch}` and pass `IMAGE_TAG` + `-p <slug>` so concurrent slice worktrees don't collide. Tear the stack down with `docker compose -p "${slug}" down -v` before exiting the worktree.

Capture the full test output to a temp file — both the success-path summary and any failure details. The output is the input to step 6a's triage.

#### 6a. Triage each failure

For every failing spec, read the failure output and classify it. The triage decides the whole shape of the rest of this run:

- **Production-code bug** — the spec asserts behavior the slice clearly intended to ship (per the slice body and the closed `type:e2e` task it came from), and the failure exposes a real defect in the slice's production code. Examples: a 500 from the backend on a happy-path request, a UI element that never renders, a state machine that returns the wrong status, a missing or wrong DOM contract that the spec accurately requires.
- **E2E-spec bug** — the spec encodes a demand the slice cannot satisfy as authored (wrong selector for the rendered UI, wrong endpoint shape, an assertion that contradicts a decision the team made between authoring and now, a flake that no production change can deterministically eliminate). The fix lives in the spec, not in production code. Spec changes are out of scope for this agent — the user reviews the failing assertion and either rewrites the spec or accepts the demand and re-dispatches.

**If even one failure is an E2E-spec bug**, route the whole run to the bail-out path in step 6c. Do not partially fix production code and then bail — the partial commits would land on the slice branch with a non-green E2E suite, and the next dispatch would have to either revert them or re-do the triage. Bail cleanly, surface every failure (production-code + spec), and let the human resolve the spec(s) before re-dispatch.

**If every failure is a production-code bug**, proceed to step 6b — drive each one to GREEN before opening the PR.

#### 6b. Fix every production-code failure via TDD

For each production-code failure, treat the failing E2E spec as the RED test. Do not write a duplicate unit test "alongside" the E2E spec to drive the fix — that would lock the same demand in twice. Drop into the minimum production change that takes the E2E spec to GREEN, then REFACTOR under green. Each fix gets its own commit per `templates/commit-messages.md` (`fix(<scope>): <subject>`).

Before declaring any fix done, `rg` the codebase for the same anti-pattern the failure surfaced — a "500 on null body" almost never lives at the only endpoint the spec exercised, and a "missing aria-label" rarely lives at the only component the spec interacted with. Each additional clearly-equivalent site gets its own RED → GREEN (a focused unit/integration test is acceptable for propagated sites that the E2E spec doesn't exercise directly), per the pattern-propagation rule in *Iron rules*. List the additional sites in the commit body so the reviewer can audit the scope.

After every commit, re-run the full set of `touched_specs` (not just the one you fixed) — a fix can regress a previously-passing spec, and finding that out after the PR opens wastes a review cycle. Repeat until every touched spec is green.

Once every spec is GREEN, run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, that the worktree has a top-level `docker-compose.yaml` (or `compose.yaml`), and that each `Dockerfile` has a sibling `.dockerignore`. If any is missing, scaffold it via `docker-patterns` and commit `chore(scaffold): <what>`.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` against everything committed in this prep pass. If a fix added a runtime dep, exposed a new port, changed an entrypoint, or moved a secret to env, update the container files in the same slice (commit `chore(docker): <what>` or `fix(docker): <what>`). If the runtime surface did not drift, leave the container files alone.

Then run the `.env.example` audit: a fix that added, renamed, or removed an env var the app reads requires a matching update to `.env.example` (commit `chore(env): <what>` or `fix(env): <what>`). If env vars did not drift, leave it alone.

Continue to step 7 (compose PR body) only after every touched spec is green and the audits are clean.

#### 6c. Bail out — flip the slice to `status:need-attention`

This bail-out path serves **two distinct triggers**:

1. **Unresolvable merge conflict from step 5** — `main`'s changes and the slice's intent are fundamentally incompatible; union resolution would require scope expansion.
2. **E2E-spec bug from step 6a** — one or more touched specs encode a demand the slice cannot satisfy as authored.

In either case, compose a diagnostic comment.

For trigger (1) — merge conflict — list every conflicting path with:

- The path.
- A 2–6 line excerpt of the conflicting hunk (slice side `<<<<<<<` vs. base side `>>>>>>>`).
- A one-line explanation of why the two sides cannot be unioned without scope expansion (e.g. "main refactored `UserService.find_by_email` into `UserService.lookup(:email, …)`; the slice still adds `find_by_email` as a new public method — picking either side erases the other's intent").
- The slice's likely path forward (e.g. "slice should drop its `find_by_email` addition and call `lookup` instead").

For trigger (2) — E2E-spec bug — list every failure (production-code + spec) with:

- The spec file path and the failing test name.
- A 2–4 line excerpt from the failure output — the assertion message, the actual-vs-expected values, and the smallest stack frame that points at the failing line.
- The triage verdict per failure: **production-code bug (fix would have landed in `path/to/file.ext:line`)** or **E2E-spec bug (`path/to/spec.spec.ts:line` — assertion contradicts the implemented behavior because …)**.

Write the comment to a temp file and call the terminal bail-out script:

```bash
comment_file="$(mktemp)"
# ... fill ${comment_file} with the diagnostic above ...
bash scripts/mark-slice-need-attention.sh <slice-#> "${comment_file}"
rm -f "${comment_file}"
```

The script removes `status:prepare-pr` from the slice, adds `status:need-attention`, and posts the comment. Stop immediately after the script returns — do not push any partial fixes, do not open a PR, do not loop. If the bail was triggered by a merge that halted on conflict, leave the local worktree mid-merge — never push the half-merged state; the worktree will be hard-reset to `origin/<slice-branch>` on the next dispatch via `setup-worktree.sh`. The user reviews the diagnostic and either rewrites the spec(s), resolves the divergence themselves, or pushes a fix, then clears `status:need-attention` so `create-draft-pr` can re-pick the slice on the next fire.

### 7. Compose the PR body

Reached only when every touched E2E spec is green (or the slice had no touched specs and step 6 was a no-op). Start from `templates/pr-body.md`, which ships the standard PR-body sections (What / Why / How / Testing / Screenshots / Checklist) plus a trailing linked-issues block with three placeholders: `<slice-#>`, `<task-#-1>` … `<task-#-N>`.

Order in the trailing block is load-bearing: **`Closes #<slice-#>` MUST be the first closing-keyword reference in the body** so `close-pr`'s `closingIssuesReferences[0]` reads the slice issue (and not a task) when it later strips `status:in-progress` and closes the slice.

Using `Closes` (not `Refs`) for tasks is safe — every task sub-issue is already closed by the time this skill fires; the closing keyword is a no-op for them at merge time but is what populates the PR's Linked Issues / Development sidebar.

Copy the template, fill in the prose sections (or drop sections that don't apply), then replace the trailing-block placeholders with the actual slice and task numbers — write the final body to a temp file for `push-create-pr-clear-prepare.sh`. Note that **changes brought in from `main` by the merge** should NOT be itemized in the PR's What/How sections — the PR body documents the slice's intent; the merge's purpose is to keep the branch current, not to ship `main`'s work:

```bash
body_file="$(mktemp)"
cp templates/pr-body.md "${body_file}"

sed -i.bak \
  -e "s/Closes #<slice-#>/Closes #${slice_number}/" \
  -e '/Closes #<task-#-/d' \
  "${body_file}"
rm -f "${body_file}.bak"

for t in ${task_numbers}; do
  printf -- '- Closes #%s\n' "${t}" >> "${body_file}"
done
```

If `${task_numbers}` is empty (unusual but possible), also strip the "Task sub-issues (closed before this PR was opened):" header line so the block doesn't ship as a dangling section.

### 8. Push, open the draft PR, and clear `status:prepare-pr`

Inherit the milestone from the slice issue (captured in step 1). Pass the milestone's `title` (display name) for stability; omit when the slice has no milestone.

```bash
bash scripts/push-create-pr-clear-prepare.sh \
  "<slice-#>" \
  "${slice_branch}" \
  "${slice_title}" \
  "${body_file}" \
  ${slice_milestone_title:+--milestone "${slice_milestone_title}"}
rm -f "${body_file}"
```

The script does a plain `git push` of the slice branch — the merge in step 5 preserved history, so the push is a strict fast-forward over `origin/<slice-branch>` and no force flag is needed. The pre-push hooks re-run the fullstack lint/format/type/test set and the security scans against the worktree — drop back into step 6b if any hook denies; never skip hooks. The script then opens the draft PR with the body file and milestone, and removes `status:prepare-pr` from the slice issue.

This is the terminal success action. Exit after the script returns — do not flip the PR to ready-to-review (that's `close-pr`'s lane), do not touch any `review:*` label, do not comment further, do not loop.

If `gh pr create` inside the script fails because a PR already raced into existence on the branch (`422 "A pull request already exists"`), surface as benign — also remove `status:prepare-pr` from the slice (the slice no longer needs prep) and exit; the orchestrator's `find-existing-pr.sh` pre-check filters this out, so a race here means a sibling fire opened the PR while this engineer was running.

## Iron rules

- **`status:prepare-pr` is the lock — the engineer removes it on every terminal path.** Either step 8's success path (push + open PR + remove label) or step 6c's bail path (remove label + add `status:need-attention`) clears it. Leaving `status:prepare-pr` on a slice after exit would prevent `create-draft-pr` from ever re-picking it.
- **Merge `origin/main` into the slice branch BEFORE running E2E specs (step 5) — never rebase.** E2E specs running against a stale base can pass on the slice tree yet fail on the merged tree; opening a PR on an up-to-date branch also eliminates a `conflict` round-trip via `fix-pr-blockers`. Merge (not rebase) preserves the slice branch's commit history as-authored, leaves task-sub-issue commit SHAs stable, and keeps the step 8 push as a plain fast-forward. Resolve every conflicting hunk by **union** — never blindly take one side — then `git add` and `git commit --no-edit` to finalize the merge. If union resolution would require scope expansion, `git merge --abort` and route to step 6c with a merge-conflict diagnostic; the user resolves the divergence and re-dispatches.
- **No force-style push is permitted in this skill — step 8 uses a plain `git push`.** Because step 5 merges (rather than rebases) `origin/main` into the slice branch, the slice branch's history is never rewritten and the push is always a strict fast-forward over `origin/<slice-branch>`. Anywhere else, never force-push and never skip hooks.
- **Failing E2E specs are the contract for production-code fixes — never duplicate the demand in a unit test.** The spec IS the RED test; the production change is what takes it to GREEN. A separate unit test for the same behavior locks the demand in twice and creates conflicting GREEN cycles.
- **Bail the whole run on the first E2E-spec bug — do not partially fix production code.** A mixed exit (some production fixes committed, slice flipped to need-attention) leaves the slice branch with a non-green suite and forces the next dispatch to either revert or re-triage. Step 6a triages first, then step 6b or 6c runs — never both.
- **Read `security-patterns` before writing any code**, even when the immediate fix looks innocuous.
- **Always fullstack — load every language reference upfront.** A failing E2E spec or a merge conflict can point at any layer; loading all four references upfront prevents a second round-trip.
- **Treat each production-code fix as a *class* of issue, not a single instance — propagate via `rg`.** A failing spec exercises one site; the bug usually lives at every equivalent site. The same rule applies to patterns brought in by the step 5 merge: when `main` ships a new helper / renamed import / new validation hook, `rg` the slice's touched files for clearly equivalent sites still on the old pattern and bring them onto the new one. Each additional site gets its own RED → GREEN. List the additional sites in the commit body. Only skip propagation when a search confirms isolation. This is not license to expand into unrelated refactors.
- **Re-run the full touched-spec set after every commit.** A fix can regress a previously-passing spec; finding that out after the PR opens wastes a review cycle.
- **Read before every edit; verify after every edit; bundle co-dependent changes.** Same oscillating-revert prevention as `implement-feature-task` — Read the exact lines before each Edit, bundle imports with the code that uses them into one `old_string`/`new_string` pair, verify immediately after each Edit before issuing the next one on the same file.
- **Container setup is a pre-push gate.** Run the two-part audit (presence + drift) before push; the pre-push hook enforces presence.
- **`.env.example` is the authoritative inventory.** Update it in the same slice whenever a fix adds, renames, or removes an env var the app reads.
- **Per-slice container isolation: slug-tag and slug-name; override port conflicts at the shell, never in committed files.** Same shell-override pattern as `implement-feature-task`.
- **`Closes #<slice-#>` MUST be the first closing-keyword reference in the PR body.** `close-pr` reads `closingIssuesReferences[0]` to find the slice issue it strips `status:in-progress` from. Putting a task ahead of the slice would point `close-pr` at the wrong issue.
- **Milestone inherits from the slice issue.** If the slice has no milestone, open the PR without one — never fabricate.
- **Commit on the cadence prescribed by `tdd-workflow` and format every commit per `templates/commit-messages.md`.** Never skip hooks.
- **Stop and exit after the terminal action.** Do not flip the PR to ready-to-review (that's `close-pr`), do not touch `review:*` labels (those live on tasks), do not comment further, do not loop.
