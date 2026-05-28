#!/usr/bin/env bash
# task-finder-stage-5-prepare-slice.sh
#
# Discovery for Stage 5 of /implement-feature: slices whose tasks have all
# closed and that are ready to enter E2E validation. Delegates entirely to
# `list-slices-all-subs-closed.sh`, which already enforces every gate:
# `level:slice` + `kind:feature` + `status:in-progress`, every sub-issue
# closed, no `review:*` label, no `e2e:*` label.
#
# Read-only — never flips labels, never dispatches.
#
# Output: one line per eligible candidate, or `- (none)` when the array is empty.
#
# Line format:
#   - #<number> | "<title>"
#
# Usage:
#   task-finder-stage-5-prepare-slice.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

bash "$script_dir/list-slices-all-subs-closed.sh" \
    --milestone "$feature_name" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
