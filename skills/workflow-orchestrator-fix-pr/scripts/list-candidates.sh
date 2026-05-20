#!/usr/bin/env bash
# List open draft PRs as JSON. Optionally scope to a milestone via the
# `--search milestone:"..."` qualifier (`gh pr list` has no `--milestone` flag).
# Always excludes PRs carrying the `status:fix-in-progress` lock (a sibling
# fire owns them) or `status:need-attention` (a prior fix dispatched
# determined the failure needs human-in-the-loop — typically an E2E spec
# rewrite). The caller still inspects label arrays defensively.
#
# Usage:
#   list-candidates.sh [--milestone <name>]
#
# Output: JSON array of objects with number, title, headRefName, baseRefName, url, labels, milestone.
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

search='-label:"status:fix-in-progress" -label:"status:need-attention"'
if [[ -n "$milestone" ]]; then
  search+=" milestone:\"${milestone}\""
fi

args=(
  --draft
  --state open
  --search "$search"
  --json number,title,headRefName,baseRefName,url,labels,milestone
  --limit 200
)

gh pr list "${args[@]}"
