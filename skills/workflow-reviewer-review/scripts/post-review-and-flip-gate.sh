#!/usr/bin/env bash
# Post the aggregated review comment on the task issue and flip the gate label
# from `review:<gate>-running` to its terminal state (`review:<gate>-passed`
# or `review:<gate>-need-fix`). Terminal action of the reviewer's workflow.
#
# Arguments:
#   <task-#>      — the task issue number
#   <gate>        — `code` or `security`
#   <verdict>     — `passed` or `need-fix`
#   <body-file>   — path to a file containing the comment body (markdown)
#
# Posting the comment and flipping the label must both succeed for the review
# to be considered final. If the comment post fails, the label is NOT flipped
# (leaving the gate as `*-running` so a triage sweep can clean it up).
#
# Usage:
#   post-review-and-flip-gate.sh <task-#> <gate> <verdict> <body-file>
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 <task-#> <gate> <verdict> <body-file>" >&2
  exit 1
fi

task_number="$1"
gate="$2"
verdict="$3"
body_file="$4"

case "$gate" in
  code|security) ;;
  *) echo "gate must be 'code' or 'security' (got: ${gate})" >&2; exit 1 ;;
esac

case "$verdict" in
  passed|need-fix) ;;
  *) echo "verdict must be 'passed' or 'need-fix' (got: ${verdict})" >&2; exit 1 ;;
esac

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: ${body_file}" >&2
  exit 1
fi

gh issue comment "$task_number" --body-file "$body_file"

gh issue edit "$task_number" \
  --remove-label "review:${gate}-running" \
  --add-label "review:${gate}-${verdict}"
