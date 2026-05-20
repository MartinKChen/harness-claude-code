#!/usr/bin/env bash
# List open task issues that carry `review:<gate>-need-fix` on top of the
# baseline filter (level:task + kind:feature + status:in-progress). The caller
# is responsible for merging the per-gate lists by issue number and excluding
# any task still carrying a `review:*-pending` / `review:*-running` label.
#
# Usage:
#   list-candidates.sh <gate> [--milestone <name>]
#
# <gate> is one of: code, security.
#
# Output: JSON array of objects with number, title, labels, url.
set -euo pipefail

gate=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,11p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$gate" ]]; then
        gate="$1"
      else
        echo "unexpected arg: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$gate" ]]; then
  echo "usage: $0 <gate> [--milestone <name>]" >&2
  exit 1
fi

if [[ "$gate" != "code" && "$gate" != "security" ]]; then
  echo "gate must be 'code' or 'security'; got '$gate'" >&2
  exit 1
fi

args=(
  --state open
  --label "level:task"
  --label "kind:feature"
  --label "status:in-progress"
  --label "review:${gate}-need-fix"
  --json number,title,labels,url
  --limit 200
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh issue list "${args[@]}"
