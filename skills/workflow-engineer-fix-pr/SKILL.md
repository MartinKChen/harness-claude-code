---
name: workflow-engineer-fix-pr
description: "Determine and fix merge-blockers on one open draft slice PR — inspect the PR via `gh` to identify which of `{conflict, ci}` apply, work in a PR-head worktree, resolve conflicts by union (TDD on regressions), drive CI to GREEN, push, clear `status:fix-in-progress`. Bail to `status:need-attention` when CI needs an E2E-spec rewrite. Activate on `Fix PR #<n> in Mode B` / '/workflow-engineer-fix-pr'. Skip for merging, task reviewer fixes."
---

# workflow-engineer-fix-pr

Fix the merge-blockers on a single open draft slice PR dispatched by the orchestrator. The orchestrator only confirmed that *something* blocks merge — **you** determine which of `conflict` / `ci` applies by inspecting the live PR state via `gh` in step 2 below. The orchestrator added `status:fix-in-progress` to the PR as a lock; this skill removes that label as its terminal action once the push lands. Reviewer feedback no longer flows through PRs — it lives against the task issue.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix PR #<n> in Mode B`.
- The user types `/workflow-engineer-fix-pr`, or phrases like 'fix the failing CI on PR #<n>', 'resolve the merge conflict on this PR', 'unblock this draft PR'.

Do NOT activate when:

- The PR is clean and green — merging is handled by the close-pr lane.
- The dispatched work concerns reviewer findings — reviewer findings now live on the task issue.
- The unit of work is a task issue (not a PR) — that is the implement-task or fix-task lane.

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
| `scripts/read-failing-logs.sh <pr-#>` | Map non-SUCCESS check-runs on the PR's head branch back to workflow runs and print each run's `--log-failed` output. Exits non-zero if no failing run is found — used in step 2 to confirm the `ci` scope and pull the failing logs. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. |
| `scripts/merge-base.sh <pr-#>` | Fetch the PR's base branch and `git merge --no-ff origin/<base>` into the current branch. Caller resolves any conflicting hunks. |
| `scripts/push-and-clear-lock.sh <pr-#> <slice-branch>` | Push the slice branch and remove `status:fix-in-progress` from the PR. Terminal success action. |
| `scripts/flip-need-attention.sh <pr-#> <comment-file>` | Remove `status:fix-in-progress` from the PR, add `status:need-attention`, post the diagnostic comment. Terminal bail-out action when the failing CI requires editing an E2E spec rather than production code. |

## Workflow

Inputs from the orchestrator: **just a PR number** (plus the orchestrator's tracking `taskId`). The orchestrator confirmed that at least one merge-blocker is present, added a `status:fix-in-progress` label to the PR as a lock, and dispatched you. You determine the **specific scope** — which of `{conflict, ci}` applies — yourself in step 2 by inspecting the live PR state via `gh`. Everything else (slice branch, base branch, failing run id, conflicting paths, user directives) you also discover yourself.

### 1. Read user directives newer than the last commit (binding overrides)

Before pulling any CI / conflict evidence, pull the PR metadata and read every PR-issue comment created strictly after the slice branch's last commit. These are the channel through which the user posts inline corrections, decision overrides, and implementation directives between fix rounds — a user directive in this window **overrides** the failing CI log's surface-level suggestion, the merge's obvious side, any existing ADR, and any default convention. Skipping this step is the most common cause of round-trip fix passes that miss the user's actual ask.

```bash
gh pr view <pr-#> --json number,title,body,headRefName,baseRefName,url,labels,closingIssuesReferences,commits
slice_branch="$(gh pr view <pr-#> --json headRefName -q .headRefName)"
last_commit_iso="$(bash scripts/last-commit-iso.sh "${slice_branch}")"
bash scripts/read-user-directives.sh <pr-#> "${last_commit_iso}"
```

Read every comment returned in full. If any comment contains explicit implementation instructions (e.g. "the CI failure is intentional — the spec needs updating", "use X instead of Y", "switch to psycopg3", "the merge should take the base side here"), record those as **binding directives** and apply them when addressing the fix scope you determine in step 2 — even if an existing ADR, the failing log's surface text, or a default convention says otherwise. Do not silently skip a user directive because it contradicts what the CI log seems to ask for; the user's comment is always the higher-priority signal.

Comments created **at or before** `${last_commit_iso}` belong to a previous round whose directives were already applied in the commits on the slice branch — re-reading them risks re-doing completed work. Empty output is benign and just means no new directives have arrived since the last commit.

### 2. Determine what to fix by inspecting the live PR state via `gh`

The orchestrator passes you only a PR number. **You** identify the specific fix scope by reading the PR's mergeability and the head SHA's check rollup directly from GitHub. Build an in-flight scope set — any non-empty subset of `{conflict, ci}` — that drives step 4's branching. Reuse `headRefName` and `baseRefName` from the PR JSON pulled in step 1; do not re-fetch.

**2.1 Confirm `conflict` scope.** Read the PR's mergeability:

```bash
mergeable="$(gh pr view <pr-#> --json mergeable --jq .mergeable)"
```

- `CONFLICTING` → add `conflict` to the scope. The exact conflicting paths will surface during the merge in step 4; you don't need to enumerate them here. `baseRefName` is the merge target.
- `MERGEABLE` → no `conflict` scope this run.
- `UNKNOWN` → re-query once after a short wait. If it persists, halt and surface — the input is mid-flight and the orchestrator should have skipped this PR; do not guess a fix from a moving target.

**2.2 Confirm `ci` scope.** Read the head SHA's check rollup:

```bash
rollup_json="$(gh pr view <pr-#> --json statusCheckRollup --jq '.statusCheckRollup')"
running="$(printf '%s' "$rollup_json" | jq '[.[]
  | select(
      (.__typename == "CheckRun"     and (.status      != "COMPLETED" or .conclusion == null)) or
      (.__typename == "StatusContext" and (.state == "PENDING" or .state == "EXPECTED"))
    )] | length')"
failing="$(printf '%s' "$rollup_json" | jq -c '[.[]
  | select(
      (.__typename == "CheckRun"     and .conclusion != "SUCCESS" and .conclusion != "SKIPPED") or
      (.__typename == "StatusContext" and .state      != "SUCCESS")
    )
  | (.name // .context)] | unique')"
```

- `running > 0` → at least one check is mid-flight. Halt and surface — same reasoning as 2.1's `UNKNOWN`. The orchestrator should not have dispatched against a mid-flight signal.
- `running == 0` AND `failing` is non-empty → add `ci` to the scope. Pull the failing-step logs for every failing workflow run on the head branch:
  ```bash
  bash scripts/read-failing-logs.sh <pr-#>
  ```
  Read each failing log for the actual error and the file/line it points at — those become the RED tests you keep failing while you implement the fix in step 4. If the script exits non-zero (no failing run found despite a non-empty `failing` array), the rollup and the run list disagree — surface and stop rather than guessing.
- `running == 0` AND `failing` is empty → no `ci` scope this run.

**2.3 Decide on the in-flight scope.**

- Scope non-empty (one or both of `conflict` / `ci`) → continue to step 3.
- Scope empty (mergeable + green) → halt and surface back to the orchestrator. Its decision to dispatch and the live state disagree, and guessing a fix from a clean tree will only churn the diff. Do not push, do not flip labels — let the user clear the lock manually if it persists.

### 3. Materialize the slice branch in a worktree

Reuse the `${slice_branch}` resolved in step 1; check it out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and do all subsequent work there.

```bash
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

### 4. Address every scope item determined in step 2

Process each item in the in-flight scope set from step 2; if both `conflict` and `ci` apply, do `conflict` first (it changes the working tree's baseline, so `ci` fixes layered on top stay clean), then `ci`. Format every commit per `templates/commit-messages.md` at the prescribed cadence. Commits land directly on the slice branch inside the worktree.

- **`conflict` scope** — this is the one branch that does **not** start with a failing test, because there is no behavior change being demanded; the work is purely to reconcile divergence between the slice branch and its base. Fetch the PR's base branch and merge it into the slice with the standard `recursive` strategy:
  ```bash
  bash scripts/merge-base.sh <pr-#>
  ```
  Resolve every conflicting hunk by reading both sides and producing the union that preserves the slice's intended behavior **and** the base's incoming change — never blindly take one side. After resolving, `git add <path>` each conflicted file and `git commit` (use the editor-default merge commit message; do not amend). If the merge introduces test-visible regressions (existing tests now fail because of merged-in code), do not patch around them — drop into a fresh RED → GREEN → REFACTOR cycle for each broken test the merge surfaced, **before** moving to the `ci` scope. If the merge brought a new pattern in from the base (a new safety helper, a renamed import, a new validation hook), `rg` the slice's other touched files for clearly equivalent sites still on the old pattern and bring them onto the new one in the same cycle — per the pattern-propagation rule in *Iron rules*. If the conflict cannot be resolved without scope expansion (e.g. the base rewrote a module the slice also rewrites and the two intents are incompatible), `git merge --abort` and surface the divergence to the orchestrator rather than guessing.
- **`ci` scope** — before writing any production change, triage the failure: is it a production-code bug (the CI log points at a real defect in the slice's runtime code), or does the failing test itself need editing (it encodes a demand the slice cannot satisfy as authored — most commonly an E2E spec whose selector / endpoint shape / assertion is wrong)? The user directives from step 1 are decisive here — if a directive says "the spec needs updating" or "this assertion is wrong, rewrite the spec", route directly to the bail-out path in step 4a regardless of what the CI log surface text suggests.
  - **Production-code bug** — keep the failing test failing (it is already RED), make the minimum production change to take it to GREEN, then REFACTOR under green. Before declaring GREEN, `rg` the codebase for the same anti-pattern the failing log pointed at (same call, same missing guard, same broken idiom) — CI exercised one site, but the bug may live at every equivalent site. Each additional site gets its own RED → GREEN, per the pattern-propagation rule in *Iron rules*. Commit at each step.
  - **E2E-spec bug (must be edited by the user)** — route to step 4a's bail-out path. Do not partially patch production code, do not push a partial fix, and do not edit the E2E spec yourself — spec rewrites are out of scope for this skill; the user reviews the failing assertion and either rewrites the spec or clarifies the demand and re-dispatches.

Drive the `ci` scope's production-code path via strict outside-in TDD (RED → GREEN → REFACTOR); the `conflict` scope only re-enters that loop if merge-time regressions surface failing tests.

#### 4a. Bail out when the CI failure needs an E2E-spec edit

When the `ci` triage in step 4 classifies one or more failures as E2E-spec bugs, compose a diagnostic comment that lists every such failure with:

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

The script removes `status:fix-in-progress` from the PR, adds `status:need-attention`, and posts the diagnostic comment. Stop immediately after the script returns — do not push any partial fixes, do not run the container / env audit, do not loop. The user reviews the diagnostic, rewrites the spec(s) or clears the demand, then clears `status:need-attention` so the orchestrator can re-pick the PR on a later fire.

If both scopes were in flight and the `conflict` scope is already committed when the `ci` triage routes here, leave the merge commit in place — that work is independent of the spec rewrite and the user benefits from the up-to-date base. The bail still applies.

Once every in-flight scope item is clear (and the run did not route to step 4a), run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, that the worktree has a top-level `docker-compose.yaml` (or `compose.yaml`), and that each `Dockerfile` has a sibling `.dockerignore`. A `conflict` merge can drop one of these (the base side deleted it intentionally — verify before re-adding) or a `ci` failure can surface a deployable surface that was added without its container artifacts. If any is missing for a surface that should ship, scaffold it now under the project's container patterns and commit using a `chore(scaffold): <what>` subject (format per `templates/commit-messages.md`). The pre-push hook enforces this.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` against everything committed in this fix pass. A `ci` failure may have surfaced a missing runtime dep that needs to land in the image; a `conflict` merge may have brought container changes in from the base that leave equivalent slice-side container changes still on the old shape. If the runtime surface drifted, update the container files in the same slice and commit using `chore(docker): <what>` / `fix(docker): <what>` (format per `templates/commit-messages.md`) before moving to the push step. If it did not drift, leave the container files alone.

Then run the `.env.example` audit: a `ci` failure can surface a missing env-var entry the app needs at boot, and a `conflict` merge can bring new env vars in from the base that leave `.env.example` out of date. If any env var the app reads was added, renamed, or removed by this fix pass (or by the merged-in base side), update `.env.example` in the same slice and commit using `chore(env): <what>` / `fix(env): <what>` (format per `templates/commit-messages.md`). If env vars did not drift, leave `.env.example` alone.

### 5. Push the slice branch and clear the lock label

Push to remote (the plugin's pre-push hooks re-run the fullstack lint/format/type/test set and the security scans against the worktree and will deny the push if any check fails — running them locally beforehand is no longer required; if a hook denies the push, drop back into step 4 with a fresh red/green/refactor cycle; never force-push, never skip hooks), then remove the `status:fix-in-progress` lock from the PR so the next sweep can re-classify it (and the close-pr lane can pick it up if it's now mergeable + green):

```bash
bash scripts/push-and-clear-lock.sh <pr-#> "${slice_branch}"
```

This is the terminal success action. Do **not** flip the PR back to ready-to-review (it stays draft until the close-pr lane promotes it), do **not** touch any `review:*` label on the PR (those don't exist on PRs anymore — reviews live on tasks), do **not** comment on the PR, do **not** loop. Exit after the label remove lands.

## Iron rules

- **Determine the fix scope yourself from the live PR state.** The orchestrator passes only a PR number — it does not enumerate `conflict` / `ci`. Step 2 reads mergeability and the head-SHA check rollup via `gh` to build the in-flight scope set; step 4 branches on that set. Treat the live `gh` view as the contract, not the orchestrator's silence on specifics.
- **Read user directives newer than the last commit BEFORE pulling any CI / conflict evidence.** A user directive in that window OVERRIDES the failing log's surface text, the conflicting hunk's obvious side, any existing ADR, and any default convention. Skipping step 1 is the most common cause of round-trip fix passes that miss the user's actual ask.
- **Halt and surface when the live PR state shows nothing to fix.** If step 2 finds the PR mergeable and green, the orchestrator's dispatch and the live state disagree. Do not push, do not flip labels, do not guess — surface back so the user can clear the stale lock.
- **Halt and surface when either signal is still mid-flight.** `UNKNOWN` mergeability or a non-zero `running` count in the check rollup means the orchestrator should have skipped this PR. Do not pick a fix scope from a moving target.
- **Bail to `status:need-attention` when the `ci` failure points at an E2E-spec edit.** Spec rewrites are out of scope for this skill — the user owns the rewrite. Drop `status:fix-in-progress`, add `status:need-attention`, post the diagnostic, and exit. Do not partially patch production code, do not push a partial fix, and do not edit the spec yourself.
- **Do `conflict` before `ci` when both are in the in-flight scope.** The merge changes the working tree's baseline, so `ci` fixes layered on top stay clean.
- **Resolve conflicts by union — never blindly take one side.** Read both sides and produce the merge that preserves the slice's intended behavior **and** the base's incoming change. If the conflict can't be resolved without scope expansion, abort the merge and surface.
- **Treat each fix as a *class* of issue, not a single instance — propagate via `rg`.** A reviewer / CI failure / merge-import almost never points at the only vulnerable site. After identifying the fix, search the codebase for the same anti-pattern and apply the fix at every clearly equivalent site — each additional site gets its own RED → GREEN so the regression suite locks the pattern out everywhere. List the additional sites in the commit body so the reviewer can audit the scope. Only skip the propagation when a search confirms the pattern is genuinely isolated. This is *not* license to expand into unrelated refactors: a site qualifies only when it exhibits the same anti-pattern, not when it merely lives nearby.
- **Read before every edit; verify after every edit; bundle co-dependent changes.** Read the exact lines before each Edit, bundle imports with the code that uses them into one `old_string`/`new_string`, verify immediately after each Edit before issuing the next one on the same file. If you issue two sequential Edit calls that target overlapping regions of the same file, the second call's `old_string` must match the file's state *after* the first edit — otherwise the Edit tool silently reverts the first edit.
- **Container setup is a pre-push gate, not optional polish.** Run the two-part audit (presence + drift) before push; the pre-push hook enforces presence. Update container files only when the runtime surface actually drifted — never as routine cleanup. Skip the audit entirely when bailing via step 4a — the run is incomplete by design.
- **`.env.example` is the authoritative inventory.** Update it in the same slice whenever a fix adds, renames, or removes an env var the app reads. Never commit a real `.env`; never put real secrets in `.env.example`.
- **Per-slice container isolation: slug-tag and slug-name; override port conflicts at the shell, never in committed files.** Derive a deterministic slug from the slice branch and use it as both the image tag and the compose project name; if a host port is already in use, override the port via env vars on the same `docker compose` command rather than editing `Dockerfile` / `docker-compose.yaml`. Tear the stack down with `docker compose -p "${slug}" down -v` before exiting the worktree.
- **Commit on the TDD cadence and format every commit per `templates/commit-messages.md`.** Never skip hooks; never force-push.
- **Stop and exit after the terminal action.** Success path: push and remove `status:fix-in-progress`. Bail path: `flip-need-attention.sh` removes `status:fix-in-progress` and adds `status:need-attention`. Either way: do not flip the PR back to ready-to-review (that's the close-pr lane), do not touch `review:*` labels on the PR, do not comment further, do not loop.
