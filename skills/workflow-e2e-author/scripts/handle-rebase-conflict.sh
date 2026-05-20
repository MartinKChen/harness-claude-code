#!/usr/bin/env bash
# Handle the rebase-conflict path: discover the conflicting files in the
# worktree, abort the rebase, flip the task issue's status label from
# `status:in-progress` to `status:need-attention`, and post a diagnostic
# comment listing the conflicting paths. After this runs, the author run
# MUST stop — do not push, do not skip conflicts.
#
# Usage:
#   handle-rebase-conflict.sh <task-#> <slice-branch> <worktree-path>
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <task-#> <slice-branch> <worktree-path>" >&2
  exit 1
fi

task_number="$1"
slice_branch="$2"
worktree_path="$3"

conflicting_files="$(git -C "$worktree_path" diff --name-only --diff-filter=U | sort -u || true)"

git -C "$worktree_path" rebase --abort || true

gh issue edit "$task_number" \
  --remove-label "status:in-progress" \
  --add-label "status:need-attention"

gh issue comment "$task_number" --body "$(cat <<EOF
Rebase conflict while rebasing \`${slice_branch}\` onto \`origin/main\`. Conflicting paths:

${conflicting_files:-(none captured)}

Author run aborted; manual resolution required before retry.
EOF
)"
