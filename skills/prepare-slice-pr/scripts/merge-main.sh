#!/usr/bin/env bash
# Fetch the latest `origin/main` and merge it into the current slice branch.
# Caller is expected to be inside the slice's worktree.
#
# Exits 0 when the merge completes cleanly — fast-forward when the slice
# branch hasn't diverged from main, or a single merge commit when it has.
# `--no-ff` is intentionally NOT used; a fast-forward merge avoids a noise
# commit when nothing on main has diverged from the slice's base.
#
# Exits non-zero and leaves the working tree mid-merge when conflicts surface
# — the caller must resolve hunks by reading both sides and producing the
# union, then `git add <path>` each resolved file and `git commit --no-edit`
# (or `git commit` with a clarifying message) to finalize the merge. If the
# conflict cannot be resolved without scope expansion, the caller should
# `git merge --abort` and bail via `mark-slice-need-attention.sh`.
#
# Usage:
#   merge-main.sh
set -euo pipefail

git fetch origin main
git merge --no-edit origin/main
