Fix the review feedback on GitHub task issue #<task-#> ("<task-title>").
URL: <task-url>
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and re-added the `review:*-pending` labels on the GitHub task.

Reviewer gates that reported `need-fix` (read the matching reviewer comment on the issue):
- code
- security

Fetch any further context you need (issue body, reviewer findings comments, parent slice issue, slice branch, etc.) yourself via `gh` — you have the issue ID.
