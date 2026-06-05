#!/usr/bin/env bash
# Create a draft PR from a slice branch against main. Prints the new PR
# number. If a PR already exists for the branch, prints that PR's number
# instead (idempotent re-run).
#
# Body is read from a file (see templates/pr-body.md for the skeleton).
# Labels can be added at creation time (--label); a milestone can be
# attached with --milestone (name or number).
#
# Usage:
#   create-draft-pr.sh <slice-branch> <title> <body-file> [--label <l>]... [--milestone <m>]
set -euo pipefail

slice_branch=""
title=""
body_file=""
labels=()
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) labels+=("$2"); shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if   [[ -z "$slice_branch" ]]; then slice_branch="$1"
      elif [[ -z "$title" ]];        then title="$1"
      elif [[ -z "$body_file" ]];    then body_file="$1"
      else echo "unexpected arg: $1" >&2; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$slice_branch" || -z "$title" || -z "$body_file" ]]; then
  echo "usage: $0 <slice-branch> <title> <body-file> [--label <l>]... [--milestone <m>]" >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

# Idempotent: if a PR is already open on this branch, print its number and exit 0.
existing="$(gh pr list --head "$slice_branch" --state open --json number --jq '.[0].number // empty')"
if [[ -n "$existing" ]]; then
  printf '%s\n' "$existing"
  exit 0
fi

args=(--base main --head "$slice_branch" --title "$title" --body-file "$body_file" --draft)
for l in ${labels[@]+"${labels[@]}"}; do args+=(--label "$l"); done
[[ -n "$milestone" ]] && args+=(--milestone "$milestone")

gh pr create "${args[@]}" >/dev/null

gh pr list --head "$slice_branch" --state open --json number --jq '.[0].number'
