#!/usr/bin/env bash
# Resolve the slice branch for a GitHub issue.
#
# - If the issue is a task sub-issue: walk to its parent slice, then print the
#   branch attached to that parent (set by `gh issue develop` at slice creation).
# - If the issue is itself a slice: print the branch attached to it directly.
#
# Exits non-zero with a diagnostic on stderr if the issue has no parent
# (and isn't itself a slice) or the slice has no linked branch.
#
# Usage:
#   resolve-slice-branch.sh <issue-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <issue-#>" >&2
  exit 1
fi

issue_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

# One GraphQL call: get the issue's labels (to detect slice vs task) AND its
# parent (in case it's a task).
response="$(gh api graphql \
  -f owner="$owner" -f repo="$repo" -F number="$issue_number" \
  -f query='
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        issue(number:$number){
          labels(first:30){ nodes{ name } }
          parent{ number }
        }
      }
    }')"

is_slice="$(printf '%s' "$response" | jq -r '
  .data.repository.issue.labels.nodes
  | map(.name)
  | any(. == "level:slice")
')"

if [[ "$is_slice" == "true" ]]; then
  slice_number="$issue_number"
else
  slice_number="$(printf '%s' "$response" | jq -r '.data.repository.issue.parent.number // empty')"
  if [[ -z "$slice_number" ]]; then
    echo "issue #$issue_number is not a slice and has no parent slice issue" >&2
    exit 1
  fi
fi

slice_branch="$(gh issue develop --list "$slice_number" | head -1 | awk '{print $1}')"

if [[ -z "$slice_branch" ]]; then
  echo "slice issue #$slice_number has no linked branch" >&2
  exit 1
fi

printf '%s\n' "$slice_branch"
