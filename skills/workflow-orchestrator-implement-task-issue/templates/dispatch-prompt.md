Implement GitHub task issue #<task-#> ("<task-title>").
URL: <task-url>
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and added the `review:*-pending` labels on the GitHub task.

Fetch any further context you need (body, labels, parent slice issue, parent branch, etc.) yourself via `gh` — you have the issue ID.
