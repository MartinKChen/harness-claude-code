#!/usr/bin/env bash
# List open draft PRs filtered by labels, missing-labels, and check/conflict
# status. Used by workflow-task-finder-fix-pr and workflow-task-finder-close-pr.
#
# --status options:
#   green     mergeable=MERGEABLE AND every check SUCCESS (default = no filter)
#   broken    mergeable=CONFLICTING OR any check FAILURE / CANCELLED / TIMED_OUT
#
# Usage:
#   list-draft-prs.sh [--label <l>]... [--missing-label <l>]... [--status green|broken]
#
# Output: JSON array of {number, title, headRefName, labels, mergeable,
# checksStatus, url}.
set -euo pipefail

labels=()
missing=()
status_filter=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) labels+=("$2"); shift 2 ;;
    --missing-label) missing+=("$2"); shift 2 ;;
    --status) status_filter="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

args=(
  --state open
  --draft
  --json number,title,headRefName,labels,mergeable,statusCheckRollup,url
  --limit 200
)
for l in "${labels[@]}"; do args+=(--label "$l"); done

prs="$(gh pr list "${args[@]}")"

missing_json="$(printf '%s\n' "${missing[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')"

printf '%s' "$prs" | jq --argjson missing "$missing_json" --arg status "$status_filter" '
  def check_state:
    if (.statusCheckRollup // []) | length == 0 then "NONE"
    else
      ([.statusCheckRollup[] | (.conclusion // .status // "PENDING")] | unique) as $states
      | if ($states | any(. == "FAILURE" or . == "CANCELLED" or . == "TIMED_OUT")) then "FAILED"
        elif ($states | all(. == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED")) then "SUCCESS"
        else "PENDING"
        end
    end;

  map(. + {checksStatus: (. | check_state)})
  | map(. as $p
      | ($p.labels | map(.name)) as $names
      | select(($missing | all(. as $m | $names | index($m) | not)))
      | $p)
  | (if $status == "green" then
       map(select(.mergeable == "MERGEABLE" and .checksStatus == "SUCCESS"))
     elif $status == "broken" then
       map(select(.mergeable == "CONFLICTING" or .checksStatus == "FAILED"))
     else . end)
  | map({number, title, headRefName, labels: [.labels[].name], mergeable, checksStatus, url})
'
