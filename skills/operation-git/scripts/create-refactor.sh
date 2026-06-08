#!/usr/bin/env bash
# create-refactor.sh
#
# Create one `kind:refactor` issue from a refactor-shaped body file and link its
# development branch — the behavior-preserving sibling of create-enhancement.sh.
# A refactor issue is residual code-quality debt triaged out of a slice/bug review
# (one issue per review dimension): it carries a `## Tasks` checklist of
# backend/frontend tasks ONLY — NO `e2e` tasks and NO acceptance criteria — so when
# /ship routes it to implement-slice the Author-E2E / coverage-gate / Pass-E2E
# phases all no-op. Behavior preservation is the existing suite staying green (the
# engineer pre-push hook runs it); the only NEW tests are unit tests for any seam
# the refactor extracts. Deterministic gh mechanics only; the caller authors the
# body + intent.
#
# Steps:
#   1. Create the issue with labels kind:refactor + status:ready-to-review
#      (the human-review gate, identical to a create-enhancement slice).
#   2. Link a `refactor/<n>-<intent>` branch via `gh issue develop --base main`
#      (creates the branch off origin/main AND records the GitHub dev link — no
#      local checkout). implement-slice resolves it back via `gh issue develop --list`
#      (resolve-slice-branch.sh is branch-prefix-agnostic).
#   3. Optionally attach a milestone.
#
# The branch carries the `refactor/<n>-<intent>` shape the /ship reconcile stage
# parses and that implement-slice / create-draft-pr consume name-agnostically.
#
# Prints two lines on success:
#   issue:<number>
#   branch:refactor/<number>-<intent>
#
# Usage:
#   create-refactor.sh --title <title> --body-file <path> --intent <kebab-intent> [--milestone <name>]
set -euo pipefail

title=""
body_file=""
intent=""
milestone=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --body-file) body_file="$2"; shift 2 ;;
    --intent) intent="$2"; shift 2 ;;
    --milestone) milestone="$2"; shift 2 ;;
    -h|--help) sed -n '2,31p' "$0"; exit 0 ;;
    *) echo "create-refactor: unexpected arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$title" || -z "$body_file" || -z "$intent" ]]; then
  echo "create-refactor: --title, --body-file, and --intent are required" >&2
  exit 1
fi
if [[ ! -f "$body_file" ]]; then
  echo "create-refactor: body file not found: $body_file" >&2
  exit 1
fi
# Guard the intent shape so the branch name stays clean (kebab-case, no slashes).
if [[ ! "$intent" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "create-refactor: --intent must be kebab-case (got: $intent)" >&2
  exit 1
fi

create_args=(
  --title "$title"
  --body-file "$body_file"
  --label "kind:refactor"
  --label "status:ready-to-review"
)
[[ -n "$milestone" ]] && create_args+=(--milestone "$milestone")

# `gh issue create` prints the new issue URL on success; the number is its last path segment.
issue_url="$(gh issue create "${create_args[@]}")"
number="${issue_url##*/}"
if [[ ! "$number" =~ ^[0-9]+$ ]]; then
  echo "create-refactor: could not parse issue number from: $issue_url" >&2
  exit 1
fi

branch="refactor/${number}-${intent}"

# Link the development branch off main (idempotent-ish: a pre-existing linked
# branch for the issue is reported by gh and treated as benign).
if ! gh issue develop "$number" --base main --name "$branch" >/dev/null 2>/tmp/dev_err; then
  if grep -qi "already exists" /tmp/dev_err; then
    : # benign — a concurrent run linked it
  else
    cat /tmp/dev_err >&2
    rm -f /tmp/dev_err
    echo "create-refactor: issue #${number} created but branch link failed" >&2
    exit 1
  fi
fi
rm -f /tmp/dev_err

printf 'issue:%s\n' "$number"
printf 'branch:%s\n' "$branch"
