#!/usr/bin/env bash
# List open task issues that are eligible-on-the-cheap to close:
# `level:task` + `kind:feature` + `status:in-progress` + `review:code-passed`.
# Code-passed is universal across `type:*`, so it is the cheapest pre-filter;
# the caller still has to re-check the full required-gate set per task.
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
      sed -n '2,11p' "$0"
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
  --label "kind:feature"
  --label "status:in-progress"
  --label "review:code-passed"
  --json number,title,labels,url
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh issue list "${args[@]}"
