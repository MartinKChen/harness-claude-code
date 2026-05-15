#!/usr/bin/env bash
# Roll back the gate flip: `review:<gate>-running` → `review:<gate>-pending`.
# Used only on synchronous `Agent` dispatch failure — once the reviewer
# sub-agent is running, it owns the terminal label (`*-passed` / `*-need-fix`).
#
# Usage:
#   unlock-gate.sh <task-#> <gate>
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
  --remove-label "review:${gate}-running" \
  --add-label    "review:${gate}-pending"
