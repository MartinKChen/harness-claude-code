---
name: workflow-task-finder-prepare-slice
description: "Discovery-only. List `level:slice`+`kind:feature`+`status:in-progress` slices whose sub-issues are ALL closed AND that carry no `review:*` or `e2e:*` label yet. Read-only — never flips labels, never dispatches agents. Activate from inside the `task-finder` agent."
---

# workflow-task-finder-prepare-slice

Discovery slice for Stage 5 of `/implement-feature`. Identify every slice whose tasks have all closed and is ready to enter the E2E validation phase, and emit the eligible list.

## When to activate

Invoked by the `task-finder` agent during Stage 5 discovery. Not user-invocable.

## Arguments

`<feature-name>` — the GitHub milestone name to scope discovery to. Required.

## Workflow

### 1. Run the prescribed command

From the repo root, with `<feature-name>` substituted in:

```sh
bash skills/operation-git/scripts/list-slices-all-subs-closed.sh \
    --milestone "<feature-name>"
```

`list-slices-all-subs-closed.sh` already enforces every gate: `level:slice` + `kind:feature` + `status:in-progress` + every sub-issue closed + no `review:*` label + no `e2e:*` label. No additional gating in the skill — if the script returns a row, it is eligible. Output is a JSON array of `{number, title, labels, url}`.

### 2. Format each row

For each element of the returned JSON array, emit one line:

```
- #<number> | "<title>"
```

If the JSON array is empty, emit the single line `- (none)`.

A one-liner that does both:

```sh
bash skills/operation-git/scripts/list-slices-all-subs-closed.sh \
    --milestone "<feature-name>" \
  | jq -r 'if length == 0 then "- (none)" else .[] | "- #\(.number) | \"\(.title)\"" end'
```

## Iron rules

- **Read-only.** No label flips, no `TaskCreate`, no `Agent`.
- **The script is the predicate.** The skill does not re-apply gates that `list-slices-all-subs-closed.sh` already enforces — it just formats the rows the script returns.
- **`kind:feature` slices only** (enforced by the script).
- **Drop silently on a gate miss.** No `SKIPPED:` block — the script already drops them silently.
- **Milestone-scoped.** `<feature-name>` is mandatory.
