#!/usr/bin/env bash
# Generic candidate listing for orchestrator skills. Returns open issues of one
# or more `kind:*` (default `kind:feature`) carrying the requested labels (and,
# optionally, confirming specific labels are absent).
#
# Since the per-slice-Workflow redesign there are no per-task issues and no
# `level:*` labels — every issue is a slice. So this script no longer filters by
# level; callers select the lifecycle slot purely with `--label` / `--missing-label`
# (e.g. the slice lock `status:in-progress`, or the gate `status:ready-to-implement`).
#
# `--kind` selects which kind(s) to return, with OR semantics across kinds (an
# issue carrying ANY of the requested kinds matches). It defaults to `kind:feature`
# so existing callers that pass no `--kind` keep their feature-only behavior. The
# kind filter is applied in jq (not as a `gh --label`) because `gh issue list`
# ANDs its `--label` flags, which can't express "feature OR bug".
#
# Output is sorted by lowest GitHub issue number first (the deterministic
# pick-order tiebreaker).
#
# Usage:
#   list-issues.sh [--kind <k>]... [--label <l>]... [--missing-label <l>]... [--milestone <name>]
#
# Output: JSON array of objects with number, title, labels, url.
set -euo pipefail

kinds=()
labels=()
missing=()
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) kinds+=("$2"); shift 2 ;;
    --label) labels+=("$2"); shift 2 ;;
    --missing-label) missing+=("$2"); shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,28p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

# Default to feature-only when no --kind is given (backward compatible).
if [[ ${#kinds[@]} -eq 0 ]]; then kinds=("kind:feature"); fi

args=(
  --state open
  --json number,title,labels,url
  --limit 200
)
for l in "${labels[@]:-}"; do [[ -n "$l" ]] && args+=(--label "$l"); done
if [[ -n "$milestone" ]]; then args+=(--milestone "$milestone"); fi

# `gh issue list` does positive AND matching only; apply the kind OR-filter and
# the negative missing-label filter in jq after the fact.
kinds_json="$(printf '%s\n' "${kinds[@]}" | jq -R . | jq -s 'map(select(. != ""))')"
missing_json="$(printf '%s\n' "${missing[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')"

gh issue list "${args[@]}" | jq --argjson kinds "$kinds_json" --argjson missing "$missing_json" '
  map(. as $i
    | ($i.labels | map(.name)) as $names
    | select(
        ($kinds   | any(. as $k | $names | index($k)))
        and
        ($missing | all(. as $m | $names | index($m) | not))
      )
    | $i
  )
  | sort_by(.number)
'
