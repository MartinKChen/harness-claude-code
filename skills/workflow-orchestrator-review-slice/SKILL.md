---
name: workflow-orchestrator-review-slice
description: "Find every `level:slice`+`kind:feature`+`status:in-progress` slice carrying `review:pending`, flip to `review:running`, and dispatch the `reviewer` background sub-agent for the slice-level review. The reviewer creates the draft PR on pass. Activate on 'review the ready slices', 'pick up pending slice reviews', '/workflow-orchestrator-review-slice'."
---

# workflow-orchestrator-review-slice

Slice-level review counterpart of `workflow-orchestrator-review-task`. Scan slice issues that have been marked ready for review (`review:pending`), lock the gate by flipping to `review:running`, then dispatch the `reviewer` sub-agent. On pass, the reviewer creates the draft PR with `merge:manual` and closure body wiring; on fail, it leaves `review:need-fix` for `workflow-orchestrator-fix-slice` to pick up.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-review-slice`.
- Asks to "review the ready slices", "pick up pending slice reviews", or "kick off slice-level review".

Do NOT activate for task-level review (`workflow-orchestrator-review-task`) or PR-level work.

## Arguments

`[<milestone-name>] [<cap>]`.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List slice issues filtered by `level:slice` + `status:in-progress` + `review:pending` (and the optional milestone).

If empty, report `nothing to pick up`.

### 3. Lock the gate

Flip the slice's review gate: remove `review:pending`, add `review:running`.

If `review:pending` was already removed (`422`), benign — skip. Otherwise surface and stop.

On synchronous dispatch failure (step 4), roll back by reversing the flip.

### 4. Create tracking task, then dispatch the reviewer

**4a. TaskCreate**

```
subject:     Review slice #<slice-#>: <slice-title>
description: <slice-url>. Dispatching reviewer to grade the slice.
             On pass the reviewer creates the draft PR (merge:manual).
             On fail it flips review:running → review:need-fix.
activeForm:  Reviewing slice #<slice-#>
```

**4b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Review slice" dispatch-prompt skeleton with the slice number. Dispatch:

- `subagent_type` — `reviewer`
- `mode` — `auto`
- `name` — `reviewer-review-slice-<slice-#>`
- `run_in_background` — `true`
- `prompt` — the filled skeleton

Pair with `TaskUpdate({ taskId, owner })` in the same batched response. Independent candidates fan out in parallel.

On synchronous `Agent` failure → roll back lock + delete tracking task.

### 5. Honor cap and report

`Dispatched <X> slice review(s); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Slices only.** Tasks are `workflow-orchestrator-review-task`'s lane.
- **Lock before dispatch.**
- **Background dispatch only.**
- **One orchestrator tracking task per dispatched reviewer.**
- **No code-changing or PR-creating work here.** The dispatched reviewer owns the verdict comment, the terminal label flip, and (on pass) the draft-PR creation.
- **Skip, don't fail, on benign outcomes.**
