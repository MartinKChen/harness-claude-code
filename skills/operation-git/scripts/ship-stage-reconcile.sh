#!/usr/bin/env bash
# ship-stage-reconcile.sh
#
# Discovery for the /ship reconcile stage: ORPHANED LOCKS across all three kinds —
# work locked into an in-flight state whose owning process died mid-run without
# releasing the lock. Read-only; the orchestrator owns every release flip.
#
# Three orphan signatures (the bug lifecycle overloads status:in-progress as both
# the analyze lock and the fix lock, disambiguated by the # Bug Analysis comment):
#
#   SLICE  (kind:feature|enhancement|refactor) status:in-progress
#            -> orphaned implement-slice Workflow      -> release:ready-to-implement
#   BUG    kind:bug status:in-progress, HAS # Bug Analysis comment
#            -> orphaned fix-bug Workflow              -> release:ready-to-implement
#   BUG    kind:bug status:in-progress, NO # Bug Analysis comment
#            -> orphaned analyze engineer              -> release:clear-analyze
#                                                         (back to no status -> re-analyze)
#   PR     draft + status:fix-in-progress
#            -> orphaned fix-pr engineer               -> release:clear-fix-pr
#
# DEATH GATE (owned here, same as task-finder-stage-0-reconcile): a runtime-
# telemetry liveness heartbeat is authoritative when present (a fresh last_seen on
# any child agent vetoes the reap); GitHub-activity staleness is the fallback.
# Thresholds: RECONCILE_HEARTBEAT_STALE_MINUTES / RECONCILE_STALE_MINUTES (both
# default 30) — generous enough to outlast a single long e2e testcontainer run.
#
# Milestone is OPTIONAL (repo-wide maintenance lane when omitted).
#
# Output: one line per orphan, or `- (none)` when none survive.
#
# Line format (the trailing release:<action> token names the lock-release flip —
# see the /ship command's reconcile stage):
#   - issue:#<n> | release:ready-to-implement | stale:<m>m | "<title>"
#   - issue:#<n> | release:clear-analyze      | stale:<m>m | "<title>"
#   - pr:#<n>    | release:clear-fix-pr | issue:<i> | stale:<m>m | "<title>"
#
# Usage:
#   ship-stage-reconcile.sh [milestone]
set -euo pipefail

milestone="${1:-}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

milestone_args=()
[[ -n "$milestone" ]] && milestone_args=(--milestone "$milestone")

stale_minutes="${RECONCILE_STALE_MINUTES:-30}"
heartbeat_stale_minutes="${RECONCILE_HEARTBEAT_STALE_MINUTES:-$stale_minutes}"

repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
owner="${repo_slug%/*}"
repo="${repo_slug#*/}"

signals_dir=""
git_common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$git_common" ]]; then
  signals_dir="/tmp/harness-claude-code/$(basename "$(dirname "$git_common")")/signals"
fi

now_epoch="$(date -u +%s)"

to_epoch() {
  local iso="$1"
  [[ -n "$iso" ]] || return 0
  date -u -d "$iso" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$iso" +%s 2>/dev/null \
    || true
}

branch_last_commit_epoch() {
  local branch="$1"
  [[ -n "$branch" ]] || return 0
  local iso
  iso="$(gh api "repos/${owner}/${repo}/commits?sha=${branch}&per_page=1" \
           --jq '.[0].commit.committer.date // empty' 2>/dev/null || true)"
  to_epoch "$iso"
}

issue_updated_epoch() {
  local number="$1"
  local iso
  iso="$(gh issue view "$number" --json updatedAt --jq '.updatedAt' 2>/dev/null || true)"
  to_epoch "$iso"
}

max_epoch() {
  local best="" e
  for e in "$@"; do
    [[ -n "$e" ]] || continue
    if [[ -z "$best" || "$e" -gt "$best" ]]; then best="$e"; fi
  done
  printf '%s' "$best"
}

minutes_since() {
  local then_epoch="$1"
  [[ -n "$then_epoch" ]] || return 0
  printf '%s' "$(( (now_epoch - then_epoch) / 60 ))"
}

heartbeat_minutes() {
  local n="$1"
  [[ -n "$signals_dir" && -d "$signals_dir" ]] || return 0
  local best="" f iss ended ls e m
  for f in "$signals_dir"/*.meta.json; do
    [[ -f "$f" ]] || continue
    iss="$(jq -r '.issue_number // empty' "$f" 2>/dev/null || true)"
    [[ "$iss" == "$n" ]] || continue
    ended="$(jq -r '.ended_at // empty' "$f" 2>/dev/null || true)"
    [[ -z "$ended" ]] || continue
    ls="$(jq -r '.last_seen // .started_at // empty' "$f" 2>/dev/null || true)"
    e="$(to_epoch "$ls")"
    [[ -n "$e" ]] || continue
    m="$(( (now_epoch - e) / 60 ))"
    if [[ -z "$best" || "$m" -lt "$best" ]]; then best="$m"; fi
  done
  printf '%s' "$best"
}

# Echoes staleness minutes if the candidate is a reapable orphan; nothing if alive.
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

# True if the issue has at least one `# Bug Analysis` comment (analysis happened).
has_bug_analysis() {
  local n="$1" c
  c="$(gh issue view "$n" --json comments \
        --jq '[.comments[] | select(.body | startswith("# Bug Analysis"))] | length' \
        2>/dev/null || echo 0)"
  [[ "${c:-0}" -gt 0 ]]
}

# Resolve the work branch for an in-progress issue: a feature/enhancement slice
# has a branch linked via `gh issue develop`; a bug-fix branch is fix/<n>-* on
# origin (created by fix-bug, not linked). Echoes empty when none exists yet
# (e.g. an analyze orphan, which has written no code).
resolve_work_branch() {
  local n="$1" kind="$2" b
  if [[ "$kind" == "bug" ]]; then
    b="$(git ls-remote --heads origin "fix/${n}-*" 2>/dev/null | head -1 | sed 's#.*refs/heads/##')"
    printf '%s' "$b"
  else
    bash "$script_dir/resolve-slice-branch.sh" "$n" 2>/dev/null || true
  fi
}

emitted=""
emit() { emitted="${emitted}${1}"$'\n'; }

# --- in-progress orphans (all kinds) ---------------------------------------
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  kind="$(printf '%s' "$row" | jq -r '.labels | map(.name) | map(select(startswith("kind:"))) | .[0] // "kind:feature" | ltrimstr("kind:")')"

  branch="$(resolve_work_branch "$number" "$kind")"
  act="$(max_epoch "$(issue_updated_epoch "$number")" "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue

  if [[ "$kind" == "bug" ]] && ! has_bug_analysis "$number"; then
    emit "- issue:#${number} | release:clear-analyze | stale:${m}m | \"${title}\""
  else
    emit "- issue:#${number} | release:ready-to-implement | stale:${m}m | \"${title}\""
  fi
done < <(bash "$script_dir/list-issues.sh" \
            --kind kind:feature --kind kind:enhancement --kind kind:refactor --kind kind:bug \
            --label status:in-progress ${milestone_args[@]+"${milestone_args[@]}"} \
          | jq -c '.[]')

# --- PR orphans (fix-pr) ---------------------------------------------------
while read -r row; do
  [[ -n "$row" ]] || continue
  number="$(printf '%s' "$row" | jq -r .number)"
  title="$(printf '%s' "$row" | jq -r .title)"
  branch="$(printf '%s' "$row" | jq -r '.headRefName // empty')"
  body="$(printf '%s' "$row" | jq -r '.body // empty')"
  # Linked issue: feature/<n>- | enhancement/<n>- | refactor/<n>- | fix/<n>- branch prefix, else the body's Closes #.
  issue="$(printf '%s' "$branch" | sed -n -E 's#^(feature|enhancement|refactor|fix)/([0-9]+)-.*#\2#p')"
  [[ -n "$issue" ]] || issue="$(printf '%s' "$body" | grep -oiE 'closes[[:space:]]+#[0-9]+' | head -1 | grep -oE '[0-9]+')"
  [[ -n "$issue" ]] || issue="?"
  act="$(max_epoch "$(branch_last_commit_epoch "$branch")")"
  m="$(reap_minutes "$number" "$act")"
  [[ -n "$m" ]] || continue
  emit "- pr:#${number} | release:clear-fix-pr | issue:${issue} | stale:${m}m | \"${title}\""
done < <(bash "$script_dir/list-draft-prs.sh" \
            --label status:fix-in-progress ${milestone_args[@]+"${milestone_args[@]}"} \
          | jq -c '.[]')

# --- output ----------------------------------------------------------------
if [[ -z "$emitted" ]]; then
  printf -- '- (none)\n'
else
  printf '%s' "$emitted"
fi
