#!/usr/bin/env bash
# task-finder-stage-6-review-slice.sh
#
# Discovery for Stage 6 of /implement-feature: slices awaiting slice-level
# review. Lists open `level:slice` + `kind:feature` + `status:in-progress`
# slices carrying `review:pending`. The list-issues.sh script is the predicate
# — every row it returns is eligible.
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when the array is empty.
#
# Line format:
#   - #<number> | "<title>"
#
# Usage:
#   task-finder-stage-6-review-slice.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

bash "$script_dir/list-issues.sh" \
    --level slice \
    --label status:in-progress \
    --label review:pending \
    --milestone "$feature_name" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
