#!/usr/bin/env bash
# Create-or-reuse a slice-scoped worktree at /tmp/git-worktree/<repo>/<slice-branch>
# and hard-reset it to origin/<slice-branch> so the worktree mirrors the remote.
# Prints the worktree path on success.
#
# Engineer modes (implement / fix-pr / fix-task) do NOT rebase the slice onto
# main — rebasing on every dispatch would create a merge maelstrom for sibling
# slices. The slice is kept up to date with main by the slice's own conflict
# handling in `fix-pr-blockers` when CI / mergeability says so.
#
# Usage:
#   setup-worktree.sh <slice-branch>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-branch>" >&2
  exit 1
fi

slice_branch="$1"
repo_name="$(basename "$(git rev-parse --show-toplevel)")"
worktree_path="/tmp/git-worktree/${repo_name}/${slice_branch}"

if [[ -d "$worktree_path" ]]; then
  git -C "$worktree_path" fetch origin "$slice_branch"
  git -C "$worktree_path" reset --hard "origin/${slice_branch}"
elif git show-ref --verify --quiet "refs/heads/${slice_branch}"; then
  git fetch origin "${slice_branch}:${slice_branch}"
  git worktree add "$worktree_path" "$slice_branch"
else
  git fetch origin "$slice_branch"
  git worktree add "$worktree_path" "$slice_branch"
fi

printf '%s\n' "$worktree_path"
