#!/usr/bin/env bash
# Runtime-telemetry bootstrap for engineer / reviewer agents.
#
# Invoked once by an engineer or reviewer agent at the top of its Execution
# Flow. Writes the per-session metadata file that the PreToolUse / PostToolUse
# / SubagentStop hooks key off of. Without this marker file, the hooks no-op —
# which is how telemetry stays limited to engineer + reviewer dispatches.
#
# Usage:
#   bash bootstrap.sh <agent_type> "<verbatim dispatch prompt>"
#
# Where <agent_type> is one of: engineer, reviewer.
#
# Opt-in: the consuming project must have created `.claude/memory/`. The
# bootstrap resolves the consuming project's main worktree (never a slice
# worktree) and writes under `<main-root>/.claude/memory/signals/runtime/`.
# If `.claude/memory/` does not exist, the bootstrap exits silently (opt-out).
#
# Correlation: keyed on $CLAUDE_SESSION_ID so the hook scripts (which receive
# session_id in their stdin payload) look up the same file. If
# $CLAUDE_SESSION_ID is empty the bootstrap exits without writing — telemetry
# requires a stable session id on both sides.

set -uo pipefail

note() { printf '[runtime-telemetry/bootstrap] %s\n' "$*" >&2; }

agent_type="${1:-}"
dispatch_prompt="${2:-}"

case "$agent_type" in
  engineer|reviewer) ;;
  *)
    note "agent_type must be 'engineer' or 'reviewer' (got '${agent_type}'); skipping"
    exit 0
    ;;
esac

if [ -z "${CLAUDE_SESSION_ID:-}" ]; then
  note "CLAUDE_SESSION_ID is empty; telemetry needs a stable session id — skipping"
  exit 0
fi

if ! command -v git >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
  note "git or jq not on PATH; skipping"
  exit 0
fi

main_root="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" 2>/dev/null)"
if [ -z "$main_root" ] || [ ! -d "$main_root" ]; then
  note "could not resolve main worktree root; skipping"
  exit 0
fi

memory_root="$main_root/.claude/memory"
if [ ! -d "$memory_root" ]; then
  # Opt-out: consuming project has not created the memory directory.
  exit 0
fi

runtime_dir="$memory_root/signals/runtime"
mkdir -p "$runtime_dir/.archive" 2>/dev/null || {
  note "could not create '$runtime_dir'; skipping"
  exit 0
}

meta_file="$runtime_dir/${CLAUDE_SESSION_ID}.meta.json"
events_file="$runtime_dir/${CLAUDE_SESSION_ID}.jsonl"

# A meta file for the same session id already exists. Two cases:
#   1. Re-invocation within the same session (shouldn't happen but defensive).
#   2. A previous session reused the same id (effectively impossible). Archive
#      it either way to keep the active file unambiguous.
if [ -f "$meta_file" ]; then
  prior_ts="$(jq -r '.started_at // "unknown"' "$meta_file" 2>/dev/null || echo unknown)"
  mv "$meta_file"   "$runtime_dir/.archive/${CLAUDE_SESSION_ID}-${prior_ts}.meta.json" 2>/dev/null || true
  [ -f "$events_file" ] && \
    mv "$events_file" "$runtime_dir/.archive/${CLAUDE_SESSION_ID}-${prior_ts}.jsonl" 2>/dev/null || true
fi

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -nc \
  --arg session_id      "$CLAUDE_SESSION_ID" \
  --arg agent_type      "$agent_type" \
  --arg agent_name      "harness-claude-code:${agent_type}" \
  --arg dispatch_prompt "$dispatch_prompt" \
  --arg started_at      "$started_at" \
  --arg transcript_path "${CLAUDE_TRANSCRIPT_PATH:-}" \
  --arg cwd             "$PWD" \
  '{
     session_id:      $session_id,
     agent_type:      $agent_type,
     agent_name:      $agent_name,
     dispatch_prompt: $dispatch_prompt,
     transcript_path: $transcript_path,
     cwd:             $cwd,
     started_at:      $started_at,
     ended_at:        null,
     duration_ms:     null,
     token_usage:     null,
     skills_invoked:  [],
     stop_reason:     null
   }' > "$meta_file" || {
    note "failed to write meta file '$meta_file'"
    exit 0
  }

# Touch the events file so hooks can append unconditionally.
: > "$events_file"

note "started telemetry session ${CLAUDE_SESSION_ID} for agent_type=${agent_type}"
exit 0
