#!/usr/bin/env bash
# Create-or-reuse a slice-scoped worktree at
# /tmp/harness-claude-code/<repo>/worktrees/<slice-branch> and hard-reset it
# to origin/<slice-branch> so the worktree ALWAYS mirrors the remote on entry.
# Optionally rebase onto origin/main (engineer/e2e flows use this; reviewer
# flows do NOT — review is read-only).
#
# The hard-reset to origin/<slice-branch> runs on every invocation regardless
# of whether the worktree was created fresh or reused — agents must enter on
# the latest branch tip, never on a stale local snapshot.
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
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
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
worktree_path="/tmp/harness-claude-code/${repo_name}/worktrees/${slice_branch}"

# Always fetch the slice branch + main before touching the worktree so the
# subsequent reset has the latest origin ref to point at.
git fetch origin "$slice_branch"
git fetch origin main

# Create the worktree if it doesn't exist yet. Three sub-cases:
#   (a) reuse existing worktree     — no add, we'll reset below
#   (b) local branch ref exists     — `git worktree add <path> <branch>`
#   (c) only remote branch exists   — `git worktree add -b <branch> <path> origin/<branch>`
#       (explicit -b avoids the ambiguous-branch behavior change in old gits)
if [[ ! -d "$worktree_path" ]]; then
  if git show-ref --verify --quiet "refs/heads/${slice_branch}"; then
    git worktree add "$worktree_path" "$slice_branch"
  else
    git worktree add -b "$slice_branch" "$worktree_path" "origin/${slice_branch}"
  fi
fi

# Always hard-reset to origin/<slice-branch>. This is what guarantees the
# agent enters on the latest tip — every branch above either just created
# the worktree at HEAD-of-local-ref (possibly stale) or reused an old
# worktree carrying obsolete state. One reset on the merged path handles
# both cases without per-branch repetition.
git -C "$worktree_path" reset --hard "origin/${slice_branch}"

if [[ "$rebase" == "true" ]]; then
  if ! git -C "$worktree_path" rebase origin/main; then
    git -C "$worktree_path" rebase --abort 2>/dev/null || true
    echo "rebase of ${slice_branch} onto origin/main conflicted — aborted" >&2
    exit 2
  fi
fi

printf '%s\n' "$worktree_path"
