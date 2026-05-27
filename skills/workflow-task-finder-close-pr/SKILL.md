---
name: workflow-task-finder-close-pr
description: "Discovery-only. List every draft PR in the milestone that is MERGEABLE with every check rollup state SUCCESS / NEUTRAL / SKIPPED, tagging each row's merge-mode (`merge:auto` vs `merge:manual`) and resolving its linked slice number from the PR body's `Closes #<slice-#>` line. Read-only — never promotes draft → ready, never merges, never writes memory. Both `merge:auto` and `merge:manual` drafts are listed; the merge-mode tag tells the dispatcher which ones to auto-close. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-close-pr

Discovery slice for Stage 9 of `/implement-feature`. Identify every draft PR that is currently clean (mergeable + all checks green), tag each one's merge-mode, and resolve its linked slice number. Emit the eligible list.

Every clean draft is eligible regardless of merge-mode — Stage 9 promotes all of them draft → open. The `merge:auto` tag is what tells Stage 9 to *also* auto-close (squash-merge) the PR; `merge:manual` drafts are promoted to open and left for the user to merge.

The actual `gh pr ready` (all mergeable drafts) + `gh pr merge --squash --delete-branch` (`merge:auto` only) work — and the post-merge per-slice memory signal capture — are owned by `/implement-feature`'s Stage 9, NOT by this skill.

## When to activate

Invoked by the `task-finder` agent during Stage 9 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-draft-prs.sh \
    --status green \
    --milestone "<feature-name>"
```

`list-draft-prs.sh --status green` already enforces: `--draft` open PRs whose `mergeable == "MERGEABLE"` AND every check rollup state is `SUCCESS` / `NEUTRAL` / `SKIPPED`. `--milestone` scopes to the feature. No `--label` filter — both `merge:auto` and `merge:manual` drafts are in scope; the next step tags each row's merge-mode so the dispatcher knows which ones to auto-close.

Output rows include `body`, which the next step parses for `Closes #<slice-#>`.

### 2. Resolve the linked slice and format

For each row, parse the first `Closes #<slice-#>` (case-insensitive) line from `body` — the line added by `workflow-reviewer-review-slice` when the draft was created. Drop the row silently if no `Closes #<n>` line is found; that PR is malformed and the dispatcher cannot wire up slice closure.

Line format (the `merge:<auto|manual>` field is read from labels: `auto` when the PR carries `merge:auto`, otherwise `manual`):

```
- PR #<pr-#> | slice:<slice-#> | merge:<auto|manual> | "<pr-title>"
```

If no row survives, emit the single line `- (none)`.

A self-contained shell pipeline:

```sh
out="$(bash skills/operation-git/scripts/list-draft-prs.sh \
    --status green \
    --milestone "<feature-name>" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      mode="$(printf '%s' "$row" | jq -r 'if (.labels | index("merge:auto")) then "auto" else "manual" end')"
      slice="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$slice" ]] || continue
      printf -- '- PR #%s | slice:%s | merge:%s | "%s"\n' "$number" "$slice" "$mode" "$title"
    done)"

if [[ -z "$out" ]]; then printf -- '- (none)\n'; else printf '%s\n' "$out"; fi
```

## Iron rules

- **Read-only.** No `gh pr ready`, no `gh pr merge`, no memory writes, no `TaskCreate`, no `Agent`.
- **The script is the predicate** for the mergeability + checks + milestone filter. The skill only tags merge-mode from labels and resolves the linked slice from the PR body.
- **All mergeable drafts are listed**, both `merge:auto` and `merge:manual`. The merge-mode tag — not a discovery filter — is what tells Stage 9 which ones to auto-close.
- **`merge:<auto|manual>` is derived from labels:** `auto` iff the PR carries the `merge:auto` label, else `manual`.
- **`SKIPPED` / `NEUTRAL` checks count as green** (enforced by `--status green`).
- **Defense-in-depth re-check at merge time is owned by `/implement-feature`** — not here.
- **Drop silently on a malformed PR body (no `Closes #<slice-#>` line).** No `SKIPPED:` block, no reason field.
- **Milestone-scoped.** `<feature-name>` is mandatory.
