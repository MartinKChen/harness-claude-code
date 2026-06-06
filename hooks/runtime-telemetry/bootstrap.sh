#!/usr/bin/env bash
# Runtime-telemetry bootstrap — SubagentStart hook for the heartbeat-bearing agents.
#
# Wired in hooks/hooks.json as a SubagentStart hook with matcher
# "^(.+:)?(engineer|reviewer|axis-reviewer|e2e-author)$" — a regex anchored so it
# accepts both the bare form (`engineer`) and the plugin-namespaced form the
# harness actually emits (`harness-claude-code:engineer`, `:axis-reviewer`, …).
# The regex form is load-bearing: Claude Code only treats a matcher as a regex
# when it contains characters outside `[A-Za-z0-9_|]`; a bare `engineer|reviewer`
# would be parsed as exact-string alternation and silently never match the
# namespaced agent_type. Fires automatically inside the subagent's context when
# one of those subagents starts, and seeds the per-dispatch metadata file that
# the PreToolUse / SubagentStop hooks key off of. Without this marker file, those
# hooks no-op — which is how telemetry stays limited to these four types.
#
# axis-reviewer and e2e-author are matched (not just engineer / reviewer) to
# close a false-reap race: they own the two longest, GitHub-quiet phases of a
# slice — the review fan-out and E2E authoring — during which no engineer /
# reviewer agent is live. Their dispatch prompts both carry `slice #<n>`, so the
# PreToolUse last_seen heartbeat below backfills issue_number and the Stage-0
# reconcile reaper sees the workflow is alive during those phases instead of
# falling through to the 30-min GitHub-staleness fallback and relaunching a live
# run onto the same branch.
#
# Two fields exist for the Stage-0 reconcile reaper (task-finder-stage-0-reconcile.sh):
#   - issue_number: null here; PreToolUse backfills it (once) from the dispatch
#     prompt so the reaper can map a meta file back to the issue it owns.
#   - last_seen: seeded to started_at; PreToolUse bumps it on every tool call as
#     a liveness heartbeat. A meta with ended_at==null whose last_seen has gone
#     stale is a killed/hung agent (a still-running agent keeps bumping it),
#     which is how the reaper tells "dead" from "alive but quiet".
#
# Keyed on `agent_id`, NOT session_id: session_id is shared across the parent and
# all parallel subagents, so two engineer/reviewer dispatches running at once
# share a session_id but carry distinct agent_ids. Keying the file on agent_id is
# what keeps concurrent dispatches from colliding on one meta file.
#
# Writes under /tmp/harness-claude-code/<repo>/signals/, creating the tree on
# first use. <repo> is the consuming project's basename, derived from the main
# worktree path so every slice worktree of the same project resolves to the same
# dir.
#
# Always exits 0 so it never blocks the subagent from starting — but every gate
# decision is logged via `note` to stderr (which the harness captures in its
# hook logs) so a silently-skipped fire still leaves a trail next time.

set -uo pipefail

note() { printf '[runtime-telemetry/bootstrap] %s\n' "$*" >&2; }

input="$(cat)"

command -v jq  >/dev/null 2>&1 || { note "jq not on PATH; cannot parse hook payload"; exit 0; }
command -v git >/dev/null 2>&1 || { note "git not on PATH; cannot resolve repo"; exit 0; }

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
session_id="$(printf '%s' "$input" | jq -r '.session_id // ""')"
raw_type="$(printf '%s' "$input" | jq -r '.agent_type // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

if [ -z "$agent_id" ]; then
  note "no agent_id in payload — skipping (not a subagent fire?)"
  exit 0
fi
if [ -z "$cwd" ]; then
  note "no cwd in payload for agent_id=${agent_id} — skipping"
  exit 0
fi

# Defensive type gate (a backstop for the hooks.json matcher): only the four
# heartbeat-bearing dispatches emit telemetry. Normalize the (possibly
# namespaced, e.g. "harness-claude-code:axis-reviewer") agent type to a bare
# canonical value, keeping axis-reviewer / e2e-author distinct from the plain
# engineer / reviewer roles (so per-type attribution survives). The two specific
# patterns are tested BEFORE the generic *reviewer* / *engineer* arms because a
# case statement takes the first match and "axis-reviewer" also contains
# "reviewer". If the payload doesn't carry agent_type at all (some harnesses omit
# it), trust the hooks.json matcher to have already filtered.
agent_type=""
case "$raw_type" in
  *axis-reviewer*) agent_type="axis-reviewer" ;;
  *e2e-author*)    agent_type="e2e-author" ;;
  *reviewer*)      agent_type="reviewer" ;;
  *engineer*)      agent_type="engineer" ;;
  "")              agent_type="unknown" ; note "raw agent_type empty — trusting hooks.json matcher; proceeding with agent_type=unknown" ;;
  *)
    note "raw agent_type='${raw_type}' does not match a heartbeat-bearing type — skipping"
    exit 0
    ;;
esac

# Resolve the consuming project's main worktree from cwd, then the repo basename.
# `--git-common-dir` returns the `.git` dir of the main worktree even when we're
# inside a linked worktree, so this collapses every slice worktree onto the same
# <repo> bucket.
git_common="$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -z "$git_common" ]; then
  note "cwd '$cwd' is not inside a git repo — skipping (agent_id=${agent_id})"
  exit 0
fi
main_root="$(dirname "$git_common")"
if [ ! -d "$main_root" ]; then
  note "computed main_root '$main_root' is not a dir — skipping (agent_id=${agent_id})"
  exit 0
fi

repo="$(basename "$main_root")"
runtime_dir="/tmp/harness-claude-code/${repo}/signals"
archive_dir="${runtime_dir}/.archive"

if ! mkdir -p "$archive_dir" 2>/dev/null; then
  note "mkdir -p '${archive_dir}' failed — skipping (agent_id=${agent_id})"
  exit 0
fi

meta_file="${runtime_dir}/${agent_id}.meta.json"

# Defensive: a file for this agent_id should not already exist (agent_id is
# unique per dispatch). If it does (re-fire), archive it to keep things clean.
if [ -f "$meta_file" ]; then
  prior_ts="$(jq -r '.started_at // "unknown"' "$meta_file" 2>/dev/null || echo unknown)"
  mv "$meta_file" "${archive_dir}/${agent_id}-${prior_ts}.meta.json" 2>/dev/null || true
fi

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# dispatch_prompt is null here — SubagentStart's payload does not carry the
# subagent's initial prompt. subagent-stop.sh backfills it from the transcript.
#
# Write the meta file via a temp + atomic mv so partial writes don't leave a
# zero-byte file (a silent failure mode in the previous version where
# `jq ... > "$meta_file" 2>/dev/null` could produce an empty file on jq failure
# and then exit 0, leaving the marker visibly present but unparseable).
tmp="$(mktemp 2>/dev/null)" || tmp="${meta_file}.tmp.$$"
if jq -nc \
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
       issue_number:      null,
       transcript_path:   $transcript_path,
       cwd:               $cwd,
       started_at:        $started_at,
       last_seen:         $started_at,
       ended_at:          null,
       duration_ms:       null,
       token_usage:       null,
       per_skill_tokens:  {},
       skills_invoked:    [],
       tool_calls:        {},
       stop_reason:       null
     }' > "$tmp" 2>/dev/null \
  && [ -s "$tmp" ] \
  && mv "$tmp" "$meta_file" 2>/dev/null; then
  note "seeded meta_file=${meta_file} agent_type=${agent_type}"
else
  rm -f "$tmp" 2>/dev/null
  note "jq write failed for meta_file=${meta_file} agent_id=${agent_id} — no signal captured"
fi

exit 0
