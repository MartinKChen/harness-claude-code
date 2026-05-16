#!/usr/bin/env bash
# Fetch the latest `origin/main` and rebase the current branch onto it.
# Caller is expected to be inside the slice's worktree.
#
# Exits 0 when the rebase completes cleanly (no conflicts surfaced).
#
# Exits non-zero and leaves the working tree mid-rebase when conflicts surface
# — the caller must resolve hunks by reading both sides and producing the
# union, then `git add <path>` each resolved file and `git rebase --continue`
# until the rebase completes. If the conflict cannot be resolved without scope
# expansion, the caller should `git rebase --abort` and bail via
# `mark-slice-need-attention.sh`.
#
# Usage:
#   rebase-onto-main.sh
set -euo pipefail

git fetch origin main
git rebase origin/main
