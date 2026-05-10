#!/usr/bin/env bash
# Pre-push gate for the `engineer` agent.
#
# Wired as a PreToolUse / Bash hook (see hooks/hooks.json). Fires on every Bash
# call but no-ops unless:
#   1. the command contains `git push`, AND
#   2. the cwd is an engineer worktree under `/tmp/git-worktree/`.
#
# When it fires, it determines mode + role and runs the matching checks:
#
#   Mode A — single-role engineer (issue dispatch).
#     Detected when there is no open PR for the slice branch.
#     Role from the most recent `Refs #<n>` trailer's `type:*` label:
#       type:backend  → backend  → backend checks only
#       type:frontend → frontend → frontend checks only
#
#   Mode B — fullstack engineer (PR dispatch).
#     Detected when there is an open PR for the slice branch.
#     Runs both backend AND frontend checks.
#
# Checks (matching skills/tdd-workflow/references/{python,frontend}-patterns.md):
#   backend:  uv run ruff check . / uv run mypy . / uv run bandit -r . / uv run pytest
#   frontend: biome check . / tsc --noEmit / npm audit --audit-level=high / jest
#
# When checks fail, the hook emits a PreToolUse JSON deny on stdout — the
# `permissionDecisionReason` field is surfaced back to Claude (the engineer
# agent), so it can read the failure summary, fix the underlying issue, and
# retry the push.

set -uo pipefail

note() { printf '[engineer-pre-push] %s\n' "$*" >&2; }

deny() {
  # Emit a PreToolUse permission decision so Claude sees the reason.
  # See https://code.claude.com/docs/en/hooks.md (PreToolUse → hookSpecificOutput).
  local reason="$1"
  local context="${2:-}"
  jq -nc \
    --arg reason "$reason" \
    --arg context "$context" \
    '{
      hookSpecificOutput: (
        {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: $reason
        }
        + (if $context == "" then {} else {additionalContext: $context} end)
      )
    }'
  exit 0
}

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"

# Only intercept Bash + git push.
[ "$tool_name" = "Bash" ] || exit 0
case "$command" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

# Only fire inside an engineer-managed worktree. Outside that path, this is a
# user-driven push and we let it through untouched.
case "$cwd" in
  /tmp/git-worktree/*) ;;
  *) exit 0 ;;
esac

if ! git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  note "cwd '$cwd' is not a git worktree; skipping checks"
  exit 0
fi

slice_branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
if [ -z "${slice_branch}" ] || [ "${slice_branch}" = "HEAD" ]; then
  deny "engineer-pre-push: could not resolve slice branch in '$cwd' (detached HEAD?)"
fi

# --- mode + role detection ---------------------------------------------------

run_backend=false
run_frontend=false
mode_label=""

pr_number="$(gh pr list --head "$slice_branch" --state open --json number --jq '.[0].number // empty' 2>/dev/null || true)"

if [ -n "${pr_number}" ]; then
  mode_label="Mode B (PR #${pr_number}, fullstack)"
  run_backend=true
  run_frontend=true
else
  issue_number="$(git -C "$cwd" log -50 --format='%B' \
    | grep -oE 'Refs #[0-9]+' \
    | head -1 \
    | grep -oE '[0-9]+' || true)"

  if [ -z "${issue_number}" ]; then
    deny "engineer-pre-push: Mode A but no 'Refs #<n>' trailer in last 50 commits — cannot determine role" \
         "The engineer agent must include 'Refs #<sub-issue-#>' in every Mode A commit (see agents/engineer.md, Mode A step 6). Add the trailer, amend or recommit, then retry the push."
  fi

  type_label="$(gh issue view "${issue_number}" --json labels --jq '.labels[].name | select(startswith("type:"))' 2>/dev/null | head -1 || true)"

  case "${type_label}" in
    type:backend)
      mode_label="Mode A (issue #${issue_number}, backend)"
      run_backend=true
      ;;
    type:frontend)
      mode_label="Mode A (issue #${issue_number}, frontend)"
      run_frontend=true
      ;;
    "")
      deny "engineer-pre-push: issue #${issue_number} has no 'type:*' label — cannot determine role"
      ;;
    *)
      deny "engineer-pre-push: issue #${issue_number} has unrecognized type label '${type_label}' (expected 'type:backend' or 'type:frontend')"
      ;;
  esac
fi

note "${mode_label} — running pre-push checks for branch '${slice_branch}'"

# --- per-stack runners -------------------------------------------------------

failures=()
fail_logs=""

run_step() {
  local label="$1"
  shift
  note "  → ${label}: $*"
  local out
  if ! out="$( "$@" 2>&1 )"; then
    failures+=("${label}")
    note "    ✗ ${label} FAILED"
    fail_logs+=$'\n--- '"${label}"$' ---\n'"${out}"$'\n'
  fi
}

run_backend_checks() {
  local backend_dir="$cwd/backend"
  if [ ! -d "${backend_dir}" ]; then
    note "backend/ not found under '$cwd' — skipping backend checks"
    return
  fi
  pushd "${backend_dir}" >/dev/null

  run_step "backend:lint"     uv run ruff check .
  run_step "backend:format"   uv run black --check .
  run_step "backend:type"     uv run mypy .
  run_step "backend:security" uv run bandit -r .
  run_step "backend:test"     uv run pytest

  popd >/dev/null
}

run_frontend_checks() {
  local frontend_dir="$cwd/frontend"
  if [ ! -d "${frontend_dir}" ]; then
    note "frontend/ not found under '$cwd' — skipping frontend checks"
    return
  fi
  pushd "${frontend_dir}" >/dev/null

  run_step "frontend:lint"     npx --no-install biome check .
  run_step "frontend:type"     npx --no-install tsc --noEmit
  run_step "frontend:security" npm audit
  run_step "frontend:test"     npx --no-install jest

  popd >/dev/null
}

if $run_backend; then
  run_backend_checks
fi
if $run_frontend; then
  run_frontend_checks
fi

# --- verdict -----------------------------------------------------------------

if [ "${#failures[@]}" -gt 0 ]; then
  reason="engineer-pre-push: blocking git push for ${slice_branch} — ${#failures[@]} check(s) failed: ${failures[*]}"
  context="Mode: ${mode_label}. Failed checks: ${failures[*]}. Fix every failure before pushing again — re-run the failing command(s) locally to see full output, commit the fix, then retry the push.${fail_logs}"
  deny "$reason" "$context"
fi

note "all pre-push checks passed — allowing git push"
exit 0
