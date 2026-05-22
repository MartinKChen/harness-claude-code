#!/usr/bin/env bash
# Print the count of OPEN `Blocked by` dependencies on a GitHub issue.
# Uses GraphQL's Issue.issueDependenciesSummary.blockedBy field — closed
# blockers are not counted, which is what the orchestrator skills want.
#
# Usage:
#   blocker-count.sh <issue-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <issue-#>" >&2
  exit 1
fi

issue_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

gh api graphql \
  -F number="$issue_number" -F owner="$owner" -F repo="$repo" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
        }
      }
    }
  ' --jq '.data.repository.issue.issueDependenciesSummary.blockedBy'
