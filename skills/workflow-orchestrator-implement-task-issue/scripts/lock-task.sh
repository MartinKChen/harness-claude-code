#!/usr/bin/env bash
# Flip a task's status label from `status:ready-to-implement` to
# `status:in-progress` in one atomic call so concurrent fires of
# `implement-task-issue` don't double-pick.
#
# Usage:
#   lock-task.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

gh issue edit "$1" \
  --remove-label "status:ready-to-implement" \
  --add-label "status:in-progress"
