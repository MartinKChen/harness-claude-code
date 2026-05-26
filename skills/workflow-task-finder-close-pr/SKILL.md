---
name: workflow-task-finder-close-pr
description: "Discovery-only. List draft PRs in the milestone labeled `merge:auto` that are MERGEABLE with every check rollup state SUCCESS / NEUTRAL / SKIPPED, with their linked slice number resolved from the PR body's `Closes #<slice-#>` line. Read-only — never promotes draft → ready, never merges, never writes memory. `merge:manual` drafts are excluded. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-close-pr

Discovery slice for Stage 9 of `/implement-feature`. Identify every draft PR opted into auto-merge (`merge:auto`) that is currently clean (mergeable + all checks green) and resolve its linked slice number. Emit the eligible list.

The actual `gh pr ready` + `gh pr merge --squash --delete-branch` work — and the post-merge per-slice memory signal capture — are owned by `/implement-feature`'s Stage 9, NOT by this skill.

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
    --label merge:auto \
    --milestone "<feature-name>"
```

`list-draft-prs.sh --status green` already enforces: `--draft` open PRs whose `mergeable == "MERGEABLE"` AND every check rollup state is `SUCCESS` / `NEUTRAL` / `SKIPPED`. `--label merge:auto` excludes `merge:manual` drafts. `--milestone` scopes to the feature.

Output rows include `body`, which the next step parses for `Closes #<slice-#>`.

### 2. Resolve the linked slice and format

For each row, parse the first `Closes #<slice-#>` (case-insensitive) line from `body` — the line added by `workflow-reviewer-review-slice` when the draft was created. Drop the row silently if no `Closes #<n>` line is found; that PR is malformed and the dispatcher cannot wire up slice closure.

Line format:

```
- PR #<pr-#> | slice:<slice-#> | "<pr-title>"
```

If no row survives, emit the single line `- (none)`.

A self-contained shell pipeline:

```sh
out="$(bash skills/operation-git/scripts/list-draft-prs.sh \
    --status green \
    --label merge:auto \
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

- **Read-only.** No `gh pr ready`, no `gh pr merge`, no memory writes, no `TaskCreate`, no `Agent`.
- **The script is the predicate** for the mergeability + checks + label + milestone filter. The skill only resolves the linked slice from the PR body.
- **`merge:auto` only.** `merge:manual` PRs are out of scope.
- **`SKIPPED` / `NEUTRAL` checks count as green** (enforced by `--status green`).
- **Defense-in-depth re-check at merge time is owned by `/implement-feature`** — not here.
- **Drop silently on a malformed PR body (no `Closes #<slice-#>` line).** No `SKIPPED:` block, no reason field.
- **Milestone-scoped.** `<feature-name>` is mandatory.
