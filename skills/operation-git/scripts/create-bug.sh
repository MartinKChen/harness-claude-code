#!/usr/bin/env bash
# create-bug.sh
#
# Create one `kind:bug` GitHub issue from a Zone-A (symptom) body file — the bug
# sibling of create-enhancement.sh. Deterministic gh mechanics only; the
# create-bug-issue skill authors the body.
#
# Unlike create-enhancement.sh, a bug:
#   - gets NO `status:*` label. A freshly-filed bug carries `kind:bug` and nothing
#     else, which is exactly the analyze-eligible set the /ship analyze stage keys
#     off (kind:bug + no status). The analyze engineer applies the first status.
#   - gets NO linked branch. The fix branch (fix/<n>-…) is created by fix-bug.mjs
#     Prep AFTER a human approves the analysis — the analyze step is read-only, so
#     creating a branch up front would be premature.
#
# Prints one line on success:
#   issue:<number>
#
# Usage:
#   create-bug.sh --title <title> --body-file <path> [--milestone <name>]
set -euo pipefail

title=""
body_file=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --body-file) body_file="$2"; shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "create-bug: unexpected arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$title" || -z "$body_file" ]]; then
  echo "create-bug: --title and --body-file are required" >&2
  exit 1
fi
if [[ ! -f "$body_file" ]]; then
  echo "create-bug: body file not found: $body_file" >&2
  exit 1
fi

create_args=(
  --title "$title"
  --body-file "$body_file"
  --label "kind:bug"
)
[[ -n "$milestone" ]] && create_args+=(--milestone "$milestone")

issue_url="$(gh issue create "${create_args[@]}")"
number="${issue_url##*/}"
if [[ ! "$number" =~ ^[0-9]+$ ]]; then
  echo "create-bug: could not parse issue number from: $issue_url" >&2
  exit 1
fi

printf 'issue:%s\n' "$number"
