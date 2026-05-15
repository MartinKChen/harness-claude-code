#!/usr/bin/env bash
# Push the slice branch to remote and add `review:code-pending` to the task
# issue so `review-task-issue` dispatches the `code-reviewer`. E2e tasks do
# not carry a security gate (test code has no production attack surface), so
# `review:security-pending` is NOT added here.
#
# Terminal action for `author-e2e-tests`. Do not open or promote the slice PR.
#
# Usage:
#   push-and-request-code-review.sh <task-#> <slice-branch>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <task-#> <slice-branch>" >&2
  exit 1
fi

task_number="$1"
slice_branch="$2"

git push origin "$slice_branch"

gh issue edit "$task_number" --add-label "review:code-pending"
