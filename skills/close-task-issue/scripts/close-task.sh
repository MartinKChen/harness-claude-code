#!/usr/bin/env bash
# Strip `status:in-progress` from a task issue, then close it as completed.
# Already-removed label / already-closed issue are benign no-ops.
#
# Usage:
#   close-task.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"

gh issue edit "$task_number" --remove-label "status:in-progress" || true
gh issue close "$task_number" --reason completed || true
