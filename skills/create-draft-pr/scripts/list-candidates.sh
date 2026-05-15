#!/usr/bin/env bash
# List open slice issues that are eligible for draft-PR creation:
# `level:slice` + `kind:feature` + `status:in-progress`. The caller still has
# to confirm every task sub-issue is closed and a slice branch is linked.
#
# Usage:
#   list-candidates.sh [--milestone <name>]
#
# Output: JSON array of objects with number, title, url, milestone.
set -euo pipefail

milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,10p' "$0"
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
  --json number,title,url,milestone
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh issue list "${args[@]}"
