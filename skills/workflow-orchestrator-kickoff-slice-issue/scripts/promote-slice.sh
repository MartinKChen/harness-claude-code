#!/usr/bin/env bash
# Flip a slice issue's status label from `status:ready-to-implement` to
# `status:in-progress` so `implement-task-issue` sees its task sub-issues
# (once they pick up `status:ready-to-implement` via `unlock-task.sh`).
#
# Usage:
#   promote-slice.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

gh issue edit "$1" \
  --remove-label "status:ready-to-implement" \
  --add-label "status:in-progress"
