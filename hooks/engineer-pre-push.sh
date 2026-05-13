#!/usr/bin/env bash
# Pre-push gate for the `engineer` agent.
#
# Wired as a PreToolUse / Bash hook (see hooks/hooks.json). Fires on every Bash
# call but no-ops unless:
#   1. the command contains `git push`, AND
#   2. the cwd is an engineer worktree under `/tmp/git-worktree/`.
#
# When it fires, it runs the **fullstack** check set — backend AND frontend —
# regardless of which mode (A/B/C) the engineer is in. The engineer is
# fullstack by spec: even a Mode A task that nominally touches one side may
# cross the boundary, and the hook is the last gate before the slice branch
# leaves the worktree. Each stack's checks are guarded on the directory
# actually existing in this worktree, so a backend-only or frontend-only
# project still runs cleanly.
#
# Checks (matching skills/tdd-workflow/references/{python,frontend}-patterns.md):
#   backend:   uv run ruff check . / uv run black --check . / uv run mypy . /
#              uv run bandit -r . / uv run pytest
#   frontend:  biome check . / tsc --noEmit / npm audit / jest
#   security:  gitleaks (secrets) / trivy fs (CVE + IaC) / semgrep (SAST)
#              — each scanner is skipped gracefully if not installed.
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

# Fullstack always — each stack's runner is internally gated on the matching
# directory existing under the worktree, so a backend-only or frontend-only
# project still runs cleanly.
note "running fullstack pre-push checks for branch '${slice_branch}'"

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
  run_step "frontend:format"   npx --no-install biome check .
  run_step "frontend:type"     npx --no-install tsc --noEmit
  run_step "frontend:security" npm audit
  run_step "frontend:test"     npx --no-install jest

  popd >/dev/null
}

run_security_scans() {
  # Cross-language static security scans. Each scanner runs only when its
  # binary is present on PATH — missing scanners are a silent skip, so the
  # repo can opt in by installing the tool without code changes here.

  if command -v gitleaks >/dev/null 2>&1; then
    run_step "security:gitleaks" gitleaks detect --source "$cwd" --no-banner --redact
  else
    note "security:gitleaks — binary not on PATH, skipping"
  fi

  if command -v trivy >/dev/null 2>&1; then
    run_step "security:trivy-fs" trivy fs \
      --severity HIGH,CRITICAL \
      --skip-dirs node_modules \
      --skip-dirs .venv \
      --skip-dirs .git \
      --exit-code 1 \
      "$cwd"
  else
    note "security:trivy-fs — binary not on PATH, skipping"
  fi

  if command -v semgrep >/dev/null 2>&1; then
    run_step "security:semgrep" semgrep scan \
      --config auto \
      --severity ERROR \
      --error \
      "$cwd"
  else
    note "security:semgrep — binary not on PATH, skipping"
  fi
}

run_backend_checks
run_frontend_checks
run_security_scans

# --- verdict -----------------------------------------------------------------

if [ "${#failures[@]}" -gt 0 ]; then
  reason="engineer-pre-push: blocking git push for ${slice_branch} — ${#failures[@]} check(s) failed: ${failures[*]}"
  context="Failed checks: ${failures[*]}. Fix every failure before pushing again — re-run the failing command(s) locally to see full output, commit the fix, then retry the push.${fail_logs}"
  deny "$reason" "$context"
fi

note "all pre-push checks passed — allowing git push"
exit 0
