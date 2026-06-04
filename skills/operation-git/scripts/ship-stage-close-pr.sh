#!/usr/bin/env bash
# ship-stage-close-pr.sh
#
# Discovery for the /ship close-pr stage: draft PRs currently clean (mergeable +
# every check rollup state SUCCESS / NEUTRAL / SKIPPED), tagging each one's
# merge-mode (`auto` when the PR carries `merge:auto`, else `manual`). Both modes
# are listed — close-pr promotes every mergeable draft to ready and only
# auto-closes (squash-merges) the `merge:auto` ones.
#
# Works for both slice PRs and bug-fix PRs; the linked issue is resolved from the
# PR body's first case-insensitive `Closes #<n>`. Drops silently when absent.
#
# Milestone is OPTIONAL (repo-wide maintenance lane when omitted).
#
# Read-only — never promotes draft → ready, never merges.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - PR #<pr-#> | issue:<issue-#> | merge:<auto|manual> | "<pr-title>"
#
# Usage:
#   ship-stage-close-pr.sh [milestone]
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

milestone_args=()
[[ -n "$milestone" ]] && milestone_args=(--milestone "$milestone")

out="$(bash "$script_dir/list-draft-prs.sh" \
    --status green \
    "${milestone_args[@]}" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      mode="$(printf '%s' "$row" | jq -r 'if (.labels | index("merge:auto")) then "auto" else "manual" end')"
      issue="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$issue" ]] || continue
      printf -- '- PR #%s | issue:%s | merge:%s | "%s"\n' "$number" "$issue" "$mode" "$title"
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
