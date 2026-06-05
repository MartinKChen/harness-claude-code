#!/usr/bin/env bash
# ship-stage-fix-pr.sh
#
# Discovery for the /ship fix-pr stage: draft PRs blocked on CI failure or merge
# conflict. Lists open draft PRs whose `mergeable == "CONFLICTING"` OR
# `checksStatus == "FAILED"`, excluding those already carrying
# `status:fix-in-progress` or `status:need-attention`. The mid-flight
# `UNKNOWN` / `PENDING` states drop silently — a later snapshot picks them up.
#
# Works for both slice PRs (from implement-slice) and bug-fix PRs (from fix-bug);
# both carry a `Closes #<n>` line. The linked issue is resolved from the PR
# body's first case-insensitive `Closes #<n>`. Drops silently when absent.
#
# Milestone is OPTIONAL: omit it for the repo-wide maintenance lane (bug / one-off
# enhancement PRs that carry no milestone); pass it to scope to a feature.
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - PR #<pr-#> | issue:<issue-#> | "<pr-title>"
#
# Usage:
#   ship-stage-fix-pr.sh [milestone]
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

milestone_args=()
[[ -n "$milestone" ]] && milestone_args=(--milestone "$milestone")

out="$(bash "$script_dir/list-draft-prs.sh" \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    "${milestone_args[@]}" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      issue="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$issue" ]] || continue
      printf -- '- PR #%s | issue:%s | "%s"\n' "$number" "$issue" "$title"
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
