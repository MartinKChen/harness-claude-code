#!/usr/bin/env bash
# Print, one per line, every closed `level:task` + `kind:feature` sub-issue
# number under a slice issue. Used to populate the PR body's linked-issues
# block (every closed task gets a `Closes #<task-#>` entry).
#
# Usage:
#   list-task-subissues.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

slice_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

gh api graphql \
  -F number="$slice_number" -F owner="$owner" -F repo="$repo" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          subIssues(first: 100) {
            nodes { number state labels(first: 20) { nodes { name } } }
          }
        }
      }
    }
  ' \
  --jq '
    .data.repository.issue.subIssues.nodes[]
    | select(.state == "CLOSED")
    | select((.labels.nodes | map(.name)) | (contains(["level:task"]) and contains(["kind:feature"])))
    | .number
  '
