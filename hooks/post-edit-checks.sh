#!/usr/bin/env bash
# PostToolUse hook for Edit / Write / MultiEdit / NotebookEdit. Runs
# language-appropriate auto-fixers on the edited file so trivial format/lint
# issues are corrected in place without round-tripping through the agent.
#
# Diagnostic-only checks (mypy, tsc --noEmit, ruff/biome in check-only mode)
# stay on the pre-push gate — this hook only runs commands that can mutate
# the file to a passing state.
#
# Currently wired:
#   *.py             → ruff format           (auto-format)
#   *.ts / *.tsx     → biome format --write  (auto-format)
#   *.js / *.jsx     → biome format --write  (auto-format)
#
# Lint auto-fixers (`ruff check --fix`, `biome check --write`,
# `biome lint --write`) are intentionally NOT wired here: their
# unused-import / unused-variable rules race with multi-step edits where the
# agent adds an import first and the code that uses it second — the fixer
# strips the import between the two Edit calls, and the agent loops or gives
# up. Lint auto-fixes belong on the pre-push gate, not the per-edit hook.
#
# Only fires inside engineer worktrees (`/tmp/git-worktree/...`); silent
# everywhere else.

set -uo pipefail

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

run_fix() { "$@" >/dev/null 2>&1 || true; }

case "$ext" in
  py)
    backend_dir="$(printf '%s' "$file_path" | sed -nE 's|^(.*/backend)/.*|\1|p')"
    if [ -n "$backend_dir" ]; then
      pushd "$backend_dir" >/dev/null
      run_fix uv run ruff format "$file_path"
      popd >/dev/null
    fi
    ;;
  ts|tsx|js|jsx)
    frontend_dir="$(printf '%s' "$file_path" | sed -nE 's|^(.*/frontend)/.*|\1|p')"
    if [ -n "$frontend_dir" ]; then
      pushd "$frontend_dir" >/dev/null
      run_fix npx --no-install biome format --write "$file_path"
      popd >/dev/null
    fi
    ;;
esac

exit 0
