#!/usr/bin/env bash
# ship-stage-analyze-bug.sh
#
# Discovery for the /ship analyze stage: freshly-filed bugs that need diagnosis.
# Lists open `kind:bug` issues carrying NO `status:*` label at all — a bug that
# has not yet entered the lifecycle. The /ship command locks each (adds
# status:in-progress) and dispatches the read-only analyze engineer
# (workflow-engineer-analyze-bug), which reproduces, posts a `# Bug Analysis`
# comment, and swaps the lock to status:ready-to-review for a human to approve.
#
# A bug acquires its first status label the moment analyze locks it, so it leaves
# this eligible set immediately — no second analyze dispatch for the same bug.
#
# Read-only — never flips labels, never dispatches. The orchestrator owns every
# mutation.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - #<number> | "<title>"
#
# Usage:
#   ship-stage-analyze-bug.sh [milestone]
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

milestone_args=()
[[ -n "$milestone" ]] && milestone_args=(--milestone "$milestone")

out="$(bash "$script_dir/list-issues.sh" \
    --kind kind:bug \
    --missing-label status:in-progress \
    --missing-label status:ready-to-review \
    --missing-label status:ready-to-implement \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    "${milestone_args[@]}" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      printf -- '- #%s | "%s"\n' "$number" "$title"
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
