#!/usr/bin/env bash
# Push the slice branch to remote and reset EVERY `review:{code,security}-*`
# gate on the task issue back to `review:*-pending` so `review-task-issue`
# will dispatch a fresh review cycle on both gates. A fix can invalidate a
# previously-passed gate, so even passed gates are reopened.
#
# Idempotent — `gh issue edit` silently ignores `--remove-label` targets that
# aren't currently set, so the call is safe regardless of which terminal
# verdicts were actually present.
#
# Terminal action for `fix-task-feedback`.
#
# Usage:
#   push-and-reset-all-reviews.sh <task-#> <slice-branch>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <task-#> <slice-branch>" >&2
  exit 1
fi

task_number="$1"
slice_branch="$2"

git push origin "$slice_branch"

gh issue edit "$task_number" \
  --remove-label "review:code-passed" \
  --remove-label "review:code-need-fix" \
  --remove-label "review:security-passed" \
  --remove-label "review:security-need-fix" \
  --add-label "review:code-pending" \
  --add-label "review:security-pending"
