#!/usr/bin/env bash
# Print every comment on the PR (issue thread) created strictly after the
# given cutoff timestamp. These are user directives — inline corrections,
# decision overrides, and implementation hints — that arrived after the
# last commit landed and must apply to this fix pass. A user directive in
# this window OVERRIDES the failing CI's surface-level suggestion AND any
# existing ADR / default convention.
#
# Each comment body is printed in full, separated by a marker line. Empty
# output means there are no user directives newer than the last commit.
#
# Usage:
#   read-user-directives.sh <pr-#> <cutoff-iso>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <pr-#> <cutoff-iso>" >&2
  exit 1
fi

pr_number="$1"
cutoff="$2"

gh pr view "$pr_number" --json comments \
  --jq --arg cutoff "$cutoff" \
       '.comments
        | map(select(.createdAt > $cutoff))
        | .[]
        | "===== comment by \(.author.login) at \(.createdAt) =====\n\(.body)\n"'
