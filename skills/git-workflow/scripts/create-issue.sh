#!/usr/bin/env bash
# Create a GitHub issue. Optionally link it as a blocker of an existing parent
# issue, and/or as a child of a parent PR (e.g. the PR that publishes the PRD
# this issue is sliced from).
#
# Issues are NOT auto-assigned. Use `gh issue edit <num> --add-assignee <user>`
# afterwards if you want one.
#
# Usage:
#   create-issue.sh <title> <body-file> \
#     [--label <label>] \
#     [--blocks <parent-issue-number>] \
#     [--parent-pr <pr-number>]
#
# Example (issue sliced from a PRD PR #17, blocking parent issue #42):
#   create-issue.sh "fix(api): 503 retries missing on user endpoint" body.md \
#     --label bug --blocks 42 --parent-pr 17
#
# Title format: see ../references/commit-messages.md.
set -euo pipefail

title=""
body_file=""
label=""
blocks=""
parent_pr=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --blocks) blocks="$2"; shift 2 ;;
    --parent-pr) parent_pr="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,18p' "$0"
      exit 0
      ;;
    *)
      if [[ -z "$title" ]]; then
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

if [[ -z "$title" || -z "$body_file" ]]; then
  echo "usage: $0 <title> <body-file> [--label <label>] [--blocks <parent-issue>] [--parent-pr <pr-number>]" >&2
  exit 1
fi

if [[ ! -f "$body_file" ]]; then
  echo "body file not found: $body_file" >&2
  exit 1
fi

create_args=(--title "$title" --body-file "$body_file")
if [[ -n "$label" ]]; then
  create_args+=(--label "$label")
fi

issue_url="$(gh issue create "${create_args[@]}")"
echo "created: $issue_url"
issue_num="${issue_url##*/}"

if [[ -n "$parent_pr" ]]; then
  gh issue comment "$issue_num" --body "Parent PR: #$parent_pr"
  gh pr comment "$parent_pr" --body "Tracks issue: #$issue_num"
  echo "linked #$issue_num to parent PR #$parent_pr"
fi

if [[ -n "$blocks" ]]; then
  gh issue comment "$blocks" --body "Tracking blocker: #$issue_num"
  echo "linked #$issue_num as a blocker on #$blocks"
fi
