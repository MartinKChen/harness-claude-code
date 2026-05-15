---
name: review-task-issue
description: "Find every open `level:task` + `kind:feature` + `status:in-progress` task carrying a `review:code-pending` or `review:security-pending` label, flip the pending gate(s) to `-running`, and dispatch the matching one-shot reviewer sub-agent (`review:code-running` → `code-reviewer`, `review:security-running` → `security-reviewer`). Reviews are scoped to the task issue itself, not the slice PR. Activate on phrases like 'review the task issues', 'pick up pending reviews', 'kick off code/security review', '/review-task-issue', or whenever the orchestrator needs to fan out reviewer agents against task issues whose review gates are pending. Do NOT activate to review a slice PR — `review:*` labels live on task issues now."
---

# review-task-issue

Scan task issues that have finished implementation and are waiting on review, lock each pending gate by flipping `review:<gate>-pending` → `review:<gate>-running` so concurrent fires don't double-pick the same gate, then dispatch the matching reviewer sub-agent. Handles the **code** and **security** gates only — the e2e gate has been retired from the label scheme (`review:e2e-*` is no longer used); the slice PR's GitHub Actions workflow check is the e2e signal.

The skill never checks out, edits, or pushes to any branch; the dispatched sub-agent runs the review and flips the gate to its terminal `-passed` / `-need-fix` state.

## When to activate

Activate this skill whenever the user:

- Types `/review-task-issue` (with or without a numeric cap argument).
- Asks to "pick up reviews", "dispatch reviewers", "review pending task issues", or "kick off code/security review on task issues".
- Wants to fan out `code-reviewer` / `security-reviewer` sub-agents against every open task issue carrying a `review:*-pending` label.

Do NOT activate when the user wants to review a slice PR directly (the `review:*` label family no longer lives on PRs), when no `review:*-pending` gate exists, or when they want a single ad-hoc review on a specific task without scanning the full backlog.

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the task scan to issues attached to that GitHub milestone (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone used by `create-issues`). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N `(task, gate)` pairs have been locked + dispatched. A task with both gates pending counts as **two** pairs against the cap. Empty / unset → process every eligible pair.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. Pull eligible tasks per gate

A task is in scope when it is **open**, carries `level:task` + `kind:feature` + `status:in-progress`, and has the matching gate's `-pending` label. Run one `gh issue list` per gate so a task with both pending labels appears in both lists; merge and dedupe by issue number on the orchestrator side. When `<milestone-name>` is set, append `--milestone "${milestone}"` to every list call so the scan is scoped to that feature; otherwise omit the flag.

```bash
gh issue list \
  --state open \
  --label "level:task" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --label "review:code-pending" \
  ${milestone:+--milestone "${milestone}"} \
  --json number,title,labels,url \
  --limit 200

gh issue list \
  --state open \
  --label "level:task" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --label "review:security-pending" \
  ${milestone:+--milestone "${milestone}"} \
  --json number,title,labels,url \
  --limit 200
```

If both lists are empty, report "nothing to pick up" and stop. When a milestone filter was applied, include it: `nothing to pick up (milestone: <milestone-name>)`.

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

Spawn each pair with the `Agent` tool, passing:

- `subagent_type` — per the table above
- `mode` — `auto`
- `run_in_background` — `true` (mandatory; see below)
- `prompt` — minimal; only the **task issue number** and the gate

`run_in_background: true` is non-negotiable. A foreground `Agent` call blocks the orchestrator turn until the reviewer fully terminates, which serializes pairs that were supposed to fan out in parallel — when both gates of one task are pending and a fire has, say, three other tasks ready, the orchestrator should dispatch all of them in a single response and continue, not wait for the first reviewer to finish before starting the next.

Independent pairs within the same fire are dispatched in parallel as multiple `Agent` calls in the same response — including the two gates of the same task when both were pending (each gate runs as its own one-shot sub-agent). The dispatched agent fetches everything else it needs (issue body, parent slice issue, slice branch, worktree path, recent commits) from `gh` and `git`.

Skeleton:

```
Review GitHub task issue #<task-#> for the <code|security> gate.

Fetch any further context you need (issue body, parent slice issue, slice branch, worktree path, recent commits) yourself via `gh` and `git` — you have the issue ID.
```

### 6. Honor the cap and report

If the user passed a positive integer N, stop locking + dispatching new pairs once N have been dispatched in this run. Already-skipped pairs do **not** count toward N.

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
- **Background dispatch only.** Every `Agent` call MUST set `run_in_background: true`. Foreground dispatch blocks the turn, serializes parallel `(task, gate)` pairs, and stalls the orchestrator on the first reviewer even when other pairs are already locked and ready to fan out.
- **Code and security only.** This skill does not handle a `review:e2e-*` family (retired — the slice PR's e2e workflow check is the only e2e signal). Do NOT widen the gate set.
- **Skip, don't fail, on benign outcomes.** "Already running", "lock race", "cap reached" are all expected — log them and continue.
- **No code-changing work.** The dispatched reviewer sub-agent owns code reads, the verdict comment, and the terminal label flip.
