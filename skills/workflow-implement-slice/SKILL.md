---
name: workflow-implement-slice
description: The per-slice Workflow that drives ONE slice through its entire inner lifecycle — author E2E → E2E coverage gate → plan → implement → pass E2E → slice review → fix → open draft PR — inside a single background `Workflow` run. Realized by `workflows/implement-slice.mjs` (invoked by `scriptPath`, not loaded as an agent skill). Launched by `/implement-feature` Stage 1 once per eligible slice after the orchestrator flips `status:ready-to-implement` → `status:in-progress` (the slice lock). Activate to understand or invoke the slice cycle, or on '/workflow-implement-slice'.
---

# workflow-implement-slice

The slice-level orchestration unit. Unlike the other `workflow-*` skills (which are
procedures an *agent* loads), this one is realized as a **`Workflow` script** —
`workflows/implement-slice.mjs` — because it must fan out child agents and call a
child workflow, which a single agent cannot do. It is the TOP of a strictly
two-layer architecture; see `workflows/README.md` for the full picture.

## What it owns

One background run per slice. It owns the entire inner cycle that the old 9-stage
label-driven `/implement-feature` used to round-trip through GitHub labels:

```
Prep → Author E2E → Coverage gate → Plan → Implement → Pass E2E → Slice review → PR
```

GitHub keeps only durable, human-relevant state: the slice issue, the
`status:in-progress` lock (held for the whole run), the `status:need-attention`
halt, and the final draft PR. Task tracking lives in the slice body's `## Tasks`
static-ID checklist — the workflow's Prep phase parses it, and each dispatched
agent ticks its boxes as it finishes.

## Phases

| Phase | Realization | Notes |
|-------|-------------|-------|
| Prep | `agent()` | Read the slice body, parse the checklist (the resume source), resolve branch + PR metadata. |
| Author E2E | `agent({agentType: e2e-author})` | One dispatch for every not-yet-`[x]` e2e task. Skipped if no e2e tasks. |
| Coverage gate | `workflow('review-slice', {scope:'coverage'})` + `e2e-author` fix loop | Static review of the authored specs vs AC + non-happy-paths. Cap `FIX_CAP`. |
| Plan | `agent()` | Group impl tasks into ordered engineer dispatches (DAG-respecting, ≤3 tasks/group). |
| Implement | `agent({agentType: engineer})` | Groups run **serially** (shared worktree). Done groups skipped. |
| Pass E2E | `agent({agentType: engineer})` | Run specs vs booted stack, drive production code to GREEN. `need-attention` → halt. |
| Slice review | `workflow('review-slice', {scope:'full'})` + `engineer` fix loop | Cap `FIX_CAP`. |
| PR | `agent()` | Open the idempotent `merge:manual` draft PR (`Closes #<slice>`). |

## Contract

- **Serial within a slice.** All tasks share one branch/worktree, so two authors
  can't run at once. Parallelism is **across** slices (multiple launches).
- **`FIX_CAP`** (default 4) caps each fix loop — the circuit breaker that replaced
  the deleted engineer budget gate's "stop runaway" role. The gate's "bound the
  context" role is covered by the planner's ≤3-tasks-per-group size cap.
- **`halt()`** flips `status:in-progress` → `status:need-attention` and posts a
  comment — the only path to a human. `/implement-feature` never recovers it.
- **Resume.** A cold restart re-reads the checklist (ticked `[x]` = done, skipped)
  and the `Workflow` resume journal replays unchanged `agent()` prefixes. There
  are no handoff docs — crash recovery is the slice branch's WIP commits (each
  carrying `Task: <id>` + `Refs #<slice>`) plus the durable checklist.

## How it's launched

`/implement-feature` Stage 1, per eligible slice:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs",
  args: { slice: <slice-#>, today: "<YYYY-MM-DD>" }
})
```

`today` is required — the workflow runtime has no clock. The child
`workflow('review-slice', …)` is resolved by `name:` within the same run.
