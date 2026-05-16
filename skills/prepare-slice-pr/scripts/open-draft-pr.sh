#!/usr/bin/env bash
# Open a draft PR against `main` for the given head branch, with a body read
# from a file and an optional milestone. Prints the new PR URL on success.
#
# Usage:
#   open-draft-pr.sh <head-branch> <title> <body-file> [--milestone <name>]
set -euo pipefail

head_branch=""
title=""
body_file=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$head_branch" ]]; then
        head_branch="$1"
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

if [[ -z "$head_branch" || -z "$title" || -z "$body_file" ]]; then
  echo "usage: $0 <head-branch> <title> <body-file> [--milestone <name>]" >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

args=(
  --draft
  --base main
  --head "$head_branch"
  --title "$title"
  --body-file "$body_file"
)

if [[ -n "$milestone" ]]; then
  args+=(--milestone "$milestone")
fi

gh pr create "${args[@]}"
