Prepare draft PR for slice issue #<slice-#>.
Orchestrator tracking task: <taskId> — call `TaskUpdate({ taskId: "<taskId>", status: "in_progress" })` when you begin and `TaskUpdate({ taskId: "<taskId>", status: "completed" })` once you've either (a) pushed, opened the draft PR, and removed `status:prepare-pr` from the slice, or (b) flipped the slice to `status:need-attention` (also removing `status:prepare-pr`) with a diagnostic comment.

The slice carries `level:slice` + `kind:feature` + `status:in-progress` + `status:prepare-pr`. Every task sub-issue is already closed and no PR exists on the slice branch yet — both pre-conditions were confirmed by the orchestrator. Fetch any further context yourself via `gh` and `git` — you have the slice number.
