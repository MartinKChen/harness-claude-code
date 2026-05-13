#!/usr/bin/env bash
# PostToolUse hook for Edit / Write / MultiEdit / NotebookEdit. Runs
# language-appropriate, file-scoped format/lint checks on the edited file and
# surfaces failures as additionalContext so the agent sees them immediately
# without waiting for the pre-push gate.
#
# Full project-wide test runs (pytest / jest) stay on the pre-push hook —
# this hook is meant to be edit-fast. But format, lint, AND type checks all
# fire here so a broken type stays a broken type for as little time as
# possible. The trade-off is that `mypy` and `tsc --noEmit` are
# project-scoped, not file-scoped, so each edit pays a small whole-project
# tax — worth it because the type error is visible immediately rather than
# at pre-push.
#
# Currently wired:
#   *.py             → ruff format --check  (format)
#                    → ruff check           (lint)
#                    → mypy                 (type — project-scoped)
#   *.ts / *.tsx     → biome check          (format + lint)
#                    → tsc --noEmit         (type — project-scoped)
#   *.js / *.jsx     → biome check          (format + lint)
#
# Only fires inside engineer worktrees (`/tmp/git-worktree/...`); silent
# everywhere else.

set -uo pipefail

note() { printf '[post-edit-checks] %s\n' "$*" >&2; }

emit() {
  local context="$1"
  jq -nc --arg context "$context" \
    '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $context } }'
}

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
case "$tool_name" in
  Edit|Write|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')"
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

# Only fire inside engineer worktrees.
case "$file_path" in
  /tmp/git-worktree/*) ;;
  *) exit 0 ;;
esac

ext="${file_path##*.}"
results=""

run_check() {
  local label="$1"; shift
  local out
  if out="$( "$@" 2>&1 )"; then
    : # silent pass — don't flood context on every successful edit
  else
    results+=$'\n['"${label}"'] FAIL\n'"${out}"$'\n'
  fi
}

case "$ext" in
  py)
    backend_dir="$(printf '%s' "$file_path" | sed -nE 's|^(.*/backend)/.*|\1|p')"
    if [ -n "$backend_dir" ]; then
      pushd "$backend_dir" >/dev/null
      run_check "ruff-format" uv run ruff format --check "$file_path"
      run_check "ruff-check"  uv run ruff check        "$file_path"
      run_check "mypy"        uv run mypy              "$file_path"
      popd >/dev/null
    fi
    ;;
  ts|tsx|js|jsx)
    frontend_dir="$(printf '%s' "$file_path" | sed -nE 's|^(.*/frontend)/.*|\1|p')"
    if [ -n "$frontend_dir" ]; then
      pushd "$frontend_dir" >/dev/null
      run_check "biome-check" npx --no-install biome check "$file_path"
      run_check "tsc-noemit"  npx --no-install tsc --noEmit
      popd >/dev/null
    fi
    ;;
  *)
    exit 0
    ;;
esac

if [ -n "$results" ]; then
  emit "post-edit checks on ${file_path}:${results}"
fi

exit 0
