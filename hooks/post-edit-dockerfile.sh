#!/usr/bin/env bash
# PostToolUse hook for Edit / Write / MultiEdit when the touched file is a
# Dockerfile (`Dockerfile` or `Dockerfile.*`). Attempts a `docker build`
# against the changed Dockerfile to verify the image still builds; surfaces
# success or the tail of the failure as additionalContext so the agent learns
# about a broken Dockerfile at edit time rather than at pre-push or worse.
#
# Only fires inside engineer worktrees (`/tmp/git-worktree/...`); silent
# everywhere else. Gracefully no-ops when `docker` is not on PATH.

set -uo pipefail

note() { printf '[post-edit-dockerfile] %s\n' "$*" >&2; }

emit() {
  local context="$1"
  jq -nc --arg context "$context" \
    '{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $context } }'
}

input="$(cat)"

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
case "$tool_name" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

file_path="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -z "$file_path" ] && exit 0
[ ! -f "$file_path" ] && exit 0

basename="$(basename "$file_path")"
case "$basename" in
  Dockerfile|Dockerfile.*) ;;
  *) exit 0 ;;
esac

case "$file_path" in
  /tmp/git-worktree/*) ;;
  *) exit 0 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  emit "post-edit-dockerfile: docker CLI not available; skipping build check for ${file_path}"
  exit 0
fi

context_dir="$(dirname "$file_path")"
slice_branch="$(git -C "$context_dir" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
slug="$(printf '%s' "${slice_branch:-edited}" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"
repo_root="$(git -C "$context_dir" rev-parse --show-toplevel 2>/dev/null || echo "$context_dir")"
repo_name="$(basename "$repo_root")"
image_tag="${repo_name}:${slug}-dockerfile-check"

note "building ${file_path} as ${image_tag}"
if out="$(docker build -f "$file_path" -t "$image_tag" "$context_dir" 2>&1)"; then
  emit "Dockerfile build OK: ${file_path} → ${image_tag}"
  docker rmi -f "$image_tag" >/dev/null 2>&1 || true
else
  failure="$(printf '%s' "$out" | tail -40)"
  emit "Dockerfile build FAILED: ${file_path}
${failure}"
fi

exit 0
