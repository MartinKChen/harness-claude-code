#!/usr/bin/env bash
# List open task issues that are eligible for implementation pickup:
# `level:task` + `kind:feature` + `status:ready-to-implement`. Caller still
# has to query open-blocker count per task via `blocker-count.sh`.
#
# Usage:
#   list-candidates.sh [--milestone <name>]
#
# Output: JSON array of objects with number, title, labels, url.
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
  --label "level:task"
  --label "status:ready-to-implement"
  --label "kind:feature"
  --json number,title,labels,url
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh issue list "${args[@]}"
