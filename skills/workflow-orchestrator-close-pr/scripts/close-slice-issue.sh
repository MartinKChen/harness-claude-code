#!/usr/bin/env bash
# Strip `status:in-progress` from a slice issue, then close it as completed.
# Already-removed label and already-closed issue are benign no-ops.
#
# Usage:
#   close-slice-issue.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

slice_issue="$1"

gh issue edit "$slice_issue" --remove-label "status:in-progress" || true
gh issue close "$slice_issue" --reason completed || true
