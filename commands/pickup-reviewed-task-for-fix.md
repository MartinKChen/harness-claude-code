---
description: Dispatch a one-shot sub-agent for every open `level:task` + `kind:feature` + `status:in-progress` task carrying at least one `review:code-need-fix` or `review:security-need-fix` label (and no `review:*-pending` / `review:*-running` — those mean a review cycle is still mid-flight). Lock each task by **stripping** every `review:{code,security}-need-fix` and every `review:{code,security}-passed` label (the absence of those terminal labels is the lock); map `type:e2e` → `e2e-author`, `type:backend` / `type:frontend` → `engineer`. The dispatched agent owns re-adding `review:*-pending` as its terminal action once the fix is pushed.
argument-hint: "[optional: max number of tasks to pick up this run; default: all eligible]"
---

# pickup-reviewed-task-for-fix

Scan open task issues that have at least one reviewer verdict back as `*-need-fix`, lock each task by stripping the terminal review labels, and dispatch the right one-shot sub-agent to fix the implementation. The agent reads the reviewer's findings (PR-style structured comment posted on the task issue) and produces a fix commit on the slice branch.

The lock mechanic is **strip only**: this command removes every `review:{code,security}-need-fix` and `review:{code,security}-passed` label on the task and leaves the gate labels absent. The engineer / e2e-author re-adds `review:*-pending` as its terminal step once the fix is pushed — this is what triggers `pickup-task-for-review` to dispatch a fresh review (a fix can invalidate a previously-passed gate, so both gates must re-review).

The e2e gate is **not** part of this label family. E2e signal comes from the slice PR's GitHub Actions workflow check, not from a `review:e2e-*` label.

The command never checks out, edits, or pushes to any branch; code-changing work is delegated to the dispatched sub-agent.

## Arguments

`$ARGUMENTS` — optional positive integer cap on how many tasks to pick up this run. Empty / unset → process every eligible task.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface the error and stop.

### 2. Pull task candidates needing fix

A task is in scope when **all** of these hold:

- state is open;
- carries `level:task` + `kind:feature` + `status:in-progress`;
- carries at least one of `review:code-need-fix`, `review:security-need-fix`;
- carries **no** `review:*-pending` and **no** `review:*-running` labels (those mean a review cycle is in flight — wait for it to land before dispatching a fix).

Run one `gh issue list` per need-fix gate and merge by issue number on the orchestrator side; then re-read each candidate's `labels` to enforce the "no pending / no running" exclusion locally.

```bash
for gate in code security; do
  gh issue list \
    --state open \
    --label "level:task" \
    --label "kind:feature" \
    --label "status:in-progress" \
    --label "review:${gate}-need-fix" \
    --json number,title,labels,url \
    --limit 200
done
```

Local filter — drop any candidate whose `labels` include `review:code-pending`, `review:code-running`, `review:security-pending`, or `review:security-running`. Log `skipped #<n> — review cycle in flight: <list>`.

If the resulting set is empty, report "nothing to pick up" and stop.

### 3. Lock by stripping every code/security terminal label

For each candidate, snapshot the current `review:{code,security}-need-fix` and `review:{code,security}-passed` labels so a synchronous dispatch failure can roll back. Then in one atomic `gh` call, remove every snapshotted label. Do **not** add anything — re-adding `review:*-pending` is the engineer / e2e-author's terminal action, not the orchestrator's.

```bash
# $task_labels_json is the JSON labels array from step 2.
snapshot="$(printf '%s' "$task_labels_json" | jq -r '
  .[].name | select(test("^review:(code|security)-(passed|need-fix)$"))
')"

remove_args=()
for lbl in $snapshot; do remove_args+=( --remove-label "$lbl" ); done

gh issue edit "${task_number}" "${remove_args[@]}"
```

If the call fails because a label was already removed by a concurrent fire (`422`), treat it as benign and skip this task. Anything else: surface verbatim and stop.

The lock MUST happen **before** the sub-agent dispatch in step 4. If the dispatch itself fails synchronously, restore the snapshot in one call:

```bash
restore_add=()
for lbl in $snapshot; do restore_add+=( --add-label "$lbl" ); done

gh issue edit "${task_number}" "${restore_add[@]}"
```

Do NOT roll back on internal sub-agent failure — once the sub-agent is running, it owns the lifecycle.

The lock works because both downstream queries are negative on the stripped state:
- `pickup-reviewed-task-for-fix` (this command) requires at least one `review:*-need-fix` label, so the stripped task no longer matches its filter.
- `pickup-task-for-review` requires at least one `review:*-pending` label, so the stripped task doesn't get picked up for review either — until the engineer's terminal flip adds `review:*-pending` back.

### 4. Dispatch the matching sub-agent

Read the task's `type:*` label (exactly one of `type:e2e`, `type:backend`, `type:frontend`). Map:

| Task `type:*` label | `subagent_type` |
|---------------------|-----------------|
| `type:e2e`          | `e2e-author`    |
| `type:backend`      | `engineer`      |
| `type:frontend`     | `engineer`      |

If the task has zero or more than one `type:*` label, roll back the lock (per step 3) and log `skipped #<n> — malformed type label(s): <list>`.

Spawn each task with the `Agent` tool, `mode=auto`. Independent tasks within the same fire are dispatched in parallel as multiple `Agent` calls in the same message.

The spawn prompt passes the **task issue number, title, URL, and the original need-fix gates** (the subset of the snapshot whose labels were `review:{code,security}-need-fix`, NOT the `*-passed` ones — `code` and/or `security`). The dispatched agent reads the reviewer's findings comment on the task and fixes accordingly; the need-fix gates tell it which reviewer comment(s) to read.

Skeleton:

```
Fix the review feedback on GitHub task issue #<task-#> ("<task-title>").
URL: <task-url>

Reviewer gates that reported `need-fix` (read the matching reviewer comment on the issue):
- code
- security

Fetch any further context you need (issue body, reviewer findings comments, parent slice issue, slice branch, etc.) yourself via `gh` — you have the issue ID.
```

Include only the gates that were actually `need-fix` before step 3's flip.

### 5. Honor the cap and report

If `$ARGUMENTS` is a positive integer N, stop after N tasks have been dispatched. Already-skipped tasks do **not** count.

One-line-per-candidate summary:

- `dispatched  #<n> "<title>" → <subagent_type> (gates: <comma-list>)`
- `skipped     #<n> "<title>" — review cycle in flight: <list>`
- `skipped     #<n> "<title>" — malformed type label(s): <list>`
- `skipped     #<n> "<title>" — lock race`
- `skipped     #<n> "<title>" — cap reached (dispatched N this run)`

End with: `Dispatched <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Strip only — the orchestrator does not add `review:*-pending`.** The dispatched engineer / e2e-author re-adds `review:*-pending` after pushing the fix. Re-adding here would race `pickup-task-for-review`, which could dispatch reviewers against an unfinished tree.
- **Strip both `need-fix` and `passed`.** A fix can invalidate a previously-passed gate; both must re-review once the engineer's terminal flip adds the pending labels back. Never selectively leave a `*-passed` label in place when locking.
- **Skip when a review cycle is in flight.** `review:*-pending` or `review:*-running` on the task means a reviewer is mid-pass; dispatching a fix now would race the reviewer's read of the slice branch. Wait for the cycle to land (terminate at `*-passed` or `*-need-fix`).
- **No e2e gate.** The `review:e2e-*` label family has been retired. E2e signal flows through the slice PR's GitHub Actions workflow check; this command does not touch it.
- **Lock before dispatch.** The label flip in step 3 happens before the `Agent` call in step 4.
- **Roll back the lock only on synchronous dispatch failure.** Once the agent is running, ownership transfers — the engineer / e2e-author handles its own terminal state.
- **`type:*` label decides the agent type, never the body.**
- **One task per dispatched sub-agent.**
- **`kind:feature` only.**
- **No worktree creation, no pre-fetched context.** The dispatched sub-agent does its own discovery off the issue ID.
- **Skip, don't fail, on benign outcomes.** "Review in flight", "malformed labels", "lock race", "cap reached" are all expected — log and continue.
