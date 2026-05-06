#!/usr/bin/env bash
# Rebase the current branch on origin/main, push it, and open a PR with the
# standard PR-body template.
#
# Usage:
#   create-pr.sh <title> <body-file>
#
# Example:
#   create-pr.sh "feat(auth): add SSO support for enterprise users" pr-body.md
#
# Title format: see ../references/commit-messages.md (PR titles section).
# Body file:    start from ../templates/pr-body.md and fill in the sections.
set -euo pipefail

title="${1:-}"
body_file="${2:-}"

if [[ -z "$title" || -z "$body_file" ]]; then
  echo "usage: $0 <title> <body-file>" >&2
  echo "  title format: see references/commit-messages.md" >&2
  echo "  body-file:    fill from templates/pr-body.md before running" >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "main" ]]; then
  echo "refusing to open a PR from main" >&2
  exit 1
fi

git fetch origin
git rebase origin/main

# `gh pr create` auto-pushes the branch; no explicit `git push` needed.
gh pr create --base main --title "$title" --body-file "$body_file"
