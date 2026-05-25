#!/usr/bin/env bash
# Runtime-telemetry PreToolUse hook.
#
# Fires on every tool call. No-ops unless a telemetry session is active for
# the current session_id (i.e. an engineer / reviewer agent ran bootstrap.sh
# earlier in this session). Active sessions are detected by the presence of
# `<session_id>.meta.json` under `<main-root>/.claude/memory/signals/runtime/`.
#
# When active:
#   - Appends a `tool_use` row to `<session_id>.jsonl` with `started_at`,
#     `tool`, `input_summary`. PostToolUse will patch the row with
#     `duration_ms` + `success` once the call returns.
#   - When the tool is `Read` against a `*/skills/*/SKILL.md` path, OR `Skill`
#     with a `skill` parameter, also appends the skill name to
#     `meta.json#skills_invoked` (deduped, preserving first-seen order).
#
# The hook always exits 0 so it never blocks a tool call — telemetry capture
# must not introduce latency or failure into normal agent operation.

set -uo pipefail

# Read the hook payload from stdin once.
input="$(cat)"

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"

[ -n "$session_id" ] || exit 0
[ -n "$cwd" ] || exit 0

# Resolve consuming project's main worktree root from cwd. Engineer / reviewer
# work in slice worktrees under /tmp/git-worktree/, so we go via
# `--git-common-dir` to get back to the main worktree's `.claude/memory`.
main_root="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$main_root" ] || exit 0
main_root="$(dirname "$main_root")"
[ -d "$main_root" ] || exit 0

memory_root="$main_root/.claude/memory"
[ -d "$memory_root" ] || exit 0

runtime_dir="$memory_root/signals/runtime"
meta_file="$runtime_dir/${session_id}.meta.json"
events_file="$runtime_dir/${session_id}.jsonl"

# Only log when a telemetry session is active for this session_id (i.e. the
# bootstrap fired). This is what limits capture to engineer + reviewer.
[ -f "$meta_file" ] || exit 0

ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- compose input_summary ---------------------------------------------------
# A short, bounded description of the first identifying argument. Avoid
# dumping the full tool_input (could be many KB).
case "$tool_name" in
  Bash)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' | head -c 200)"
    ;;
  Read|Edit|Write|MultiEdit|NotebookEdit)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' | head -c 200)"
    ;;
  Glob|Grep)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.pattern // ""' | head -c 200)"
    ;;
  WebFetch|WebSearch)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.url // .tool_input.query // ""' | head -c 200)"
    ;;
  Skill)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""' | head -c 200)"
    ;;
  Agent|TaskCreate|TaskUpdate|SendMessage)
    summary="$(printf '%s' "$input" | jq -r '.tool_input.description // .tool_input.subject // .tool_input.to // ""' | head -c 200)"
    ;;
  *)
    summary=""
    ;;
esac

jq -nc \
  --arg ts            "$ts" \
  --arg event         "tool_use" \
  --arg tool          "$tool_name" \
  --arg input_summary "$summary" \
  --arg session_id    "$session_id" \
  '{
     ts:            $ts,
     event:         $event,
     tool:          $tool,
     input_summary: $input_summary,
     session_id:    $session_id
   }' >> "$events_file" 2>/dev/null || true

# --- skills_invoked update ---------------------------------------------------
skill_name=""
if [ "$tool_name" = "Read" ]; then
  fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
  # Match `.../skills/<name>/SKILL.md` (case-sensitive on SKILL.md).
  case "$fp" in
    */skills/*/SKILL.md)
      # Extract the segment between `/skills/` and `/SKILL.md`.
      skill_name="${fp##*/skills/}"
      skill_name="${skill_name%%/SKILL.md}"
      ;;
  esac
elif [ "$tool_name" = "Skill" ]; then
  skill_name="$(printf '%s' "$input" | jq -r '.tool_input.skill // ""')"
fi

if [ -n "$skill_name" ]; then
  tmp="$(mktemp 2>/dev/null)" || tmp="${meta_file}.tmp.$$"
  jq --arg skill "$skill_name" \
     '.skills_invoked = ((.skills_invoked // []) + [$skill] | unique_by(.))' \
     "$meta_file" > "$tmp" 2>/dev/null \
    && mv "$tmp" "$meta_file" 2>/dev/null \
    || rm -f "$tmp" 2>/dev/null
fi

exit 0
