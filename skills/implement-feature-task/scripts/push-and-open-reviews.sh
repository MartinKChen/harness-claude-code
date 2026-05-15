#!/usr/bin/env bash
# Push the slice branch to remote and open both review gates on the task
# issue (`review:code-pending` + `review:security-pending`) so `review-task-issue`
# dispatches the `code-reviewer` and `security-reviewer`.
#
# Terminal action for `implement-feature-task`.
#
# Usage:
#   push-and-open-reviews.sh <issue-#> <slice-branch>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <issue-#> <slice-branch>" >&2
  exit 1
fi

issue_number="$1"
slice_branch="$2"

git push origin "$slice_branch"

gh issue edit "$issue_number" \
  --add-label "review:code-pending" \
  --add-label "review:security-pending"
