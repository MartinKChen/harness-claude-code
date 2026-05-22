---
name: workflow-orchestrator-implement-task
description: "Dispatch a one-shot background sub-agent for every `level:task`+`kind:feature`+`status:ready-to-implement` task with no open blockers and no sibling task currently editing the same slice worktree. Lock via label flip (`ready-to-implement`→`in-progress`); map `type:e2e`→`e2e-author`, `type:backend`/`type:frontend`→`engineer`. Each dispatched agent gets a matching orchestrator TaskCreate row so progress is visible. Activate on 'implement the ready tasks', '/workflow-orchestrator-implement-task'."
---

# workflow-orchestrator-implement-task

Scan open task issues that are ready to implement and unblocked, lock each one with a label flip so concurrent fires don't double-pick, and dispatch the right background sub-agent (engineer or e2e-author). Slice promotion lives in `workflow-orchestrator-kickoff-slice` — this skill never touches slice issues.

The skill never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched sub-agent.

## When to activate

Activate this skill whenever the user:

- Types `/workflow-orchestrator-implement-task` (with or without arguments).
- Asks to "pick up tasks to implement", "dispatch engineers / e2e-authors against ready tasks", or "kick off implementation on the unblocked task backlog".

Do NOT activate when the user wants to promote slice issues (use `workflow-orchestrator-kickoff-slice`), ad-hoc start a single task without scanning the backlog, or fast-track a `kind:bug` / `kind:enhancement` task.

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`. Behavior identical to `workflow-orchestrator-kickoff-slice` (see that skill's description).

## Workflow

### 1. Resolve the repo

If the working dir isn't a GitHub repo, surface and stop.

### 2. Pull eligible task candidates

List task issues filtered by `level:task` + `status:ready-to-implement` (excluding `status:need-attention`, and optionally the milestone). Sort order is fixed: `type:e2e` (0) → `type:backend` (1) → `type:frontend` (2), then by issue number. Tasks with `status:need-attention` are excluded — they're waiting on human triage.

If empty, report `nothing to pick up` (with milestone if applied) and stop.

### 3. For each candidate, run pre-lock eligibility gates

Two gates, both must pass before locking.

**3a. Open-blocker count.** Drop when the task's open-blocker count is `> 0` — track as skipped (blocked).

**3b. Slice in-flight count.** Sibling tasks under the same slice share one `/tmp/git-worktree/<repo>/<slice-branch>` directory. Dispatching two agents into the same slice races on the same files. Count sibling tasks currently being EDITED (predicate: `status:in-progress` AND no `review:*` label).

Drop when `in_flight > 0` — track as skipped (slice locked by N sibling(s)). The skipped candidate stays eligible and will be picked up on a later fire once the in-flight agent's terminal label-add (`review:pending`) lands.

### 4. Lock the task with a label flip

Flip the task's labels: remove `status:ready-to-implement`, add `status:in-progress`.

If the call fails because the label was already removed by a concurrent fire (`422`), treat as benign and skip. Anything else: surface verbatim and stop further candidates for this run.

The lock MUST happen **before** the sub-agent dispatch in step 5. On synchronous dispatch failure (bad `subagent_type`, missing tool), roll the lock back (remove `status:in-progress`, add `status:ready-to-implement`).

Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle.

### 5. Create a tracking task, then dispatch the matching background sub-agent

Read the candidate's `type:*` label (exactly one of `type:e2e` / `type:backend` / `type:frontend`). Map:

| `type:*` | `subagent_type` |
|----------|-----------------|
| `type:e2e`      | `e2e-author` |
| `type:backend`  | `engineer`   |
| `type:frontend` | `engineer`   |

Malformed labels (none, or more than one `type:*`) → roll back the lock and skip (malformed).

Pick a unique name `<subagent_type>-implement-<task-#>` (e.g. `engineer-implement-42`).

**5a. TaskCreate**

```
subject:     Implement #<task-#>: <task-title>
description: <task-url>. Dispatching <subagent_type> to implement.
             Agent owns the lifecycle until it pushes and adds review:pending.
activeForm:  Implementing #<task-#>
```

Capture the returned `taskId`. If `TaskCreate` fails synchronously → roll back the lock, skip (TaskCreate failed).

**5b. Agent + TaskUpdate(owner) in the same response**

Fill the project's "Implement task" dispatch-prompt skeleton with the task number. Spawn the candidate:

- `subagent_type` — per the table above
- `mode` — `auto`
- `name` — `<subagent_type>-implement-<task-#>`
- `run_in_background` — `true` (mandatory)
- `prompt` — the filled skeleton

Immediately follow with `TaskUpdate({ taskId, owner: <agent-name> })` **in the same batched response** so the task row reflects assignment before the backgrounded sub-agent makes meaningful progress.

Independent candidates within the same fire fan out in parallel: emit all the `Agent` calls AND their matching `TaskUpdate(owner)` calls together in one batched response. Step 3b's slice-in-flight gate guarantees at most one agent per slice.

If `Agent` dispatch fails synchronously → roll back BOTH the lock (step 4) AND the orchestrator task (`TaskUpdate({ taskId, status: "deleted" })`).

### 6. Honor the cap and report

If a cap N was passed, stop after N dispatches in this run. Skipped candidates do NOT count.

After every candidate has been processed (or the cap is hit), emit exactly one line:

`Dispatched <X> task(s); skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Tasks only — no slice promotion.** That's `workflow-orchestrator-kickoff-slice`.
- **One agent per slice worktree at any moment.** Step 3b enforces this.
- **Lock before dispatch.** The label flip is the lock.
- **One orchestrator tracking task per dispatched sub-agent.** Never reuse a `taskId` and never spawn an `Agent` without a paired `TaskCreate`.
- **Roll back lock AND tracking task on synchronous dispatch failure.** Once the sub-agent is running, ownership transfers.
- **Background dispatch + same-message owner assignment.** Foreground dispatch serializes parallel candidates and races the owner assignment against the agent's own terminal task update.
- **`type:*` decides the agent type, never the body.**
- **One GitHub task issue per dispatched sub-agent.**
- **`kind:feature` only.**
- **No worktree creation, no pre-fetched context, no role/mode in the dispatch.** The dispatched sub-agent does its own discovery off the issue ID.
- **Skip, don't fail, on benign outcomes.** Blocked / slice-locked / malformed / lock race / cap reached / TaskCreate failed — track internally and continue.
