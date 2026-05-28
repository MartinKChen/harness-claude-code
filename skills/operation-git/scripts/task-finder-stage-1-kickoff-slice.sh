#!/usr/bin/env bash
# task-finder-stage-1-kickoff-slice.sh
#
# Discovery for Stage 1 of /implement-feature: slice issues ready to be
# promoted. Lists open `level:slice` + `kind:feature` + `status:ready-to-implement`
# slices with zero open `Blocked by` dependencies (closed blockers don't count,
# via `issueDependenciesSummary.blockedBy`).
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - #<number> | "<title>"
#
# Usage:
#   task-finder-stage-1-kickoff-slice.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

out="$(bash "$script_dir/list-issues.sh" \
    --level slice \
    --label status:ready-to-implement \
    --milestone "$feature_name" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      if [[ "$(bash "$script_dir/blocker-count.sh" "$number")" == "0" ]]; then
        title="$(printf '%s' "$row" | jq -r .title)"
        printf -- '- #%s | "%s"\n' "$number" "$title"
      fi
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
