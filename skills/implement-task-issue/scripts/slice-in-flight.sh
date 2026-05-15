#!/usr/bin/env bash
# Print the count of sibling tasks on this task's parent slice that are
# currently being EDITED by a dispatched sub-agent (status:in-progress AND
# no review:* label of any kind). When that count is > 0, the slice's
# worktree is in active use — dispatching another agent into the same slice
# would race on the same /tmp/git-worktree/.../<slice-branch> directory.
#
# The predicate "status:in-progress AND no review:*" cleanly identifies the
# active-editing window because:
#   - Engineer / e2e-author / fix-agent's TERMINAL action is to add
#     `review:*-pending`. Before that terminal action lands, no review label
#     is present.
#   - fix-task-issue's lock strips every `review:{code,security}-*` label
#     before dispatching a fix-agent, so during a fix run the task is also
#     in the "in-progress + no review label" state — correctly counted as
#     in-flight.
#   - Tasks awaiting review (status:in-progress + review:code-pending)
#     do NOT count: the agent has exited, the worktree is idle, and the
#     reviewer is read-only.
#
# Self is excluded — the caller is asking "are any of my siblings active?",
# not "am I active?".
#
# Usage:
#   slice-in-flight.sh <task-#>
#
# Output: a single integer (0 = slice idle, >0 = slice locked by N siblings).
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <task-#>" >&2
  exit 1
fi

task_number="$1"
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

gh api graphql \
  -F number="$task_number" -F owner="$owner" -F repo="$repo" \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          parent {
            subIssues(first: 100) {
              nodes {
                number
                state
                labels(first: 30) { nodes { name } }
              }
            }
          }
        }
      }
    }
  ' --jq '
    [
      .data.repository.issue.parent.subIssues.nodes[]
      | select(.state == "OPEN")
      | select(.number != '"$task_number"')
      | (.labels.nodes | map(.name)) as $labels
      | select(any($labels[]; . == "status:in-progress"))
      | select(any($labels[]; startswith("review:")) | not)
    ] | length
  '
