#!/usr/bin/env bash
# PreCompact handoff safety-net for the `engineer` agent.
#
# Wired as a PreCompact hook (see hooks/hooks.json). Fires when the engineer
# subagent's context is about to be compacted — manually (`/compact`) or
# automatically (the window hit the auto-compact threshold). No-ops unless the
# firing agent is an engineer working inside a slice worktree.
#
# WHY THIS IS A SAFETY NET, NOT THE PRIMARY TRIGGER
# -------------------------------------------------
# The real handoff is agent work: finish the current TDD step, commit + push,
# write a thoughtful `Where to pick up next`. A shell hook can do none of that.
# And per the hooks reference, PreCompact CANNOT inject context that survives
# compaction (no `additionalContext`), and whether a PreCompact `block` reason
# reaches the model is undocumented. So by the time compaction fires it is
# already too late to drive a clean handoff from here.
#
# The agent-facing enforcement therefore lives in a PreToolUse budget gate
# (engineer-budget-gate.sh) that DENIES the next mutating tool call once the
# live context size crosses ~100K and tells the agent to run
# operation-engineer-handoff's Outgoing handoff — a deny reason DOES reliably
# reach the subagent. This PreCompact hook only covers the case where a single
# huge turn blew past the gate before it could fire, by:
#
#   1. Writing a git-state BREADCRUMB to the canonical handoff-doc path (only
#      if no doc exists there yet — never clobbering an agent-authored doc, or
#      one this hook already wrote), so a session that dies at compaction still
#      leaves the next dispatch a pointer to the pushed commits.
#   2. BLOCKING the first AUTO compaction for this agent and emitting a handoff
#      instruction as the reason — a no-op if the reason doesn't reach the
#      model, but a clean win if it does. Guarded by a once-per-agent marker so
#      a non-reaching reason can never wedge the session in a block loop: the
#      second compaction is always allowed through.
#
# Manual `/compact` is user-intended and is NEVER blocked — we only refresh the
# breadcrumb and step aside.
#
# Always exits 0 on the allow path so a telemetry/breadcrumb failure can never
# stall a legitimate compaction.

set -uo pipefail

note() { printf '[engineer-precompact-handoff] %s\n' "$*" >&2; }

input="$(cat)"

command -v jq  >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

agent_id="$(printf '%s' "$input" | jq -r '.agent_id // ""')"
agent_type="$(printf '%s' "$input" | jq -r '.agent_type // ""')"
cwd="$(printf '%s' "$input" | jq -r '.cwd // ""')"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // ""')"
# Newer payloads use `compaction_trigger`; older docs showed `trigger`. Accept both.
trigger="$(printf '%s' "$input" | jq -r '.compaction_trigger // .trigger // ""')"

# --- gate: only the engineer subagent inside a slice worktree ---------------
# No agent_id => main-thread compaction; not ours.
[ -n "$agent_id" ] || exit 0
# agent_type is the most precise gate; fall back to the worktree-path check if
# the running version doesn't populate it for PreCompact.
if [ -n "$agent_type" ] && [ "$agent_type" != "engineer" ]; then
  exit 0
fi
[ -n "$cwd" ] || exit 0
case "$cwd" in
  /tmp/git-worktree/*) ;;
  *) exit 0 ;;
esac
git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

slice_branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ -n "$slice_branch" ] && [ "$slice_branch" != "HEAD" ] || exit 0
# <repo> is the first path component after the /tmp/git-worktree/ prefix — i.e.
# the `<repo>` in the documented worktree layout /tmp/git-worktree/<repo>/<slice-branch>.
# (Do NOT use `basename $(git rev-parse --show-toplevel)`: inside a linked
# worktree that returns the slice-branch leaf, not the repo. The agent side must
# derive <repo> the same way, else its handoff doc and this breadcrumb collide
# on different paths — see note in operation-engineer-handoff/SKILL.md.)
repo="$(printf '%s' "$cwd" | sed -E 's#^/tmp/git-worktree/([^/]+)/.*#\1#')"
[ -n "$repo" ] && [ "$repo" != "$cwd" ] || exit 0

# --- derive <unit> from the dispatch verb in the transcript ------------------
# Mirrors operation-engineer-handoff's unit table. We read the dispatch verb
# straight out of the transcript (the subagent's first user message carries it)
# rather than guessing, so the breadcrumb lands at the exact path the incoming-
# pickup procedure will look for.
unit=""
if [ -n "$transcript_path" ] && [ -f "$transcript_path" ]; then
  verb="$(grep -oE 'Fix the review feedback on GitHub slice issue #[0-9]+|Fix the review feedback on GitHub task issue #[0-9]+|Implement GitHub task issue #[0-9]+|Fix PR #[0-9]+' "$transcript_path" 2>/dev/null | head -1)"
  num="$(printf '%s' "$verb" | grep -oE '[0-9]+' | head -1)"
  case "$verb" in
    "Fix the review feedback on GitHub slice issue"*) unit="slice-${num}" ;;
    *"GitHub task issue"*)                            unit="task-${num}"  ;;
    "Fix PR"*)                                        unit="pr-${num}"    ;;
  esac
fi
# Fallback: derive from a feature/<slice#>-... branch when the verb wasn't found.
if [ -z "$unit" ]; then
  case "$slice_branch" in
    feature/*) unit="slice-$(printf '%s' "$slice_branch" | sed -E 's#^feature/([0-9]+).*#\1#')" ;;
    *)         unit="$(printf '%s' "$slice_branch" | tr '/' '-')" ;;
  esac
fi

doc_dir="/tmp/claude-handoff/${repo}"
doc_path="${doc_dir}/${unit}.md"
marker="${doc_dir}/.precompact-blocked-${agent_id}"
mkdir -p "$doc_dir" 2>/dev/null || true

# --- gather committed git state (the only trustworthy source) ----------------
# The unit id embedded in commit Refs trailers (task-7 -> #7, slice-3 -> #3).
unit_num="$(printf '%s' "$unit" | grep -oE '[0-9]+' | head -1)"
pushed_commits="$(git -C "$cwd" log -10 --grep "Refs #${unit_num}" --format='- %h %s' 2>/dev/null || true)"
[ -n "$pushed_commits" ] || pushed_commits="- (no commits found with \`Refs #${unit_num}\` — verify the unit number)"

unpushed="$(git -C "$cwd" log "origin/${slice_branch}..HEAD" --format='- %h %s' 2>/dev/null || true)"
[ -n "$unpushed" ] || unpushed="- (none — HEAD is pushed)"

dirty="$(git -C "$cwd" status --porcelain 2>/dev/null || true)"
if [ -z "$dirty" ]; then
  tree_state="clean"
else
  tree_state="$(printf 'DIRTY — uncommitted changes present (NOT in any commit; invisible to the next agent):\n%s' "$dirty")"
fi

# --- write the breadcrumb (only if no doc exists; never clobber) -------------
if [ ! -f "$doc_path" ]; then
  {
    printf '# Handoff: %s — AUTO-CAPTURED at compaction (breadcrumb, not a full handoff)\n\n' "$unit"
    printf '> Written by engineer-precompact-handoff.sh because the engineer session was compacted\n'
    printf '> before a clean Outgoing handoff ran. Commits are the source of truth; treat the\n'
    printf '> sections below as a pointer to the branch state, not a substitute for re-reading\n'
    printf '> the issue. Trigger: %s. Captured: %s.\n\n' "${trigger:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

    printf '## Dispatch\n'
    printf -- '- Slice branch: %s\n' "$slice_branch"
    printf -- '- Worktree: %s\n' "$cwd"
    printf -- '- Unit: %s\n\n' "$unit"

    printf '## What'\''s been done\n%s\n\n' "$pushed_commits"

    printf '## Where I stopped\n'
    printf -- '- Working tree state: %s\n' "$tree_state"
    printf -- '- Unpushed commits on this branch:\n%s\n\n' "$unpushed"

    printf '## Where to pick up next\n'
    printf -- '- Re-read the issue body and resume from the last green step above.\n'
    printf -- '- If the working tree was DIRTY, that work was lost to compaction — redo it from the last commit.\n'
    printf -- '- Verify every commit listed under "What'\''s been done" is actually on the branch before trusting it.\n'
  } > "$doc_path" 2>/dev/null \
    && note "wrote breadcrumb to $doc_path" \
    || note "failed to write breadcrumb to $doc_path"
else
  note "handoff doc already exists at $doc_path — leaving it untouched"
fi

# --- block exactly once on AUTO compaction -----------------------------------
# Manual /compact is user-intended; never block it. For auto compaction, block
# the first one for this agent and surface the handoff instruction. The marker
# guarantees the next compaction is allowed, so an unreachable reason can never
# wedge the session.
if [ "$trigger" = "auto" ] && [ ! -f "$marker" ]; then
  : > "$marker" 2>/dev/null || true
  reason="Auto-compaction is about to discard this engineer session's working context. Before any compaction, run operation-engineer-handoff's Outgoing handoff: finish the current TDD step (or \`git restore\` the half-edit so the tree is clean), commit + push every completed step with the dual \`Refs\` trailers, then write the handoff doc at ${doc_path}. A git-state breadcrumb has been written there as a fallback. This block fires once — the next compaction proceeds regardless."
  jq -nc --arg reason "$reason" '{decision: "block", reason: $reason}'
  exit 0
fi

note "allowing ${trigger:-?} compaction for ${unit} (agent ${agent_id})"
exit 0
