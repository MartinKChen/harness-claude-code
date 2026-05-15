#!/usr/bin/env bash
# List open draft PRs as JSON. Optionally scope to a milestone via the
# `--search milestone:"..."` qualifier (`gh pr list` has no `--milestone` flag).
# The caller filters out PRs already carrying the `status:fix-in-progress`
# lock label.
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
  --draft
  --state open
  --json number,title,headRefName,baseRefName,url,labels,milestone
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--search "milestone:\"${milestone}\"")
fi

gh pr list "${args[@]}"
