#!/usr/bin/env bash
# Create-or-reuse a slice-scoped worktree at
# /tmp/harness-claude-code/<repo>/worktrees/<slice-branch> and hard-reset it
# to origin/<slice-branch> so the worktree ALWAYS mirrors the remote on entry.
# Optionally integrate origin/main into the slice branch before handing it to
# the caller (the E2E-validation flow uses this; authoring/fixing and reviewer
# flows do NOT). One integration mode:
#   --merge-main        merges origin/main INTO the slice branch with an
#                       explicit merge commit. Push-safe (fast-forward append,
#                       no history rewrite, no force-push). On conflict it does
#                       NOT abort — it leaves the conflicted worktree in place
#                       so the caller can resolve, commit the merge, and push,
#                       then exits 3 to signal "resolution required".
#
# There is deliberately NO rebase-onto-main mode: rewriting a slice branch's
# history would require a force-push, violating the never-force-push iron rule.
# Integration is merge-only so every slice branch stays plain-push-safe.
#
# The hard-reset to origin/<slice-branch> runs on every invocation regardless
# of whether the worktree was created fresh or reused — agents must enter on
# the latest branch tip, never on a stale local snapshot.
#
# Prints the worktree path on stdout (always, including the merge-conflict
# case so the caller can cd in to resolve). Non-zero exit on merge conflict (3).
#
# Usage:
#   setup-worktree.sh <slice-branch> [--merge-main]
set -euo pipefail

merge_main=false
slice_branch=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --merge-main) merge_main=true; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
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
  echo "usage: $0 <slice-branch> [--merge-main]" >&2
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

if [[ "$merge_main" == "true" ]]; then
  # Push-safe integration: merge origin/main INTO the slice branch. No history
  # rewrite (so no force-push), honoring the never-force-push iron rule. On
  # conflict, leave the half-merged worktree in place — the caller resolves it,
  # commits the merge, and pushes — and exit 3 so the caller knows to do so.
  if ! git -C "$worktree_path" merge --no-edit origin/main; then
    printf '%s\n' "$worktree_path"
    echo "merge of origin/main into ${slice_branch} conflicted — resolve in the worktree above, 'git commit' the merge, then push" >&2
    exit 3
  fi
fi

printf '%s\n' "$worktree_path"
