#!/usr/bin/env bash
# Revert a PR's ready-for-review promotion back to draft. Used by `close-pr`
# when `gh pr merge` loses a merge race after `gh pr ready` succeeded.
#
# Usage:
#   undo-ready.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

gh pr ready "$1" --undo
