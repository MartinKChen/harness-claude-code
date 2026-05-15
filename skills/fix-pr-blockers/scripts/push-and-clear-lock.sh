#!/usr/bin/env bash
# Push the slice branch to remote and remove the `status:fix-in-progress`
# lock label from the PR so the next sweep can re-classify it (and `close-pr`
# can pick it up if it's now mergeable + green).
#
# Terminal action for `fix-pr-blockers`. The PR stays draft — do not flip it
# to ready-to-review (that's `close-pr`'s lane).
#
# Usage:
#   push-and-clear-lock.sh <pr-#> <slice-branch>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pr-#> <slice-branch>" >&2
  exit 1
fi

pr_number="$1"
slice_branch="$2"

git push origin "$slice_branch"

gh pr edit "$pr_number" --remove-label "status:fix-in-progress"
