#!/usr/bin/env bash
# Pull the slice issue's sub-issues with state + labels in one GraphQL call.
# Caller decides whether to skip the slice (any open sub-issue) and extracts
# the closed `level:task` + `kind:feature` sub-issue numbers for the
# PR body's linked-issues block.
#
# Usage:
#   inspect-subissues.sh <slice-#>
#
# Output: raw GraphQL response JSON.
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
  '
