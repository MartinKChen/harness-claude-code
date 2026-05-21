Fix PR #<pr-#> in Mode B.
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've pushed and removed `status:fix-in-progress` from the PR.

Determine the fix scope yourself — inspect the PR's mergeability and head-SHA check rollup via `gh` (per your skill's step 2) and address every blocker you find (merge conflict, failing CI, or both). You have the PR number; fetch any further context via `gh` and `git`.
