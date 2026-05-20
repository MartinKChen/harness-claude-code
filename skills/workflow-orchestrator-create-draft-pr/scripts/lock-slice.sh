#!/usr/bin/env bash
# Add the `status:prepare-pr` lock label to a slice issue so concurrent fires
# of `create-draft-pr` don't double-pick it while the engineer is running
# its `prepare-slice-pr` workflow. The engineer (success path) or its bail
# script (`mark-slice-need-attention.sh`) removes the label terminally.
#
# Usage:
#   lock-slice.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

gh issue edit "$1" --add-label "status:prepare-pr"
