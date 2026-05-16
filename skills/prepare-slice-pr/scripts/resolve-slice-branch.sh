#!/usr/bin/env bash
# Print the branch attached to a slice issue via `gh issue develop --list`.
# Empty output means no branch is linked — caller should surface and stop.
#
# Usage:
#   resolve-slice-branch.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

gh issue develop --list "$1" | head -1 | awk '{print $1}'
