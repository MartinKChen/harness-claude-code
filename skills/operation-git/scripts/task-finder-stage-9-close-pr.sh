#!/usr/bin/env bash
# task-finder-stage-9-close-pr.sh
#
# Discovery for Stage 9 of /implement-feature: draft PRs currently clean
# (mergeable + every check rollup state SUCCESS / NEUTRAL / SKIPPED), tagging
# each one's merge-mode (`auto` when the PR carries `merge:auto`, else `manual`).
#
# Both `merge:auto` and `merge:manual` drafts are listed — Stage 9 promotes
# every mergeable draft to ready and only auto-closes (squash-merges) the
# `merge:auto` ones. The merge-mode tag is what tells the dispatcher which to
# auto-close; it is not a discovery filter.
#
# Resolves each PR's linked slice number from the PR body's first
# case-insensitive `Closes #<n>` line. Drops silently when the body has no
# `Closes #<n>` line.
#
# Read-only — never promotes draft → ready, never merges, never writes memory.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - PR #<pr-#> | slice:<slice-#> | merge:<auto|manual> | "<pr-title>"
#
# Usage:
#   task-finder-stage-9-close-pr.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

out="$(bash "$script_dir/list-draft-prs.sh" \
    --status green \
    --milestone "$feature_name" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      mode="$(printf '%s' "$row" | jq -r 'if (.labels | index("merge:auto")) then "auto" else "manual" end')"
      slice="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$slice" ]] || continue
      printf -- '- PR #%s | slice:%s | merge:%s | "%s"\n' "$number" "$slice" "$mode" "$title"
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
