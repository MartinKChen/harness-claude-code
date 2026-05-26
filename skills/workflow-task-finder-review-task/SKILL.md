---
name: workflow-task-finder-review-task
description: "Discovery-only. List `level:task`+`kind:feature`+`status:in-progress` tasks carrying `review:pending` — these are tasks awaiting code review. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-review-task

Discovery slice for Stage 3 of `/implement-feature`. Identify every task issue waiting on review and emit the eligible list. This skill never flips labels, never dispatches agents.

## When to activate

Invoked by the `task-finder` agent during Stage 3 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level task \
    --label status:in-progress \
    --label review:pending \
    --milestone "<feature-name>"
```

`list-issues.sh` already enforces `level:task` + `kind:feature` + the supplied labels + milestone. Output is a JSON array sorted by `type:*` rank then issue number. No additional gating in the skill — if the script returns a row, it is eligible.

### 2. Format each row

For each element of the returned JSON array, emit one line:

```
- #<number> | "<title>"
```

If the JSON array is empty, emit the single line `- (none)`.

A one-liner that does both:

```sh
bash skills/operation-git/scripts/list-issues.sh \
    --level task \
    --label status:in-progress \
    --label review:pending \
    --milestone "<feature-name>" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
```

## Iron rules

- **Read-only.** No label flips, no comments, no closes, no `TaskCreate`, no `Agent`.
- **The script is the predicate.** No re-gating in the skill.
- **Reviews live on task issues.** `review:*` is on `level:task` / `level:slice` issues, never on PRs.
- **`kind:feature` only** (enforced by the script).
- **Milestone-scoped.** `<feature-name>` is mandatory.
