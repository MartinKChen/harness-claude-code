#!/usr/bin/env bash
# Create-or-reuse a slice-scoped worktree at /tmp/git-worktree/<repo>/<slice-branch>
# and hard-reset it to origin/<slice-branch> so the worktree mirrors the remote.
# Optionally rebase onto origin/main (engineer/e2e flows use this; reviewer
# flows do NOT — review is read-only).
#
# Prints the worktree path on success. Non-zero exit on rebase conflict.
#
# Usage:
#   setup-worktree.sh <slice-branch> [--rebase-onto-main]
set -euo pipefail

rebase=false
slice_branch=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebase-onto-main) rebase=true; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$slice_branch" ]]; then
        slice_branch="$1"; shift
      else
        echo "unexpected arg: $1" >&2; exit 1
      fi
      ;;
  esac
done

if [[ -z "$slice_branch" ]]; then
  echo "usage: $0 <slice-branch> [--rebase-onto-main]" >&2
  exit 1
fi

repo_name="$(basename "$(git rev-parse --show-toplevel)")"
worktree_path="/tmp/git-worktree/${repo_name}/${slice_branch}"

git fetch origin "$slice_branch"
git fetch origin main

if [[ -d "$worktree_path" ]]; then
  git -C "$worktree_path" reset --hard "origin/${slice_branch}"
elif git show-ref --verify --quiet "refs/heads/${slice_branch}"; then
  git worktree add "$worktree_path" "$slice_branch"
  git -C "$worktree_path" reset --hard "origin/${slice_branch}"
else
  git worktree add "$worktree_path" "$slice_branch"
fi

if [[ "$rebase" == "true" ]]; then
  if ! git -C "$worktree_path" rebase origin/main; then
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    echo "rebase of ${slice_branch} onto origin/main conflicted — aborted" >&2
    exit 2
  fi
fi

printf '%s\n' "$worktree_path"
