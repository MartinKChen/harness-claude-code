#!/usr/bin/env bash
# Print the count of **open** "Blocked by" dependencies on a GitHub issue.
# Uses GraphQL's `Issue.issueDependenciesSummary.blockedBy` field — closed
# blockers are not counted, which is what `implement-task-issue` wants.
#
# Usage:
#   blocker-count.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

gh api graphql \
  -F number="$task_number" -F owner="$owner" -F repo="$repo" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
        }
      }
    }
  ' --jq '.data.repository.issue.issueDependenciesSummary.blockedBy'
