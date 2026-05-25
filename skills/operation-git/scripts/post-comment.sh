#!/usr/bin/env bash
# Post a single comment to a GitHub issue or PR from a file. Using --body-file
# avoids quoting pitfalls in markdown-heavy review comments.
#
# Usage:
#   post-comment.sh <issue-or-pr-#> <body-file>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <issue-or-pr-#> <body-file>" >&2
  exit 1
fi

number="$1"
body_file="$2"

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

# gh issue comment works for both issues and PRs (PRs are issues in GitHub's data model).
gh issue comment "$number" --body-file "$body_file"
