#!/usr/bin/env bash
# Runtime-telemetry SubagentStop hook.
#
# Fires once when an engineer / reviewer subagent terminates. Finalizes the
# session's meta.json by writing:
#   - ended_at (ISO-8601 UTC)
#   - duration_ms (ended_at - started_at)
#   - token_usage (parsed from the tail of the subagent's transcript)
#   - stop_reason (parsed from the tail of the subagent's transcript)
#
# The marker file is intentionally NOT deleted — the meta + jsonl pair remain
# in `signals/runtime/` as the post-mortem record. Operators can rotate
# completed sessions into `.archive/` on their own schedule (see
# memory-convention).
#
# Always exits 0.

set -uo pipefail

input="$(cat)"

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

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

[ -f "$meta_file" ] || exit 0

ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

started_at="$(jq -r '.started_at // ""' "$meta_file" 2>/dev/null)"
duration_ms="null"
if [ -n "$started_at" ]; then
  # Cross-platform epoch parsing: GNU `date -d` works on Linux; macOS needs
  # `-j -f`. Try GNU first, fall back to BSD.
  start_epoch="$(date -u -d "$started_at" +%s 2>/dev/null \
              || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$started_at" +%s 2>/dev/null)"
  end_epoch="$(date -u -d "$ended_at" +%s 2>/dev/null \
            || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$ended_at" +%s 2>/dev/null)"
  if [ -n "$start_epoch" ] && [ -n "$end_epoch" ]; then
    duration_ms="$(( (end_epoch - start_epoch) * 1000 ))"
  fi
fi

# --- Token usage + stop reason from the transcript ---------------------------
# The transcript is JSON Lines, one message per row. The final assistant turn
# carries the cumulative `usage` block from the Anthropic API response, and a
# `stop_reason` field. We tail the file and pull the last assistant row that
# has a `usage` object.
token_usage="null"
stop_reason="null"

if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  last_with_usage="$(tac "$transcript_path" 2>/dev/null \
                  | jq -c 'select((.message.usage // .usage) != null)' 2>/dev/null \
                  | head -1)"

  if [ -z "$last_with_usage" ]; then
    # `tac` may not be on macOS without coreutils; fall back to awk reverse.
    last_with_usage="$(awk '{a[NR]=$0} END{for(i=NR;i>0;i--) print a[i]}' "$transcript_path" 2>/dev/null \
                    | jq -c 'select((.message.usage // .usage) != null)' 2>/dev/null \
                    | head -1)"
  fi

  if [ -n "$last_with_usage" ]; then
    token_usage="$(printf '%s' "$last_with_usage" | jq -c '.message.usage // .usage // null' 2>/dev/null || echo null)"
    stop_reason_raw="$(printf '%s' "$last_with_usage" | jq -r '.message.stop_reason // .stop_reason // ""' 2>/dev/null)"
    if [ -n "$stop_reason_raw" ]; then
      stop_reason="$(printf '%s' "$stop_reason_raw" | jq -Rc .)"
    fi
  fi
fi

# Stitch the finalized fields into the meta file.
tmp="$(mktemp 2>/dev/null)" || tmp="${meta_file}.tmp.$$"
jq \
  --arg ended_at        "$ended_at" \
  --argjson duration_ms "$duration_ms" \
  --argjson token_usage "$token_usage" \
  --argjson stop_reason "$stop_reason" \
  '.ended_at    = $ended_at
 | .duration_ms = $duration_ms
 | .token_usage = $token_usage
 | .stop_reason = $stop_reason' \
  "$meta_file" > "$tmp" 2>/dev/null \
  && mv "$tmp" "$meta_file" 2>/dev/null \
  || rm -f "$tmp" 2>/dev/null

exit 0
