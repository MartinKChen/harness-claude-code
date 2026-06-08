#!/usr/bin/env bash
# ship-finder.sh
#
# Read-only candidate discovery for the unified /ship lifecycle, covering all
# three kinds (feature, enhancement, bug). Runs five stages against ONE snapshot
# of GitHub state and emits ONE structured markdown report. Never flips labels,
# never launches workflows, never dispatches agents, never merges — every
# mutation is owned by the /ship command.
#
# The five stages, in processing order:
#   reconcile    release orphaned locks (dead implement-slice / fix-bug / analyze
#                / fix-pr runs) across all kinds.
#   analyze-bug  freshly-filed kind:bug with no status -> dispatch the read-only
#                analyze engineer (then a human approves its # Bug Analysis).
#   kickoff      kind:feature|enhancement|refactor|bug at status:ready-to-implement,
#                0 blockers, not locked -> launch the per-unit workflow
#                (implement-slice for feature/enhancement/refactor, fix-bug for bug).
#   fix-pr       draft PRs blocked on CI / conflict -> dispatch the fix-pr engineer.
#   close-pr     mergeable draft PRs -> promote to ready (+ auto-merge merge:auto).
#
# Milestone is OPTIONAL. Pass one to scope to a feature milestone; omit it for the
# repo-wide MAINTENANCE LANE (all open bugs + one-off enhancements regardless of
# milestone). Features normally carry a milestone for their Blocked-by grouping;
# bugs / one-off enhancements usually don't.
#
# Usage:
#   ship-finder.sh [milestone]
#
# Output (milestone shown as "(repo-wide)" when omitted):
#   # ship-finder report — <milestone|(repo-wide)>
#   ## Stage: reconcile
#   ...
#   ## Stage: analyze-bug
#   ...
#   ## Stage: kickoff
#   ...
#   ## Stage: fix-pr
#   ...
#   ## Stage: close-pr
#   ...
#   ## Summary
#   Eligible: <N> across <S> stage(s). Empty stages: <E>.
#
# Exit codes:
#   0  — report emitted.
#   1  — precheck failed (not a GitHub repo, or a named milestone not found), or
#        any per-stage script exited non-zero. Diagnostic on stderr.
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Precheck 1: working directory is a GitHub repo.
if ! repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)"; then
  echo "ship-finder: not a GitHub repo (gh repo view failed)" >&2
  exit 1
fi

# Precheck 2: if a milestone was named, it must exist (open) in this repo.
if [[ -n "$milestone" ]]; then
  milestone_number="$(gh api "repos/${repo_slug}/milestones?state=open" \
    | jq --arg name "$milestone" -r '.[] | select(.title == $name) | .number')"
  if [[ -z "$milestone_number" ]]; then
    echo "ship-finder: milestone \"$milestone\" not found" >&2
    exit 1
  fi
fi

stages=(reconcile analyze-bug kickoff fix-pr close-pr)

total_candidates=0
filled_stages=0
empty_stages=0

printf '# ship-finder report — %s\n\n' "${milestone:-(repo-wide)}"

for name in "${stages[@]}"; do
  script="${script_dir}/ship-stage-${name}.sh"

  printf '## Stage: %s\n' "$name"

  if [[ ! -f "$script" ]]; then
    echo "ship-finder: missing stage script: $script" >&2
    exit 1
  fi

  err_tmp="$(mktemp)"
  if ! out="$(bash "$script" "$milestone" 2>"$err_tmp")"; then
    echo "ship-finder: stage $name failed:" >&2
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
