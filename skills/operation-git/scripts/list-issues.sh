#!/usr/bin/env bash
# Generic candidate listing for orchestrator skills. Returns open `kind:feature`
# issues carrying the requested labels (and, optionally, confirms specific labels
# are absent).
#
# Since the per-slice-Workflow redesign there are no per-task issues and no
# `level:*` labels — every issue is a slice. So this script no longer filters by
# level; callers select the lifecycle slot purely with `--label` / `--missing-label`
# (e.g. the slice lock `status:in-progress`, or the gate `status:ready-to-implement`).
#
# Output is sorted by lowest GitHub issue number first (the deterministic
# pick-order tiebreaker).
#
# Usage:
#   list-issues.sh [--label <l>]... [--missing-label <l>]... [--milestone <name>]
#
# Output: JSON array of objects with number, title, labels, url.
set -euo pipefail

labels=()
missing=()
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) labels+=("$2"); shift 2 ;;
    --missing-label) missing+=("$2"); shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

args=(
  --state open
  --label "kind:feature"
  --json number,title,labels,url
  --limit 200
)
for l in "${labels[@]:-}"; do [[ -n "$l" ]] && args+=(--label "$l"); done
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
  | sort_by(.number)
'
