#!/usr/bin/env bash
# List open slice issues whose ALL sub-issues are closed. Used by
# workflow-orchestrator-prepare-slice to find slices that finished
# implementation and are ready for the slice-level review.
#
# Filters: open + level:slice + kind:feature + status:in-progress, minus any
# slice already carrying a `review:*` or `e2e:*` label (E2E validation /
# review is already in-flight or settled).
#
# Usage:
#   list-slices-all-subs-closed.sh [--milestone <name>]
#
# Output: JSON array of {number, title, labels, url} for eligible slices.
set -euo pipefail

milestone=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

args=(
  --state open
  --label "level:slice"
  --label "kind:feature"
  --label "status:in-progress"
  --json number,title,labels,url
  --limit 200
)
if [[ -n "$milestone" ]]; then args+=(--milestone "$milestone"); fi

slices="$(gh issue list "${args[@]}")"

# For each slice, query sub-issue OPEN count via GraphQL. Keep only those with 0.
printf '%s' "$slices" | jq -c '.[]' | while read -r slice; do
  number="$(printf '%s' "$slice" | jq -r .number)"
  open_subs="$(gh api graphql \
    -F owner="$owner" -F repo="$repo" -F number="$number" \
    -f query='
      query($owner:String!,$repo:String!,$number:Int!){
        repository(owner:$owner,name:$repo){
          issue(number:$number){
            subIssues(first:100){ nodes{ state } }
          }
        }
      }' \
    --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN")] | length')"

  labels="$(printf '%s' "$slice" | jq -r '[.labels[].name]')"
  has_review="$(printf '%s' "$labels" | jq 'any(.[]; startswith("review:"))')"
  has_e2e="$(printf '%s' "$labels" | jq 'any(.[]; startswith("e2e:"))')"

  if [[ "$open_subs" == "0" && "$has_review" == "false" && "$has_e2e" == "false" ]]; then
    printf '%s\n' "$slice"
  fi
done | jq -s '.'
