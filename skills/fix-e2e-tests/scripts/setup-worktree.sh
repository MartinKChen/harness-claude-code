#!/usr/bin/env bash
# Create-or-reuse a slice-scoped worktree at /tmp/git-worktree/<repo>/<slice-branch>,
# fetch origin, and rebase the slice branch onto origin/main so the worktree is
# current. Prints the worktree path on success.
#
# On rebase conflict, this script aborts the rebase and exits non-zero — the
# caller must surface the diagnostic and stop the fix run.
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

git fetch origin "$slice_branch" main

if [[ -d "$worktree_path" ]]; then
  git -C "$worktree_path" checkout "$slice_branch"
elif git show-ref --verify --quiet "refs/heads/${slice_branch}"; then
  git worktree add "$worktree_path" "$slice_branch"
else
  git worktree add "$worktree_path" -b "$slice_branch" "origin/${slice_branch}"
fi

if ! git -C "$worktree_path" rebase origin/main; then
  git -C "$worktree_path" rebase --abort || true
  echo "rebase of ${slice_branch} onto origin/main hit a conflict — surface and stop" >&2
  exit 1
fi

printf '%s\n' "$worktree_path"
