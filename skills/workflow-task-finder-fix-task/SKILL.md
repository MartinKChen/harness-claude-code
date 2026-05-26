---
name: workflow-task-finder-fix-task
description: "Discovery-only. List `level:task`+`kind:feature`+`status:in-progress` tasks carrying `review:need-fix` and no sibling currently editing the same slice worktree, classified by `type:*` into the matching agent type (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-task

Discovery slice for Stage 4 of `/implement-feature`. Identify every task issue whose reviewer verdict came back as `need-fix` that is not currently slice-locked, classify by `type:*`, and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 4 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. List candidate task issues

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level task \
    --label status:in-progress \
    --label review:need-fix \
    --milestone "<feature-name>"
```

`list-issues.sh` already enforces `level:task` + `kind:feature` + the supplied labels + milestone, AND sorts deterministically (`type:e2e` → `type:backend` → `type:frontend`, then by issue number).

### 2. Apply the per-row gates and format

For each candidate row, apply two gates, resolve the parent slice, and format the line:

- **Slice-in-flight gate** — `bash skills/operation-git/scripts/slice-in-flight.sh <task-#>` must return `0`. Sibling tasks under the same parent slice share one worktree.
- **`type:*` gate** — the row must carry exactly one of `type:e2e` / `type:backend` / `type:frontend`. Zero or more than one drops the row silently.
- **Parent-slice resolution** — fetch the parent's number via GraphQL `issue.parent.number`. Do NOT body-parse.
- **Type → subagent mapping** —

  | `type:*` | `<subagent_type>` |
  |----------|-------------------|
  | `type:e2e`      | `e2e-author` |
  | `type:backend`  | `engineer`   |
  | `type:frontend` | `engineer`   |

A self-contained shell pipeline that does steps 1 + 2 in one pass:

```sh
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

out="$(bash skills/operation-git/scripts/list-issues.sh \
    --level task \
    --label status:in-progress \
    --label review:need-fix \
    --milestone "<feature-name>" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      names="$(printf '%s' "$row" | jq -r '[.labels[].name]')"

      types="$(printf '%s' "$names" | jq -r '[.[] | select(. == "type:e2e" or . == "type:backend" or . == "type:frontend")]')"
      [[ "$(printf '%s' "$types" | jq 'length')" == "1" ]] || continue
      type_label="$(printf '%s' "$types" | jq -r '.[0]')"

      [[ "$(bash skills/operation-git/scripts/slice-in-flight.sh "$number")" == "0" ]] || continue

      slice="$(gh api graphql -F owner="$owner" -F repo="$repo" -F number="$number" \
        -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){parent{number}}}}' \
        --jq '.data.repository.issue.parent.number // empty')"
      [[ -n "$slice" ]] || continue

      case "$type_label" in
        type:e2e) subagent="e2e-author" ;;
        type:backend|type:frontend) subagent="engineer" ;;
      esac

      printf -- '- #%s | %s | %s | slice:%s | "%s"\n' "$number" "$subagent" "$type_label" "$slice" "$title"
    done)"

if [[ -z "$out" ]]; then printf -- '- (none)\n'; else printf '%s\n' "$out"; fi
```

Line format (positional, pipe-delimited):

```
- #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<task-title>"
```

If no row survives, emit the single line `- (none)`.

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **The script + the per-row gate scripts are the predicate.** No additional gating beyond what's prescribed above.
- **Only `review:need-fix` triggers this skill.** `review:running` means a review cycle is still in flight — `list-issues.sh --label review:need-fix` already excludes those.
- **One agent per slice worktree.** The slice-in-flight gate enforces.
- **`type:*` decides the agent type.** Malformed drops silently.
- **`kind:feature` only** (enforced by `list-issues.sh`).
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Drop silently on every gate.** No `SKIPPED:` block.
