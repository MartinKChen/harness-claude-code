#!/usr/bin/env bash
# Add the `status:fix-in-progress` lock label to a draft PR so concurrent
# fires of `fix-pr` don't double-pick. Caller dispatches the engineer
# *after* this call succeeds.
#
# Usage:
#   lock-pr.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

gh pr edit "$1" --add-label "status:fix-in-progress"
