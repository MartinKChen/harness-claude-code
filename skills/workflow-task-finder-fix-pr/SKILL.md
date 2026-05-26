---
name: workflow-task-finder-fix-pr
description: "Discovery-only. List draft PRs in the milestone with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` or `status:need-attention`. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-pr

Discovery slice for Stage 8 of `/implement-feature`. Identify every draft PR that's blocked on CI failure or a merge conflict and emit the eligible list. The dispatched engineer (owned by `/implement-feature`) determines whether the fix is conflict, CI, or both — this skill does not classify.

## When to activate

Invoked by the `task-finder` agent during Stage 8 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-draft-prs.sh \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    --milestone "<feature-name>"
```

`list-draft-prs.sh --status broken` already enforces: `--draft` open PRs whose `mergeable == "CONFLICTING"` OR whose `checksStatus == "FAILED"` (any rollup of `FAILURE` / `CANCELLED` / `TIMED_OUT`). The `--missing-label` flags drop in-flight fixes and human-pending PRs. `--milestone` scopes to the feature.

The `mergeable == "UNKNOWN"` / `checksStatus == "PENDING"` defense-in-depth re-check is implicit: those states are not `CONFLICTING` and not `FAILED`, so the `--status broken` filter drops them silently. A later snapshot picks them up once they settle.

### 2. Format each row

For each element of the returned JSON array, emit one line:

```
- PR #<number> | "<title>"
```

If the JSON array is empty, emit the single line `- (none)`.

A one-liner that does both:

```sh
bash skills/operation-git/scripts/list-draft-prs.sh \
    --status broken \
    --missing-label status:fix-in-progress \
    --missing-label status:need-attention \
    --milestone "<feature-name>" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- PR #\(.number) | \"\(.title)\"" end'
```

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **The script is the predicate.** No re-gating in the skill.
- **Drafts only.** Ready-to-review PRs are out of scope (enforced by the script's `--draft` flag).
- **Skip `status:need-attention` PRs.** A prior engineer fix bailed for human-in-the-loop work.
- **Skip `status:fix-in-progress` PRs.** A fix is already in flight on that PR.
- **Mid-flight signals (`UNKNOWN` / `PENDING`) drop silently.** `--status broken` is terminal-only.
- **Drop silently on every gate.** No `SKIPPED:` block.
- **Milestone-scoped.** `<feature-name>` is mandatory.
- **Do not classify the fix scope.** The engineer dispatched by `/implement-feature` inspects the live PR itself.
