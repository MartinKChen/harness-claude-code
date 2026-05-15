#!/usr/bin/env bash
# Promote a draft PR to ready-for-review, then squash-merge it and delete the
# head branch on the remote. Never `--force`, never push directly to base,
# never override branch protection.
#
# Usage:
#   merge-pr.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"

gh pr ready "$pr_number"
gh pr merge "$pr_number" --squash --delete-branch
