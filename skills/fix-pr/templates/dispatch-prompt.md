Fix PR #<pr-#> in Mode B.
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and removed `status:fix-in-progress` from the PR.

Scenarios to address (handle every one listed):
- conflict
- ci

Fetch any further context yourself via `gh` and `git` — you have the PR number.
