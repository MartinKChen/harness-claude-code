#!/usr/bin/env bash
# Generic candidate listing for orchestrator skills. Returns open `kind:feature`
# issues at the requested level with the requested labels (and, optionally,
# confirms specific labels are absent).
#
# Output is sorted by the deterministic pick-order tiebreaker:
#   1. `type:e2e` before `type:backend` before `type:frontend` (only when
#      candidates carry `type:*`; slices don't, so this tier is a no-op there).
#   2. Lowest GitHub issue number first.
#
# Usage:
#   list-issues.sh --level <slice|task> [--label <l>]... [--missing-label <l>]... [--milestone <name>]
#
# Output: JSON array of objects with number, title, labels, url.
set -euo pipefail

level=""
labels=()
missing=()
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --level) level="$2"; shift 2 ;;
    --label) labels+=("$2"); shift 2 ;;
    --missing-label) missing+=("$2"); shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$level" ]]; then
  echo "usage: $0 --level <slice|task> [--label <l>]... [--missing-label <l>]... [--milestone <name>]" >&2
  exit 1
fi

args=(
  --state open
  --label "level:${level}"
  --label "kind:feature"
  --json number,title,labels,url
  --limit 200
)
for l in "${labels[@]}"; do args+=(--label "$l"); done
if [[ -n "$milestone" ]]; then args+=(--milestone "$milestone"); fi

# `gh issue list` does positive label matching but not negative — apply the
# missing-label filter in jq after the fact.
missing_json="$(printf '%s\n' "${missing[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')"

gh issue list "${args[@]}" | jq --argjson missing "$missing_json" '
  map(. as $i
    | ($i.labels | map(.name)) as $names
    | select(
        ($missing | all(. as $m | $names | index($m) | not))
      )
    | $i
  )
  | map(. + {
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
