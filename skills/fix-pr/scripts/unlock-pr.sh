#!/usr/bin/env bash
# Remove the `status:fix-in-progress` lock label from a PR. Used for rollback
# when an `Agent` dispatch fails synchronously after the lock was acquired.
#
# Usage:
#   unlock-pr.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

gh pr edit "$1" --remove-label "status:fix-in-progress"
