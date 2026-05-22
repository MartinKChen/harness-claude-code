---
name: workflow-orchestrator-close-pr
description: "Find draft PRs labeled `merge:auto` whose checks are all green and that are MERGEABLE; promote draft → ready, squash-merge with `--delete-branch`. Slice issue closure happens automatically via the `Closes #<slice-#>` line in the PR body. PRs without `merge:auto` are left for the user to merge manually. Activate on 'merge the ready PRs', 'close out the auto-merge PRs', '/workflow-orchestrator-close-pr'."
---

# workflow-orchestrator-close-pr

Terminal step of the slice lifecycle for PRs opted into auto-merge. When a draft PR labeled `merge:auto` has all Actions checks green and is mergeable against base, promote it to ready and squash-merge it. The PR body's `Closes #<slice-#>` (filled in by `workflow-reviewer-review-slice` when the draft was created) auto-closes the linked slice issue on merge.

`merge:manual` drafts are NOT in scope — those are left in draft for the user to promote and merge manually. Reviews on the PR are out of scope too — they live on issues (`review:*` is on `level:slice` / `level:task` issues, not on PRs).

The skill never checks out, edits, or pushes to any branch beyond the `gh pr merge --squash --delete-branch` call.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-close-pr` (with or without arguments).
- Asks to "merge the ready PRs", "close out the auto-merge PRs", "squash-merge eligible draft PRs", or "land the auto drafts that are mergeable + all-green".

Do NOT activate to fix CI / conflict (use `workflow-orchestrator-fix-pr`), to review code (use `workflow-orchestrator-review-*`), or to merge a `merge:manual` PR (the user handles those manually).

## Arguments

`[<milestone-name>] [<cap>]`.

## Workflow

### 1. Resolve the repo

### 2. List candidate PRs

List draft PRs filtered by `merge:auto` + `--status green` (mergeable `MERGEABLE` AND every check rollup state SUCCESS / NEUTRAL / SKIPPED).

If empty, report `nothing to merge` and stop.

### 3. Per PR — defense-in-depth re-verification, then merge

Process PRs **sequentially**. Concurrent `gh pr merge` calls race on the base branch.

For each candidate:

**3.1 Re-check live state.** GitHub may have changed since step 2:

- `mergeable != "MERGEABLE"` OR `checks != "SUCCESS"` → skip (no longer eligible).
- Otherwise proceed.

**3.2 Promote draft → ready, then squash-merge with branch deletion.**

- `gh pr ready <pr-#>` to undraft.
- `gh pr merge <pr-#> --squash --delete-branch`.

Never `--force` a merge; never push directly to `main`; never override branch protection. If the merge fails because GitHub recomputed mergeability between step 3.1 and 3.2 (race), undo the ready promotion (`gh pr ready <pr-#> --undo`) and skip.

Track as skipped (merge race) and continue. A later fire will re-pick.

The slice issue closes automatically when the PR merges — the PR body opens with `Closes #<slice-#>` (added by `workflow-reviewer-review-slice` when it created the draft).

### 4. Honor the cap and report

`Merged <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **`merge:auto` only.** `merge:manual` PRs are the user's responsibility — never promote, never merge them here.
- **Squash-merge with branch deletion.** Slice work commits at TDD cadence; squash-on-merge keeps `main` linear and one-commit-per-slice, and `--delete-branch` reclaims the slice branch.
- **Sequential merges.** Parallel `gh pr merge` calls race on the base branch.
- **Slice closure rides on the PR body.** `Closes #<slice-#>` in the body (added by reviewer-review-slice) auto-closes the slice when the PR merges. No explicit `gh issue close` here.
- **`SKIPPED` / `NEUTRAL` checks count as green.** Path-filtered or branch-gated workflows return these legitimately.
- **No promotion to ready on a non-mergeable PR.** Only promote when step 3.1 confirms MERGEABLE + SUCCESS. Undo the promotion on a merge race.
- **No PR-state changes on a skip.** A skipped PR ends the run in the exact state it started.
- **Skip, don't fail, on benign outcomes.** Race, transient state, cap reached — track internally and continue.
