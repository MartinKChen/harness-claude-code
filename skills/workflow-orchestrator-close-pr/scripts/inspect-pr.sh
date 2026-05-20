#!/usr/bin/env bash
# Print a JSON object with mergeability, mergeStateStatus, and the full
# statusCheckRollup for a PR — the gating inputs `close-pr` uses to decide
# whether to promote + merge.
#
# Usage:
#   inspect-pr.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

gh pr view "$1" --json mergeable,mergeStateStatus,statusCheckRollup
