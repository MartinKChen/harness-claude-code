#!/usr/bin/env bash
# Poll a PR's mergeability until it settles to MERGEABLE or CONFLICTING, or
# until ~10s have passed. Prints the final mergeability string verbatim
# (MERGEABLE / CONFLICTING / UNKNOWN). UNKNOWN means the cap was hit — caller
# should treat as a benign skip.
#
# Usage:
#   wait-mergeability.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"
attempts=0
status="UNKNOWN"

until [[ "$status" == "MERGEABLE" || "$status" == "CONFLICTING" || "$attempts" -ge 5 ]]; do
  status="$(gh pr view "$pr_number" --json mergeable --jq '.mergeable')"
  if [[ "$status" == "UNKNOWN" ]]; then
    attempts=$((attempts + 1))
    sleep 2
  fi
done

printf '%s\n' "$status"
