---
description: Dispatch a one-shot sub-agent for every open `level:task` + `kind:feature` + `status:ready-to-implement` task with zero open `Blocked by` dependencies. Lock each task with a label flip (`status:ready-to-implement` → `status:in-progress`); map `type:e2e` → `e2e-author`, `type:backend` / `type:frontend` → `engineer`. Slice promotion is owned by the sibling command `pickup-slice-for-implement`.
argument-hint: "[optional: max number of tasks to pick up this run; default: all eligible]"
---

# pickup-task-for-implement

Scan open task issues that are ready to implement and unblocked, lock each one with a label flip so concurrent fires don't double-pick, and dispatch the right one-shot sub-agent. The command never touches slice issues — slice promotion (`status:ready-to-implement` → `status:in-progress` on the slice + appending `status:ready-to-implement` to its task sub-issues) is the job of `pickup-slice-for-implement`.

The command never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched sub-agent.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many tasks to pick up this run. Empty / unset → process every eligible task. A positive integer N → stop after N tasks have been locked + dispatched; remaining eligible tasks are picked up on the next invocation.

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

### 5. Dispatch the right one-shot sub-agent

Read the candidate's `type:*` label (exactly one of `type:e2e`, `type:backend`, `type:frontend` — `create-issues` enforces this). Map to the dispatch table:

| Task `type:*` label | `subagent_type` |
|---------------------|-----------------|
| `type:e2e`          | `e2e-author`    |
| `type:backend`      | `engineer`      |
| `type:frontend`     | `engineer`      |

If the candidate carries no `type:*` label or carries more than one, that's a `create-issues` invariant violation — roll back the lock (per step 4) and log `skipped #<n> — malformed type label(s): <list>`. Do NOT guess.

Spawn each task with the `Agent` tool, `mode=auto`. Each spawn is a single `Agent` call; independent tasks within the same fire are dispatched in parallel as multiple `Agent` calls in the same message.

The spawn prompt is deliberately minimal — pass only the **task issue number, title, and URL**. The dispatched agent fetches everything else it needs (body, labels, parent issue, parent branch, worktree path, role hints) from `gh` itself.

Skeleton for the dispatch prompt:

```
Implement GitHub task issue #<task-#> ("<task-title>").
URL: <task-url>

Fetch any further context you need (body, labels, parent slice issue, parent branch, etc.) yourself via `gh` — you have the issue ID.
```

### 6. Honor the cap and report

If `$ARGUMENTS` parses as a positive integer N, stop locking + dispatching new tasks once N have been dispatched in this run. Already-skipped tasks (blocked / malformed) do **not** count toward N.

Print a one-line-per-candidate summary, one of these forms:

- `dispatched  #<n> "<title>" → <subagent_type>`
- `skipped     #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped     #<n> "<title>" — malformed type label(s): <list>`
- `skipped     #<n> "<title>" — cap reached (dispatched N this run)`

End with a single sentence: `Dispatched <X> task(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Tasks only — no slice promotion.** Slice issues are promoted by `pickup-slice-for-implement`, which is what populates `status:ready-to-implement` on the task sub-issues this command consumes. Do NOT touch slice issues here.
- **Lock before dispatch.** The label flip in step 4 happens before the `Agent` call in step 5. The flip is the lock that prevents concurrent fires from picking up the same task.
- **Roll back the lock only on synchronous dispatch failure.** Once the sub-agent is running, ownership transfers — the agent's terminal action adds review-pending labels on the task, and `close-task-issue` later clears `status:in-progress` on a green review verdict. Do NOT speculatively unlock.
- **`type:*` label decides the agent type, never the body.** `create-issues` puts type info on the label only; do not parse type out of the sub-issue body.
- **One task per dispatched sub-agent.** Each `Agent` call owns exactly one task — never batch multiple tasks into one dispatch. Independent tasks within a fire go out as parallel `Agent` calls in the same message.
- **`kind:feature` only.** This command does not handle `kind:bug` or `kind:enhancement` fast-track tasks. Add those as separate commands when the fast-track flow is wired up — do NOT silently widen the label filter.
- **No worktree creation, no pre-fetched context, no role/mode in the dispatch.** The dispatched sub-agent does its own discovery off the issue ID and owns its full lifecycle.
- **Skip, don't fail, on benign outcomes.** "Blocked", "malformed labels", "lock race", "cap reached" are all expected — log them and continue, never abort the whole run.
