#!/usr/bin/env bash
# Print the ISO-8601 committer timestamp of the most recent commit on the
# remote slice branch. Used as the cutoff for filtering reviewer comments —
# only comments created strictly after this timestamp belong to the current
# review round; earlier comments are previous rounds whose findings are
# already addressed in `git log`.
#
# Exits non-zero on a missing branch / missing timestamp.
#
# Usage:
#   last-commit-iso.sh <slice-branch>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <slice-branch>" >&2
  exit 1
fi

slice_branch="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

last_commit_iso="$(gh api "repos/${owner}/${repo}/branches/${slice_branch}" \
  --jq '.commit.commit.committer.date')"

if [[ -z "$last_commit_iso" || "$last_commit_iso" == "null" ]]; then
  echo "could not read last-commit timestamp on ${slice_branch} — surface and stop" >&2
  exit 1
fi

printf '%s\n' "$last_commit_iso"
