#!/usr/bin/env bash
# Runtime-telemetry PostToolUse hook.
#
# Fires after every tool call. No-ops unless a telemetry session is active
# for the current session_id. Appends a `tool_result` row to the session's
# events file so downstream analysis can pair each `tool_use` (from
# pre-tool-use.sh) with its outcome:
#
#   {"ts": "...", "event": "tool_use",    "tool": "Bash", "input_summary": "...",     "session_id": "..."}
#   {"ts": "...", "event": "tool_result", "tool": "Bash", "success": true|false,        "session_id": "..."}
#
# Pairing is by sequence — a single agent's tool calls are serial, so the
# N-th `tool_result` corresponds to the N-th `tool_use`. We do not patch
# rows in place because JSONL is append-only by design.
#
# Always exits 0; telemetry must never block a tool call.

set -uo pipefail

input="$(cat)"

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

[ -n "$session_id" ] || exit 0
[ -n "$cwd" ] || exit 0

main_root="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$main_root" ] || exit 0
main_root="$(dirname "$main_root")"
[ -d "$main_root" ] || exit 0

memory_root="$main_root/.claude/memory"
[ -d "$memory_root" ] || exit 0

runtime_dir="$memory_root/signals/runtime"
meta_file="$runtime_dir/${session_id}.meta.json"
events_file="$runtime_dir/${session_id}.jsonl"

[ -f "$meta_file" ] || exit 0

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Success heuristic: PostToolUse payload exposes a `tool_response` object.
# A non-empty `error` field or an explicit `is_error: true` flag indicates
# failure. Anything else counts as success. We don't deep-inspect — the
# transcript holds the canonical result if downstream analysis needs more.
success="$(printf '%s' "$input" | jq -r '
  if (.tool_response.is_error == true)                  then "false"
  elif ((.tool_response.error // "" | length) > 0)      then "false"
  else "true" end
')"

jq -nc \
  --arg ts         "$ts" \
  --arg event      "tool_result" \
  --arg tool       "$tool_name" \
  --argjson success "$success" \
  --arg session_id "$session_id" \
  '{
     ts:         $ts,
     event:      $event,
     tool:       $tool,
     success:    $success,
     session_id: $session_id
   }' >> "$events_file" 2>/dev/null || true

exit 0
