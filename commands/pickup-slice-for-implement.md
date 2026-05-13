---
description: Promote ready-to-implement slice issues to in-progress, then append `status:ready-to-implement` to every `kind:feature` task sub-issue underneath, so `pickup-task-for-implement` can pick them up. Skips slices that still have open `Blocked by` dependencies.
argument-hint: "[optional: max number of slices to promote this run; default: all eligible]"
---

# pickup-slice-for-implement

Slice issues created by `create-issues` are born with their dev branch already linked and `status:ready-to-implement` on the slice — but their task sub-issues are *not* yet ready (they ship without `status:ready-to-implement`, so `pickup-task-for-implement` cannot see them). This command is the gatekeeper: for every slice that is `level:slice` + `kind:feature` + `status:ready-to-implement` with zero open blockers, flip the slice to `status:in-progress` and append `status:ready-to-implement` to its `level:task` + `kind:feature` sub-issues.

The command never checks out, edits, or pushes to any branch. It mutates **only** GitHub labels.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many slices to promote this run. Empty / unset → process every eligible slice. A positive integer N → stop after N slices have been promoted; remaining eligible slices are picked up on the next invocation.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
owner="${repo_slug%/*}"; repo="${repo_slug#*/}"
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate slice issues

```bash
gh issue list \
  --state open \
  --label "level:slice" \
  --label "status:ready-to-implement" \
  --label "kind:feature" \
  --json number,title,url \
  --limit 200
```

If empty, report "nothing to pick up" and stop.

### 3. For each slice: query open-blocker count and sub-issues in one GraphQL call

`Issue.subIssues` returns the GitHub-native sub-issue children; `issueDependenciesSummary.blockedBy` counts only **open** blockers (closed blockers don't count).

```bash
gh api graphql \
  -F number=<slice-#> -F owner="${owner}" -F repo="${repo}" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
          subIssues(first: 100) {
            nodes { number labels(first: 20) { nodes { name } } }
          }
        }
      }
    }
  '
```

If `blockedBy > 0`, skip the slice (`skipped slice #<n> — blocked by <count> open issue(s)`) and continue.

### 4. Promote the slice and unlock its task sub-issues

When unblocked, do both flips:

1. **Flip the slice itself:**

   ```bash
   gh issue edit "${slice_number}" \
     --remove-label "status:ready-to-implement" \
     --add-label "status:in-progress"
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
     gh issue edit "${task_number}" --add-label "status:ready-to-implement"
   done
   ```

   If a sub-issue already has `status:ready-to-implement`, the call is a no-op — treat it as benign. Any other failure: surface verbatim and stop processing further slices for this run.

### 5. Honor the cap and report

If `$ARGUMENTS` parses as a positive integer N, stop after N slices have been promoted in this run. Already-skipped slices (blocked) do **not** count toward N.

Print a one-line-per-slice summary:

- `promoted   slice #<n> "<title>" → <K> task(s) unlocked`
- `skipped    slice #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped    slice #<n> "<title>" — cap reached (promoted N this run)`

End with a single sentence: `Promoted <S> slice(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **One responsibility: slice promotion.** This command does not dispatch agents, does not touch task `type:*` labels, does not check out branches, and does not open or close anything. It flips two labels per slice and exits.
- **Blocker count uses `issueDependenciesSummary.blockedBy`.** Only **open** blockers count. Do not parse "Blocked by" text out of issue bodies; the GraphQL field is authoritative.
- **`kind:feature` only.** Bugs / enhancements are out of scope.
- **Slice flip and sub-issue flip are *not* atomic across GitHub's API.** If the slice flip succeeds but a sub-issue flip fails, the slice ends up `status:in-progress` with some sub-issues still missing `status:ready-to-implement`. Surface the failure and stop — a re-run will idempotently top-up the missing sub-issue labels (the slice itself is already promoted, so its own flip becomes a no-op).
- **Idempotent re-runs.** Re-running this command on a slice already at `status:in-progress` is a benign no-op (the slice falls out of step 2's filter).
- **Skip, don't fail, on benign outcomes.** "Blocked", "cap reached", "label already present" are all expected.
