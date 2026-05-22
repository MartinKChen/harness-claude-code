---
name: workflow-orchestrator-fix-task
description: "Dispatch a one-shot background sub-agent for every `level:task`+`kind:feature`+`status:in-progress` task carrying `review:need-fix`. Lock by stripping `review:need-fix`. Map `type:e2e`→`e2e-author`, `type:backend`/`type:frontend`→`engineer`. Activate on 'fix the reviewed tasks', 'pick up tasks needing fix', '/workflow-orchestrator-fix-task'."
---

# workflow-orchestrator-fix-task

Scan task issues whose reviewer verdict came back as `need-fix`, strip the gate label so concurrent fires don't double-pick, and dispatch the matching background sub-agent (engineer or e2e-author).

The skill never checks out, edits, or pushes to any branch; the fix is delegated to the dispatched sub-agent.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-fix-task` (with or without arguments).
- Asks to "fix the reviewed tasks", "pick up tasks needing fix", "dispatch fix agents for need-fix tasks".

Do NOT activate while a review cycle is still in flight on the task (`review:running`), to fix an open PR (use `workflow-orchestrator-fix-pr`), or to fix a slice (use `workflow-orchestrator-fix-slice`).

## Arguments

`[<milestone-name>] [<cap>]` — same shape as the other orchestrator skills.

## Workflow

### 1. Resolve the repo

### 2. List candidates

List task issues filtered by `level:task` + `status:in-progress` + `review:need-fix` (and the optional milestone).

If empty, report `nothing to pick up` and stop.

### 3. Slice in-flight gate

Same as `workflow-orchestrator-implement-task`'s 3b — sibling tasks on the same slice share a worktree. Count sibling tasks currently being edited (`status:in-progress` AND no `review:*` label).

Drop when `in_flight > 0` — track as skipped (slice locked).

### 4. Lock the task by stripping the gate label

A fix is owned by an agent when the task carries `status:in-progress` AND has no `review:*` label. We achieve that by removing `review:need-fix`.

If the label was already removed by a concurrent fire (`422`), treat as benign and skip. Anything else: surface verbatim and stop.

On synchronous dispatch failure, roll back by re-adding `review:need-fix`.

### 5. Create tracking task, then dispatch the matching sub-agent

Read the `type:*` label. Map:

| `type:*` | `subagent_type` |
|----------|-----------------|
| `type:e2e`      | `e2e-author` |
| `type:backend`  | `engineer`   |
| `type:frontend` | `engineer`   |

Malformed labels → restore `review:need-fix` and skip (malformed).

Name pattern: `<subagent_type>-fix-task-<task-#>` (e.g. `engineer-fix-task-42`).

**5a. TaskCreate**

```
subject:     Fix #<task-#>: <task-title>
description: <task-url>. Dispatching <subagent_type> to address reviewer findings.
             Agent owns the lifecycle until it pushes and re-adds review:pending.
activeForm:  Fixing #<task-#>
```

If TaskCreate fails synchronously → restore `review:need-fix`, skip.

**5b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Fix the review feedback" dispatch-prompt skeleton with the task number. Dispatch:

- `subagent_type` — per table
- `mode` — `auto`
- `name` — `<subagent_type>-fix-task-<task-#>`
- `run_in_background` — `true`
- `prompt` — the filled skeleton

Pair with `TaskUpdate({ taskId, owner })`. Independent candidates fan out in parallel in the same batched response.

On synchronous `Agent` failure → roll back lock + delete tracking task.

### 6. Honor cap and report

`Dispatched <X> fix(s); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Only `review:need-fix` triggers this skill.** `review:running` means a review cycle is still in flight — don't dispatch.
- **Lock = absence of any `review:*` label.** Stripping `review:need-fix` (and never re-adding `pending`/`running` here) puts the task in the "agent owns it" window.
- **One agent per slice worktree.** Step 3 enforces.
- **`type:*` decides the agent type.**
- **Background dispatch only.**
- **One orchestrator tracking task per dispatched agent.**
- **Skip, don't fail, on benign outcomes.**
- **No code-changing work.** The agent owns the actual fix and the terminal `review:pending` flip.
