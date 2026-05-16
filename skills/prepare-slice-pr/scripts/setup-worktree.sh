#!/usr/bin/env bash
# Create-or-reuse the slice-branch worktree at
# `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to the latest
# `origin/<slice-branch>`. Prints the worktree path on stdout.
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

git fetch origin "$slice_branch" >&2

if [[ -d "$worktree_path/.git" ]] || git worktree list --porcelain | grep -q "worktree ${worktree_path}$"; then
  git -C "$worktree_path" reset --hard "origin/${slice_branch}" >&2
else
  mkdir -p "$(dirname "$worktree_path")"
  git worktree add --force "$worktree_path" "origin/${slice_branch}" >&2
  git -C "$worktree_path" checkout -B "$slice_branch" "origin/${slice_branch}" >&2
fi

printf '%s\n' "$worktree_path"
