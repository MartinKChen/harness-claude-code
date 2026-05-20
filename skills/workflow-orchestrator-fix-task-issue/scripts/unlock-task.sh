#!/usr/bin/env bash
# Restore the snapshot of labels stripped by `lock-task.sh`. Used only on
# synchronous `Agent` dispatch failure — once the sub-agent is running, it
# owns the lifecycle and adds `review:*-pending` as its terminal step.
#
# Usage:
#   unlock-task.sh <task-#> <label> [<label> ...]
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <task-#> <label> [<label> ...]" >&2
  exit 1
fi

task_number="$1"
shift

add_args=()
for lbl in "$@"; do
  [[ -z "$lbl" ]] && continue
  add_args+=(--add-label "$lbl")
done

if [[ ${#add_args[@]} -eq 0 ]]; then
  exit 0
fi

gh issue edit "$task_number" "${add_args[@]}"
