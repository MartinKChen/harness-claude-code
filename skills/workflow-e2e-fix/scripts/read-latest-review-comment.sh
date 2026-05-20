#!/usr/bin/env bash
# Print the body of the most recent comment on the task issue whose body starts
# with "# Code Review" — that's the structured findings comment posted by the
# `code-reviewer` sub-agent and is the source-of-truth fix list.
#
# Exits non-zero with a diagnostic on stderr if no matching comment exists.
#
# Usage:
#   read-latest-review-comment.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"

body="$(gh issue view "$task_number" --json comments \
  --jq '.comments | reverse | map(select(.body | startswith("# Code Review"))) | .[0].body // empty')"

if [[ -z "$body" ]]; then
  echo "no '# Code Review' comment found on task #$task_number — surface and stop" >&2
  exit 1
fi

printf '%s\n' "$body"
