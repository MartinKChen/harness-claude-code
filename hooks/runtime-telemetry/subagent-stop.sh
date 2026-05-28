#!/usr/bin/env bash
# Runtime-telemetry SubagentStop hook.
#
# Fires once when an engineer / reviewer subagent terminates. Finalizes the
# session's meta.json by writing:
#   - ended_at (ISO-8601 UTC)
#   - duration_ms (ended_at - started_at)
#   - token_usage (TOTAL: each usage field summed across all assistant turns)
#   - per_skill_tokens (active-window attribution: each turn's tokens credited
#     to the most-recently-loaded skill at that point in the transcript)
#   - stop_reason (from the last assistant turn that carries one)
#
# The marker file is intentionally NOT deleted — it remains in
# `signals/runtime/` as the post-mortem record. Operators can rotate completed
# sessions into `.archive/` on their own schedule.
#
# Always exits 0.

set -uo pipefail

input="$(cat)"

if ! command -v jq >/dev/null 2>&1 || ! command -v git >/dev/null 2>&1; then
  exit 0
fi

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

[ -n "$agent_id" ] || exit 0
[ -n "$cwd" ] || exit 0

main_root="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
[ -n "$main_root" ] || exit 0
main_root="$(dirname "$main_root")"
[ -d "$main_root" ] || exit 0

repo="$(basename "$main_root")"
runtime_dir="/tmp/harness-claude-code/${repo}/signals"
meta_file="${runtime_dir}/${agent_id}.meta.json"

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

# --- Token usage, per-skill attribution, stop reason from the transcript -----
# The transcript is JSON Lines, one message per row. Each assistant turn
# carries a `usage` block and (on the final turn) a `stop_reason`. We slurp the
# whole file and, in one pass:
#   - sum each usage field across all turns           -> token_usage (total)
#   - walk turns in order, crediting each turn's tokens to the most-recently
#     loaded skill (a `Read` of `*/skills/<name>/SKILL.md` or a `Skill` call),
#     turns before the first load going to "__unattributed__"
#                                                      -> per_skill_tokens
#   - take the last non-null stop_reason              -> stop_reason
#   - take the first user turn's text                 -> dispatch_prompt
#     (SubagentStart's payload had no prompt, so we backfill it here)
token_usage="null"
per_skill_tokens="{}"
stop_reason="null"
dispatch_prompt="null"

if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  agg="$(jq -s '
    def msgof: (.message // .);
    def skill_of_block:
      if .name == "Skill" then (.input.skill // "")
      elif .name == "Read" then
        ((.input.file_path // "")
         | if test("/skills/[^/]+/SKILL\\.md$")
           then capture("/skills/(?<n>[^/]+)/SKILL\\.md$").n
           else "" end)
      else "" end;

    (reduce (.[] | msgof | .usage // empty) as $u (
        {input_tokens:0, output_tokens:0, cache_creation_input_tokens:0, cache_read_input_tokens:0};
        .input_tokens                 += ($u.input_tokens // 0)
        | .output_tokens              += ($u.output_tokens // 0)
        | .cache_creation_input_tokens += ($u.cache_creation_input_tokens // 0)
        | .cache_read_input_tokens    += ($u.cache_read_input_tokens // 0)
     )) as $totals
    | (reduce .[] as $row (
        {current:"__unattributed__", acc:{}};
        .current as $cur
        | ($row | msgof) as $m
        | (if $m.usage then
            .acc[$cur] = {
              input_tokens:  ((.acc[$cur].input_tokens  // 0) + ($m.usage.input_tokens  // 0)),
              output_tokens: ((.acc[$cur].output_tokens // 0) + ($m.usage.output_tokens // 0))
            }
           else . end)
        | (($m.content) as $c | (if ($c | type) == "array" then $c else [] end)
            | map(select(.type=="tool_use") | skill_of_block) | map(select(. != ""))) as $skills
        | (if ($skills | length) > 0 then .current = ($skills | last) else . end)
     )) as $walk
    | {
        token_usage:      $totals,
        per_skill_tokens: $walk.acc,
        stop_reason:      ([.[] | msgof | (.stop_reason // empty)] | last // null),
        dispatch_prompt:  ([ .[] | msgof | select(.role == "user")
                             | (.content
                                | if type == "string" then .
                                  elif type == "array" then ([.[] | select(.type == "text") | .text] | join("\n"))
                                  else "" end)
                             | select(. != "") ] | .[0] // null)
      }
  ' "$transcript_path" 2>/dev/null)"

  if [ -n "$agg" ]; then
    token_usage="$(printf '%s' "$agg" | jq -c '.token_usage // null' 2>/dev/null || echo null)"
    per_skill_tokens="$(printf '%s' "$agg" | jq -c '.per_skill_tokens // {}' 2>/dev/null || echo '{}')"
    stop_reason="$(printf '%s' "$agg" | jq -c '.stop_reason // null' 2>/dev/null || echo null)"
    dispatch_prompt="$(printf '%s' "$agg" | jq -c '.dispatch_prompt // null' 2>/dev/null || echo null)"
  fi
fi

# Stitch the finalized fields into the meta file.
tmp="$(mktemp 2>/dev/null)" || tmp="${meta_file}.tmp.$$"
jq \
  --arg ended_at             "$ended_at" \
  --argjson duration_ms      "$duration_ms" \
  --argjson token_usage      "$token_usage" \
  --argjson per_skill_tokens "$per_skill_tokens" \
  --argjson stop_reason      "$stop_reason" \
  --argjson dispatch_prompt  "$dispatch_prompt" \
  '.ended_at         = $ended_at
 | .duration_ms      = $duration_ms
 | .token_usage      = $token_usage
 | .per_skill_tokens = $per_skill_tokens
 | .stop_reason      = $stop_reason
 | .dispatch_prompt  = (if $dispatch_prompt == null then .dispatch_prompt else $dispatch_prompt end)' \
  "$meta_file" > "$tmp" 2>/dev/null \
  && mv "$tmp" "$meta_file" 2>/dev/null \
  || rm -f "$tmp" 2>/dev/null

exit 0
