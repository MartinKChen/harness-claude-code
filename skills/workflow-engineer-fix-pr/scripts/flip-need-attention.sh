#!/usr/bin/env bash
# Terminal bail-out action for `fix-pr-blockers` when the failing CI is
# confirmed to need E2E-spec edits (not a production-code fix). Removes
# the `status:fix-in-progress` lock from the PR, adds `status:need-attention`,
# and posts the diagnostic comment (the engineer wrote to `<comment-file>`)
# so the user can see which E2E specs need editing.
#
# After this runs, `fix-pr` and `close-pr` both skip the PR (because of
# `status:need-attention`) until the user removes the label.
#
# Usage:
#   flip-need-attention.sh <pr-#> <comment-file>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pr-#> <comment-file>" >&2
  exit 1
fi

pr_number="$1"
comment_file="$2"

if [[ ! -f "$comment_file" ]]; then
  echo "comment file not found: $comment_file" >&2
  exit 1
fi

gh pr edit "$pr_number" \
  --remove-label "status:fix-in-progress" \
  --add-label "status:need-attention"

gh pr comment "$pr_number" --body-file "$comment_file"
