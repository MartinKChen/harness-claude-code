---
name: fix-pr-blockers
description: "Fix one or more `{conflict, ci}` scenarios on a single open draft slice PR dispatched by `fix-pr`. Read the dispatched scenarios from the prompt, pull only that channel's evidence (failing CI logs for `ci`; conflicting paths surface during merge for `conflict`), materialize the PR's head ref as a worktree, load the always-on security context and the full fullstack pattern set, address each scenario (`conflict` first if both are dispatched — merge base into slice, resolve conflicts by union, drop into RED→GREEN if regressions surface; `ci` keeps the failing test failing, drives minimum production change to GREEN, propagates the fix to clearly equivalent sites via `rg`), audit the container surface and `.env.example` for drift, push, and remove the `status:fix-in-progress` lock label from the PR. Activate when the dispatch prompt opens with `Fix PR #<n> in Mode B` and lists a non-empty subset of `{conflict, ci}`, or when the user types phrases like 'fix the failing CI on PR #<n>', 'resolve the merge conflict on this PR', '/fix-pr-blockers'. Do NOT activate to merge a clean PR (that is `close-pr`'s lane), to address reviewer findings on a task (use `fix-task-feedback`), or to fix issues outside an open PR."
---

# fix-pr-blockers

Fix the `conflict` and/or `ci` scenarios on a single open draft slice PR dispatched by `fix-pr`. The orchestrator added `status:fix-in-progress` to the PR as a lock; this skill removes that label as its terminal action once the push lands. Reviewer feedback no longer flows through PRs — the retired `review` scenario lives in `fix-task-feedback` against the task issue.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix PR #<n> in Mode B` and lists scenarios from the set `{conflict, ci}`.
- The user types `/fix-pr-blockers`, or phrases like 'fix the failing CI on PR #<n>', 'resolve the merge conflict on this PR', 'unblock this draft PR'.

Do NOT activate when:

- The PR is clean and green — merging is `close-pr`'s lane.
- The dispatched scenario includes `review` — that scenario was retired; reviewer findings now live on the task issue via `fix-task-feedback`.
- The unit of work is a task issue (not a PR) — use `implement-feature-task` or `fix-task-feedback`.

## References

| Skill | When to route to it |
|-------|---------------------|
| `tdd-workflow` | For the `ci` branch (and for any merge-time regressions surfaced by `conflict`). **Required when `ci` is dispatched.** |
| `security-patterns` | At the start of every dispatch, before writing any code. **Required (always).** |
## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every commit produced during this fix pass (`conflict`-merge commits, `ci`-fix RED/GREEN/REFACTOR commits, and any drift-correcting `chore(docker)` / `chore(env)` commits). |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/read-failing-logs.sh <pr-#>` | Map non-SUCCESS check-runs on the PR's head branch back to workflow runs and print each run's `--log-failed` output. Exits non-zero if no failing run is found. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. |
| `scripts/merge-base.sh <pr-#>` | Fetch the PR's base branch and `git merge --no-ff origin/<base>` into the current branch. Caller resolves any conflicting hunks. |
| `scripts/push-and-clear-lock.sh <pr-#> <slice-branch>` | Push the slice branch and remove `status:fix-in-progress` from the PR. Terminal action. |

## Workflow

Inputs from the orchestrator: a PR number **and** a list of fix scenarios — any non-empty subset of `{conflict, ci}`. The orchestrator (`fix-pr`) added a `status:fix-in-progress` label to the PR as a lock and dispatched you. Everything else (slice branch, base branch, failing run id, conflicting paths) you discover yourself.

### 1. Identify what to fix from the scenarios in the dispatch prompt

Pull PR metadata once, then for each scenario gather only that scenario's evidence — do not waste cycles on channels that weren't dispatched:

```bash
gh pr view <pr-#> --json number,title,body,headRefName,baseRefName,url,labels,closingIssuesReferences,commits
```

- **`conflict` scenario.** The orchestrator hit `CONFLICTING` mergeability against the PR's base branch. The exact conflicting paths will surface during the merge in step 5; you don't need to enumerate them here. Capture only `headRefName` (slice branch) and `baseRefName` (merge target) from the JSON above — that's all step 5's conflict path needs.
- **`ci` scenario.** The orchestrator flagged `ci` because at least one workflow check on the PR's head SHA returned a non-`SUCCESS`, non-`SKIPPED` conclusion. Pull the failing-step logs for every failing workflow run on the head branch:
  ```bash
  bash scripts/read-failing-logs.sh <pr-#>
  ```
  Read each failing log for the actual error and the file/line it points at — those become the RED tests you keep failing while you implement the fix in step 5. If the script exits non-zero (no failing run found), the orchestrator's view and the live state disagree — surface and stop rather than guessing a fix from a clean tree.

If no dispatched channel surfaces actionable input (no failing CI run found, no live conflict), halt and surface back to the orchestrator — its view and the live state disagree, and guessing a fix from a clean tree will only churn the diff.

### 2. Materialize the slice branch in a worktree

The PR's `headRefName` (captured in step 1) IS the slice branch. Check it out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and do all work there.

```bash
slice_branch="$(gh pr view <pr-#> --json headRefName -q .headRefName)"
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

### 3. Load always-on security context

Invoke `security-patterns` before any code is written, even when the immediate fix looks innocuous — a fix touching auth / input / output / logging must still satisfy the checklist.

### 4. Load the full fullstack pattern set via `tdd-workflow`

CI failures and merge conflicts can land in any layer of the slice. Instruct `tdd-workflow` to load `references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, and `references/docker-patterns.md` so the fix can land anywhere without a second round-trip.

### 5. Address every dispatched scenario

Process each scenario from the dispatch prompt; if both were passed, do `conflict` first (it changes the working tree's baseline, so `ci` fixes layered on top stay clean), then `ci`. Format every commit per `templates/commit-messages.md` at the prescribed cadence. Commits land directly on the slice branch inside the worktree.

- **`conflict` scenario** — this is the one branch that does **not** start with a failing test, because there is no behavior change being demanded; the work is purely to reconcile divergence between the slice branch and its base. Fetch the PR's base branch and merge it into the slice with the standard `recursive` strategy:
  ```bash
  bash scripts/merge-base.sh <pr-#>
  ```
  Resolve every conflicting hunk by reading both sides and producing the union that preserves the slice's intended behavior **and** the base's incoming change — never blindly take one side. After resolving, `git add <path>` each conflicted file and `git commit` (use the editor-default merge commit message; do not amend). If the merge introduces test-visible regressions (existing tests now fail because of merged-in code), do not patch around them — drop into a fresh RED → GREEN → REFACTOR cycle for each broken test the merge surfaced, **before** moving to the `ci` scenario. If the merge brought a new pattern in from the base (a new safety helper, a renamed import, a new validation hook), `rg` the slice's other touched files for clearly equivalent sites still on the old pattern and bring them onto the new one in the same cycle — per the pattern-propagation rule in *Iron rules*. If the conflict cannot be resolved without scope expansion (e.g. the base rewrote a module the slice also rewrites and the two intents are incompatible), `git merge --abort` and surface the divergence to the orchestrator rather than guessing.
- **`ci` scenario** — keep the failing test failing (it is already RED), make the minimum production change to take it to GREEN, then REFACTOR under green. Before declaring GREEN, `rg` the codebase for the same anti-pattern the failing log pointed at (same call, same missing guard, same broken idiom) — CI exercised one site, but the bug may live at every equivalent site. Each additional site gets its own RED → GREEN, per the pattern-propagation rule in *Iron rules*. Commit at each step.

Invoke `tdd-workflow` for the `ci` branch; the `conflict` branch only re-enters `tdd-workflow` if merge-time regressions surface failing tests.

Once the dispatched scenario(s) are clear, run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, that the worktree has a top-level `docker-compose.yaml` (or `compose.yaml`), and that each `Dockerfile` has a sibling `.dockerignore`. A `conflict` merge can drop one of these (the base side deleted it intentionally — verify before re-adding) or a `ci` failure can surface a deployable surface that was added without its container artifacts. If any is missing for a surface that should ship, scaffold it now via `docker-patterns` and commit using a `chore(scaffold): <what>` subject (format per `templates/commit-messages.md`). The pre-push hook enforces this.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` against everything committed in this fix pass. A `ci` failure may have surfaced a missing runtime dep that needs to land in the image; a `conflict` merge may have brought container changes in from the base that leave equivalent slice-side container changes still on the old shape. If the runtime surface drifted, update the container files in the same slice and commit using `chore(docker): <what>` / `fix(docker): <what>` (format per `templates/commit-messages.md`) before moving to the push step. If it did not drift, leave the container files alone.

Then run the `.env.example` audit: a `ci` failure can surface a missing env-var entry the app needs at boot, and a `conflict` merge can bring new env vars in from the base that leave `.env.example` out of date. If any env var the app reads was added, renamed, or removed by this fix pass (or by the merged-in base side), update `.env.example` in the same slice and commit using `chore(env): <what>` / `fix(env): <what>` (format per `templates/commit-messages.md`). If env vars did not drift, leave `.env.example` alone.

### 6. Push the slice branch and clear the lock label

Push to remote (the plugin's pre-push hooks re-run the fullstack lint/format/type/test set and the security scans against the worktree and will deny the push if any check fails — running them locally beforehand is no longer required; if a hook denies the push, drop back into step 5 with a fresh red/green/refactor cycle; never force-push, never skip hooks), then remove the `status:fix-in-progress` lock from the PR so the next sweep can re-classify it (and `close-pr` can pick it up if it's now mergeable + green):

```bash
bash scripts/push-and-clear-lock.sh <pr-#> "${slice_branch}"
```

This is the terminal action. Do **not** flip the PR back to ready-to-review (it stays draft until `close-pr` promotes it), do **not** touch any `review:*` label on the PR (those don't exist on PRs anymore — reviews live on tasks), do **not** comment on the PR, do **not** loop. Exit after the label remove lands.

## Iron rules

- **Treat the PR's failing CI logs and the live merge conflict as the contract.** If either evidence channel comes back empty when the orchestrator said otherwise, halt and surface — never guess a fix from a clean tree.
- **Read `security-patterns` before writing any code**, even for innocuous-looking CI / conflict fixes.
- **Always fullstack — load every language reference upfront.** Mode-B fixes can land in any layer; loading all four references upfront prevents a second round-trip.
- **Do `conflict` before `ci` when both are dispatched.** The merge changes the working tree's baseline, so `ci` fixes layered on top stay clean.
- **Resolve conflicts by union — never blindly take one side.** Read both sides and produce the merge that preserves the slice's intended behavior **and** the base's incoming change. If the conflict can't be resolved without scope expansion, abort the merge and surface.
- **Treat each fix as a *class* of issue, not a single instance — propagate via `rg`.** A reviewer / CI failure / merge-import almost never points at the only vulnerable site. After identifying the fix, search the codebase for the same anti-pattern and apply the fix at every clearly equivalent site — each additional site gets its own RED → GREEN so the regression suite locks the pattern out everywhere. List the additional sites in the commit body so the reviewer can audit the scope. Only skip the propagation when a search confirms the pattern is genuinely isolated. This is *not* license to expand into unrelated refactors: a site qualifies only when it exhibits the same anti-pattern, not when it merely lives nearby.
- **Read before every edit; verify after every edit; bundle co-dependent changes.** Same oscillating-revert prevention as `implement-feature-task` — Read the exact lines before each Edit, bundle imports with the code that uses them into one `old_string`/`new_string`, verify immediately after each Edit before issuing the next one on the same file.
- **Container setup is a pre-push gate, not optional polish.** Run the two-part audit (presence + drift) before push; the pre-push hook enforces presence. Update container files only when the runtime surface actually drifted — never as routine cleanup.
- **`.env.example` is the authoritative inventory.** Update it in the same slice whenever a fix adds, renames, or removes an env var the app reads. Never commit a real `.env`; never put real secrets in `.env.example`.
- **Per-slice container isolation: slug-tag and slug-name; override port conflicts at the shell, never in committed files.** Same shell-override pattern as `implement-feature-task`.
- **Commit on the cadence prescribed by `tdd-workflow` and format every commit per `templates/commit-messages.md`.** Never skip hooks; never force-push.
- **Stop and exit after pushing and removing the lock label.** Do not flip the PR back to ready-to-review (that's `close-pr`'s lane), do not touch `review:*` labels on the PR, do not comment, do not loop.
