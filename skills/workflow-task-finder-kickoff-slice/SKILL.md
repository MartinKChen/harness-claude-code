---
name: workflow-task-finder-kickoff-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:ready-to-implement` slices with zero open blockers — these are the slices that the `/implement-feature` command should promote to `status:in-progress` and whose `kind:feature` task sub-issues should receive `status:ready-to-implement`. Read-only — never mutates labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-kickoff-slice

Discovery slice for Stage 1 of `/implement-feature`. Identify every slice issue in the milestone that is ready to be promoted (and whose task sub-issues are ready to be unlocked), apply the blocker-count gate, and emit the eligible list. This skill never flips labels, never mutates state.

The caller (`task-finder` agent) feeds the output into its aggregated report. The dispatcher (`/implement-feature` command) then performs the actual slice promotion and sub-issue label flips.

## When to activate

Invoked by the `task-finder` agent during Stage 1 discovery. Not user-invocable — the dispatcher chains it via `task-finder` rather than calling it standalone.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. List candidate slice issues

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level slice \
    --label status:ready-to-implement \
    --milestone "<feature-name>"
```

`list-issues.sh` already enforces `level:slice` + `kind:feature` + `status:ready-to-implement` + milestone. Output is a JSON array of `{number, title, labels, url}`.

### 2. Apply the open-blocker gate

For each candidate row, call `blocker-count.sh` and drop the row when the count is greater than zero. Closed blockers do not count — `blocker-count.sh` queries `issueDependenciesSummary.blockedBy` directly, which is the authoritative GraphQL field. Never parse `Blocked by` text from issue bodies.

A one-liner that does the listing + the gate in one shell pipeline:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level slice \
    --label status:ready-to-implement \
    --milestone "<feature-name>" \
  | jq -c '.[]' \
  | while read -r row; do
      number="$(printf '%s' "$row" | jq -r .number)"
      if [[ "$(bash skills/operation-git/scripts/blocker-count.sh "$number")" == "0" ]]; then
        printf '%s\n' "$row"
      fi
    done \
  | jq -s '.'
```

### 3. Format each row

For each surviving JSON row, emit one line:

```
- #<number> | "<title>"
```

If the surviving set is empty, emit the single line `- (none)`.

## Iron rules

- **Read-only.** No `gh issue edit`, no `gh issue close`, no label flips, no `TaskCreate`, no `Agent`.
- **The script + `blocker-count.sh` are the predicate.** No additional gating in the skill.
- **Open-blocker count comes from `issueDependenciesSummary.blockedBy`** via `blocker-count.sh`. Never parse `Blocked by` from issue bodies.
- **`kind:feature` only** (enforced by the script). Bugs / enhancements out of scope.
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Drop silently on gate failure.** No `SKIPPED:` block, no reason field, no negative output.
- **One snapshot.** Run the queries once and report; do not re-query mid-emit.
