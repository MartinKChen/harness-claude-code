#!/usr/bin/env bash
# Inspect a PR's status check rollup (the GitHub Actions checks + status
# contexts on the head SHA) and emit two facets:
#
#   { "running": <int>, "failing": [<names>] }
#
# `running` is the count of checks still in flight (not in a terminal state).
# `failing` is the de-duplicated list of names whose terminal conclusion is
# something other than SUCCESS / SKIPPED. An empty `failing` array with
# `running == 0` means the PR is green.
#
# Usage:
#   inspect-checks.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"

rollup_json="$(gh pr view "$pr_number" --json statusCheckRollup --jq '.statusCheckRollup')"

printf '%s' "$rollup_json" | jq '{
  running: ([.[]
    | select(
        (.__typename == "CheckRun"     and (.status      != "COMPLETED" or .conclusion == null)) or
        (.__typename == "StatusContext" and (.state == "PENDING" or .state == "EXPECTED"))
      )] | length),
  failing: ([.[]
    | select(
        (.__typename == "CheckRun"     and .conclusion != "SUCCESS" and .conclusion != "SKIPPED") or
        (.__typename == "StatusContext" and .state      != "SUCCESS")
      )
    | (.name // .context)] | unique)
}'
