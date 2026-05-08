---
description: Promote ready-to-implement slice issues to in-progress (unlocking their task sub-issues), then dispatch a one-shot sub-agent for every open `level:task` + `status:ready-to-implement` + `kind:feature` task with zero open `Blocked by` (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`).
argument-hint: "[optional: max number of tasks to pick up this run; default: all eligible]"
---

# pickup-task-for-implementation

Promote slice issues that are ready and unblocked — flipping them to `status:in-progress` and appending `status:ready-to-implement` to their `kind:feature` task sub-issues — then scan open task issues, keep the ones that are ready and unblocked, lock each one with a label flip so concurrent fires don't double-pick, and dispatch the right one-shot sub-agent. Invoke it directly with `/pickup-task-for-implementation`, or schedule it via `/loop /pickup-task-for-implementation`.

The command never checks out, edits, or pushes to any branch, and code-changing work is delegated to the dispatched sub-agent.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many tasks to pick up this run. Empty / unset → process every eligible task. A positive integer N → stop after N tasks have been locked + dispatched; remaining eligible tasks are picked up on the next invocation.

## Workflow

### 1. Resolve the repo

Capture `<owner>/<repo>` for every subsequent `gh api` call. If the working dir isn't a GitHub repo, surface the error and stop.

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

### 2. Promote ready slice issues, unlock their task sub-issues

Slice issues created by `create-issues` are born with their dev branch already linked. When a slice has no open blockers it's safe to start work — flip the slice to `status:in-progress` and append `status:ready-to-implement` to every `kind:feature` task sub-issue underneath so the rest of this command can pick them up.

List candidate slice issues:

```bash
gh issue list \
  --state open \
  --label "level:slice" \
  --label "status:ready-to-implement" \
  --label "kind:feature" \
  --json number,title,url \
  --limit 200
```

For each slice, query its open-blocker count and its sub-issues in one GraphQL call. `Issue.subIssues` returns the GitHub-native sub-issue children; `issueDependenciesSummary.blockedBy` counts only **open** blockers:

```bash
gh api graphql \
  -F number=<slice-#> -F owner=<owner> -F repo=<repo> \
  -f query='
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          issueDependenciesSummary { blockedBy }
          subIssues(first: 100) {
            nodes { number labels(first: 20) { nodes { name } } }
          }
        }
      }
    }
  '
```

If `blockedBy > 0`, skip the slice (`skipped slice #<n> — blocked by <count> open issue(s)`) and continue. Otherwise:

1. Flip the slice itself:

   ```bash
   gh issue edit "${slice_number}" \
     --remove-label "status:ready-to-implement" \
     --add-label "status:in-progress"
   ```

2. Extract the qualifying task sub-issue numbers from the same GraphQL response — every sub-issue carrying both `level:task` and `kind:feature` — and append `status:ready-to-implement` to each:

   ```bash
   # $slice_response holds the GraphQL JSON returned above for this slice.
   task_numbers="$(printf '%s' "$slice_response" | jq -r '
     .data.repository.issue.subIssues.nodes[]
     | (.labels.nodes | map(.name)) as $names
     | select(($names | index("level:task")) and ($names | index("kind:feature")))
     | .number
   ')"

   for task_number in $task_numbers; do
     gh issue edit "${task_number}" --add-label "status:ready-to-implement"
   done
   ```

If a sub-issue already has `status:ready-to-implement`, the call is a no-op — treat it as benign. Any other failure: surface verbatim and stop processing further slices for this run.

### 3. Pull eligible task candidates

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

### 4. For each candidate, query open-blocker count

`gh issue view --json` does not expose dependency counts, so query GraphQL. `Issue.issueDependenciesSummary.blockedBy` is the count of **open** blockers (closed blockers don't count, which is exactly what we want):

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

### 5. Lock the task with a label flip

Flip both labels in one atomic `gh` call so the lock is visible immediately:

```bash
gh issue edit "${task_number}" \
  --remove-label "status:ready-to-implement" \
  --add-label "status:in-progress"
```

If the call fails (e.g. the label was already removed by a concurrent fire — `422`), treat it as benign and skip this task. Anything else: surface the error verbatim, stop processing further candidates for this run.

The lock MUST happen **before** the sub-agent dispatch in step 6. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the lock back:

```bash
gh issue edit "${task_number}" \
  --remove-label "status:in-progress" \
  --add-label "status:ready-to-implement"
```

so the next fire can retry. Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle (it closes the issue on success, or the orchestrator's later sweep clears stale `status:in-progress` on aborted runs).

### 6. Dispatch the right one-shot sub-agent

Read the candidate's `type:*` label (exactly one of `type:e2e`, `type:backend`, `type:frontend` — `create-issues` enforces this). Map to the dispatch table:

| Task `type:*` label | `subagent_type` |
|---------------------|-----------------|
| `type:e2e`          | `e2e-author`    |
| `type:backend`      | `engineer`      |
| `type:frontend`     | `engineer`      |

If the candidate carries no `type:*` label or carries more than one, that's a `create-issues` invariant violation — roll back the lock (per step 5) and log `skipped #<n> — malformed type label(s): <list>`. Do NOT guess.

Spawn with the `Agent` tool, `mode=auto`. Each spawn is a single `Agent` call; independent tasks within the same fire are dispatched in parallel as multiple `Agent` calls in the same message.

The spawn prompt is deliberately minimal — pass only the **task issue number, title, and URL**. The dispatched agent fetches everything else it needs (body, labels, parent issue, parent branch, worktree path, role hints) from `gh` using the issue ID. Do NOT pre-fetch the body, do NOT pass the parent issue number or parent branch name, do NOT include role/mode lines — the agent owns its own discovery and lifecycle.

Skeleton for the dispatch prompt:

```
Implement GitHub issue #<task-#> ("<task-title>").
URL: <task-url>

Fetch any further context you need (body, labels, parent issue, parent branch, etc.) yourself via `gh` — you have the issue ID.
```

### 7. Honor the cap and report

If `$ARGUMENTS` parses as a positive integer N, stop locking + dispatching new tasks once N have been dispatched in this run. Already-skipped tasks (blocked / malformed) do **not** count toward N.

Print a one-line-per-candidate summary, one of these forms:

- `dispatched  #<n> "<title>" → <subagent_type>`
- `skipped     #<n> "<title>" — blocked by <count> open issue(s)`
- `skipped     #<n> "<title>" — malformed type label(s): <list>`
- `skipped     #<n> "<title>" — cap reached (dispatched N this run)`

End with a single sentence: `Promoted <S> slice(s); dispatched <X> task(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Promote slices before scanning tasks.** Step 2 is what unlocks task issues — `create-issues` ships tasks without `status:ready-to-implement`, so skipping step 2 means step 3 always finds nothing.
- **Lock before dispatch.** The label flip in step 5 happens before the `Agent` call in step 6. The flip is the lock that prevents concurrent fires from picking up the same task.
- **Roll back the lock only on synchronous dispatch failure.** Once the sub-agent is running, ownership transfers — the agent closes the issue on success, and a later sweep (out of scope for this command) clears `status:in-progress` on aborted runs. Do NOT speculatively unlock.
- **`type:*` label decides the agent type, never the body.** `create-issues` puts type info on the label only; do not parse type out of the sub-issue body.
- **One task per dispatched sub-agent.** Each `Agent` call owns exactly one task — never batch multiple tasks into one dispatch. Independent tasks within a fire go out as parallel `Agent` calls in the same message.
- **`kind:feature` only.** This command does not handle `kind:bug` or `kind:enhancement` fast-track tasks. Add those as separate commands or extend this one explicitly when the fast-track flow is wired up — do NOT silently widen the label filter.
- **No worktree creation, no pre-fetched context, no role/mode in the dispatch.** This command does not cut worktrees, does not pre-fetch the issue body, and does not pass parent issue / parent branch / role / mode. The dispatched sub-agent does its own discovery off the issue ID and owns its full lifecycle (worktree create → implement → smoke run → commit → merge → push → cleanup).
- **Skip, don't fail, on benign outcomes.** "Blocked", "malformed labels", "lock race", "cap reached" are all expected — log them and continue, never abort the whole run.
