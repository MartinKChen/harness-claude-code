#!/usr/bin/env bash
# PostToolUse hook for Bash + `git push`. After a successful push, briefly
# polls for the workflow runs triggered on the pushed branch and surfaces
# each one's current state (queued / running / completed-with-conclusion) as
# additionalContext, so the agent knows whether CI is in flight without
# having to manually `gh run list`.
#
# Informational only — never denies. Only fires inside engineer worktrees
# (`/tmp/git-worktree/...`); silent everywhere else. Gracefully no-ops when
# `gh` is not on PATH or no runs are wired.

set -uo pipefail

note() { printf '[post-push-ci-status] %s\n' "$*" >&2; }

emit() {
  local context="$1"
  jq -nc --arg context "$context" \
    '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $context } }'
}

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
command="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
exit_code="$(printf '%s' "$input" | jq -r '.tool_response.exit_code // .tool_output.exit_code // 0')"

[ "$tool_name" = "Bash" ] || exit 0
case "$command" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

# Skip if the push itself failed.
[ "$exit_code" -ne 0 ] && exit 0

case "$cwd" in
  /tmp/git-worktree/*) ;;
  *) exit 0 ;;
esac

if ! command -v gh >/dev/null 2>&1; then
  exit 0
fi

slice_branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ -z "$slice_branch" ] && exit 0

# Give GitHub a moment to register the push and queue any triggered workflows.
sleep 5

runs_json="$(gh run list --branch "$slice_branch" --limit 10 \
  --json databaseId,workflowName,status,conclusion,createdAt,event 2>/dev/null || echo '[]')"

count="$(printf '%s' "$runs_json" | jq 'length')"
if [ "$count" -eq 0 ]; then
  emit "post-push CI status for ${slice_branch}: no workflow runs found yet (workflows may not be wired up, or GitHub is still queueing)"
  exit 0
fi

summary="$(printf '%s' "$runs_json" | jq -r '
  group_by(.workflowName)
  | map(max_by(.createdAt))
  | map("  - " + .workflowName + ": " + .status + (if .conclusion then " (" + .conclusion + ")" else "" end))
  | join("\n")
')"

emit "post-push CI status for ${slice_branch}:
${summary}"

exit 0
