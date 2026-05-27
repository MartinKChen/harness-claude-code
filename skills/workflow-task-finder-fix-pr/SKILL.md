---
name: workflow-task-finder-fix-pr
description: "Discovery-only. List draft PRs in the milestone with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` or `status:need-attention`, and resolve each one's linked slice number from the PR body's `Closes #<slice-#>` line. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-pr

Discovery slice for Stage 8 of `/implement-feature`. Identify every draft PR that's blocked on CI failure or a merge conflict and emit the eligible list. The dispatched engineer (owned by `/implement-feature`) determines whether the fix is conflict, CI, or both — this skill does not classify.

## When to activate

Invoked by the `task-finder` agent during Stage 8 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-draft-prs.sh \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    --milestone "<feature-name>"
```

`list-draft-prs.sh --status broken` already enforces: `--draft` open PRs whose `mergeable == "CONFLICTING"` OR whose `checksStatus == "FAILED"` (any rollup of `FAILURE` / `CANCELLED` / `TIMED_OUT`). The `--missing-label` flags drop in-flight fixes and human-pending PRs. `--milestone` scopes to the feature.

The `mergeable == "UNKNOWN"` / `checksStatus == "PENDING"` defense-in-depth re-check is implicit: those states are not `CONFLICTING` and not `FAILED`, so the `--status broken` filter drops them silently. A later snapshot picks them up once they settle.

### 2. Resolve the linked slice and format each row

For each element of the returned JSON array, parse the first `Closes #<slice-#>` (case-insensitive) line from `body` — the line added by `workflow-reviewer-review-slice` when the draft was created. This is the same resolution `workflow-task-finder-close-pr` performs, and it lets `/implement-feature` enforce its per-slice implement budget (a `fix-pr` dispatch edits the slice worktree, so it counts against the one-implement-agent-per-slice limit). Drop the row silently if no `Closes #<n>` line is found; that PR is malformed and the dispatcher cannot map it to a slice.

```
- PR #<pr-#> | slice:<slice-#> | "<title>"
```

If the JSON array is empty, emit the single line `- (none)`.

A one-liner that does both:

```sh
out="$(bash skills/operation-git/scripts/list-draft-prs.sh \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    --milestone "<feature-name>" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      slice="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$slice" ]] || continue
      printf -- '- PR #%s | slice:%s | "%s"\n' "$number" "$slice" "$title"
    done)"

if [[ -z "$out" ]]; then printf -- '- (none)\n'; else printf '%s\n' "$out"; fi
```

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **The script is the predicate.** No re-gating in the skill; the skill only resolves the linked slice from the PR body.
- **Resolve the linked slice from the PR body's `Closes #<slice-#>` line.** Drop silently on a malformed body (no `Closes #<n>` line). The slice number lets the dispatcher enforce its per-slice implement budget.
- **Drafts only.** Ready-to-review PRs are out of scope (enforced by the script's `--draft` flag).
- **Skip `status:need-attention` PRs.** A prior engineer fix bailed for human-in-the-loop work.
- **Skip `status:fix-in-progress` PRs.** A fix is already in flight on that PR.
- **Mid-flight signals (`UNKNOWN` / `PENDING`) drop silently.** `--status broken` is terminal-only.
- **Drop silently on every gate.** No `SKIPPED:` block.
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Do not classify the fix scope.** The engineer dispatched by `/implement-feature` inspects the live PR itself.
