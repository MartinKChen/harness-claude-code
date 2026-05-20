#!/usr/bin/env bash
# Roll back a task's status flip: `status:in-progress` →
# `status:ready-to-implement`. Used only on synchronous `Agent` dispatch
# failure — once the sub-agent is running, ownership transfers.
#
# Usage:
#   unlock-task.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

gh issue edit "$1" \
  --remove-label "status:in-progress" \
  --add-label "status:ready-to-implement"
