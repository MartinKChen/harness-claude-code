#!/usr/bin/env bash
# Strip every `review:{code,security}-(passed|need-fix)` label currently on
# a task issue. The absence of those terminal labels IS the lock — the
# dispatched engineer / e2e-author re-adds `review:*-pending` after pushing
# the fix. Re-adding the snapshot via `unlock-task.sh` is the rollback path
# when an `Agent` dispatch fails synchronously.
#
# Prints the snapshot of removed labels, one per line, on stdout — the
# orchestrator captures this so it can pass the same list back to
# `unlock-task.sh` on rollback.
#
# Usage:
#   lock-task.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"

snapshot="$(gh issue view "$task_number" --json labels --jq '
  .labels[].name | select(test("^review:(code|security)-(passed|need-fix)$"))
')"

if [[ -z "$snapshot" ]]; then
  exit 0
fi

remove_args=()
while IFS= read -r lbl; do
  [[ -z "$lbl" ]] && continue
  remove_args+=(--remove-label "$lbl")
done <<<"$snapshot"

gh issue edit "$task_number" "${remove_args[@]}" >/dev/null

printf '%s\n' "$snapshot"
