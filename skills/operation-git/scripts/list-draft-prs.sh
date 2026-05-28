#!/usr/bin/env bash
# List open draft PRs filtered by labels, missing-labels, and check/conflict
# status. Used by task-finder-stage-8-fix-pr.sh and task-finder-stage-9-close-pr.sh.
#
# --status options:
#   green     mergeable=MERGEABLE AND every check SUCCESS (default = no filter)
#   broken    mergeable=CONFLICTING OR any check FAILURE / CANCELLED / TIMED_OUT
#
# Usage:
#   list-draft-prs.sh [--label <l>]... [--missing-label <l>]... [--status green|broken] [--milestone <name>]
#
# Output: JSON array of {number, title, body, headRefName, labels, milestone,
# mergeable, checksStatus, url}.
set -euo pipefail

labels=()
missing=()
status_filter=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) labels+=("$2"); shift 2 ;;
    --missing-label) missing+=("$2"); shift 2 ;;
    --status) status_filter="$2"; shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

args=(
  --state open
  --draft
  --json number,title,body,headRefName,labels,milestone,mergeable,statusCheckRollup,url
  --limit 200
)
if [[ ${#labels[@]} -gt 0 ]]; then
  for l in "${labels[@]}"; do args+=(--label "$l"); done
fi

prs="$(gh pr list "${args[@]}")"

missing_json="$(printf '%s\n' "${missing[@]:-}" | jq -R . | jq -s 'map(select(. != ""))')"

printf '%s' "$prs" | jq --argjson missing "$missing_json" --arg status "$status_filter" --arg milestone "$milestone" '
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
  | (if $milestone == "" then . else
       map(select((.milestone.title // "") == $milestone))
     end)
  | map(. as $p
      | ($p.labels | map(.name)) as $names
      | select(($missing | all(. as $m | $names | index($m) | not)))
      | $p)
  | (if $status == "green" then
       map(select(.mergeable == "MERGEABLE" and .checksStatus == "SUCCESS"))
     elif $status == "broken" then
       map(select(.mergeable == "CONFLICTING" or .checksStatus == "FAILED"))
     else . end)
  | map({number, title, headRefName, labels: [.labels[].name], milestone: (.milestone.title // null), mergeable, checksStatus, url, body})
'
