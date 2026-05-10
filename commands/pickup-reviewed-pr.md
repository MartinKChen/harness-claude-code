---
description: Find draft PRs that have completed every review gate (code + security + ci in terminal state), promote and squash-merge the clean ones, revert any with conflicts back to draft, and dispatch a one-shot `engineer` per remaining PR with the list of fix scenarios it must handle (`conflict`, `review`, `ci`).
argument-hint: "[optional: max number of PRs to process this run; default: all eligible]"
---

# pickup-reviewed-pr

Drive the merge / fix-routing pass for draft PRs that have made it through both reviewer gates and the e2e gate. Promote the clean ones to ready, wait for GitHub to compute mergeability, and squash-merge them. Revert any PR that hits a conflict back to draft. Then for every draft PR that completed a full review cycle but is *not* mergeable (need-fix labels, failing e2e check, or a conflict that just reverted), strip every `review:*` label and dispatch a one-shot `engineer` sub-agent in Mode B with the list of fix scenarios.

The command never checks out, edits, or pushes a branch itself; code-changing work belongs to the dispatched `engineer`.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many PRs to act on this run (merge + dispatch combined). Empty / unset → process every eligible PR. Already-skipped PRs (no scenario detected, mergeability stuck on `UNKNOWN`, lock race) do **not** count toward the cap.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. Find merge-ready draft PRs

A draft PR is merge-ready when **all three** review gates are green:
- carries `review:code-passed`,
- carries `review:security-passed`,
- carries `review:e2e-passed`.

Pull the candidate set in one call:

```bash
gh pr list \
  --draft \
  --label "review:code-passed" \
  --label "review:security-passed" \
  --label "review:e2e-passed" \
  --json number,title,headRefName,url,labels \
  --limit 200
```

### 3. Promote → wait for mergeability → merge or revert

Process merge-ready PRs **sequentially** — concurrent merges race on `main` and aren't worth the orchestration overhead at this scale.

For each PR:

3.1 **Promote draft → ready.**
```bash
gh pr ready <pr-#>
```

3.2 **Poll mergeability until GitHub finishes computing it.** GitHub returns `UNKNOWN` for the first few seconds after promotion. Cap at ~30 s; treat `UNKNOWN` past the cap as a benign skip (`mergeability still UNKNOWN`).
```bash
attempts=0
until status="$(gh pr view <pr-#> --json mergeable --jq '.mergeable')" \
   && [ "$status" = "MERGEABLE" -o "$status" = "CONFLICTING" ] \
   || [ "$attempts" -ge 15 ]; do
  attempts=$((attempts + 1))
  sleep 2
done
```

3.3 **`MERGEABLE` → squash-merge and delete the slice branch.**
```bash
gh pr merge <pr-#> --squash --delete-branch
```
Record the PR in `merged_set` for the report.

3.4 **`CONFLICTING` → revert to draft, queue for the dispatch phase with the `conflict` scenario flagged.**
```bash
gh pr ready <pr-#> --undo
```
Record the PR + `conflict` in `conflicted_set` so step 5 picks it up even though `pickup-reviewed-pr`'s own list calls in step 4 will also surface it (the labels are still all-passing).

3.5 **`UNKNOWN` after 15 polls → revert to draft and skip for this run.** Don't dispatch an engineer; a later fire will re-pick it once GitHub finishes computing.
```bash
gh pr ready <pr-#> --undo
```

Never `--force` a merge; never push directly to `main`; never override branch protection.

### 4. Find the dispatch set (PRs that still need an engineer)

A draft PR enters the dispatch set when it has finished a full review cycle but is **not** merge-ready — i.e., at least one gate ended in `-need-fix`, or the e2e check failed, or it just reverted in 3.4. The filter is **AND** across the three gates, with **OR** within each gate (terminal state of that gate):

- carries `review:e2e-passed` OR `review:e2e-need-fix`, AND
- carries `review:code-passed` OR `review:code-need-fix`, AND
- carries `review:security-passed` OR `review:security-need-fix`.

Subtract `merged_set` (those PRs left `open=draft` state when they merged) — `merged_set` is empty here in practice because squash-merge closes the PR, but be defensive. Union with `conflicted_set` (the conflict-reverted PRs are already in draft state and will appear in this list naturally; the explicit union just makes the intent obvious).

### 5. Classify scenarios and strip every `review:*` label

For each PR in the dispatch set, determine the fix scenarios — 1 to 3 of:

| Scenario   | Trigger                                                              |
|------------|----------------------------------------------------------------------|
| `conflict` | PR is in `conflicted_set` (just reverted from MERGEABLE check fail). |
| `review`   | PR carries `review:code-need-fix` or `review:security-need-fix`.     |
| `ci`       | PR's last-non-skipped Actions conclusion (per workflow on the head branch — same JQ as step 2) is anything other than `success` for at least one workflow. Latest-run-was-`skipped` does NOT trigger `ci` on its own; we walk back past skipped runs first. |

If a PR matches **no** scenario (e.g. all gates passed and CI is green but it didn't make merge-ready in step 2 for an unforeseen reason), skip it with `skipped PR #<n> — no fix scenario detected` and leave its labels alone. Do not dispatch — there's nothing for the engineer to do.

For each PR with at least one scenario, strip every `review:*` label in one atomic call. `gh pr edit` silently ignores labels that aren't currently on the PR, so listing all nine is safe regardless of which subset the PR carries:

```bash
gh pr edit <pr-#> \
  --remove-label "review:e2e-passed" \
  --remove-label "review:e2e-passed" \
  --remove-label "review:code-passed" \
  --remove-label "review:code-need-fix" \
  --remove-label "review:security-passed" \
  --remove-label "review:security-need-fix"
```

The strip MUST happen **before** the `Agent` dispatch in step 6. If the dispatch fails synchronously (bad `subagent_type`, missing tool, etc.), roll the strip back by re-adding the labels you snapshotted from the PR's pre-strip `labels` array. Do NOT roll back on internal sub-agent failure — once the engineer is running, it owns the lifecycle and will add labels as its terminal action.

### 6. Dispatch one `engineer` per dispatch-set PR

Spawn each PR with the `Agent` tool, `subagent_type=engineer`, `mode=auto`. Independent PRs go out in parallel as multiple `Agent` calls in the **same** response.

The dispatch prompt is deliberately minimal — pass only the **PR number** and the **scenarios list**. The agent fetches the rest itself (PR body, head ref, comments, failing runs, base branch) via `gh` and `git`.

Skeleton:

```
Fix PR #<pr-#> in Mode B.

Scenarios to address (handle every one listed):
- conflict
- review
- ci

Fetch any further context yourself via `gh` and `git` — you have the PR number.
```

Include only the scenarios that classified for this PR; never list one that didn't trigger.

### 7. Honor the cap and report

If `$ARGUMENTS` is a positive integer N, stop processing once N PRs have been merged or dispatched in this run. Already-skipped PRs do not count toward N.

Print a one-line-per-PR summary, one of these forms:

- `merged      PR #<n> "<title>"`
- `dispatched  PR #<n> "<title>" → engineer (scenarios: <comma-list>)`
- `skipped     PR #<n> "<title>" — mergeability still UNKNOWN`
- `skipped     PR #<n> "<title>" — no fix scenario detected`
- `skipped     PR #<n> "<title>" — lock race`
- `skipped     PR #<n> "<title>" — cap reached (acted on N this run)`

End with one sentence: `Merged <M>; dispatched <D>; skipped <S>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Squash-merge with branch deletion.** Slice work is committed at TDD cadence; squash-on-merge keeps `main` linear and one-commit-per-slice, and `--delete-branch` reclaims the slice branch on the remote.
- **Sequential merges.** The merge phase processes PRs one at a time. The dispatch phase parallelizes (multiple `Agent` calls in the same response), but `gh pr merge` calls do not.
- **Strip every `review:*` label before dispatching the engineer.** The engineer's terminal action in Mode B is to add labels; leaving stale review-gate labels on a PR being fixed would let `pickup-pr-for-review` race in and re-dispatch a reviewer against unfinished work.
- **One engineer per PR; pass scenarios in the prompt.** Each `Agent` call owns one PR and lists every scenario the engineer must handle (1-3 of `conflict` / `review` / `ci`). Independent PRs go out as parallel `Agent` calls in the same response.
- **Roll back the strip only on synchronous dispatch failure.** Once the agent is running, ownership transfers — the agent adds labels on success. Do NOT speculatively un-strip.
- **Conflict revert leaves all review labels intact.** `gh pr ready --undo` only flips draft state; the PR's `review:code-passed` / `review:security-passed` / `review:e2e-passed` labels persist, which is exactly why step 4 re-finds it and step 5 strips them before handing to the engineer.
- **`UNKNOWN` mergeability is benign.** If GitHub hasn't computed mergeability after ~30 s, revert to draft and let a later fire re-try. Do not block the rest of the run on a single stuck PR.
- **No PR-state changes beyond the documented label/state flips.** This command does not comment on PRs, request reviewers, change merge settings, or touch labels outside the `review:*` family. Anything else is the engineer's lane.
- **Skip, don't fail, on benign outcomes.** "No fix scenario", "mergeability UNKNOWN", "lock race", "cap reached" are all expected — log them and continue, never abort the whole run.
