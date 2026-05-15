---
name: implement-task-issue
description: "Dispatch a one-shot sub-agent for every open `level:task` + `kind:feature` + `status:ready-to-implement` task with zero open `Blocked by` dependencies. Lock each task with a label flip (`status:ready-to-implement` → `status:in-progress`); map `type:e2e` → `e2e-author`, `type:backend` / `type:frontend` → `engineer`. Slice promotion is owned by the sibling skill `kickoff-slice-issue`. Activate on phrases like 'implement the ready tasks', 'pick up task issues for implement', 'kick off task implementation', '/implement-task-issue', or whenever the orchestrator needs to fan out engineer / e2e-author agents against unblocked, ready task issues. Do NOT activate to start work on a single ad-hoc task without scanning the backlog, or to promote slice issues (use `kickoff-slice-issue`)."
---

# implement-task-issue

Scan open task issues that are ready to implement and unblocked, lock each one with a label flip so concurrent fires don't double-pick, and dispatch the right one-shot sub-agent. The skill never touches slice issues — slice promotion (`status:ready-to-implement` → `status:in-progress` on the slice + appending `status:ready-to-implement` to its task sub-issues) is the job of `kickoff-slice-issue`.

The skill never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched sub-agent.

## When to activate

Activate this skill whenever the user:

- Types `/implement-task-issue` (with or without a numeric cap argument).
- Asks to "pick up tasks to implement", "dispatch engineers / e2e-authors against ready tasks", or "kick off implementation on the unblocked task backlog".
- Wants to fan out `engineer` / `e2e-author` sub-agents against every open task issue carrying `status:ready-to-implement` with zero open blockers.

Do NOT activate when the user wants to promote slice issues (use `kickoff-slice-issue`), wants to ad-hoc start a single specific task without scanning the full backlog, or wants to fast-track a `kind:bug` / `kind:enhancement` task (this skill is `kind:feature` only).

## Arguments

The skill accepts an optional positive integer cap on how many tasks to pick up this run. Empty / unset → process every eligible task. A positive integer N → stop after N tasks have been locked + dispatched; remaining eligible tasks are picked up on the next invocation.

## Workflow

### 1. Resolve the repo

Capture `<owner>/<repo>` for every subsequent `gh` call. If the working dir isn't a GitHub repo, surface the error and stop.

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

### 2. Pull eligible task candidates

List open task issues that are ready to implement and tagged as features:

```bash
gh issue list \
  --state open \
  --label "level:task" \
  --label "status:ready-to-implement" \
  --label "kind:feature" \
  --json number,title,labels,url \
  --limit 200
```

If the result is empty, report "nothing to pick up" and stop.

### 3. For each candidate, query open-blocker count

`gh issue view --json` does not expose dependency counts, so query GraphQL. `Issue.issueDependenciesSummary.blockedBy` is the count of **open** blockers (closed blockers don't count, which is what we want):

```bash
gh api graphql \
  -F number=<n> -F owner=<owner> -F repo=<repo> \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
        }
      }
    }
  ' --jq '.data.repository.issue.issueDependenciesSummary.blockedBy'
```

Drop the candidate when `blockedBy > 0` — log `skipped #<n> — blocked by <count> open issue(s)` and continue.

### 4. Lock the task with a label flip

Flip both labels in one atomic `gh` call so the lock is visible immediately:

```bash
gh issue edit "${task_number}" \
  --remove-label "status:ready-to-implement" \
  --add-label "status:in-progress"
```

If the call fails (e.g. the label was already removed by a concurrent fire — `422`), treat it as benign and skip this task. Anything else: surface the error verbatim, stop processing further candidates for this run.

The lock MUST happen **before** the sub-agent dispatch in step 5. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the lock back:

```bash
gh issue edit "${task_number}" \
  --remove-label "status:in-progress" \
  --add-label "status:ready-to-implement"
```

so the next fire can retry. Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle (it adds `review:*-pending` labels and exits, leaving `status:in-progress` for `close-task-issue` to clear once reviews pass).

### 5. Create an orchestrator tracking task, then dispatch the right one-shot sub-agent

Each dispatched sub-agent gets a unique addressable name and a matching orchestrator-side `Task` (via `TaskCreate`) so the user can see progress in the harness task list. Terminology: the **GitHub task issue** is the unit of work tracked on GitHub; the **orchestrator tracking task** is the in-conversation `Task` row visible to the user.

Read the candidate's `type:*` label (exactly one of `type:e2e`, `type:backend`, `type:frontend` — `create-issues` enforces this). Map to the dispatch table:

| Task `type:*` label | `subagent_type` |
|---------------------|-----------------|
| `type:e2e`          | `e2e-author`    |
| `type:backend`      | `engineer`      |
| `type:frontend`     | `engineer`      |

If the candidate carries no `type:*` label or carries more than one, that's a `create-issues` invariant violation — roll back the lock (per step 4) and log `skipped #<n> — malformed type label(s): <list>`. Do NOT guess.

Pick a unique agent name of the form `<subagent_type>-implement-<task-#>` (e.g. `engineer-implement-42`, `e2e-author-implement-15`). This same string is used as the `Agent`'s `name` field AND as the orchestrator task's `owner` so the user can correlate spinner, task row, and spawned agent.

**5a. Create the orchestrator tracking task**

Call `TaskCreate` with:

- `subject`: `Implement #<task-#>: <task-title>`
- `description`: one short paragraph — the URL, the chosen `subagent_type`, and a one-liner saying the dispatched agent owns its lifecycle until it pushes and adds `review:*-pending`.
- `activeForm`: `Implementing #<task-#>`

Capture the returned `taskId`.

If `TaskCreate` itself fails synchronously, roll back the lock (per step 4) and log `skipped #<n> — TaskCreate failed: <error>`.

**5b. Dispatch the sub-agent and assign the tracking task**

Spawn the candidate with the `Agent` tool, passing:

- `subagent_type` — per the table above
- `mode` — `auto`
- `name` — the chosen agent name (e.g. `engineer-implement-42`)
- `run_in_background` — `true` (mandatory; see below)
- `prompt` — minimal; only the **task issue number, title, URL, and the orchestrator `taskId`**

`run_in_background: true` is non-negotiable. A foreground `Agent` call blocks the orchestrator turn until the sub-agent fully terminates, which (a) serializes candidates that were supposed to fan out in parallel and (b) lets the sub-agent's own terminal `TaskUpdate({ status: "completed" })` land before the orchestrator's `TaskUpdate({ owner })` — at which point the owner assignment races a finalized task and the harness UI never shows who owned the row.

Immediately follow the `Agent` call — in the **same batched response** — with `TaskUpdate({ taskId, owner: <agent-name> })` so the task row reflects the assignment before the backgrounded sub-agent makes meaningful progress. Never split the `Agent` and `TaskUpdate(owner)` calls across turns.

Independent candidates within the same fire are dispatched in parallel: emit all the `Agent` calls AND their matching `TaskUpdate(owner)` calls together in one batched response. The `TaskCreate` calls in step 5a may be batched the same way per fire.

If the `Agent` dispatch fails synchronously (bad `subagent_type`, missing tool, etc.), roll back BOTH the lock (per step 4) and the orchestrator task via `TaskUpdate({ taskId, status: "deleted" })`. Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle (it sets the tracking task's status, then `review-task-issue` / `close-task-issue` clear the GitHub-side labels once reviews pass).

Skeleton for the dispatch prompt:

```
Implement GitHub task issue #<task-#> ("<task-title>").
URL: <task-url>
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and added the `review:*-pending` labels on the GitHub task.

Fetch any further context you need (body, labels, parent slice issue, parent branch, etc.) yourself via `gh` — you have the issue ID.
```

### 6. Honor the cap and report

If the user passed a positive integer N, stop locking + dispatching new tasks once N have been dispatched in this run. Already-skipped tasks (blocked / malformed) do **not** count toward N.

Print a one-line-per-candidate summary, one of these forms:

- `dispatched  #<n> "<title>" → <subagent_type>`
- `skipped     #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped     #<n> "<title>" — malformed type label(s): <list>`
- `skipped     #<n> "<title>" — cap reached (dispatched N this run)`

End with a single sentence: `Dispatched <X> task(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Tasks only — no slice promotion.** Slice issues are promoted by `kickoff-slice-issue`, which is what populates `status:ready-to-implement` on the task sub-issues this skill consumes. Do NOT touch slice issues here.
- **Lock before dispatch.** The label flip in step 4 happens before the `TaskCreate` + `Agent` calls in step 5. The flip is the lock that prevents concurrent fires from picking up the same task.
- **One orchestrator tracking task per dispatched sub-agent.** Every dispatched candidate gets exactly one `TaskCreate` row, and the same agent `name` is used as the task `owner`. Never reuse a `taskId` across candidates and never spawn an `Agent` without a paired tracking task.
- **Roll back lock AND tracking task on synchronous dispatch failure.** If `Agent` errors synchronously, restore the labels (per step 4) and call `TaskUpdate({ taskId, status: "deleted" })` so the row doesn't dangle. Once the sub-agent is running, ownership transfers — the agent's terminal action adds review-pending labels on the GitHub issue and marks the tracking task `completed`, and `close-task-issue` later clears `status:in-progress` on a green review verdict. Do NOT speculatively unlock.
- **Background dispatch + same-message owner assignment.** Every `Agent` call MUST set `run_in_background: true` and MUST be emitted in the same response as its `TaskUpdate({ taskId, owner: <agent-name> })`. Foreground dispatch blocks the turn, serializes parallel candidates, and races the orchestrator's owner assignment against the sub-agent's own terminal task update.
- **`type:*` label decides the agent type, never the body.** `create-issues` puts type info on the label only; do not parse type out of the sub-issue body.
- **One GitHub task issue per dispatched sub-agent.** Each `Agent` call owns exactly one issue — never batch multiple issues into one dispatch. Independent tasks within a fire go out as parallel `Agent` calls (and parallel `TaskUpdate` owner-assignments) in the same message.
- **`kind:feature` only.** This skill does not handle `kind:bug` or `kind:enhancement` fast-track tasks. Add those as separate skills when the fast-track flow is wired up — do NOT silently widen the label filter.
- **No worktree creation, no pre-fetched context, no role/mode in the dispatch.** The dispatched sub-agent does its own discovery off the issue ID and owns its full lifecycle (including its own tracking-task status transitions).
- **Skip, don't fail, on benign outcomes.** "Blocked", "malformed labels", "lock race", "cap reached", "TaskCreate failed" are all expected — log them and continue, never abort the whole run.
