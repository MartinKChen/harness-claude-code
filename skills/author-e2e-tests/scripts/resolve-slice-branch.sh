#!/usr/bin/env bash
# Resolve the parent slice issue from a task issue, then print the slice
# branch attached to that parent. The slice branch is attached to the parent
# slice issue (set by `create-issues`), not to the task sub-issue.
#
# Exits non-zero with a diagnostic on stderr if the task has no parent slice
# issue or the parent has no linked branch.
#
# Usage:
#   resolve-slice-branch.sh <task-#>
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

parent_number="$(gh api graphql \
  -f owner="$owner" -f repo="$repo" -F number="$task_number" \
  -f query='query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){issue(number:$number){parent{number}}}}' \
  --jq '.data.repository.issue.parent.number')"

if [[ -z "$parent_number" || "$parent_number" == "null" ]]; then
  echo "task issue #$task_number has no parent slice issue — surface and stop" >&2
  exit 1
fi

slice_branch="$(gh issue develop --list "$parent_number" | head -1 | awk '{print $1}')"

if [[ -z "$slice_branch" ]]; then
  echo "parent slice issue #$parent_number has no linked branch yet — surface and stop" >&2
  exit 1
fi

printf '%s\n' "$slice_branch"
