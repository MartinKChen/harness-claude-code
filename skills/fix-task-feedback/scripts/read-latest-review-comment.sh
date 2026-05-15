#!/usr/bin/env bash
# Print the body of the most recent reviewer comment on the task whose body
# starts with the matching header (`# Code Review` for the `code` gate,
# `# Security Review` for the `security` gate) AND whose createdAt is strictly
# after the given cutoff timestamp.
#
# Comments at or before the cutoff are previous review rounds — the findings
# they raised are already addressed by commits on the slice branch, and
# re-reading them would re-do completed work.
#
# Exits non-zero with a diagnostic on stderr if no matching comment is found
# newer than the cutoff — the caller must surface "fix dispatched for gate
# `<gate>` but no review comment newer than the slice's last commit" and stop.
#
# Usage:
#   read-latest-review-comment.sh <task-#> <cutoff-iso> <gate>
#
#   <gate> ∈ {code, security}
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <task-#> <cutoff-iso> <gate (code|security)>" >&2
  exit 1
fi

task_number="$1"
cutoff="$2"
gate="$3"

case "$gate" in
  code)     header="# Code Review" ;;
  security) header="# Security Review" ;;
  *)
    echo "unknown gate '$gate' — must be 'code' or 'security'" >&2
    exit 1
    ;;
esac

body="$(gh issue view "$task_number" --json comments \
  --jq --arg cutoff "$cutoff" --arg header "$header" \
       '.comments
        | map(select(.createdAt > $cutoff))
        | reverse
        | map(select(.body | startswith($header)))
        | .[0].body // empty')"

if [[ -z "$body" ]]; then
  echo "no '$header' comment newer than $cutoff on task #$task_number — surface and stop" >&2
  exit 1
fi

printf '%s\n' "$body"
