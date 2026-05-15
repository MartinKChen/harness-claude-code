---
name: kickoff-slice-issue
description: "Promote ready-to-implement slice issues to in-progress, then append `status:ready-to-implement` to every `kind:feature` task sub-issue underneath, so `implement-task-issue` can pick them up. Skips slices that still have open `Blocked by` dependencies. Activate on phrases like 'kick off the next slices', 'promote slice issues', 'unlock the slice task sub-issues', '/kickoff-slice-issue', or whenever the orchestrator needs to flip ready slice issues into the in-progress lane and prime their task sub-issues for implementation. Do NOT activate to dispatch agents against tasks (use `implement-task-issue`) or to merge a slice PR (use `close-pr`)."
---

# kickoff-slice-issue

Slice issues created by `create-issues` are born with their dev branch already linked and `status:ready-to-implement` on the slice — but their task sub-issues are *not* yet ready (they ship without `status:ready-to-implement`, so `implement-task-issue` cannot see them). This skill is the gatekeeper: for every slice that is `level:slice` + `kind:feature` + `status:ready-to-implement` with zero open blockers, flip the slice to `status:in-progress` and append `status:ready-to-implement` to its `level:task` + `kind:feature` sub-issues.

The skill never checks out, edits, or pushes to any branch. It mutates **only** GitHub labels.

## When to activate

Activate this skill whenever the user:

- Types `/kickoff-slice-issue` (with or without a numeric cap argument).
- Asks to "promote slice issues", "kick off the next slices", "unlock task sub-issues for implementation", or "advance ready slices into in-progress".

Do NOT activate when the user wants to dispatch agents to start the actual work (that's `implement-task-issue`'s job), wants to merge a slice PR (that's `close-pr`), or wants to create slice issues from a PRD (that's the `create-issues` skill).

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the slice scan to issues attached to that GitHub milestone (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone created by `/deep-dive-feature` and used by `create-issues`). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N slices have been promoted. Empty / unset → process every eligible slice. Already-skipped slices (blocked, etc.) do not count toward N.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Scripts

Every gh / shell operation below is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Script | Purpose |
|--------|---------|
| `scripts/list-candidates.sh [--milestone <name>]` | List open ready-to-implement feature slices. |
| `scripts/inspect-slice.sh <slice-#>` | GraphQL: open-blocker count + sub-issues for the slice. |
| `scripts/promote-slice.sh <slice-#>` | Flip slice `status:ready-to-implement` → `status:in-progress`. |
| `scripts/unlock-task.sh <task-#>` | Append `status:ready-to-implement` to a task sub-issue. |

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
owner="${repo_slug%/*}"; repo="${repo_slug#*/}"
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

```bash
bash scripts/list-candidates.sh ${milestone:+--milestone "${milestone}"}
```

If empty, report "nothing to pick up" and stop. When a milestone filter was applied, include it in the message: `nothing to pick up (milestone: <milestone-name>)`.

### 3. For each slice: query open-blocker count and sub-issues in one GraphQL call

`Issue.subIssues` returns the GitHub-native sub-issue children; `issueDependenciesSummary.blockedBy` counts only **open** blockers (closed blockers don't count).

```bash
slice_response="$(bash scripts/inspect-slice.sh <slice-#>)"
```

If `blockedBy > 0`, skip the slice (`skipped slice #<n> — blocked by <count> open issue(s)`) and continue.

### 4. Promote the slice and unlock its task sub-issues

When unblocked, do both flips:

1. **Flip the slice itself:**

   ```bash
   bash scripts/promote-slice.sh "${slice_number}"
   ```

2. **Extract qualifying task sub-issue numbers and append `status:ready-to-implement` to each.** From the same GraphQL response, every sub-issue carrying both `level:task` and `kind:feature` qualifies:

   ```bash
   # $slice_response holds the GraphQL JSON returned in step 3.
   task_numbers="$(printf '%s' "$slice_response" | jq -r '
     .data.repository.issue.subIssues.nodes[]
     | (.labels.nodes | map(.name)) as $names
     | select(($names | index("level:task")) and ($names | index("kind:feature")))
     | .number
   ')"

   for task_number in $task_numbers; do
     bash scripts/unlock-task.sh "${task_number}"
   done
   ```

   If a sub-issue already has `status:ready-to-implement`, the call is a no-op — treat it as benign. Any other failure: surface verbatim and stop processing further slices for this run.

### 5. Honor the cap and report

If the user passed a positive integer N, stop after N slices have been promoted in this run. Already-skipped slices (blocked) do **not** count toward N.

Print a one-line-per-slice summary:

- `promoted   slice #<n> "<title>" → <K> task(s) unlocked`
- `skipped    slice #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped    slice #<n> "<title>" — cap reached (promoted N this run)`

End with a single sentence: `Promoted <S> slice(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **One responsibility: slice promotion.** This skill does not dispatch agents, does not touch task `type:*` labels, does not check out branches, and does not open or close anything. It flips two labels per slice and exits.
- **Blocker count uses `issueDependenciesSummary.blockedBy`.** Only **open** blockers count. Do not parse "Blocked by" text out of issue bodies; the GraphQL field is authoritative.
- **`kind:feature` only.** Bugs / enhancements are out of scope.
- **Slice flip and sub-issue flip are *not* atomic across GitHub's API.** If the slice flip succeeds but a sub-issue flip fails, the slice ends up `status:in-progress` with some sub-issues still missing `status:ready-to-implement`. Surface the failure and stop — a re-run will idempotently top-up the missing sub-issue labels (the slice itself is already promoted, so its own flip becomes a no-op).
- **Idempotent re-runs.** Re-running this skill on a slice already at `status:in-progress` is a benign no-op (the slice falls out of step 2's filter).
- **Skip, don't fail, on benign outcomes.** "Blocked", "cap reached", "label already present" are all expected.
