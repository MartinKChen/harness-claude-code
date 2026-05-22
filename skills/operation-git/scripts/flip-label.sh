#!/usr/bin/env bash
# Atomic label flip on an issue or PR. Touches ONLY the labels named —
# every other label is preserved. Used by every lock/unlock helper in
# the workflow-* skills.
#
# `gh issue edit` and `gh pr edit` share the same --add-label / --remove-label
# flags. The script auto-detects which subcommand to use by querying the
# issue/PR number.
#
# Usage:
#   flip-label.sh <issue-or-pr-#> [--remove <l>]... [--add <l>]...
set -euo pipefail

number=""
adds=()
removes=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --add) adds+=("$2"); shift 2 ;;
    --remove) removes+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *)
      if [[ -z "$number" ]]; then
        number="$1"; shift
      else
        echo "unexpected arg: $1" >&2; exit 1
      fi
      ;;
  esac
done

if [[ -z "$number" ]]; then
  echo "usage: $0 <issue-or-pr-#> [--remove <l>]... [--add <l>]..." >&2
  exit 1
fi

if [[ ${#adds[@]} -eq 0 && ${#removes[@]} -eq 0 ]]; then
  echo "nothing to do: pass at least one --add or --remove" >&2
  exit 1
fi

# Decide subcommand by type — PR if it's in the PR namespace, else issue.
# `gh pr view` exits non-zero for issues; `gh issue view` exits non-zero for PRs.
if gh pr view "$number" --json number >/dev/null 2>&1; then
  cmd=(gh pr edit "$number")
else
  cmd=(gh issue edit "$number")
fi

for l in "${removes[@]}"; do cmd+=(--remove-label "$l"); done
for l in "${adds[@]}";    do cmd+=(--add-label "$l"); done

"${cmd[@]}"
