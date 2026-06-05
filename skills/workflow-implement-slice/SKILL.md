---
name: workflow-implement-slice
description: The per-slice Workflow that drives ONE slice through its entire inner lifecycle — author E2E → E2E coverage gate → plan → implement → pass E2E → slice review → fix → open draft PR — inside a single background `Workflow` run. Realized by `workflows/implement-slice.mjs` (invoked by `scriptPath`, not loaded as an agent skill). Launched by `/implement-feature` Stage 1 once per eligible slice after the orchestrator flips `status:ready-to-implement` → `status:in-progress` (the slice lock). Activate to understand or invoke the slice cycle, or on '/workflow-implement-slice'.
---

# workflow-implement-slice

The slice-level orchestration unit. Unlike the other `workflow-*` skills (which are
procedures an *agent* loads), this one is realized as a **`Workflow` script** —
`workflows/implement-slice.mjs` — because it must fan out child agents (the review
runs one `axis-reviewer` agent per pattern), which a single agent cannot do. It
is the only workflow in the slice lifecycle: the review fan-out is inlined as the
`runReviewSlice()` function rather than a separate child workflow. See
`workflows/README.md` for the full picture.

## What it owns

One background run per slice. It owns the entire inner cycle — including the
fan-out review (coverage gate + slice review) — that the old 9-stage label-driven
`/implement-feature` used to round-trip through GitHub labels:

```
Prep → Author E2E → Coverage gate → Plan → Implement → Pass E2E → Slice review → PR
```

GitHub keeps only durable, human-relevant state: the slice issue, the
`status:in-progress` lock (held for the whole run), the `status:need-attention`
halt, and the final draft PR. Task tracking lives in the slice body's `## Tasks`
static-ID checklist — the workflow's Prep phase parses it, and each dispatched
agent ticks its **task** boxes as it finishes (a progress claim). The slice's
**AC** checkboxes are a separate ledger: they are ticked by the workflow at the
end of the Slice-review phase, on APPROVE only — the engineer's task tick is a
claim; the reviewer-gated AC tick is the verified gate (Decision 1 of
`docs/test-layering-and-gates.md`).

## Phases

| Phase | Realization | Notes |
|-------|-------------|-------|
| Prep | `agent()` | Read the slice body, parse the checklist (the resume source), resolve branch + PR metadata. |
| Author E2E | `agent({agentType: e2e-author})` | One dispatch for every not-yet-`[x]` e2e task. Skipped if no e2e tasks. |
| Coverage gate | `runReviewSlice('test-coverage')` + `e2e-author` fix loop | Static review of the authored specs vs AC + non-happy-paths. Loops to APPROVE (no round cap). |
| Plan | `agent()` | Group impl tasks into ordered engineer dispatches (DAG-respecting, ≤3 tasks/group). |
| Implement | `agent({agentType: engineer})` | Groups run **serially** (shared worktree). Done groups skipped. |
| Pass E2E | `agent({agentType: engineer})` diagnose → per-group fix loop | Each round: one **diagnose** dispatch boots the stack, runs the specs, and categorizes failures into correlated groups; then one **fix** dispatch per group runs **serially** (shared worktree). Loops (uncapped) until a round diagnoses GREEN; a test-case constraint → `halt()`. |
| Slice review | `runReviewSlice('production-code')` + `engineer` fix loop, then AC-tick | Loops to APPROVE (no round cap), judging each task at its **owning layer** (the per-task discharge ledger). On APPROVE, ticks every AC checkbox — the verified gate. |
| PR | `agent()` | Open the idempotent `merge:manual` draft PR (`Closes #<slice>`). |

## Contract

- **Serial within a slice.** All tasks share one branch/worktree, so two authors
  can't run at once. Parallelism is **across** slices (multiple launches).
- **No convergence cap.** Each fix loop (coverage gate, implement re-dispatch,
  slice review) runs until it reaches confidence to pass — review `APPROVE`, or
  every task ticked `[x]` — not a fixed number of rounds. Aggressive `axis-reviewer`
  recall + the fan-out's adversarial verify keep the loops convergent: only a
  finding that survives refutation holds a gate open, and `production-code` review blocks on
  `I:H` alone. An infra failure inside `runReviewSlice()` (e.g. the worktree won't
  set up) returns `{ error }` and halts, so the uncapped loop can't spin on it. The
  deleted budget gate's "bound the context" role is covered by the planner's
  ≤3-tasks-per-group size cap.
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
  args: {
    slice: <slice-#>,
    today: "<YYYY-MM-DD>"
  }
})
```

`today` is required — the workflow runtime has no clock. There is no longer a
`reviewScriptPath`: the review fan-out is inlined as `runReviewSlice()`, so there
is no child workflow to resolve by path (and none of the v0.40 scriptPath-passing
fragility).
