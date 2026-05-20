#!/usr/bin/env bash
# Print the PR number of any existing PR (any state — draft, ready, merged,
# closed) on a branch. Empty output means no PR exists for the branch.
#
# Usage:
#   find-existing-pr.sh <head-branch>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <head-branch>" >&2
  exit 1
fi

gh pr list --head "$1" --state all --json number,state \
  --jq '.[0].number // empty'
