#!/usr/bin/env bash
# Push the slice branch to remote, open a draft PR for it, and remove the
# `status:prepare-pr` lock label from the slice issue. Terminal success
# action for `prepare-slice-pr`.
#
# Idempotent on the PR side: if a PR already exists for the head branch
# (race with a sibling fire), the script still removes `status:prepare-pr`
# from the slice and exits 0 — the duplicate is benign.
#
# Usage:
#   push-create-pr-clear-prepare.sh <slice-#> <slice-branch> <title> <body-file> [--milestone <name>]
set -euo pipefail

slice_number=""
slice_branch=""
title=""
body_file=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,13p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$slice_number" ]]; then
        slice_number="$1"
      elif [[ -z "$slice_branch" ]]; then
        slice_branch="$1"
      elif [[ -z "$title" ]]; then
        title="$1"
      elif [[ -z "$body_file" ]]; then
        body_file="$1"
      else
        echo "unexpected arg: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$slice_number" || -z "$slice_branch" || -z "$title" || -z "$body_file" ]]; then
  echo "usage: $0 <slice-#> <slice-branch> <title> <body-file> [--milestone <name>]" >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

git push origin "$slice_branch"

create_args=(
  --draft
  --base main
  --head "$slice_branch"
  --title "$title"
  --body-file "$body_file"
)

if [[ -n "$milestone" ]]; then
  create_args+=(--milestone "$milestone")
fi

if ! gh pr create "${create_args[@]}" 2> >(tee /tmp/prepare-slice-pr.err >&2); then
  if grep -q "A pull request already exists" /tmp/prepare-slice-pr.err 2>/dev/null; then
    echo "PR already exists for ${slice_branch} (benign race); clearing the slice lock anyway." >&2
  else
    rm -f /tmp/prepare-slice-pr.err
    exit 1
  fi
fi
rm -f /tmp/prepare-slice-pr.err

gh issue edit "$slice_number" --remove-label "status:prepare-pr"
