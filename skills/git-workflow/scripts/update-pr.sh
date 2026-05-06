#!/usr/bin/env bash
# Pull remote PR-branch updates, rebase the current branch on origin/main, and
# push with --force-with-lease (never --force).
#
# Usage:
#   update-pr.sh
#
# Run this from the PR's branch after committing new work locally.
set -euo pipefail

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "main" ]]; then
  echo "refusing to run on main" >&2
  exit 1
fi

git fetch origin
git pull --rebase origin "$branch" || true
git rebase origin/main
git push --force-with-lease
