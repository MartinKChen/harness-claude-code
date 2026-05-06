#!/usr/bin/env bash
# Start a new branch in its own worktree off the latest origin/main.
#
# Usage:
#   start-feature.sh <branch-name>
#
# Example:
#   start-feature.sh feature/payment-integration
#
# See ../references/branch-naming.md for the branching prefix convention.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <branch-name>" >&2
  echo "  e.g., feature/payment-integration   (see references/branch-naming.md)" >&2
  exit 1
fi

branch="$1"
suffix="${branch##*/}"

repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
worktree_path="$(cd "$repo_root/.." && pwd)/${repo_name}-${suffix}"

git -C "$repo_root" fetch origin
git -C "$repo_root" worktree add "$worktree_path" -b "$branch" origin/main

echo
echo "worktree ready: $worktree_path"
echo "next: cd \"$worktree_path\""
