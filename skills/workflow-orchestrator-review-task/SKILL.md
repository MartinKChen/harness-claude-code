---
name: workflow-orchestrator-review-task
description: "Find every `level:task`+`kind:feature`+`status:in-progress` task carrying `review:pending`, flip the gate to `review:running`, and dispatch the `reviewer` background sub-agent. One review gate, one agent per task. Activate on 'review the task issues', 'pick up pending reviews', '/workflow-orchestrator-review-task'."
---

# workflow-orchestrator-review-task

Scan task issues that have finished implementation and are waiting on review, lock the gate by flipping `review:pending` → `review:running` so concurrent fires don't double-pick, then dispatch the `reviewer` sub-agent.

The skill never checks out, edits, or pushes to any branch; code-reading and verdict-writing are delegated to the dispatched reviewer.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-review-task` (with or without arguments).
- Asks to "pick up reviews", "dispatch reviewers", "review pending task issues", or "kick off review on the task backlog".

Do NOT activate when the user wants to review a slice (use `workflow-orchestrator-review-slice`), or wants a single ad-hoc review without scanning the backlog.

## Arguments

`[<milestone-name>] [<cap>]` — same shape as the other orchestrator skills.

## Workflow

### 1. Resolve the repo

### 2. Pull eligible task candidates

List task issues filtered by `level:task` + `status:in-progress` + `review:pending` (and the optional milestone).

If empty, report `nothing to pick up` and stop.

### 3. Lock the gate

Flip the task's review gate: remove `review:pending`, add `review:running`.

If the call fails because `review:pending` was already removed by a concurrent fire (`422`), treat as benign and skip. Anything else: surface verbatim and stop.

The flip MUST happen before the sub-agent dispatch in step 4. On synchronous dispatch failure, roll back (remove `review:running`, add `review:pending`).

### 4. Create a tracking task, then dispatch the `reviewer`

**4a. TaskCreate**

```
subject:     Review #<task-#>: <task-title>
description: <task-url>. Dispatching reviewer to grade the task.
             Agent owns the lifecycle until it posts a verdict and flips
             review:running to passed or need-fix.
activeForm:  Reviewing #<task-#>
```

Capture `taskId`. Roll back lock + skip if TaskCreate fails synchronously.

**4b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Review task" dispatch-prompt skeleton with the task number. Spawn:

- `subagent_type` — `reviewer`
- `mode` — `auto`
- `name` — `reviewer-review-task-<task-#>`
- `run_in_background` — `true` (mandatory)
- `prompt` — the filled skeleton

Immediately follow with `TaskUpdate({ taskId, owner: <agent-name> })` in the same batched response.

Independent candidates within the same fire are dispatched in parallel as multiple `Agent` calls + paired `TaskUpdate(owner)` in one batched response.

On synchronous `Agent` failure → roll back lock + delete the tracking task.

### 5. Honor the cap and report

`Dispatched <X> review(s); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Reviews live on task issues.** The `review:*` label family is on `level:task` (and `level:slice`) issues — never on PRs.
- **One review gate per task.** No separate code/security gates anymore; the reviewer agent runs whatever review patterns it needs against the task itself.
- **Lock before dispatch.** The `pending`→`running` flip is the lock.
- **One orchestrator tracking task per dispatched reviewer.**
- **Background dispatch only.** `run_in_background: true` on every `Agent` call.
- **Skip, don't fail, on benign outcomes.** Lock race / cap reached / TaskCreate failed — track internally and continue.
- **No code-changing work.** The dispatched reviewer owns the verdict comment, terminal label flip, and (on pass) the close-issue call.
