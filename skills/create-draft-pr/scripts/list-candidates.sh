#!/usr/bin/env bash
# List open slice issues that are eligible for draft-PR creation:
# `level:slice` + `kind:feature` + `status:in-progress`, AND not already
# carrying either `status:prepare-pr` (a sibling fire's engineer is preparing
# the PR) or `status:need-attention` (a prior fire flagged the slice for
# human review). The caller still has to confirm every task sub-issue is
# closed and a slice branch is linked.
#
# Usage:
#   list-candidates.sh [--milestone <name>]
#
# Output: JSON array of objects with number, title, url, milestone, labels.
set -euo pipefail

milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      echo "unexpected arg: $1" >&2
      exit 1
      ;;
  esac
done

args=(
  --state open
  --label "level:slice"
  --label "kind:feature"
  --label "status:in-progress"
  --search '-label:"status:prepare-pr" -label:"status:need-attention"'
  --json number,title,url,milestone,labels
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh issue list "${args[@]}"
