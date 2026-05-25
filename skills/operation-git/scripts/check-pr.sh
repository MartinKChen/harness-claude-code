#!/usr/bin/env bash
# Pull the PR status the orchestrators key off — mergeability, check rollup,
# draft flag, labels, head ref, last-commit sha + authored date. One JSON
# object so the caller can `jq` it apart.
#
# Usage:
#   check-pr.sh <pr-#>
#
# Output keys: mergeable, checksStatus (SUCCESS|FAILED|PENDING|NONE),
# isDraft, labels (array), headRefName, lastCommitSha, lastCommitDate.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr="$1"

gh pr view "$pr" --json mergeable,isDraft,headRefName,labels,statusCheckRollup,commits | jq '
  def check_state:
    if (.statusCheckRollup // []) | length == 0 then "NONE"
    else
      ([.statusCheckRollup[] | (.conclusion // .status // "PENDING")] | unique) as $states
      | if ($states | any(. == "FAILURE" or . == "CANCELLED" or . == "TIMED_OUT")) then "FAILED"
        elif ($states | all(. == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED")) then "SUCCESS"
        else "PENDING"
        end
    end;

  {
    mergeable,
    checksStatus: (. | check_state),
    isDraft,
    headRefName,
    labels: [.labels[].name],
    lastCommitSha:  (.commits | last | .oid),
    lastCommitDate: (.commits | last | .authoredDate)
  }
'
