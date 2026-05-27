#!/usr/bin/env bash
# Context-budget gate for the `engineer` agent — the primary handoff trigger.
#
# Wired as a PreToolUse hook on the mutating tools (Edit|Write|MultiEdit|
# NotebookEdit|Bash — see hooks/hooks.json). No-ops unless the firing agent is
# an engineer working inside a slice worktree.
#
# WHY THIS IS THE PRIMARY TRIGGER (and PreCompact is only the safety net)
# ----------------------------------------------------------------------
# A PreToolUse `deny` reason is reliably surfaced back to the subagent (keyed by
# agent_id) per the hooks reference, and it fires while the agent STILL HAS its
# full context — so the agent can actually perform the handoff (finish the TDD
# step, commit, push, write the doc). By contrast PreCompact fires too late
# (context is already being discarded) and cannot inject surviving context.
#
# HOW IT MEASURES "how full am I"
# -------------------------------
# Current window occupancy ≈ the MOST RECENT assistant turn's input side:
# input_tokens + cache_read_input_tokens + cache_creation_input_tokens. This is
# deliberately NOT the cumulative sum across turns that runtime-telemetry's
# subagent-stop.sh computes — that sum is lifetime consumption and would trip
# almost immediately. We want occupancy of the live window, which is the latest
# turn's input total.
#
# FIRING DISCIPLINE (deny-once-then-step-aside, with re-arm)
# ----------------------------------------------------------
# When occupancy first crosses ENGINEER_HANDOFF_THRESHOLD (default 150000) the
# gate DENIES the current mutating call and tells the agent to run the Outgoing
# handoff. It records the firing occupancy in a per-agent marker and then ALLOWS
# subsequent mutating calls through — otherwise the handoff's own commit / push /
# doc-write would be blocked and the session would deadlock. If the agent ignores
# the instruction and keeps ballooning context, the gate RE-ARMS: it fires again
# once occupancy grows by another ENGINEER_HANDOFF_REARM (default 20000) tokens,
# so a determined-to-continue agent gets nagged again instead of silently sailing
# into the hard context limit.
#
# Always allows (exit 0) on any error path so a gate failure can never wedge a
# legitimate tool call.

set -uo pipefail

note() { printf '[engineer-budget-gate] %s\n' "$*" >&2; }

THRESHOLD="${ENGINEER_HANDOFF_THRESHOLD:-150000}"
REARM="${ENGINEER_HANDOFF_REARM:-20000}"

input="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
agent_type="$(printf '%s' "$input" | jq -r '.agent_type // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"

# --- act only on mutating tools ---------------------------------------------
# Reads/Greps/Globs stay free so the handoff can prep without interference.
# (Defensive: the hooks.json matcher already scopes this, but re-check so the
# script is correct regardless of how it's wired.)
case "$tool_name" in
  Edit|Write|MultiEdit|NotebookEdit|Bash) ;;
  *) exit 0 ;;
esac

# --- gate: only the engineer subagent inside a slice worktree ----------------
[ -n "$agent_id" ] || exit 0
if [ -n "$agent_type" ] && [ "$agent_type" != "engineer" ]; then
  exit 0
fi
[ -n "$cwd" ] || exit 0
# Match the worktree prefix symlink-agnostically: setup-worktree.sh creates the
# tree at /tmp/git-worktree/..., but on macOS /tmp is a symlink to private/tmp,
# so the cwd the hook receives is the resolved /private/tmp/git-worktree/...
# Glob on the stable */git-worktree/* segment instead of the leading prefix.
case "$cwd" in
  */git-worktree/*) ;;
  *) exit 0 ;;
esac
[ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

# --- current window occupancy = latest assistant turn's input side -----------
occ="$(jq -rs '
  [ .[] | (.message // .) | .usage // empty ]
  | last
  | ( ((.input_tokens // 0)
      + (.cache_read_input_tokens // 0)
      + (.cache_creation_input_tokens // 0)) )
  // 0
' "$transcript_path" 2>/dev/null)"
case "$occ" in
  ''|*[!0-9]*) exit 0 ;;   # no usable usage figure yet — allow
esac

# Under budget => allow silently.
[ "$occ" -ge "$THRESHOLD" ] || exit 0

# --- re-arm bookkeeping ------------------------------------------------------
# <repo> is the first component after the git-worktree/ segment (robust to
# nested slice branches and to the /tmp -> /private/tmp symlink on macOS),
# matching engineer-precompact-handoff.sh and the documented worktree layout.
repo="$(printf '%s' "$cwd" | sed -E 's#^.*/git-worktree/([^/]+)/.*#\1#')"
[ -n "$repo" ] && [ "$repo" != "$cwd" ] || exit 0
state_dir="/tmp/claude-handoff/${repo}"
marker="${state_dir}/.budget-gate-${agent_id}"
mkdir -p "$state_dir" 2>/dev/null || true

last_fired=0
if [ -f "$marker" ]; then
  last_fired="$(cat "$marker" 2>/dev/null || echo 0)"
  case "$last_fired" in ''|*[!0-9]*) last_fired=0 ;; esac
fi

# Already fired and context hasn't grown by another REARM step => step aside so
# the handoff (commit / push / doc-write) can proceed unobstructed.
if [ "$last_fired" -gt 0 ] && [ "$occ" -lt "$((last_fired + REARM))" ]; then
  note "occ=${occ} >= threshold but within re-arm window (last_fired=${last_fired}); allowing"
  exit 0
fi

# --- derive <unit> + doc path for a precise instruction ----------------------
unit=""
verb="$(grep -oE 'Fix the review feedback on GitHub slice issue #[0-9]+|Fix the review feedback on GitHub task issue #[0-9]+|Implement GitHub task issue #[0-9]+|Fix PR #[0-9]+' "$transcript_path" 2>/dev/null | head -1)"
num="$(printf '%s' "$verb" | grep -oE '[0-9]+' | head -1)"
case "$verb" in
  "Fix the review feedback on GitHub slice issue"*) unit="slice-${num}" ;;
  *"GitHub task issue"*)                            unit="task-${num}"  ;;
  "Fix PR"*)                                        unit="pr-${num}"    ;;
esac
if [ -z "$unit" ]; then
  slice_branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  case "$slice_branch" in
    feature/*) unit="slice-$(printf '%s' "$slice_branch" | sed -E 's#^feature/([0-9]+).*#\1#')" ;;
    *)         unit="$(printf '%s' "${slice_branch:-unknown}" | tr '/' '-')" ;;
  esac
fi
doc_path="${state_dir}/${unit}.md"

# --- fire: record occupancy, emit the deny + handoff instruction -------------
printf '%s' "$occ" > "$marker" 2>/dev/null || true
note "FIRING handoff deny: occ=${occ} threshold=${THRESHOLD} unit=${unit} agent=${agent_id}"

reason="Context budget reached: this engineer session's window is at ~${occ} tokens (handoff threshold ${THRESHOLD}). Stop adding new work. Run operation-engineer-handoff's Outgoing handoff now: (1) finish the current TDD step or \`git restore\` the half-edit so the tree is clean; (2) commit + push every completed step with the dual \`Refs\` trailers; (3) write the handoff doc at ${doc_path} using the template; (4) exit cleanly WITHOUT flipping review:pending or touching status:in-progress. This gate steps aside after this message so your handoff commit/push/doc-write are not blocked."

jq -nc --arg reason "$reason" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: $reason
  }
}'
exit 0
