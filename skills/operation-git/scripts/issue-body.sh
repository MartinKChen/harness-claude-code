#!/usr/bin/env bash
# Fetch a GitHub issue's spec fields WITHOUT the rendered comment chrome that
# bare `gh issue view <n>` injects. Auto-rendered comments + reactions +
# cross-references can balloon to multiple kilobytes of noise for any issue
# with discussion history, and most workflows only want the body + labels.
#
# Output is a single JSON document on stdout — workflows pipe it through `jq`
# to pull the fields they need.
#
# Default fields cover the spec: number, title, body, labels, milestone, url,
# state. Pass a comma-separated list as the second argument to override (see
# `gh issue view --help` for the full field list).
#
# Workflows that genuinely need comments (fix-task, fix-slice, fix-pr, where
# reviewer comments ARE the spec) should NOT use this helper — they should
# call `gh issue view <n> --comments` directly and filter comments newer than
# the last `Refs #<n>` commit.
#
# Usage:
#   issue-body.sh <issue-#>
#   issue-body.sh <issue-#> number,title,body,labels
#
# Examples:
#   issue-body.sh 142 | jq -r '.body'
#   issue-body.sh 142 | jq -r '.labels[].name'
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: $0 <issue-#> [fields-csv]" >&2
  exit 1
fi

number="$1"
fields="${2:-number,title,body,labels,milestone,url,state}"

gh issue view "$number" --json "$fields"
