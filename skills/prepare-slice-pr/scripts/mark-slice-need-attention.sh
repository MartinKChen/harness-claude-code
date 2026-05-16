#!/usr/bin/env bash
# Terminal bail-out action for `prepare-slice-pr`. Remove the
# `status:prepare-pr` lock from the slice, add `status:need-attention`, and
# post the diagnostic comment (the engineer wrote to `<comment-file>`) so the
# user can see which E2E specs need editing.
#
# After this runs, `create-draft-pr` will not re-pick the slice until the
# user removes `status:need-attention`.
#
# Usage:
#   mark-slice-need-attention.sh <slice-#> <comment-file>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <slice-#> <comment-file>" >&2
  exit 1
fi

slice_number="$1"
comment_file="$2"

if [[ ! -f "$comment_file" ]]; then
  echo "comment file not found: $comment_file" >&2
  exit 1
fi

gh issue edit "$slice_number" \
  --remove-label "status:prepare-pr" \
  --add-label "status:need-attention"

gh issue comment "$slice_number" --body-file "$comment_file"
