#!/usr/bin/env bash
# task-finder-stage-7-fix-slice.sh
#
# Discovery for Stage 7 of /implement-feature: slices whose slice-level
# reviewer verdict came back as `need-fix`. Lists open `level:slice` +
# `kind:feature` + `status:in-progress` slices carrying `review:need-fix`.
# The list-issues.sh script is the predicate — every row it returns is eligible.
# `review:running` (a review still in flight) is implicitly excluded by
# filtering on `review:need-fix`.
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when the array is empty.
#
# Line format:
#   - #<number> | "<title>"
#
# Usage:
#   task-finder-stage-7-fix-slice.sh <feature-name>
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
    --label review:need-fix \
    --milestone "$feature_name" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
