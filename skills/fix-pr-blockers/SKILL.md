---
name: fix-pr-blockers
description: "Fix one or more `{conflict, ci}` scenarios on a single open draft slice PR dispatched by `fix-pr`. Read the dispatched scenarios from the prompt; before touching evidence, resolve the slice branch's last commit and read every PR-issue comment newer than that commit as binding user directives that override default fix paths. Pull only the dispatched channel's evidence (failing CI logs for `ci`; conflicting paths surface during merge for `conflict`), materialize the PR's head ref as a worktree, load the always-on security context and the full fullstack pattern set, address each scenario (`conflict` first if both are dispatched — merge base into slice, resolve conflicts by union, drop into RED→GREEN if regressions surface; `ci` keeps the failing test failing, drives minimum production change to GREEN, propagates the fix to clearly equivalent sites via `rg`). When a `ci` failure is confirmed to require modifying an E2E spec rather than production code, STOP, drop the `status:fix-in-progress` lock, flip the PR to `status:need-attention` with a diagnostic comment, and exit — the user owns the spec rewrite. Otherwise audit the container surface and `.env.example` for drift, push, and remove the `status:fix-in-progress` lock label from the PR. Activate when the dispatch prompt opens with `Fix PR #<n> in Mode B` and lists a non-empty subset of `{conflict, ci}`, or when the user types phrases like 'fix the failing CI on PR #<n>', 'resolve the merge conflict on this PR', '/fix-pr-blockers'. Do NOT activate to merge a clean PR (that is `close-pr`'s lane), to address reviewer findings on a task (use `fix-task-feedback`), or to fix issues outside an open PR."
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
| `scripts/last-commit-iso.sh <slice-branch>` | Print the ISO-8601 committer timestamp of the most recent commit on the PR's head branch. Used as the cutoff for filtering user directives. |
| `scripts/read-user-directives.sh <pr-#> <cutoff-iso>` | Print every PR-issue comment created strictly after the cutoff — binding user directives newer than the last commit. |
| `scripts/read-failing-logs.sh <pr-#>` | Map non-SUCCESS check-runs on the PR's head branch back to workflow runs and print each run's `--log-failed` output. Exits non-zero if no failing run is found. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. |
| `scripts/merge-base.sh <pr-#>` | Fetch the PR's base branch and `git merge --no-ff origin/<base>` into the current branch. Caller resolves any conflicting hunks. |
| `scripts/push-and-clear-lock.sh <pr-#> <slice-branch>` | Push the slice branch and remove `status:fix-in-progress` from the PR. Terminal success action. |
| `scripts/flip-need-attention.sh <pr-#> <comment-file>` | Remove `status:fix-in-progress` from the PR, add `status:need-attention`, post the diagnostic comment. Terminal bail-out action when the failing CI requires editing an E2E spec rather than production code. |

## Workflow

Inputs from the orchestrator: a PR number **and** a list of fix scenarios — any non-empty subset of `{conflict, ci}`. The orchestrator (`fix-pr`) added a `status:fix-in-progress` label to the PR as a lock and dispatched you. Everything else (slice branch, base branch, failing run id, conflicting paths, user directives) you discover yourself.

### 1. Read user directives newer than the last commit (binding overrides)

Before pulling any CI / conflict evidence, pull the PR metadata and read every PR-issue comment created strictly after the slice branch's last commit. These are the channel through which the user posts inline corrections, decision overrides, and implementation directives between fix rounds — a user directive in this window **overrides** the failing CI log's surface-level suggestion, the merge's obvious side, any existing ADR, and any default convention. Skipping this step is the most common cause of round-trip fix passes that miss the user's actual ask.

```bash
gh pr view <pr-#> --json number,title,body,headRefName,baseRefName,url,labels,closingIssuesReferences,commits
slice_branch="$(gh pr view <pr-#> --json headRefName -q .headRefName)"
last_commit_iso="$(bash scripts/last-commit-iso.sh "${slice_branch}")"
bash scripts/read-user-directives.sh <pr-#> "${last_commit_iso}"
```

Read every comment returned in full. If any comment contains explicit implementation instructions (e.g. "the CI failure is intentional — the spec needs updating", "use X instead of Y", "switch to psycopg3", "the merge should take the base side here"), record those as **binding directives** and apply them when addressing the dispatched scenarios — even if an existing ADR, the failing log's surface text, or a default convention says otherwise. Do not silently skip a user directive because it contradicts what the CI log seems to ask for; the user's comment is always the higher-priority signal.

Comments created **at or before** `${last_commit_iso}` belong to a previous round whose directives were already applied in the commits on the slice branch — re-reading them risks re-doing completed work. Empty output is benign and just means no new directives have arrived since the last commit.

### 2. Identify what to fix from the scenarios in the dispatch prompt

For each scenario in the dispatch prompt, gather only that scenario's evidence — do not waste cycles on channels that weren't dispatched. The PR JSON from step 1 already has `headRefName`, `baseRefName`, and `labels`; reuse it.

- **`conflict` scenario.** The orchestrator hit `CONFLICTING` mergeability against the PR's base branch. The exact conflicting paths will surface during the merge in step 6; you don't need to enumerate them here. Capture `headRefName` (slice branch) and `baseRefName` (merge target) — that's all step 6's conflict path needs.
- **`ci` scenario.** The orchestrator flagged `ci` because at least one workflow check on the PR's head SHA returned a non-`SUCCESS`, non-`SKIPPED` conclusion. Pull the failing-step logs for every failing workflow run on the head branch:
  ```bash
  bash scripts/read-failing-logs.sh <pr-#>
  ```
  Read each failing log for the actual error and the file/line it points at — those become the RED tests you keep failing while you implement the fix in step 6. If the script exits non-zero (no failing run found), the orchestrator's view and the live state disagree — surface and stop rather than guessing a fix from a clean tree.

If no dispatched channel surfaces actionable input (no failing CI run found, no live conflict), halt and surface back to the orchestrator — its view and the live state disagree, and guessing a fix from a clean tree will only churn the diff.

### 3. Materialize the slice branch in a worktree

Reuse the `${slice_branch}` resolved in step 1; check it out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and do all subsequent work there.

```bash
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

### 4. Load always-on security context

Invoke `security-patterns` before any code is written, even when the immediate fix looks innocuous — a fix touching auth / input / output / logging must still satisfy the checklist.

### 5. Load the full fullstack pattern set via `tdd-workflow`

CI failures and merge conflicts can land in any layer of the slice. Instruct `tdd-workflow` to load `references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, and `references/docker-patterns.md` so the fix can land anywhere without a second round-trip.

### 6. Address every dispatched scenario

Process each scenario from the dispatch prompt; if both were passed, do `conflict` first (it changes the working tree's baseline, so `ci` fixes layered on top stay clean), then `ci`. Format every commit per `templates/commit-messages.md` at the prescribed cadence. Commits land directly on the slice branch inside the worktree.

- **`conflict` scenario** — this is the one branch that does **not** start with a failing test, because there is no behavior change being demanded; the work is purely to reconcile divergence between the slice branch and its base. Fetch the PR's base branch and merge it into the slice with the standard `recursive` strategy:
  ```bash
  bash scripts/merge-base.sh <pr-#>
  ```
  Resolve every conflicting hunk by reading both sides and producing the union that preserves the slice's intended behavior **and** the base's incoming change — never blindly take one side. After resolving, `git add <path>` each conflicted file and `git commit` (use the editor-default merge commit message; do not amend). If the merge introduces test-visible regressions (existing tests now fail because of merged-in code), do not patch around them — drop into a fresh RED → GREEN → REFACTOR cycle for each broken test the merge surfaced, **before** moving to the `ci` scenario. If the merge brought a new pattern in from the base (a new safety helper, a renamed import, a new validation hook), `rg` the slice's other touched files for clearly equivalent sites still on the old pattern and bring them onto the new one in the same cycle — per the pattern-propagation rule in *Iron rules*. If the conflict cannot be resolved without scope expansion (e.g. the base rewrote a module the slice also rewrites and the two intents are incompatible), `git merge --abort` and surface the divergence to the orchestrator rather than guessing.
- **`ci` scenario** — before writing any production change, triage the failure: is it a production-code bug (the CI log points at a real defect in the slice's runtime code), or does the failing test itself need editing (it encodes a demand the slice cannot satisfy as authored — most commonly an E2E spec whose selector / endpoint shape / assertion is wrong)? The user directives from step 1 are decisive here — if a directive says "the spec needs updating" or "this assertion is wrong, rewrite the spec", route directly to the bail-out path in step 6a regardless of what the CI log surface text suggests.
  - **Production-code bug** — keep the failing test failing (it is already RED), make the minimum production change to take it to GREEN, then REFACTOR under green. Before declaring GREEN, `rg` the codebase for the same anti-pattern the failing log pointed at (same call, same missing guard, same broken idiom) — CI exercised one site, but the bug may live at every equivalent site. Each additional site gets its own RED → GREEN, per the pattern-propagation rule in *Iron rules*. Commit at each step.
  - **E2E-spec bug (must be edited by the user)** — route to step 6a's bail-out path. Do not partially patch production code, do not push a partial fix, and do not edit the E2E spec yourself — spec rewrites are out of scope for this skill; the user reviews the failing assertion and either rewrites the spec or clarifies the demand and re-dispatches.

Invoke `tdd-workflow` for the `ci` branch's production-code path; the `conflict` branch only re-enters `tdd-workflow` if merge-time regressions surface failing tests.

#### 6a. Bail out when the CI failure needs an E2E-spec edit

When the `ci` triage in step 6 classifies one or more failures as E2E-spec bugs, compose a diagnostic comment that lists every such failure with:

- The spec file path and the failing test name.
- A 2–4 line excerpt from the failing log — the assertion message, the actual-vs-expected values, and the smallest stack frame that points at the failing line.
- The triage verdict: **E2E-spec bug (`path/to/spec.spec.ts:line` — assertion contradicts the implemented behavior because …)** and a one-line note on what the user likely needs to change.
- Any binding user directive from step 1 that drove the verdict (paraphrased; cite the comment author + timestamp).

Write the comment to a temp file and call the terminal bail-out script:

```bash
comment_file="$(mktemp)"
# ... fill ${comment_file} with the diagnostic above ...
bash scripts/flip-need-attention.sh <pr-#> "${comment_file}"
rm -f "${comment_file}"
```

The script removes `status:fix-in-progress` from the PR, adds `status:need-attention`, and posts the diagnostic comment. Stop immediately after the script returns — do not push any partial fixes, do not run the container / env audit, do not loop. The user reviews the diagnostic, rewrites the spec(s) or clears the demand, then clears `status:need-attention` so `fix-pr` can re-pick the PR on a later fire.

If both scenarios were dispatched and the `conflict` scenario is already committed when the `ci` triage routes here, leave the merge commit in place — that work is independent of the spec rewrite and the user benefits from the up-to-date base. The bail still applies.

Once the dispatched scenario(s) are clear (and the run did not route to step 6a), run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, that the worktree has a top-level `docker-compose.yaml` (or `compose.yaml`), and that each `Dockerfile` has a sibling `.dockerignore`. A `conflict` merge can drop one of these (the base side deleted it intentionally — verify before re-adding) or a `ci` failure can surface a deployable surface that was added without its container artifacts. If any is missing for a surface that should ship, scaffold it now via `docker-patterns` and commit using a `chore(scaffold): <what>` subject (format per `templates/commit-messages.md`). The pre-push hook enforces this.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` against everything committed in this fix pass. A `ci` failure may have surfaced a missing runtime dep that needs to land in the image; a `conflict` merge may have brought container changes in from the base that leave equivalent slice-side container changes still on the old shape. If the runtime surface drifted, update the container files in the same slice and commit using `chore(docker): <what>` / `fix(docker): <what>` (format per `templates/commit-messages.md`) before moving to the push step. If it did not drift, leave the container files alone.

Then run the `.env.example` audit: a `ci` failure can surface a missing env-var entry the app needs at boot, and a `conflict` merge can bring new env vars in from the base that leave `.env.example` out of date. If any env var the app reads was added, renamed, or removed by this fix pass (or by the merged-in base side), update `.env.example` in the same slice and commit using `chore(env): <what>` / `fix(env): <what>` (format per `templates/commit-messages.md`). If env vars did not drift, leave `.env.example` alone.

### 7. Push the slice branch and clear the lock label

Push to remote (the plugin's pre-push hooks re-run the fullstack lint/format/type/test set and the security scans against the worktree and will deny the push if any check fails — running them locally beforehand is no longer required; if a hook denies the push, drop back into step 6 with a fresh red/green/refactor cycle; never force-push, never skip hooks), then remove the `status:fix-in-progress` lock from the PR so the next sweep can re-classify it (and `close-pr` can pick it up if it's now mergeable + green):

```bash
bash scripts/push-and-clear-lock.sh <pr-#> "${slice_branch}"
```

This is the terminal success action. Do **not** flip the PR back to ready-to-review (it stays draft until `close-pr` promotes it), do **not** touch any `review:*` label on the PR (those don't exist on PRs anymore — reviews live on tasks), do **not** comment on the PR, do **not** loop. Exit after the label remove lands.

## Iron rules

- **Read user directives newer than the last commit BEFORE pulling any CI / conflict evidence.** A user directive in that window OVERRIDES the failing log's surface text, the conflicting hunk's obvious side, any existing ADR, and any default convention. Skipping step 1 is the most common cause of round-trip fix passes that miss the user's actual ask.
- **Treat the PR's failing CI logs and the live merge conflict as the contract.** If either evidence channel comes back empty when the orchestrator said otherwise, halt and surface — never guess a fix from a clean tree.
- **Bail to `status:need-attention` when the `ci` failure points at an E2E-spec edit.** Spec rewrites are out of scope for this skill — the user owns the rewrite. Drop `status:fix-in-progress`, add `status:need-attention`, post the diagnostic, and exit. Do not partially patch production code, do not push a partial fix, and do not edit the spec yourself.
- **Read `security-patterns` before writing any code**, even for innocuous-looking CI / conflict fixes.
- **Always fullstack — load every language reference upfront.** Mode-B fixes can land in any layer; loading all four references upfront prevents a second round-trip.
- **Do `conflict` before `ci` when both are dispatched.** The merge changes the working tree's baseline, so `ci` fixes layered on top stay clean.
- **Resolve conflicts by union — never blindly take one side.** Read both sides and produce the merge that preserves the slice's intended behavior **and** the base's incoming change. If the conflict can't be resolved without scope expansion, abort the merge and surface.
- **Treat each fix as a *class* of issue, not a single instance — propagate via `rg`.** A reviewer / CI failure / merge-import almost never points at the only vulnerable site. After identifying the fix, search the codebase for the same anti-pattern and apply the fix at every clearly equivalent site — each additional site gets its own RED → GREEN so the regression suite locks the pattern out everywhere. List the additional sites in the commit body so the reviewer can audit the scope. Only skip the propagation when a search confirms the pattern is genuinely isolated. This is *not* license to expand into unrelated refactors: a site qualifies only when it exhibits the same anti-pattern, not when it merely lives nearby.
- **Read before every edit; verify after every edit; bundle co-dependent changes.** Same oscillating-revert prevention as `implement-feature-task` — Read the exact lines before each Edit, bundle imports with the code that uses them into one `old_string`/`new_string`, verify immediately after each Edit before issuing the next one on the same file.
- **Container setup is a pre-push gate, not optional polish.** Run the two-part audit (presence + drift) before push; the pre-push hook enforces presence. Update container files only when the runtime surface actually drifted — never as routine cleanup. Skip the audit entirely when bailing via step 6a — the run is incomplete by design.
- **`.env.example` is the authoritative inventory.** Update it in the same slice whenever a fix adds, renames, or removes an env var the app reads. Never commit a real `.env`; never put real secrets in `.env.example`.
- **Per-slice container isolation: slug-tag and slug-name; override port conflicts at the shell, never in committed files.** Same shell-override pattern as `implement-feature-task`.
- **Commit on the cadence prescribed by `tdd-workflow` and format every commit per `templates/commit-messages.md`.** Never skip hooks; never force-push.
- **Stop and exit after the terminal action.** Success path: push and remove `status:fix-in-progress`. Bail path: `flip-need-attention.sh` removes `status:fix-in-progress` and adds `status:need-attention`. Either way: do not flip the PR back to ready-to-review (that's `close-pr`'s lane), do not touch `review:*` labels on the PR, do not comment further, do not loop.
