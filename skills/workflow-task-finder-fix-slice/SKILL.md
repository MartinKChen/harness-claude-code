---
name: workflow-task-finder-fix-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:in-progress` slices carrying `review:need-fix` — these are slices whose slice-level reviewer verdict came back as need-fix and must be picked up by `engineer`. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-fix-slice

Discovery slice for Stage 7 of `/implement-feature`. Identify every slice whose slice-level reviewer flagged integration / cross-task issues and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 7 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level slice \
    --label status:in-progress \
    --label review:need-fix \
    --milestone "<feature-name>"
```

`list-issues.sh` already enforces `level:slice` + `kind:feature` + the supplied labels + milestone. Output is a JSON array. No additional gating in the skill — if the script returns a row, it is eligible.

### 2. Format each row

For each element of the returned JSON array, emit one line:

```
- #<number> | "<title>"
```

If the JSON array is empty, emit the single line `- (none)`.

A one-liner that does both:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level slice \
    --label status:in-progress \
    --label review:need-fix \
    --milestone "<feature-name>" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
```

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **The script is the predicate.** No re-gating in the skill.
- **Slice-level only.** Task-level fixes are `workflow-task-finder-fix-task`'s lane; PR-level fixes are `workflow-task-finder-fix-pr`'s lane.
- **`review:running` means a review is still in flight — drop.** Querying for `review:need-fix` already excludes `review:running`.
- **`kind:feature` only** (enforced by the script).
- **Milestone-scoped.** `<feature-name>` is mandatory.
