#!/usr/bin/env bash
# Prepare a repo to follow the Automated Engineer Flow by creating the labels
# the lifecycle keys off, and DELETING the labels the per-slice-Workflow redesign
# retired. The inner slice cycle (author E2E → coverage gate → implement → pass
# E2E → review → fix → PR) now runs entirely inside one background `implement-slice`
# Workflow per slice; GitHub keeps only durable, human-relevant state. So the
# surviving label families are small:
#
#   status:ready-to-review     — create-feature-issues sets this; the human design-approval gate
#   status:ready-to-implement  — human flips ready-to-review → this to release the slice
#   status:in-progress         — REPURPOSED: the slice lock ("a workflow is running"). Name
#                                kept to limit churn; it is no longer a per-task state.
#   status:need-attention      — the durable, human-owned halt (the only path to a human)
#   status:fix-in-progress     — the fix-PR lock owned by the outer /loop's fix-pr stage
#   kind:* / merge:* / feature-lockin — unchanged
#
# Everything the inner cycle used to round-trip through labels (per-task typing,
# the review:* gate family, the e2e:* markers, level:slice/level:task) is now
# in-memory workflow phase state or lives in the slice body's task checklist, so
# those labels are DELETED here to keep the repo's label set honest.
#
# Idempotent: `gh label create --force` updates an existing label's color instead
# of erroring; `gh label delete --yes` on a missing label is treated as benign.
#
# Usage:
#   init-flow-labels.sh [--repo <owner>/<name>]
#
# Examples:
#   init-flow-labels.sh                       # current repo (gh's default)
#   init-flow-labels.sh --repo acme/widgets   # explicit target
set -euo pipefail

repo_args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo_args=(--repo "$2"); shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

create() {
  local name="$1" color="$2"
  gh label create "$name" -c "$color" --force ${repo_args[@]+"${repo_args[@]}"} >/dev/null
  echo "  ✓ $name"
}

# Delete a retired label. A 404 (already gone / never existed) is benign.
remove() {
  local name="$1"
  if gh label delete "$name" --yes ${repo_args[@]+"${repo_args[@]}"} >/dev/null 2>&1; then
    echo "  ✗ $name (deleted)"
  else
    echo "  · $name (absent)"
  fi
}

echo "status:"
create "status:ready-to-review"     FBCA04
create "status:ready-to-implement"  0E8A16
create "status:in-progress"         1D76DB
create "status:fix-in-progress"     5319E7
create "status:need-attention"      D93F0B

echo "kind:"
create "kind:feature"               0075CA
create "kind:bug"                   D73A4A
create "kind:enhancement"           A2EEEF
create "kind:refactor"              D4C5F9

echo "merge:"
create "merge:auto"                 0E8A16
create "merge:manual"               FBCA04

echo "PR markers:"
create "feature-lockin"             000000

echo "retired by the per-slice-Workflow redesign:"
remove "level:slice"
remove "level:task"
remove "type:e2e"
remove "type:backend"
remove "type:frontend"
remove "review:pending"
remove "review:running"
remove "review:passed"
remove "review:need-fix"
remove "e2e:running"
remove "e2e:validated"

echo
echo "done."
