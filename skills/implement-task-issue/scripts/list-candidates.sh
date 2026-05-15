#!/usr/bin/env bash
# List open task issues that are eligible for implementation pickup:
# `level:task` + `kind:feature` + `status:ready-to-implement`. Caller still
# has to query open-blocker count per task via `blocker-count.sh`.
#
# Output is sorted by the deterministic pick-order tiebreaker so the caller
# can iterate top-to-bottom without further ordering work:
#   1. `type:e2e` before `type:backend` before `type:frontend`
#      (rank 0 / 1 / 2; any task missing a recognized `type:*` label is
#      ranked last at 3 — it will be flagged malformed by the skill anyway).
#   2. Lowest GitHub issue number first.
#
# The within-slice issue graph is a DAG now, so several tasks under one
# slice can become eligible simultaneously once their last `e2e` closes;
# this ordering picks the next one to dispatch.
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
      sed -n '2,18p' "$0"
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

gh issue list "${args[@]}" | jq '
  map(. + {
    _type_rank: (
      if   any(.labels[]; .name == "type:e2e")      then 0
      elif any(.labels[]; .name == "type:backend")  then 1
      elif any(.labels[]; .name == "type:frontend") then 2
      else 3
      end
    )
  })
  | sort_by([._type_rank, .number])
  | map(del(._type_rank))
'
