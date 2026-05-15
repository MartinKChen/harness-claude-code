---
name: close-task-issue
description: "Close every open `level:task` + `kind:feature` + `status:in-progress` task whose required review gates have all reached `*-passed`. `type:backend` / `type:frontend` need both `review:code-passed` and `review:security-passed`; `type:e2e` needs only `review:code-passed` (test cases skip the security gate). Activate on phrases like 'close out the green task issues', 'close passed tasks', 'close task issues whose reviews passed', '/close-task-issue', or whenever the orchestrator needs to finalize task issues that have green review gates. Do NOT activate to dispatch reviewers (use `review-task-issue`), merge a PR (use `close-pr`), or close a slice issue (handled implicitly by `close-pr`)."
---

# close-task-issue

The terminal step of the task lifecycle. When every required review gate on a task has flipped to `-passed`, the task is done — strip `status:in-progress` and close the issue. This skill is the *only* place a task issue gets closed; engineers and reviewers leave the lifecycle to this skill.

Required gates depend on the task's `type:*` label:

| Task `type:*` label | Required `*-passed` labels                              |
|---------------------|---------------------------------------------------------|
| `type:backend`      | `review:code-passed` AND `review:security-passed`       |
| `type:frontend`     | `review:code-passed` AND `review:security-passed`       |
| `type:e2e`          | `review:code-passed` (test cases skip security review)  |

The skill never checks out, edits, or pushes to any branch. It mutates GitHub issue state only.

## When to activate

Activate this skill whenever the user:

- Types `/close-task-issue` (with or without a numeric cap argument).
- Asks to "close out the green tasks", "close task issues with passed reviews", or "finalize tasks whose review gates are all `*-passed`".

Do NOT activate when the user wants to dispatch reviewers (use `review-task-issue`), wants to merge a slice PR (use `close-pr`), or wants to close a slice issue directly (slice issues close as a side effect of `close-pr`).

## Arguments

Up to two optional positional arguments: `[<milestone-name>] [<cap>]`.

- `<milestone-name>` — when set, scope the task scan to issues attached to that GitHub milestone (the feature name passed by `/implement-feature <feature-name>`, which matches the milestone used by `create-issues`). Empty / unset → scan every milestone.
- `<cap>` — optional positive integer; stop after N tasks have been closed. Empty / unset → close every eligible task.

When both args are passed, `<milestone-name>` comes first and `<cap>` second. When only one arg is passed and it parses as a positive integer, treat it as `<cap>` with no milestone filter; otherwise treat it as `<milestone-name>` with no cap.

## Workflow

### 1. Resolve the repo

```bash
repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"   # owner/repo
```

If the working dir isn't a GitHub repo, surface and stop.

### 2. List candidate tasks

A task is a candidate when it is **open**, carries `level:task` + `kind:feature` + `status:in-progress`, and carries `review:code-passed`. (Code-passed is universal across `type:*`, so it's the cheapest pre-filter; we re-check the full required-gate set per task in step 3.) When `<milestone-name>` is set, append `--milestone "${milestone}"` so the scan is scoped to that feature; otherwise omit the flag.

```bash
gh issue list \
  --state open \
  --label "level:task" \
  --label "kind:feature" \
  --label "status:in-progress" \
  --label "review:code-passed" \
  ${milestone:+--milestone "${milestone}"} \
  --json number,title,labels,url \
  --limit 200
```

If empty, report "nothing to close" and stop. When a milestone filter was applied, include it: `nothing to close (milestone: <milestone-name>)`.

### 3. Validate the full required-gate set per task

For each candidate, read its `labels` array and apply the type-specific rule:

- Exactly one `type:*` label must be present. If zero or more than one, log `skipped #<n> — malformed type label(s): <list>` and continue.
- Compute the required-passed set from the table above.
- Drop the candidate if any required `*-passed` label is missing — log `skipped #<n> — missing required gate(s): <list>`. (A task still mid-review will fall here.)
- Drop the candidate if any `review:*-pending`, `review:*-running`, or `review:*-need-fix` label is *also* present — that means a fresh review cycle is in flight and closing now would race the reviewer. Log `skipped #<n> — review cycle in flight: <list>` and continue.

### 4. Close the task

In one atomic sequence per task: remove `status:in-progress`, then close. The `gh issue close` call also accepts `--reason completed`, which is the right reason here (the work landed cleanly).

```bash
gh issue edit "${task_number}" --remove-label "status:in-progress"
gh issue close "${task_number}" --reason completed
```

If the `--remove-label` call fails because the label was already removed by a concurrent fire (`422`), treat it as benign and proceed to the close. If the close fails (the issue was already closed by another runner), also treat as benign — the desired end state is already in place. Any other failure: surface verbatim and stop processing further candidates for this run.

### 5. Honor the cap and report

If the user passed a positive integer N, stop after N tasks have been closed this run. Already-skipped tasks do **not** count.

One-line-per-task summary:

- `closed     #<n> "<title>" (type:<type>)`
- `skipped    #<n> "<title>" — missing required gate(s): <list>`
- `skipped    #<n> "<title>" — review cycle in flight: <list>`
- `skipped    #<n> "<title>" — malformed type label(s): <list>`
- `skipped    #<n> "<title>" — cap reached (closed N this run)`

End with: `Closed <X>; skipped <Y>; <Z> remaining eligible.`

## Iron rules

- **Required gates differ by `type:*`.** `type:e2e` skips the security gate by design — test cases have no production attack surface to validate. Do NOT widen or narrow the required-passed set without updating the rule table above.
- **Race-safe by re-check.** Step 3 re-reads each candidate's labels after the step-2 list call, so a task that picked up a fresh `*-need-fix` or `*-pending` between list and close is correctly skipped.
- **No reopening of closed tasks.** This skill only closes; reviewers/engineers reopen when they need to drive a fresh fix cycle.
- **No slice or PR mutation.** Closing the last task on a slice does **not** merge the slice PR — that's `close-pr`'s job, driven independently off the slice PR's check + mergeability state.
- **Skip, don't fail, on benign outcomes.** Already-removed labels, already-closed issues, missing gates, and cap-reached are all expected — log and continue.
