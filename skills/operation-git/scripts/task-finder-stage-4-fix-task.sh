#!/usr/bin/env bash
# task-finder-stage-4-fix-task.sh
#
# Discovery for Stage 4 of /implement-feature: task issues whose reviewer
# verdict came back as `need-fix`. Lists open `level:task` + `kind:feature` +
# `status:in-progress` tasks carrying `review:need-fix`, then applies three
# per-row gates:
#
#   1. `type:*` gate — exactly one of `type:e2e` / `type:backend` / `type:frontend`.
#   2. Slice-in-flight gate — `slice-in-flight.sh` returns 0.
#   3. Parent-slice resolution — GraphQL `issue.parent.number` must resolve.
#
# No open-blocker gate: by Stage 4, blockers were already satisfied at Stage 2,
# and `review:need-fix` itself is the only signal the dispatcher needs.
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - #<task-#> | <subagent_type> | <type:label> | slice:<slice-#> | "<task-title>"
#
# Usage:
#   task-finder-stage-4-fix-task.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

out="$(bash "$script_dir/list-issues.sh" \
    --level task \
    --label status:in-progress \
    --label review:need-fix \
    --milestone "$feature_name" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      names="$(printf '%s' "$row" | jq -r '[.labels[].name]')"

      types="$(printf '%s' "$names" | jq -r '[.[] | select(. == "type:e2e" or . == "type:backend" or . == "type:frontend")]')"
      [[ "$(printf '%s' "$types" | jq 'length')" == "1" ]] || continue
      type_label="$(printf '%s' "$types" | jq -r '.[0]')"

      [[ "$(bash "$script_dir/slice-in-flight.sh" "$number")" == "0" ]] || continue

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

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
