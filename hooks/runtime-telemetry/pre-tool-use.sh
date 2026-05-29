#!/usr/bin/env bash
# Runtime-telemetry PreToolUse hook.
#
# Fires on every tool call. No-ops unless a telemetry session is active for
# the current `agent_id` (i.e. the SubagentStart bootstrap seeded a meta file for
# this engineer / reviewer dispatch). Active dispatches are detected by the
# presence of `<agent_id>.meta.json` under
# `/tmp/harness-claude-code/<repo>/signals/`. Keying on agent_id (not the
# shared session_id) keeps parallel subagents from clobbering each other.
#
# When active, it updates the dispatch's meta.json in place (a single
# read-modify-write; a subagent's tool calls are serial, so this is safe):
#   - Bumps `last_seen` to now on every fire — the liveness heartbeat the
#     Stage-0 reconcile reaper uses to tell a killed/hung agent (last_seen gone
#     stale, ended_at still null) from one that is alive but quiet (last_seen
#     keeps advancing). This is what makes the reaper's death signal precise.
#   - Backfills `issue_number` ONCE from the dispatch prompt (the transcript's
#     first user turn, e.g. "Implement GitHub task issue #42") so the reaper can
#     map this meta file back to the issue it owns. Cheap: parsed only while
#     issue_number is still null.
#   - Increments `tool_calls[<tool>]` so the final meta carries a tool -> count
#     histogram for the dispatch.
#   - When the tool is `Read` against a `*/skills/*/SKILL.md` path, OR `Skill`
#     with a `skill` parameter, appends the skill name to
#     `meta.json#skills_invoked` (deduped, first-seen order preserved).
#
# The hook always exits 0 so it never blocks a tool call — telemetry capture
# must not introduce latency or failure into normal agent operation.

set -uo pipefail

# Read the hook payload from stdin once.
input="$(cat)"

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

# No agent_id => main-thread call (not inside a subagent); nothing to capture.
[ -n "$agent_id" ] || exit 0
[ -n "$cwd" ] || exit 0

# Resolve consuming project's main worktree root from cwd. Engineer / reviewer
# work in slice worktrees under /tmp/harness-claude-code/<repo>/worktrees/...,
# so we go via `--git-common-dir` to get back to the main worktree, then derive
# the same <repo> the bootstrap used to locate the /tmp signal store.
main_root="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$main_root" ] || exit 0
main_root="$(dirname "$main_root")"
[ -d "$main_root" ] || exit 0

repo="$(basename "$main_root")"
runtime_dir="/tmp/harness-claude-code/${repo}/signals"
meta_file="${runtime_dir}/${agent_id}.meta.json"

# Only log when a telemetry dispatch is active for this agent_id (i.e. the
# SubagentStart bootstrap fired). This is what limits capture to engineer +
# reviewer — other agents never get a meta file seeded.
[ -f "$meta_file" ] || exit 0

# --- detect a skill load -----------------------------------------------------
# A `Read` of `*/skills/<name>/SKILL.md` or a `Skill` invocation marks the skill
# as loaded for this dispatch.
skill_name=""
if [ "$tool_name" = "Read" ]; then
  fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
  case "$fp" in
    */skills/*/SKILL.md)
      skill_name="${fp##*/skills/}"
      skill_name="${skill_name%%/SKILL.md}"
      ;;
  esac
elif [ "$tool_name" = "Skill" ]; then
  skill_name="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""')"
fi

# --- liveness heartbeat timestamp --------------------------------------------
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- one-time issue_number backfill ------------------------------------------
# Parse the unit number from the dispatch prompt (transcript's first user turn,
# e.g. "Implement GitHub task issue #42", "Fix PR #17"). Only attempted while
# issue_number is still null, so the transcript read happens at most a handful
# of times early in the dispatch, not on every tool call.
issue_number=""
current_issue="$(jq -r '.issue_number // ""' "$meta_file" 2>/dev/null || echo "")"
if [ -z "$current_issue" ] && [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  first_user="$(jq -rs '
    [ .[] | (.message // .) | select(.role == "user")
      | (.content
         | if type == "string" then .
           elif type == "array" then ([ .[] | select(.type == "text") | .text ] | join("\n"))
           else "" end) ]
    | map(select(. != "")) | .[0] // ""' "$transcript_path" 2>/dev/null || echo "")"
  issue_number="$(printf '%s' "$first_user" | grep -oE '#[0-9]+' | head -n1 | tr -d '#')"
fi

# --- single read-modify-write of meta.json -----------------------------------
# Bump last_seen (heartbeat), increment the tool histogram, backfill
# issue_number if just parsed, and append the skill name (first-seen order
# preserved, deduped) when this call loaded one. Serial tool calls make the
# read-modify-write race-free.
tmp="$(mktemp 2>/dev/null)" || tmp="${meta_file}.tmp.$$"
jq --arg tool "$tool_name" --arg skill "$skill_name" --arg now "$now" --arg issue "$issue_number" '
  .last_seen = $now
  | .tool_calls[$tool] = ((.tool_calls[$tool] // 0) + 1)
  | (if ($issue != "" and ((.issue_number // null) == null))
     then .issue_number = ($issue | tonumber) else . end)
  | if ($skill != "" and ((.skills_invoked // []) | index($skill) | not))
    then .skills_invoked = ((.skills_invoked // []) + [$skill])
    else . end
' "$meta_file" > "$tmp" 2>/dev/null \
  && mv "$tmp" "$meta_file" 2>/dev/null \
  || rm -f "$tmp" 2>/dev/null

exit 0
