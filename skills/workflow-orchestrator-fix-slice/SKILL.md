---
name: workflow-orchestrator-fix-slice
description: "Dispatch a one-shot background `engineer` for every `level:slice`+`kind:feature`+`status:in-progress` slice carrying `review:need-fix`. Lock by stripping `review:need-fix`. The engineer addresses slice-level findings (cross-task issues, integration gaps) directly on the slice branch. Activate on 'fix the reviewed slices', 'pick up slices needing fix', '/workflow-orchestrator-fix-slice'."
---

# workflow-orchestrator-fix-slice

Slice-level counterpart of `workflow-orchestrator-fix-task`. When the slice reviewer flags integration / cross-task issues with `review:need-fix`, this skill dispatches the `engineer` agent to address them directly on the slice branch (no parent task to scope under).

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-fix-slice`.
- Asks to "fix the reviewed slices", "pick up slices needing fix", "dispatch engineer against need-fix slices".

Do NOT activate during slice review (`review:running` → that's still in flight) or for task fixes (`workflow-orchestrator-fix-task`).

## Arguments

`[<milestone-name>] [<cap>]`.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List slice issues filtered by `level:slice` + `status:in-progress` + `review:need-fix` (and the optional milestone).

If empty, report `nothing to pick up`.

### 3. Lock by stripping the gate label

Remove `review:need-fix` from the slice. The absence of any `review:*` label means the engineer owns the slice.

Race (`422`) → benign skip. Other errors → surface and stop.

### 4. Create tracking task, then dispatch the engineer

**4a. TaskCreate**

```
subject:     Fix slice #<slice-#>: <slice-title>
description: <slice-url>. Dispatching engineer to address slice-level
             reviewer findings. Agent owns the lifecycle until it pushes
             and re-adds review:pending to the slice.
activeForm:  Fixing slice #<slice-#>
```

If TaskCreate fails → restore `review:need-fix`, skip.

**4b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Fix the review feedback" dispatch-prompt skeleton with `<slice-#>`. Dispatch:

- `subagent_type` — `engineer`
- `mode` — `auto`
- `name` — `engineer-fix-slice-<slice-#>`
- `run_in_background` — `true`
- `prompt` — the filled skeleton

Pair with `TaskUpdate({ taskId, owner })`. On synchronous `Agent` failure → roll back lock + delete tracking task.

### 5. Honor cap and report

`Dispatched <X> slice fix(es); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Slices only — no PR-level work.** That's `workflow-orchestrator-fix-pr`.
- **Lock = absence of any `review:*` label.**
- **Always dispatches `engineer`.** Slice-level findings span tasks; there's no `type:*` on the slice itself to route by.
- **Background dispatch only.**
- **One orchestrator tracking task per dispatched engineer.**
- **Skip, don't fail, on benign outcomes.**
