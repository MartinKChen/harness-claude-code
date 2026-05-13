---
description: Find every open `level:task` + `kind:feature` + `status:in-progress` task carrying a `review:code-pending` or `review:security-pending` label, flip the pending gate(s) to `-running`, and dispatch the matching one-shot reviewer sub-agent (`review:code-running` → `code-reviewer`, `review:security-running` → `security-reviewer`). Reviews are now scoped to the task issue itself, not the slice PR.
argument-hint: "[optional: max number of task-gate pairs to dispatch this run; default: all eligible]"
---

# pickup-task-for-review

Scan task issues that have finished implementation and are waiting on review, lock each pending gate by flipping `review:<gate>-pending` → `review:<gate>-running` so concurrent fires don't double-pick the same gate, then dispatch the matching reviewer sub-agent. Handles the **code** and **security** gates only — the e2e gate has been retired from the label scheme (`review:e2e-*` is no longer used); the slice PR's GitHub Actions workflow check is the e2e signal.

The command never checks out, edits, or pushes to any branch; the dispatched sub-agent runs the review and flips the gate to its terminal `-passed` / `-need-fix` state.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many `(task, gate)` pairs to dispatch this run. Empty / unset → process every eligible pair. A positive integer N → stop after N pairs have been locked + dispatched. A task with both gates pending counts as **two** pairs against the cap.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. Pull eligible tasks per gate

A task is in scope when it is **open**, carries `level:task` + `kind:feature` + `status:in-progress`, and has the matching gate's `-pending` label. Run one `gh issue list` per gate so a task with both pending labels appears in both lists; merge and dedupe by issue number on the orchestrator side.

```bash
gh issue list \
  --state open \
  --label "level:task" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --label "review:code-pending" \
  --json number,title,labels,url \
  --limit 200

gh issue list \
  --state open \
  --label "level:task" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --label "review:security-pending" \
  --json number,title,labels,url \
  --limit 200
```

If both lists are empty, report "nothing to pick up" and stop.

### 3. Build the (task, gate) work list

For each unique task returned by step 2, derive the set of pending gates from its current `labels` array — every label whose name matches `review:<gate>-pending` for `<gate>` in `{code, security}`. Each `(task, gate)` pair becomes one unit of work.

Skip a pair (and log the skip reason) when:

- The same gate is already in `review:<gate>-running` on this task — log `skipped #<n> <gate> — already running` (a concurrent fire picked it up).

### 4. Flip just the pending gate(s) to running — preserve every other label

For each `(task, gate)` pair, flip `review:<gate>-pending` → `review:<gate>-running` in one atomic `gh` call. Pass only the labels you are removing/adding; do NOT touch any other label on the task. Concretely, if a task carries `review:security-pending` + `review:code-passed`, the security flip removes only `review:security-pending` and adds only `review:security-running`, leaving `review:code-passed` exactly as it was.

```bash
gh issue edit "${task_number}" \
  --remove-label "review:${gate}-pending" \
  --add-label "review:${gate}-running"
```

If the call fails because the pending label was already removed by a concurrent fire (`422`), treat it as benign and skip this pair. Anything else: surface the error verbatim, stop processing further pairs for this run.

The flip MUST happen **before** the sub-agent dispatch in step 5. If the dispatch itself fails synchronously (bad `subagent_type`, missing tool, etc.), roll the flip back so the next fire can retry:

```bash
gh issue edit "${task_number}" \
  --remove-label "review:${gate}-running" \
  --add-label "review:${gate}-pending"
```

Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle (it flips to `-passed` / `-need-fix` on completion, or a later sweep clears stale `-running` on aborted runs).

### 5. Dispatch the matching reviewer sub-agent

Map gate to `subagent_type`:

| Running gate label         | `subagent_type`     |
|----------------------------|---------------------|
| `review:code-running`      | `code-reviewer`     |
| `review:security-running`  | `security-reviewer` |

Spawn each pair with the `Agent` tool, `mode=auto`. Independent pairs within the same fire are dispatched in parallel as multiple `Agent` calls in the same response — including the two gates of the same task when both were pending (each gate runs as its own one-shot sub-agent).

The spawn prompt is minimal — pass only the **task issue number**. The dispatched agent fetches everything else it needs (issue body, parent slice issue, slice branch, worktree path, recent commits) from `gh` and `git`.

Skeleton:

```
Review GitHub task issue #<task-#> for the <code|security> gate.

Fetch any further context you need (issue body, parent slice issue, slice branch, worktree path, recent commits) yourself via `gh` and `git` — you have the issue ID.
```

### 6. Honor the cap and report

If `$ARGUMENTS` is a positive integer N, stop locking + dispatching new pairs once N have been dispatched in this run. Already-skipped pairs do **not** count toward N.

Print a one-line-per-pair summary:

- `dispatched  #<n> <gate> "<title>" → <subagent_type>`
- `skipped     #<n> <gate> "<title>" — already running`
- `skipped     #<n> <gate> "<title>" — lock race`
- `skipped     #<n> <gate> "<title>" — cap reached (dispatched N this run)`

End with one sentence: `Dispatched <X> pair(s); skipped <Y>; <Z> remaining eligible.` (`Z` is non-zero only if a cap was hit.)

## Iron rules

- **Reviews are on task issues, not the slice PR.** The `review:*` label family lives on `level:task` issues now. The slice PR carries no `review:*` labels.
- **Lock before dispatch.** The label flip in step 4 happens before the `Agent` call in step 5. The flip is the lock that prevents concurrent fires from picking up the same `(task, gate)` pair.
- **Roll back the flip only on synchronous dispatch failure.** Once the sub-agent is running, ownership transfers — the agent flips the gate to its terminal state (`-passed` / `-need-fix`) on completion.
- **Touch only the pending gate's labels.** When flipping, pass only the `--remove-label` / `--add-label` for the one gate being moved. Never re-add or remove labels for the other gate, the `status:*` family, the `kind:*` family, or anything else on the task.
- **One `(task, gate)` per dispatched sub-agent.** Each `Agent` call owns exactly one gate of one task. Independent pairs go out as parallel `Agent` calls in the same response — including both gates of a single task when both were pending.
- **Code and security only.** This command does not handle a `review:e2e-*` family (retired — the slice PR's e2e workflow check is the only e2e signal). Do NOT widen the gate set.
- **Skip, don't fail, on benign outcomes.** "Already running", "lock race", "cap reached" are all expected — log them and continue.
- **No code-changing work.** The dispatched reviewer sub-agent owns code reads, the verdict comment, and the terminal label flip.
