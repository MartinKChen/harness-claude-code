#!/usr/bin/env bash
# Prepare a repo to follow the Automated Engineer Flow by creating the labels
# that the loops, agents, and skills key off (status lifecycle, hierarchy, kind,
# task type, review-gate state, plus the lock-in / amendment PR markers).
#
# Idempotent: uses `gh label create --force` so re-running updates the color of
# any existing label with the same name instead of erroring.
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
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unexpected arg: $1" >&2; exit 1 ;;
  esac
done

create() {
  local name="$1" color="$2"
  gh label create "$name" -c "$color" --force "${repo_args[@]}" >/dev/null
  echo "  ✓ $name"
}

echo "status:"
create "status:ready-to-review"     FBCA04
create "status:ready-to-implement"  0E8A16
create "status:in-progress"         1D76DB
create "status:fix-in-progress"     5319E7
create "status:prepare-pr"          B60205
create "status:need-attention"      D93F0B

echo "level:"
create "level:slice"                24292E
create "level:task"                 959DA5

echo "kind:"
create "kind:feature"               0075CA
create "kind:bug"                   D73A4A
create "kind:enhancement"           A2EEEF

echo "type:"
create "type:e2e"                   BFD4F2
create "type:backend"               F9D0C4
create "type:frontend"              D4C5F9

echo "review gates:"
for gate in security code; do
  create "review:${gate}-pending"   FEF2C0
  create "review:${gate}-running"   1D76DB
  create "review:${gate}-passed"    0E8A16
  create "review:${gate}-need-fix"  D73A4A
done

echo "PR markers:"
create "feature-lockin"             000000

echo
echo "done."
