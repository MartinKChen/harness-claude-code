#!/usr/bin/env bash
# Append `status:ready-to-implement` to a task sub-issue under a freshly
# promoted slice. Already-present label is a benign no-op.
#
# Usage:
#   unlock-task.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

gh issue edit "$1" --add-label "status:ready-to-implement"
