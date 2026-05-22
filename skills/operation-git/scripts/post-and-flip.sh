#!/usr/bin/env bash
# Post a comment AND flip labels on a GitHub issue. Terminal action for
# reviewer-review-task / reviewer-review-slice — the comment carries the
# verdict and the label flip publishes that verdict to the orchestrator.
#
# Not strictly atomic (two API calls), but the comment is posted first so
# the verdict is visible even if the label flip fails.
#
# Usage:
#   post-and-flip.sh <issue-#> <body-file> [--remove <l>]... [--add <l>]...
set -euo pipefail

number=""
body_file=""
adds=()
removes=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --add) adds+=("$2"); shift 2 ;;
    --remove) removes+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$number" ]]; then number="$1"
      elif [[ -z "$body_file" ]]; then body_file="$1"
      else echo "unexpected arg: $1" >&2; exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$number" || -z "$body_file" ]]; then
  echo "usage: $0 <issue-#> <body-file> [--remove <l>]... [--add <l>]..." >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

here="$(dirname "$0")"
bash "$here/post-comment.sh" "$number" "$body_file"

flip_args=("$number")
for l in "${removes[@]}"; do flip_args+=(--remove "$l"); done
for l in "${adds[@]}";    do flip_args+=(--add "$l"); done
bash "$here/flip-label.sh" "${flip_args[@]}"
