#!/usr/bin/env bash
# Resolve the slice issue linked to a merged PR. Prefers the
# `closingIssuesReferences` field (the canonical Development link wired via
# `gh issue develop` from `create-issues`); falls back to parsing
# `Closes #<n>` / `Fixes #<n>` from the PR body. Prints the issue number, or
# empty if none could be resolved.
#
# Usage:
#   resolve-slice-issue.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"

slice_issue="$(gh pr view "$pr_number" --json closingIssuesReferences \
  --jq '.closingIssuesReferences[0].number // empty')"

if [[ -z "$slice_issue" ]]; then
  body="$(gh pr view "$pr_number" --json body --jq '.body // ""')"
  slice_issue="$(printf '%s' "$body" \
    | grep -ioE '(closes|fixes) #[0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+' || true)"
fi

printf '%s' "$slice_issue"
