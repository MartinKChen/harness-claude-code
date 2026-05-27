#!/usr/bin/env bash
# Runtime-telemetry bootstrap — SubagentStart hook for engineer / reviewer agents.
#
# Wired in hooks/hooks.json as a SubagentStart hook with matcher
# "engineer|reviewer". Fires automatically inside the subagent's context when an
# engineer or reviewer subagent starts, and seeds the per-dispatch metadata file
# that the PreToolUse / SubagentStop hooks key off of. Without this marker file,
# those hooks no-op — which is how telemetry stays limited to engineer + reviewer.
#
# Keyed on `agent_id`, NOT session_id: session_id is shared across the parent and
# all parallel subagents, so two engineer/reviewer dispatches running at once
# share a session_id but carry distinct agent_ids. Keying the file on agent_id is
# what keeps concurrent dispatches from colliding on one meta file.
#
# Always-on: writes under /tmp/claude-memory/<repo-slug>/signals/runtime/,
# creating the tree on first use. <repo-slug> is derived from the main worktree
# path so every slice worktree of the same project resolves to the same dir.
#
# Always exits 0 so it never blocks the subagent from starting.

set -uo pipefail

input="$(cat)"

command -v jq  >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
raw_type="$(printf '%s' "$input" | jq -r '.agent_type // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

[ -n "$agent_id" ] || exit 0
[ -n "$cwd" ] || exit 0

# Defensive type gate (in case the matcher is ever broadened): only engineer /
# reviewer dispatches emit telemetry. Normalize the (possibly namespaced, e.g.
# "harness-claude-code:engineer") agent type to a bare canonical value.
case "$raw_type" in
  *reviewer*) agent_type="reviewer" ;;
  *engineer*) agent_type="engineer" ;;
  *)          exit 0 ;;
esac

# Resolve the consuming project's main worktree from cwd, then the repo-slug.
main_root="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$main_root" ] || exit 0
main_root="$(dirname "$main_root")"
[ -d "$main_root" ] || exit 0

slug="$(basename "$main_root")-$(printf '%s' "$main_root" | { shasum -a 256 2>/dev/null || sha256sum; } | cut -c1-8)"
runtime_dir="/tmp/claude-memory/$slug/signals/runtime"
mkdir -p "$runtime_dir/.archive" 2>/dev/null || exit 0

meta_file="$runtime_dir/${agent_id}.meta.json"

# Defensive: a file for this agent_id should not already exist (agent_id is
# unique per dispatch). If it does (re-fire), archive it to keep things clean.
if [ -f "$meta_file" ]; then
  prior_ts="$(jq -r '.started_at // "unknown"' "$meta_file" 2>/dev/null || echo unknown)"
  mv "$meta_file" "$runtime_dir/.archive/${agent_id}-${prior_ts}.meta.json" 2>/dev/null || true
fi

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# dispatch_prompt is null here — SubagentStart's payload does not carry the
# subagent's initial prompt. subagent-stop.sh backfills it from the transcript.
jq -nc \
  --arg agent_id        "$agent_id" \
  --arg session_id      "$session_id" \
  --arg agent_type      "$agent_type" \
  --arg agent_name      "harness-claude-code:${agent_type}" \
  --arg started_at      "$started_at" \
  --arg transcript_path "$transcript_path" \
  --arg cwd             "$cwd" \
  '{
     agent_id:          $agent_id,
     session_id:        $session_id,
     agent_type:        $agent_type,
     agent_name:        $agent_name,
     dispatch_prompt:   null,
     transcript_path:   $transcript_path,
     cwd:               $cwd,
     started_at:        $started_at,
     ended_at:          null,
     duration_ms:       null,
     token_usage:       null,
     per_skill_tokens:  {},
     skills_invoked:    [],
     tool_calls:        {},
     stop_reason:       null
   }' > "$meta_file" 2>/dev/null || exit 0

exit 0
