#!/usr/bin/env bash
# task-finder.sh
#
# Read-only candidate discovery for the /implement-feature lifecycle. Runs the
# nine per-stage discovery scripts against ONE snapshot of GitHub state for a
# given milestone and emits ONE structured markdown report. Never flips labels,
# never creates tasks, never dispatches agents — every mutation is owned by
# /implement-feature.
#
# Replaces the former `task-finder` agent + nine `workflow-task-finder-*` skills:
# the per-stage logic is pure shell, so the LLM round-trip and Skill prompt-include
# loads are unnecessary overhead.
#
# Usage:
#   task-finder.sh <feature-name>
#
# Output: a markdown report shaped exactly:
#   # task-finder report — <feature-name>
#   ## Stage 1: kickoff-slice
#   <stage 1 stdout>
#   …
#   ## Stage 9: close-pr
#   <stage 9 stdout>
#   ## Summary
#   Eligible: <N> across <S> stage(s). Empty stages: <E>.
#
# Exit codes:
#   0  — report emitted (every stage including all-empty).
#   1  — precheck failed (bad usage, not a GitHub repo, or milestone missing),
#        or any per-stage script exited non-zero. Diagnostic on stderr.
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "task-finder: usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Precheck 1: working directory is a GitHub repo.
if ! repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)"; then
  echo "task-finder: not a GitHub repo (gh repo view failed)" >&2
  exit 1
fi

# Precheck 2: milestone exists (open) in this repo.
milestone_number="$(gh api "repos/${repo_slug}/milestones?state=open" \
  | jq --arg name "$feature_name" -r '.[] | select(.title == $name) | .number')"
if [[ -z "$milestone_number" ]]; then
  echo "task-finder: milestone \"$feature_name\" not found" >&2
  exit 1
fi

# Stage definitions: "<n>:<stage-name>". Stage-name maps 1:1 to the per-stage
# script `task-finder-stage-<n>-<stage-name>.sh` and to the report heading.
stages=(
  "1:kickoff-slice"
  "2:implement-task"
  "3:review-task"
  "4:fix-task"
  "5:prepare-slice"
  "6:review-slice"
  "7:fix-slice"
  "8:fix-pr"
  "9:close-pr"
)

total_candidates=0
filled_stages=0
empty_stages=0

printf '# task-finder report — %s\n\n' "$feature_name"

for stage in "${stages[@]}"; do
  n="${stage%%:*}"
  name="${stage#*:}"
  script="${script_dir}/task-finder-stage-${n}-${name}.sh"

  printf '## Stage %s: %s\n' "$n" "$name"

  if [[ ! -f "$script" ]]; then
    echo "task-finder: missing stage script: $script" >&2
    exit 1
  fi

  err_tmp="$(mktemp)"
  if ! out="$(bash "$script" "$feature_name" 2>"$err_tmp")"; then
    echo "task-finder: stage $n ($name) failed:" >&2
    cat "$err_tmp" >&2
    rm -f "$err_tmp"
    exit 1
  fi
  rm -f "$err_tmp"

  printf '%s\n\n' "$out"

  if [[ "$out" == "- (none)" ]]; then
    empty_stages=$(( empty_stages + 1 ))
  else
    filled_stages=$(( filled_stages + 1 ))
    candidates_in_stage="$(printf '%s\n' "$out" | grep -c '^- ' || true)"
    total_candidates=$(( total_candidates + candidates_in_stage ))
  fi
done

printf '## Summary\n'
printf 'Eligible: %d across %d stage(s). Empty stages: %d.\n' \
  "$total_candidates" "$filled_stages" "$empty_stages"
