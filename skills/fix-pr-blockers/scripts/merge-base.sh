#!/usr/bin/env bash
# Fetch the PR's base branch and merge it into the current branch with a
# standard recursive --no-ff merge. Caller is expected to be inside the
# slice's worktree.
#
# Exits non-zero (and aborts the merge) if conflicts surface — the caller
# must resolve hunks by reading both sides and producing the union, then
# commit, never blindly take one side. If the conflict cannot be resolved
# without scope expansion, the caller should `git merge --abort` and surface.
#
# Usage:
#   merge-base.sh <pr-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <pr-#>" >&2
  exit 1
fi

pr_number="$1"
base_branch="$(gh pr view "$pr_number" --json baseRefName -q .baseRefName)"

if [[ -z "$base_branch" ]]; then
  echo "PR #$pr_number has no baseRefName — surface and stop" >&2
  exit 1
fi

git fetch origin "$base_branch"
git merge --no-ff "origin/${base_branch}"
