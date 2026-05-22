#!/usr/bin/env bash
# Close a GitHub issue. Optional reason (`completed` or `not_planned`,
# defaulting to `completed`).
#
# Use after stripping `status:in-progress` (see flip-label.sh).
#
# Usage:
#   close-issue.sh <issue-#> [--reason completed|not_planned]
set -euo pipefail

number=""
reason="completed"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reason) reason="$2"; shift 2 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$number" ]]; then
        number="$1"; shift
      else
        echo "unexpected arg: $1" >&2; exit 1
      fi
      ;;
  esac
done

if [[ -z "$number" ]]; then
  echo "usage: $0 <issue-#> [--reason completed|not_planned]" >&2
  exit 1
fi

gh issue close "$number" --reason "$reason"
