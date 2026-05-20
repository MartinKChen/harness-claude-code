#!/usr/bin/env bash
# Pull the slice issue's open-blocker count AND its sub-issue list (number +
# labels) in one GraphQL call. The caller skips the slice when
# `issueDependenciesSummary.blockedBy > 0` and extracts qualifying task
# sub-issue numbers (labels include `level:task` AND `kind:feature`) to
# append `status:ready-to-implement` to.
#
# Usage:
#   inspect-slice.sh <slice-#>
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
          issueDependenciesSummary { blockedBy }
          subIssues(first: 100) {
            nodes { number labels(first: 20) { nodes { name } } }
          }
        }
      }
    }
  '
