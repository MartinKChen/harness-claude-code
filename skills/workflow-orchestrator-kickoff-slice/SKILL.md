---
name: workflow-orchestrator-kickoff-slice
description: "Promote ready slice issues with no open blockers to in-progress, then append `status:ready-to-implement` to every `kind:feature` task sub-issue underneath so the implement-task stage can pick them up. Mutates GitHub labels only — never checks out or pushes. Activate on 'kick off the next slices', 'promote slice issues', '/workflow-orchestrator-kickoff-slice'."
---

# workflow-orchestrator-kickoff-slice

Slice issues are born with their dev branch already linked and `status:ready-to-implement` on the slice — but their task sub-issues are NOT yet ready (they ship without `status:ready-to-implement`, so the implement-task stage cannot see them). This skill is the gatekeeper: for every slice that is `level:slice` + `kind:feature` + `status:ready-to-implement` with zero open blockers, flip the slice to `status:in-progress` and append `status:ready-to-implement` to every `level:task` + `kind:feature` sub-issue under it.

This skill never checks out, edits, or pushes to any branch. It mutates **only** GitHub labels.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-kickoff-slice` (with or without arguments).
- Asks to "promote slice issues", "kick off the next slices", "unlock task sub-issues for implementation", or "advance ready slices into in-progress".

Do NOT activate when the user wants to dispatch agents to start the actual work, wants to merge a slice PR, or wants to create slice issues from a PRD.

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the slice scan to issues attached to that GitHub milestone. Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N slices have been promoted. Skipped slices (blocked) do not count toward N.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Workflow

### 1. Resolve the repo

Resolve `owner/repo` via `gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

List slice issues filtered by `level:slice` + `status:ready-to-implement` (and the optional milestone). If empty, report `nothing to pick up` and stop. When a milestone filter was applied, include it: `nothing to pick up (milestone: <milestone-name>)`.

### 3. For each candidate slice, check blocker count

Look up the slice's open-blocker count from `issueDependenciesSummary.blockedBy` (the authoritative GraphQL field — do NOT parse `Blocked by` text out of issue bodies).

If `blocked_by > 0`, track as skipped (blocked by N open issues) and continue. Closed blockers do not count.

### 4. Promote the slice and unlock its task sub-issues

When unblocked, do both flips:

- **4a.** Flip the slice itself: remove `status:ready-to-implement`, add `status:in-progress`.
- **4b.** Pull the slice's sub-issues via GraphQL (`repository.issue.subIssues.nodes`), filter to nodes whose labels include both `level:task` and `kind:feature`, and for each such task add the `status:ready-to-implement` label.

If a sub-issue already has `status:ready-to-implement`, the add is a no-op — benign. Any other failure: surface verbatim and stop processing further slices for this run (the slice itself is already promoted, so a re-run idempotently tops up the missing sub-issue labels).

### 5. Honor the cap and report

If the user passed a positive integer N, stop after N slices have been promoted in this run. Skipped slices (blocked) do **not** count toward N.

Track promoted / skipped counts internally per slice; do **not** print per-slice decisions. After every candidate has been processed (or the cap is hit), emit exactly one line:

`Promoted <S> slice(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **One responsibility: slice promotion.** Does not dispatch agents, does not touch task `type:*` labels, does not check out branches, does not open or close anything. Two label flips per slice and exit.
- **Blocker count uses `issueDependenciesSummary.blockedBy`.** Only OPEN blockers count. Do not parse `Blocked by` text out of issue bodies.
- **`kind:feature` only.** Bugs / enhancements are out of scope.
- **Slice flip and sub-issue flips are not atomic across the GitHub API.** On partial failure, the slice may end up `status:in-progress` with some sub-issues still missing `status:ready-to-implement`. Surface the failure and stop — a re-run idempotently tops up the missing sub-issue labels.
- **Idempotent re-runs.** Re-running on a slice already at `status:in-progress` is a benign no-op (filtered out in step 2).
- **Skip, don't fail, on benign outcomes.** "Blocked", "cap reached", "label already present" — track internally and continue.
