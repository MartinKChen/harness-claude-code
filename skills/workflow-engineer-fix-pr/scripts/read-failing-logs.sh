#!/usr/bin/env bash
# Print the failing-step logs for every CI workflow that failed against the
# PR's head branch. Maps non-SUCCESS / non-SKIPPED check-run conclusions back
# to workflow run ids and pulls each run's `--log-failed` output.
#
# Exits non-zero with a diagnostic on stderr if no failing run is found —
# in that case the orchestrator's view and the live state disagree and the
# caller must surface and stop rather than guessing a fix.
#
# Usage:
#   read-failing-logs.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"
slice_branch="$(gh pr view "$pr_number" --json headRefName -q .headRefName)"

if [[ -z "$slice_branch" ]]; then
  echo "PR #$pr_number has no headRefName — surface and stop" >&2
  exit 1
fi

failed_run_ids="$(gh run list --branch "$slice_branch" --limit 50 \
  --json databaseId,workflowName,conclusion,status,createdAt \
  --jq '[.[] | select(.status == "completed" and .conclusion != "SKIPPED" and .conclusion != "SUCCESS")]
        | group_by(.workflowName) | map(max_by(.createdAt))
        | .[].databaseId')"

if [[ -z "$failed_run_ids" ]]; then
  echo "orchestrator dispatched 'ci' but no failing run found on $slice_branch — surface and stop" >&2
  exit 1
fi

for run_id in $failed_run_ids; do
  printf '===== workflow run %s =====\n' "$run_id"
  gh run view "$run_id" --log-failed || true
  printf '\n'
done
