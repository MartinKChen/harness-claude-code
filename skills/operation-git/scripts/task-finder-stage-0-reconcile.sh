#!/usr/bin/env bash
# task-finder-stage-0-reconcile.sh
#
# Discovery for Stage 0 of /implement-feature: ORPHANED LOCKS — work that was
# locked into an in-flight label state and dispatched to a sub-agent that then
# died mid-run (SIGKILL from memory pressure, a killed process tree, a hung
# agent) WITHOUT advancing the label to its next state. Nothing in Stages 1–9
# ever re-picks such an item — it is frozen in an in-flight state with no live
# owner, and (for `status:in-progress` tasks) it keeps blocking sibling tasks on
# the same slice via `slice-in-flight.sh`. This stage finds those orphans so the
# orchestrator can RELEASE the lock; the next /loop pass then re-dispatches the
# work from durable state (the slice branch's WIP commits + the issue body).
#
# Read-only — never flips labels, never dispatches. The orchestrator owns every
# mutation, exactly as with the other eight stages.
#
# DETECTION = in-flight label signature + staleness gate.
#
# Orphan signatures (open, in-milestone, kind:feature):
#
#   TASK  T1  review:running                          -> orphaned reviewer
#   TASK  T2  status:in-progress AND no review:*       -> orphaned engineer
#               (implement vs fix disambiguated by "was review:pending ever
#                applied?" — see ever_reviewed)
#   SLICE S1  e2e:running                              -> orphaned e2e engineer
#   SLICE S2  review:running                           -> orphaned reviewer
#   SLICE S3  status:in-progress AND e2e:validated      -> orphaned fix-slice engineer
#               AND no review:*
#   PR    P1  draft PR + status:fix-in-progress        -> orphaned fix-pr engineer
#
# Bare `status:in-progress` on a SLICE is the normal long-lived parent state
# (set at kickoff, held while tasks churn) and is NEVER reaped — slice orphans
# are only the e2e:running / review:running / fix-slice signatures above.
#
# DEATH GATE — an in-flight item is an orphan only if its owning agent is gone.
# Two signals, in priority order:
#
#   1. TELEMETRY HEARTBEAT (authoritative when present). The runtime-telemetry
#      PreToolUse hook bumps `last_seen` in the agent's signal meta on every tool
#      call and records `issue_number`. A meta with `ended_at == null` whose
#      `last_seen` has gone stale (>= RECONCILE_HEARTBEAT_STALE_MINUTES, default
#      = RECONCILE_STALE_MINUTES) is a killed/hung agent; a FRESH last_seen
#      proves the agent is alive and VETOES the reap no matter how quiet GitHub
#      is (this is what eliminates false reaps of a productive-but-quiet agent —
#      e.g. one 30 min into a hard task with no commit yet). Covers engineer +
#      reviewer dispatches (the only agents telemetry is wired for).
#
#   2. GITHUB STALENESS (fallback — no telemetry record: e2e-author dispatches,
#      telemetry disabled, or a record that already ended gracefully). Reap when
#      there has been NO activity for >= RECONCILE_STALE_MINUTES (default 30).
#      Activity =
#        - reviewer locks (T1, S2): issue.updatedAt ONLY (a concurrent sibling
#          engineer's commits on the shared slice branch must not mask a dead
#          reviewer).
#        - engineer locks (T2, S1, S3, P1): max(issue.updatedAt, slice-branch
#          last commit). Engineers commit per TDD step, so a recent commit =
#          alive.
#
# Both thresholds must exceed the longest uninterrupted stretch a healthy agent
# can go silent (notably a single long e2e testcontainer run, which emits no
# intermediate tool call or commit); set them below that and a long op
# false-reaps. The defaults are deliberately generous.
#
# Output: one line per orphan, or `- (none)` when none survive.
#
# Line format (the trailing `release:<action>` token tells the orchestrator
# exactly which label flip releases the lock — see /implement-feature Stage 0):
#   - task:#<n>  | release:ready-to-implement | stale:<m>m | "<title>"
#   - task:#<n>  | release:need-fix           | stale:<m>m | "<title>"
#   - task:#<n>  | release:review-pending     | stale:<m>m | "<title>"
#   - slice:#<n> | release:clear-e2e          | stale:<m>m | "<title>"
#   - slice:#<n> | release:review-pending     | stale:<m>m | "<title>"
#   - slice:#<n> | release:need-fix           | stale:<m>m | "<title>"
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

# GitHub-staleness threshold — the fallback gate for agents WITHOUT a telemetry
# record (e2e-author, telemetry disabled). Must exceed the longest uninterrupted
# stretch a healthy agent can go without touching GitHub or committing (notably
# an e2e testcontainer run); too low risks false-reaping a live-but-quiet agent.
stale_minutes="${RECONCILE_STALE_MINUTES:-30}"

# Heartbeat-staleness threshold — the gate when a telemetry record IS present.
# The PreToolUse hook bumps last_seen on every tool call, so a fresh last_seen
# proves the agent is alive (and vetoes a reap no matter how quiet GitHub is),
# while a stale one confirms a kill/hang. Defaults to the GitHub threshold;
# lower it for faster recovery in projects whose longest single tool call (e.g.
# the e2e suite) is short — never below that duration, or a long op false-reaps.
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
#     heartbeat is stale (>= heartbeat_stale_minutes); a fresh heartbeat means
#     the agent is provably alive and vetoes the reap regardless of GitHub.
#   - Otherwise fall back to GitHub activity staleness (max of updatedAt and,
#     for engineer locks, the slice branch's last commit), reaping at
#     stale_minutes.
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

# Has review:pending (or any later review:* gate) EVER been applied to this
# task? If yes, the task has been implemented at least once and a no-review:*
# in-flight state is a FIX in flight; if no, it is the first IMPLEMENT in flight.
ever_reviewed() {
  local number="$1"
  gh api "repos/${owner}/${repo}/issues/${number}/timeline" --paginate \
    --jq '[.[] | select(.event == "labeled") | .label.name]
          | any(. == "review:pending" or . == "review:running"
                or . == "review:need-fix" or . == "review:passed")' \
    2>/dev/null | grep -qx true
}

emitted=""
emit() { emitted="${emitted}${1}"$'\n'; }

# Resolve the slice branch for an issue, swallowing the helper's diagnostics.
slice_branch_of() {
  bash "$script_dir/resolve-slice-branch.sh" "$1" 2>/dev/null || true
}

# --- TASK orphans ----------------------------------------------------------

# T1 — orphaned task reviewer (review:running). Activity = issue.updatedAt only.
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  act="$(issue_updated_epoch "$number")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- task:#${number} | release:review-pending | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-issues.sh" \
            --level task --label review:running --milestone "$feature_name" \
          | jq -c '.[]')

# T2 — orphaned task engineer (status:in-progress, no review:* of any kind).
# Activity = max(issue.updatedAt, slice-branch last commit). Release target
# depends on whether the task has ever been reviewed.
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(slice_branch_of "$number")"
  act="$(max_epoch "$(issue_updated_epoch "$number")" "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  if ever_reviewed "$number"; then
    emit "- task:#${number} | release:need-fix | stale:${m}m | \"${title}\""
  else
    emit "- task:#${number} | release:ready-to-implement | stale:${m}m | \"${title}\""
  fi
done < <(bash "$script_dir/list-issues.sh" \
            --level task --label status:in-progress \
            --missing-label review:pending --missing-label review:running \
            --missing-label review:need-fix --missing-label review:passed \
            --milestone "$feature_name" \
          | jq -c '.[]')

# --- SLICE orphans ---------------------------------------------------------

# S1 — orphaned e2e engineer (e2e:running). Activity = max(updatedAt, branch).
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(slice_branch_of "$number")"
  act="$(max_epoch "$(issue_updated_epoch "$number")" "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- slice:#${number} | release:clear-e2e | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-issues.sh" \
            --level slice --label e2e:running --milestone "$feature_name" \
          | jq -c '.[]')

# S2 — orphaned slice reviewer (review:running). Activity = updatedAt only.
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  act="$(issue_updated_epoch "$number")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- slice:#${number} | release:review-pending | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-issues.sh" \
            --level slice --label review:running --milestone "$feature_name" \
          | jq -c '.[]')

# S3 — orphaned fix-slice engineer (status:in-progress + e2e:validated, no
# review:*). A PASSED slice carries review:passed and is excluded; bare
# status:in-progress without e2e:validated is normal task-churn and is excluded.
# Activity = max(updatedAt, branch).
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(slice_branch_of "$number")"
  act="$(max_epoch "$(issue_updated_epoch "$number")" "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- slice:#${number} | release:need-fix | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-issues.sh" \
            --level slice --label status:in-progress --label e2e:validated \
            --missing-label review:pending --missing-label review:running \
            --missing-label review:need-fix --missing-label review:passed \
            --milestone "$feature_name" \
          | jq -c '.[]')

# --- PR orphans ------------------------------------------------------------

# P1 — orphaned fix-pr engineer (draft PR + status:fix-in-progress). Activity =
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
