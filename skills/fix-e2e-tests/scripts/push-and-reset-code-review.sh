#!/usr/bin/env bash
# Push the slice branch to remote and reset the task's `review:code-*` gate to
# `review:code-pending` so `review-task-issue` dispatches a fresh `code-reviewer`
# against the fix. Idempotent — `gh issue edit` silently ignores
# `--remove-label` targets that aren't currently set.
#
# Terminal action for `fix-e2e-tests`.
#
# Usage:
#   push-and-reset-code-review.sh <task-#> <slice-branch>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <task-#> <slice-branch>" >&2
  exit 1
fi

task_number="$1"
slice_branch="$2"

git push origin "$slice_branch"

gh issue edit "$task_number" \
  --remove-label "review:code-need-fix" \
  --remove-label "review:code-passed" \
  --add-label "review:code-pending"
