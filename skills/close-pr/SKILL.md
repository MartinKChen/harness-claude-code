---
name: close-pr
description: "Promote draft PRs that have all GitHub Actions checks green and a `MERGEABLE` mergeability state, squash-merge them, then strip `status:in-progress` from the PR's linked closing slice issue and close it. Activate on phrases like 'merge ready draft PRs', 'close out the green PRs', 'squash-merge the eligible slice PRs', '/close-pr', or whenever the orchestrator needs to land draft PRs that pass CI and are mergeable. Do NOT activate to merge against a PR with failing CI or conflicts (use `fix-pr`), to review code (use `review-task-issue`), or to close task issues (use `close-task-issue`)."
---

# close-pr

Terminal step of the slice lifecycle. When a draft PR's full set of Actions checks is green and the branch is mergeable against base, promote it to ready, squash-merge it, then close the linked slice issue. This skill is the only place a slice PR gets merged and the only place its slice issue gets closed.

Reviews on the PR are out of scope — they live on task issues now (`review:*-*` are not on PRs). Mergeability and the workflow check conclusions are the only gates this skill honors.

The skill never checks out, edits, or pushes to any branch beyond the `gh pr merge --squash --delete-branch` call.

## When to activate

Activate this skill whenever the user:

- Types `/close-pr` (with or without a numeric cap argument).
- Asks to "merge the ready PRs", "close out the green slice PRs", "squash-merge eligible draft PRs", or "land the drafts that are mergeable + all-green".

Do NOT activate when the user wants to fix CI / merge-conflict blockers on a draft (use `fix-pr`), wants to review code on a task (use `review-task-issue`), or wants to close a task issue (use `close-task-issue`).

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the draft-PR scan to PRs whose milestone matches (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone `create-draft-pr` inherits from the slice issue). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N PRs have been merged. Empty / unset → merge every eligible PR.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Scripts

Every gh / shell operation below is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Script | Purpose |
|--------|---------|
| `scripts/list-candidates.sh [--milestone <name>]` | List draft open PRs as JSON. |
| `scripts/inspect-pr.sh <pr-#>` | Print mergeability + statusCheckRollup as JSON. |
| `scripts/wait-mergeability.sh <pr-#>` | Poll mergeability up to ~10 s; print MERGEABLE / CONFLICTING / UNKNOWN. |
| `scripts/merge-pr.sh <pr-#>` | Promote draft → ready and squash-merge with `--delete-branch`. |
| `scripts/undo-ready.sh <pr-#>` | Revert a ready-promotion back to draft (used on merge-race rollback). |
| `scripts/resolve-slice-issue.sh <pr-#>` | Resolve the linked slice issue number from the PR. |
| `scripts/close-slice-issue.sh <slice-#>` | Strip `status:in-progress` and close the slice issue. |

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate PRs

A PR is a candidate when it is **draft** (the slice PR stays draft until this skill promotes and merges it). `gh pr list` has no `--milestone` flag; when `<milestone-name>` is set, the script scopes via the `--search milestone:"…"` qualifier; otherwise it scans all milestones.

```bash
bash scripts/list-candidates.sh ${milestone:+--milestone "${milestone}"}
```

If empty, report "nothing to merge" and stop. When a milestone filter was applied, include it: `nothing to merge (milestone: <milestone-name>)`.

### 3. Per PR — verify checks green and mergeable

Process PRs **sequentially**. Concurrent merges race on the base branch and aren't worth the overhead at this scale.

For each candidate:

3.1 **Pull mergeability and check rollup in one call.** `statusCheckRollup` is GitHub's aggregate of every check run + status context on the head SHA; `mergeable` is the merge conflict state.

```bash
bash scripts/inspect-pr.sh <pr-#>
```

3.2 **Wait out `UNKNOWN` mergeability.** GitHub returns `UNKNOWN` for ~seconds after the head SHA changes. The script caps at ~10 s and prints the final status; treat a returned `UNKNOWN` as a benign skip (`mergeability still UNKNOWN`).

```bash
status="$(bash scripts/wait-mergeability.sh <pr-#>)"
```

3.3 **Classify.**

- `mergeable == CONFLICTING` → track as skipped (code conflict) and continue. (`fix-pr` will pick this PR up and dispatch an engineer.)
- `mergeable == UNKNOWN` past the cap → track as skipped (mergeability still UNKNOWN) and continue.
- Any check in `statusCheckRollup` with `conclusion != "SUCCESS"` and `conclusion != "SKIPPED"` (or `state == "FAILURE"` for the legacy status-context shape) → track as skipped (failing checks) and continue. (`fix-pr` will dispatch an engineer.)
- Any check still `IN_PROGRESS` / `QUEUED` / `PENDING` → track as skipped (checks still running) and continue (a later fire will re-pick).
- All checks `SUCCESS`/`SKIPPED` and `mergeable == MERGEABLE` → proceed to step 4.

### 4. Promote draft → ready, squash-merge, delete the slice branch

```bash
bash scripts/merge-pr.sh <pr-#>
```

Never `--force` a merge; never push directly to `main`; never override branch protection. If the merge fails because GitHub recomputed mergeability between step 3 and step 4 (race), revert the ready promotion and skip the PR for this fire:

```bash
bash scripts/undo-ready.sh <pr-#>
```

Track as skipped (merge race) and continue. A later fire will re-pick.

### 5. Close the linked slice issue

GitHub's squash-merge with a "Closes #<n>" trailer auto-closes the linked issue, but the slice issue is wired via the *Development* link (`gh issue develop`) rather than a body trailer — so GitHub may *not* close it automatically. Make the closure explicit:

5.1 **Resolve the linked slice issue from the PR's `closingIssuesReferences`** (with a `Closes #<n>` / `Fixes #<n>` body-parse fallback):

```bash
slice_issue="$(bash scripts/resolve-slice-issue.sh <pr-#>)"
```

If empty, count the PR as merged (no linked slice issue) and continue (the merge already succeeded; the slice issue lookup is best-effort).

5.2 **Strip `status:in-progress` and close.**

```bash
bash scripts/close-slice-issue.sh "${slice_issue}"
```

Already-removed label / already-closed issue → benign, no-op. Any other failure: surface verbatim and continue with the next PR (the merge has already landed; do not retry).

### 6. Honor the cap and report

If the user passed a positive integer N, stop after N PRs have been merged this run.

Track merged / skipped counts internally per PR; do **not** print per-PR decisions to the user. After every candidate has been processed (or the cap is hit), emit exactly one line:

`Merged <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Squash-merge with branch deletion.** Slice work commits at TDD cadence; squash-on-merge keeps `main` linear and one-commit-per-slice, and `--delete-branch` reclaims the slice branch on the remote.
- **Sequential merges.** Process PRs one at a time. Parallel `gh pr merge` calls race on the base branch.
- **`SKIPPED` checks count as green.** Path-filtered or branch-gated workflows return `conclusion=SKIPPED` legitimately. Treat them as non-blocking.
- **`IN_PROGRESS` / `QUEUED` / `PENDING` is benign.** A check still mid-flight isn't a failure; skip the PR and let a later fire re-classify.
- **Conflict → `fix-pr`.** This skill does not call `gh pr ready --undo` on a conflict — the PR is already draft. Just skip; `fix-pr` owns dispatching an engineer.
- **No PR-state changes on a skip.** A skipped PR ends the run in the exact state it started (draft, original labels, no comments).
- **No promotion to ready on a non-mergeable PR.** Only promote when step 3 returns `MERGEABLE` + all-green checks. Roll the promotion back on a merge race per step 4.
- **Skip, don't fail, on benign outcomes.** Conflicts, failing checks, running checks, unknown mergeability, merge races, and cap-reached are all expected — track internally and continue, never surface per-PR.
