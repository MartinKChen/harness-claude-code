---
name: workflow-orchestrator-prepare-slice
description: "Find every `level:slice`+`kind:feature`+`status:in-progress` slice whose sub-issues are ALL closed (no `review:*` or `e2e:*` label yet), flip on `e2e:running`, and dispatch a one-shot background `engineer` to run the slice's E2E specs against a real stack via testcontainers. On pass the engineer removes `e2e:running` and adds `review:pending`; on test-case constraints it flips to `status:need-attention`. Activate on 'prepare slices for review', '/workflow-orchestrator-prepare-slice'."
---

# workflow-orchestrator-prepare-slice

Once all task sub-issues of a slice close, the slice's E2E specs need to be validated against a real stack before the slice can be reviewed. This skill finds qualifying slices, flips on `e2e:running` as the lock, and dispatches a background `engineer` to run + green-light the E2E suite. The engineer adds `review:pending` on pass — that's what `workflow-orchestrator-review-slice` picks up next.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-prepare-slice` (with or without arguments).
- Asks to "prepare slices for review", "validate E2E on closed-out slices", or "dispatch engineers against slices with all tasks done".

Do NOT activate to review a slice directly (use `workflow-orchestrator-review-slice`), open a PR for a slice, or merge a PR.

## Arguments

`[<milestone-name>] [<cap>]` — same shape as the other orchestrator skills.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List `level:slice` + `kind:feature` + `status:in-progress` slices whose sub-issues are ALL closed AND that carry no `review:*` or `e2e:*` label yet (and the optional milestone filter). The absence guards are the idempotence guard — a re-fire never re-dispatches a slice that's mid-validation or settled.

If empty, report `nothing to pick up` and stop.

### 3. Lock with `e2e:running`

Add the `e2e:running` label to the slice.

If the label is already present (lock race), benign — skip. Any other failure: surface verbatim and stop.

The lock MUST happen before the dispatch in step 4. On synchronous dispatch failure, roll the lock back by removing `e2e:running`.

### 4. Create tracking task, then dispatch the engineer

Name pattern: `engineer-e2e-<slice-#>`.

**4a. TaskCreate**

```
subject:     E2E-validate slice #<slice-#>: <slice-title>
description: <slice-url>. Dispatching engineer to run the slice's E2E
             specs against a real stack via testcontainers.
             On pass: engineer removes e2e:running and adds review:pending.
             On test-case constraint: engineer flips to status:need-attention.
activeForm:  E2E-validating slice #<slice-#>
```

If `TaskCreate` fails synchronously → roll back lock, skip.

**4b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Validate E2E" dispatch-prompt skeleton (`Validate E2E test cases on GitHub slice issue #<slice-#>`). Spawn:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — `engineer-e2e-<slice-#>`
- `run_in_background` — `true` (mandatory)
- `prompt` — the filled "Validate E2E" skeleton

Pair with `TaskUpdate({ taskId, owner })` in the same batched response. Independent slices fan out in parallel.

On synchronous `Agent` failure → roll back lock + delete tracking task.

### 5. Honor cap and report

`Dispatched <X> slice E2E validation(s); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Predicate: all sub-issues closed AND no `review:*` AND no `e2e:*` label present.** All three conditions matter — the absence guards are the idempotence guard.
- **`kind:feature` slices only.**
- **Lock before dispatch.** `e2e:running` is the lock; engineer-e2e removes it as its terminal action on success.
- **One orchestrator tracking task per dispatched engineer.**
- **Background dispatch + same-message owner assignment.**
- **No code-changing or label-flipping work beyond the `e2e:running` lock here.** The dispatched engineer owns the E2E run and the terminal label transitions.
- **Skip, don't fail, on benign outcomes.**
