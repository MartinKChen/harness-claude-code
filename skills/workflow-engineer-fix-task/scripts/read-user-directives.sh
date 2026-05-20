#!/usr/bin/env bash
# Print every non-reviewer comment on the task issue created strictly after
# the given cutoff timestamp. These comments are the channel through which
# the user posts inline corrections, decision overrides, and implementation
# directives between review rounds — a user directive in this window
# OVERRIDES the reviewer's suggested fix path AND any existing ADR / prior
# constraint. Reviewer-authored comments (`# Code Review` / `# Security Review`)
# are filtered out — those are read separately via `read-latest-review-comment.sh`.
#
# Each comment body is printed in full, separated by a marker line. Empty
# output means there are no user directives in this round and the reviewer
# findings can be applied as-is.
#
# Usage:
#   read-user-directives.sh <task-#> <cutoff-iso>
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <task-#> <cutoff-iso>" >&2
  exit 1
fi

task_number="$1"
cutoff="$2"

gh issue view "$task_number" --json comments \
  --jq --arg cutoff "$cutoff" \
       '.comments
        | map(select(.createdAt > $cutoff))
        | map(select(
            (.body | startswith("# Code Review") | not) and
            (.body | startswith("# Security Review") | not)
          ))
        | .[]
        | "===== comment by \(.author.login) at \(.createdAt) =====\n\(.body)\n"'
