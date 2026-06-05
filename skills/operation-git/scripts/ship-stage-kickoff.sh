#!/usr/bin/env bash
# ship-stage-kickoff.sh
#
# Discovery for the /ship kickoff stage: issues ready to launch their per-unit
# workflow. Lists open `kind:feature` / `kind:enhancement` / `kind:bug` issues
# that are `status:ready-to-implement`, NOT already `status:in-progress` (the
# lock), and have zero open `Blocked by` dependencies. Each line carries its
# `kind:` so the orchestrator routes the launch:
#   - kind:feature / kind:enhancement -> implement-slice.mjs (args { slice })
#   - kind:bug                        -> fix-bug.mjs         (args { issue })
#
# An enhancement is a single feature-shaped issue with a `## Tasks` checklist, so
# it runs the identical implement-slice cycle as a feature. A bug carries no
# `## Tasks` checklist and no `Blocked by` chain; its regression test is written
# inside fix-bug's Fix phase. The blocker gate is applied uniformly (a bug
# normally returns 0; a manually-added blocker correctly makes it wait).
#
# Read-only — never flips labels, never launches. The orchestrator flips
# status:ready-to-implement -> status:in-progress and launches the workflow.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - #<number> | kind:<feature|enhancement|bug> | "<title>"
#
# Usage:
#   ship-stage-kickoff.sh [milestone]
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

milestone_args=()
[[ -n "$milestone" ]] && milestone_args=(--milestone "$milestone")

# kind-name of an issue row (first kind:* label found), for the routing tag.
kind_of() {
  printf '%s' "$1" | jq -r '
    (.labels | map(.name) | map(select(startswith("kind:"))) | .[0] // "kind:feature")
    | ltrimstr("kind:")'
}

out="$(bash "$script_dir/list-issues.sh" \
    --kind kind:feature --kind kind:enhancement --kind kind:bug \
    --label status:ready-to-implement \
    --missing-label status:in-progress \
    ${milestone_args[@]+"${milestone_args[@]}"} \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      if [[ "$(bash "$script_dir/blocker-count.sh" "$number")" == "0" ]]; then
        title="$(printf '%s' "$row" | jq -r .title)"
        printf -- '- #%s | kind:%s | "%s"\n' "$number" "$(kind_of "$row")" "$title"
      fi
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
