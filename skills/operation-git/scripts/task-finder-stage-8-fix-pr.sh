#!/usr/bin/env bash
# task-finder-stage-8-fix-pr.sh
#
# Discovery for Stage 8 of /implement-feature: draft PRs blocked on CI failure
# or merge conflict. Lists open draft PRs in the milestone whose
# `mergeable == "CONFLICTING"` OR `checksStatus == "FAILED"`, excluding those
# already carrying `status:fix-in-progress` or `status:need-attention`. The
# `mergeable == "UNKNOWN"` / `checksStatus == "PENDING"` mid-flight states drop
# silently — a later snapshot picks them up once they settle.
#
# Resolves each PR's linked slice number from the PR body's first
# case-insensitive `Closes #<n>` line so /implement-feature can enforce its
# per-slice implement budget (a `fix-pr` dispatch edits the slice worktree).
# Drops silently when the body has no `Closes #<n>` line.
#
# Read-only — never flips labels, never dispatches, never classifies fix scope.
#
# Output: one line per eligible candidate, or `- (none)` when none survive.
#
# Line format:
#   - PR #<pr-#> | slice:<slice-#> | "<pr-title>"
#
# Usage:
#   task-finder-stage-8-fix-pr.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

out="$(bash "$script_dir/list-draft-prs.sh" \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    --milestone "$feature_name" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      title="$(printf '%s' "$row" | jq -r .title)"
      body="$(printf '%s' "$row" | jq -r .body)"
      slice="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
      [[ -n "$slice" ]] || continue
      printf -- '- PR #%s | slice:%s | "%s"\n' "$number" "$slice" "$title"
    done)"

if [[ -z "$out" ]]; then
  printf -- '- (none)\n'
else
  printf '%s\n' "$out"
fi
