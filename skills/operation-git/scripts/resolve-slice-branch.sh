#!/usr/bin/env bash
# Resolve the slice branch for a slice issue.
#
# Since the per-slice-Workflow redesign every issue IS a slice (there are no task
# sub-issues), so this just prints the branch attached to the issue by
# `gh issue develop` at slice creation.
#
# Exits non-zero with a diagnostic on stderr if the slice has no linked branch.
#
# Usage:
#   resolve-slice-branch.sh <slice-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-#>" >&2
  exit 1
fi

slice_number="$1"

slice_branch="$(gh issue develop --list "$slice_number" | head -1 | awk '{print $1}')"

if [[ -z "$slice_branch" ]]; then
  echo "slice issue #$slice_number has no linked branch" >&2
  exit 1
fi

printf '%s\n' "$slice_branch"
