#!/usr/bin/env bash
# Remove the `status:prepare-pr` lock label from a slice issue. Used for
# rollback when the engineer dispatch fails synchronously (the engineer
# never started, so no other terminal handler will clean the label up).
#
# Usage:
#   unlock-slice.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

gh issue edit "$1" --remove-label "status:prepare-pr"
