#!/usr/bin/env bash
# Flip a single review gate's label from `review:<gate>-pending` to
# `review:<gate>-running` in one atomic call. Touches only the named gate's
# labels — every other label on the task is preserved.
#
# Usage:
#   lock-gate.sh <task-#> <gate>
#
# <gate> is one of: code, security.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <task-#> <gate>" >&2
  exit 1
fi

task_number="$1"
gate="$2"

if [[ "$gate" != "code" && "$gate" != "security" ]]; then
  echo "gate must be 'code' or 'security'; got '$gate'" >&2
  exit 1
fi

gh issue edit "$task_number" \
  --remove-label "review:${gate}-pending" \
  --add-label    "review:${gate}-running"
