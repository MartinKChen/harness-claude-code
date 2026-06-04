#!/usr/bin/env bash
# task-finder-stage-0-reconcile.sh
#
# Discovery for Stage 0 of /implement-feature: ORPHANED LOCKS — work that was
# locked into an in-flight state and whose owning process then died mid-run
# (SIGKILL under memory pressure, a killed process tree, a hung run) WITHOUT
# releasing the lock. Nothing in Stages 1, 8, 9 ever re-picks such an item — it
# is frozen with no live owner. This stage finds those orphans so the
# orchestrator can RELEASE the lock; the next /loop pass then re-launches the
# work from durable state (the slice branch's WIP commits + the slice body's
# task checklist + the Workflow's resume journal).
#
# Read-only — never flips labels, never launches. The orchestrator owns every
# mutation.
#
# Two orphan signatures survive the per-slice-Workflow redesign:
#
#   SLICE  status:in-progress  -> orphaned `implement-slice` Workflow
#                                  (the lock the kickoff stage applied; held for
#                                   the whole inner cycle by ONE background run)
#   PR     draft + status:fix-in-progress -> orphaned fix-pr engineer
#
# `status:in-progress` on a slice is now the WHOLE inner-cycle lock (one
# `implement-slice` Workflow owns author-E2E → coverage gate → implement → pass
# E2E → review → fix → open PR). When that Workflow dies, the lock is the only
# thing left holding the slice; reaping it lets the next pass relaunch, and the
# Workflow's resume journal + the checklist's ticked boxes skip everything that
# already completed. (Contrast the old model, where bare status:in-progress was a
# long-lived parent state that was NEVER reaped — that no longer applies.)
#
# DEATH GATE — an in-flight item is an orphan only if its owning run is gone.
# Two signals, in priority order:
#
#   1. TELEMETRY HEARTBEAT (authoritative when present). The runtime-telemetry
#      PreToolUse hook bumps `last_seen` in a running agent's signal meta on every
#      tool call and records `issue_number` (the slice the workflow's engineer /
#      reviewer agents are working). A meta with `ended_at == null` whose
#      `last_seen` is stale (>= RECONCILE_HEARTBEAT_STALE_MINUTES, default =
#      RECONCILE_STALE_MINUTES) is a dead run; a FRESH last_seen proves a child
#      agent is alive and VETOES the reap no matter how quiet GitHub is.
#
#   2. GITHUB STALENESS (fallback — no telemetry record: between agents, telemetry
#      disabled, or a graceful end). Reap when there has been NO activity for >=
#      RECONCILE_STALE_MINUTES (default 30). Activity = max(issue.updatedAt,
#      slice-branch last commit) for the slice lock (the workflow's engineers
#      commit per TDD step), and the head-branch last commit for the fix-pr lock.
#
# Both thresholds must exceed the longest uninterrupted stretch a healthy run can
# go silent (notably a single long e2e testcontainer run, which emits no
# intermediate tool call or commit); the defaults are deliberately generous.
#
# Output: one line per orphan, or `- (none)` when none survive.
#
# Line format (the trailing `release:<action>` token tells the orchestrator
# exactly which label flip releases the lock — see /implement-feature Stage 0):
#   - slice:#<n> | release:ready-to-implement | stale:<m>m | "<title>"
#   - pr:#<n>    | release:clear-fix-pr | slice:<s> | stale:<m>m | "<title>"
#
# Usage:
#   task-finder-stage-0-reconcile.sh <feature-name>
set -euo pipefail

if [[ $# -ne 1 || -z "$1" ]]; then
  echo "usage: $0 <feature-name>" >&2
  exit 1
fi

feature_name="$1"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# GitHub-staleness threshold — the fallback gate for runs WITHOUT a fresh
# telemetry heartbeat. Must exceed the longest uninterrupted stretch a healthy
# run can go without touching GitHub or committing (notably an e2e testcontainer
# run); too low risks false-reaping a live-but-quiet workflow.
stale_minutes="${RECONCILE_STALE_MINUTES:-30}"

# Heartbeat-staleness threshold — the gate when a telemetry record IS present.
heartbeat_stale_minutes="${RECONCILE_HEARTBEAT_STALE_MINUTES:-$stale_minutes}"

repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

# Runtime-telemetry signal store — derived the SAME way the hooks derive it
# (local main-worktree basename, NOT the GitHub repo name, which can differ).
signals_dir=""
git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$git_common" ]]; then
  signals_dir="/tmp/harness-claude-code/$(basename "$(dirname "$git_common")")/signals"
fi

now_epoch="$(date -u +%s)"

# Cross-platform ISO-8601 -> epoch (GNU `date -d`, BSD `date -j -f`). Empty on
# failure or empty input.
to_epoch() {
  local iso="$1"
  [[ -n "$iso" ]] || return 0
  date -u -d "$iso" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null \
    || true
}

# Most recent commit timestamp (epoch) on a branch, or empty if the branch is
# missing / has no commits.
branch_last_commit_epoch() {
  local branch="$1"
  [[ -n "$branch" ]] || return 0
  local iso
  iso="$(gh api "repos/${owner}/${repo}/commits?sha=${branch}&per_page=1" \
           --jq '.[0].commit.committer.date // empty' 2>/dev/null || true)"
  to_epoch "$iso"
}

# updatedAt (epoch) for an issue.
issue_updated_epoch() {
  local number="$1"
  local iso
  iso="$(gh issue view "$number" --json updatedAt --jq '.updatedAt' 2>/dev/null || true)"
  to_epoch "$iso"
}

# Highest of a list of epochs (ignores empties). Echoes nothing if all empty.
max_epoch() {
  local best=""
  local e
  for e in "$@"; do
    [[ -n "$e" ]] || continue
    if [[ -z "$best" || "$e" -gt "$best" ]]; then best="$e"; fi
  done
  printf '%s' "$best"
}

# Minutes since an epoch. Echoes nothing if epoch is empty.
minutes_since() {
  local then_epoch="$1"
  [[ -n "$then_epoch" ]] || return 0
  printf '%s' "$(( (now_epoch - then_epoch) / 60 ))"
}

# Minutes since the liveness heartbeat (last_seen) of a STILL-RUNNING telemetry
# record (ended_at == null) owning this issue. Among multiple matches, returns
# the freshest (smallest) — if any live agent is recent, the unit is alive.
# Echoes nothing when telemetry is off / no record matches, signalling the
# caller to fall back to GitHub staleness.
heartbeat_minutes() {
  local n="$1"
  [[ -n "$signals_dir" && -d "$signals_dir" ]] || return 0
  local best="" f iss ended ls e m
  for f in "$signals_dir"/*.meta.json; do
    [[ -f "$f" ]] || continue
    iss="$(jq -r '.issue_number // empty' "$f" 2>/dev/null || true)"
    [[ "$iss" == "$n" ]] || continue
    ended="$(jq -r '.ended_at // empty' "$f" 2>/dev/null || true)"
    [[ -z "$ended" ]] || continue   # gracefully stopped — not a live-agent record
    ls="$(jq -r '.last_seen // .started_at // empty' "$f" 2>/dev/null || true)"
    e="$(to_epoch "$ls")"
    [[ -n "$e" ]] || continue
    m="$(( (now_epoch - e) / 60 ))"
    if [[ -z "$best" || "$m" -lt "$best" ]]; then best="$m"; fi
  done
  printf '%s' "$best"
}

# Decide whether an in-flight candidate is an orphan to reap, and echo the
# staleness minutes to report. Echoes nothing => not an orphan (skip).
#   - If a telemetry heartbeat exists, it is AUTHORITATIVE: reap iff the
#     heartbeat is stale (>= heartbeat_stale_minutes); a fresh heartbeat means a
#     child agent is provably alive and vetoes the reap regardless of GitHub.
#   - Otherwise fall back to GitHub activity staleness, reaping at stale_minutes.
# Args: <issue-#> <github-activity-epoch>
reap_minutes() {
  local n="$1" gh_epoch="$2"
  local hb
  hb="$(heartbeat_minutes "$n")"
  if [[ -n "$hb" ]]; then
    if [[ "$hb" -ge "$heartbeat_stale_minutes" ]]; then printf '%s' "$hb"; fi
    return 0
  fi
  local m
  m="$(minutes_since "$gh_epoch")"
  if [[ -n "$m" && "$m" -ge "$stale_minutes" ]]; then printf '%s' "$m"; fi
}

emitted=""
emit() { emitted="${emitted}${1}"$'\n'; }

# Resolve the slice branch for an issue, swallowing the helper's diagnostics.
slice_branch_of() {
  bash "$script_dir/resolve-slice-branch.sh" "$1" 2>/dev/null || true
}

# --- SLICE orphans ---------------------------------------------------------

# Orphaned implement-slice Workflow (status:in-progress lock). Activity =
# max(issue.updatedAt, slice-branch last commit) — the workflow's engineers
# commit per TDD step. Release reverses the kickoff lock flip.
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(slice_branch_of "$number")"
  act="$(max_epoch "$(issue_updated_epoch "$number")" "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- slice:#${number} | release:ready-to-implement | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-issues.sh" \
            --label status:in-progress --milestone "$feature_name" \
          | jq -c '.[]')

# --- PR orphans ------------------------------------------------------------

# Orphaned fix-pr engineer (draft PR + status:fix-in-progress). Activity =
# branch last commit (the fix-pr engineer commits to the head branch).
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(printf '%s' "$row" | jq -r '.headRefName // empty')"
  # slice number is encoded in the slice branch name: feature/<slice#>-<intent>
  slice="$(printf '%s' "$branch" | sed -n 's#^feature/\([0-9][0-9]*\)-.*#\1#p')"
  [[ -n "$slice" ]] || slice="?"
  act="$(max_epoch "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- pr:#${number} | release:clear-fix-pr | slice:${slice} | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-draft-prs.sh" \
            --label status:fix-in-progress --milestone "$feature_name" \
          | jq -c '.[]')

# --- Output ----------------------------------------------------------------

if [[ -z "$emitted" ]]; then
  printf -- '- (none)\n'
else
  printf '%s' "$emitted"
fi
