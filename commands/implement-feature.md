---
description: Drive one outer pass over a feature milestone's slice lifecycle. The inner slice cycle (author E2E → coverage gate → implement → pass E2E → review → fix → open draft PR) runs entirely inside ONE background `implement-slice` Workflow per slice, so this command owns only four stages: reconcile dead-workflow locks, launch a workflow for each eligible slice, and the two external-wait PR stages (fix-pr, close-pr). Run the `task-finder.sh` script once (read-only, no LLM) to find candidates across those four stages, then perform the per-stage label flips + `Workflow`/`Agent` dispatch (or merge) directly. Across slices, work runs in parallel (one workflow per slice); within a slice everything is serial inside its workflow. Each pass is a snapshot. Run under self-paced `/loop /implement-feature <feature-name>`: every backgrounded run's completion re-invokes the orchestrator (event-driven fast path), backstopped by a long `ScheduleWakeup` reconcile pass. The loop ends only when a pass dispatches nothing and no tracking tasks remain.
argument-hint: <feature-name>
---

# implement-feature

Run one full sweep across the four outer-loop stages, in order, for a single feature milestone.

- **Discovery** is owned by the `task-finder.sh` script (read-only, single run, no LLM).
- **Every state mutation** — the kickoff lock flip + `Workflow` launch, reconcile lock releases, `Agent` dispatch for `fix-pr`, draft → ready promotion, squash-merge — is owned by this command.

The inner slice lifecycle is NOT this command's concern. Once Stage 1 launches a slice's `implement-slice` Workflow, that one background run owns author-E2E → coverage gate → plan → implement → pass-E2E → slice-review → fix → open-draft-PR by itself (see `workflow-implement-slice` / `workflows/implement-slice.mjs`). This command only kicks it off, reaps it if it dies, and handles the PR afterward.

The `task-finder-stage-<n>-<name>.sh` scripts under `skills/operation-git/scripts/` (reconcile stage 0, kickoff stage 1, fix-pr stage 8, close-pr stage 9) are pure discovery and emit eligible-candidate lists only; they never flip labels, never launch workflows, never dispatch agents, never merge PRs.

This command does **not** wait for backgrounded work to finish *within* a pass. Once a workflow or agent is launched, the command moves on and ends the pass. What carries the milestone forward *across* passes is the trigger model in **Step 4** — a backgrounded run finishing re-invokes the orchestrator (event-driven fast path), backstopped by a long `ScheduleWakeup`. Run under self-paced `/loop /implement-feature <feature-name>` (no interval) so those re-invocations re-enter this command.

## Arguments

Exactly one positional argument: `<feature-name>` — the GitHub milestone name created by `/deep-dive-feature` and used by `create-feature-issues` to group every slice issue and inherited by every slice PR.

If `<feature-name>` is missing or empty, stop and ask the user for it before dispatching anything.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### Step 0.5 — Close finished tracking tasks

If this pass was re-invoked by one or more `<task-notification>` messages, each names a backgrounded run (an `implement-slice` Workflow or a `fix-pr` engineer) dispatched in a prior pass that has now finished. Before Step 1, call `TaskList`; for each notification, find the open tracking task whose `owner` matches the finished run's name (both encode the same slice/PR number) and `TaskUpdate({ taskId, status: "completed" })`. A notification with no matching open task is benign; skip silently.

### Step 1 — Run `task-finder.sh` (single shot, no LLM)

Run the discovery script **once** with `<feature-name>` so its report is available before any mutation. The script is pure shell — no agent dispatch, no `Skill` invocations, no LLM round-trips:

```
Bash({
  command: "bash skills/operation-git/scripts/task-finder.sh '<feature-name>'",
  description: "Discover lifecycle candidates for the <feature-name> milestone"
})
```

The script returns ONE markdown report covering the four stages on stdout. Parse positionally:

- Each stage section is `## Stage <N>: <stage-name>` followed by one or more `- ...` lines.
- Every listed candidate is ELIGIBLE — `task-finder.sh` and its per-stage scripts drop ineligible candidates silently.
- Pipe-delimited fields per candidate are positional (see the corresponding `task-finder-stage-<n>-<name>.sh` header comment for field order).
- A stage whose only line is `- (none)` has no work this pass.

If the script exits non-zero, stderr carries a diagnostic (`task-finder: not a GitHub repo`, `task-finder: milestone "<n>" not found`, `task-finder: stage <n> (<name>) failed: …`). Surface that verbatim and stop. Do not improvise.

### Step 2 — Process the report, stage by stage

Process the stages **in order, Stage 0 first** (cross-stage cascade *within* a pass is not preserved — the snapshot is frozen at `task-finder.sh` time; the `/loop` wrapper carries it across passes). Within each stage, eligible candidates **fan out in parallel** — emit all per-candidate dispatch + `TaskUpdate(owner)` calls together in one batched response. There is **no per-slice budget** to track: a slice is either locked (`status:in-progress`, a workflow is running — kickoff excludes it) or it isn't, and each slice's inner work is serialized inside its own single workflow.

If a stage's candidate list is `- (none)`, log `Stage <N> (<stage-name>): nothing to pick up` and move on.

Use the `operation-git` skill's `gh-commands` reference and `dispatch-prompt` template as the source of truth for query / mutation shapes. Fill **only** the issue/PR number into the chosen `dispatch-prompt.md` skeleton — never add failure context, CI output, or diagnosis.

---

#### Stage 0 — `reconcile` (release orphaned locks; no launch)

Process this stage **first**. It launches nothing.

Stage 0 lists work frozen in an in-flight lock state whose owning process died mid-run (SIGKILL under memory pressure, a killed process tree, a hung run) without releasing the lock. Two signatures survive the per-slice-Workflow redesign:

- A **slice** carrying `status:in-progress` — the kickoff lock — whose `implement-slice` Workflow is gone (stale telemetry heartbeat + stale GitHub activity).
- A **draft PR** carrying `status:fix-in-progress` whose `fix-pr` engineer is gone.

This stage **releases the lock**; it does NOT resurrect the dead run. The next `/loop` pass re-discovers the released item and re-launches a **fresh** run, which resumes from durable state (the slice branch's WIP commits + the slice body's task checklist + the Workflow's resume journal). Releasing a lock this pass does NOT make the item eligible for Stages 1/8/9 *this* pass — the snapshot is frozen; recovery lands next pass.

For each orphan line, apply the label flip named by its `release:<action>` token, then (best-effort) clean up the dead run's tracking task:

| `release:<action>` | Line prefix | Label flip |
|--------------------|-------------|------------|
| `ready-to-implement` | `slice:#<n>` | `gh issue edit <n> --remove-label "status:in-progress" --add-label "status:ready-to-implement"` |
| `clear-fix-pr`       | `pr:#<n>`    | `gh pr edit <n> --remove-label "status:fix-in-progress"` |

Each flip exactly reverses the lock the orchestrator applied at dispatch. After flipping, if a tracking task whose `owner` encodes this number is still open in `TaskList` (e.g. `implement-slice-<n>`, `engineer-fix-pr-<n>`), `TaskUpdate({ taskId, status: "deleted" })` — its run is gone. A missing tracking task (different session) is benign; skip silently.

Treat a `422` from a flip (label already moved by a concurrent fire) as benign and skip. Stage 0 never launches, never merges.

The death gate is owned by the script: a runtime-telemetry liveness heartbeat (authoritative — a fresh `last_seen` on any of the workflow's child engineer / reviewer agents proves the run is alive and is never reaped, no matter how quiet GitHub is) with GitHub-activity staleness as the fallback (`RECONCILE_HEARTBEAT_STALE_MINUTES` / `RECONCILE_STALE_MINUTES`, both default 30). Do NOT second-guess a listed orphan — `task-finder.sh` already applied the gate.

---

#### Stage 1 — `kickoff-slice` (lock flip + `Workflow` launch)

For each eligible slice `#<slice-#>` (line format: `- #<slice-#> | "<title>"`):

1. **Lock**: `gh issue edit <slice-#> --remove-label "status:ready-to-implement" --add-label "status:in-progress"`. The lock is what makes the slice invisible to the next pass's kickoff stage (it queries `--missing-label status:in-progress`) and what the reconcile reaper releases on death. On `422` (concurrent fire already flipped it) treat as benign and skip; anything else → surface and stop.
2. **TaskCreate** (capture `taskId`):
   ```
   subject:     Implement slice #<slice-#>: <slice-title>
   description: <slice-url>. Launching the implement-slice Workflow to drive the
                whole inner cycle (author E2E → coverage gate → implement → pass
                E2E → review → fix → open draft PR). On halt it flips
                status:need-attention; on success it opens a merge:manual draft PR
                and releases the lock.
   activeForm:  Implementing slice #<slice-#>
   ```
3. **`Workflow` + `TaskUpdate(owner)` in the same batched response**:
   - **Tool**: `Workflow`
   - `scriptPath`: `${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs` (plugin-shipped, not a consuming-project `.claude/workflows/` entry — resolve `$CLAUDE_PLUGIN_ROOT` from the environment the same way the plugin's hooks do, then pass the absolute path)
   - `args`: `{ "slice": <slice-#>, "today": "<YYYY-MM-DD>" }`
     - `today` — pass today's date explicitly; the workflow runtime has no clock and stamps the PR body's review-verdict line.
     - There is no `reviewScriptPath`: the fan-out review is inlined in `implement-slice.mjs` as the `runReviewSlice()` function (it spawns one `axis-reviewer` agent per pattern), so there is no child workflow to resolve by path.
   - Pair with `TaskUpdate({ taskId, owner: "implement-slice-<slice-#>" })` in the same batched response.

   The workflow runs in the background, returns a task id immediately, and notifies on completion — the same lifecycle as a backgrounded agent, so the loop-continuation accounting in Step 4 is unchanged (it keys off the `implement-slice-<slice-#>` tracking owner). The workflow owns everything internally; it flips `status:in-progress` → `status:need-attention` on halt, or releases the lock and opens the draft PR on success.

   > **Fallback.** If `Workflow` is unavailable in the running harness, there is no single-agent equivalent for the *whole* slice cycle (the old per-stage label dispatch was removed in this redesign). Surface that the harness lacks `Workflow` and stop — do NOT attempt to hand-drive the cycle.

Roll back on synchronous launch failure: restore `status:ready-to-implement` (remove `status:in-progress`) AND `TaskUpdate({ taskId, status: "deleted" })`. Do NOT roll back on internal workflow failure — once backgrounded, the workflow owns the lifecycle (and halts to `status:need-attention` on its own).

---

#### Stage 8 — `fix-pr` (lock + `TaskCreate` + `Agent`)

For each eligible draft PR (line format: `- PR #<pr-#> | slice:<slice-#> | "<title>"`):

1. **Lock**: `gh pr edit <pr-#> --add-label "status:fix-in-progress"`.
2. **TaskCreate**:
   ```
   subject:     Fix PR #<pr-#>: <pr-title>
   description: <pr-url>. Engineer determines fix scope (conflict/CI/both)
                from live PR state. Agent owns the lifecycle until it pushes
                and removes status:fix-in-progress from the PR.
   activeForm:  Fixing PR #<pr-#>
   ```
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `engineer`
   - `mode`: `auto`
   - `name`: `engineer-fix-pr-<pr-#>`
   - `run_in_background`: `true`
   - `prompt`: fill the "Fix a PR" skeleton from `operation-git/templates/dispatch-prompt.md` with `<pr-#>`

Roll back on dispatch failure by removing `status:fix-in-progress` and deleting the tracking task.

---

#### Stage 9 — `close-pr` (sequential, no agent dispatch)

Process PRs **sequentially** — concurrent `gh pr merge` calls race on the base branch.

For each eligible draft PR (line format: `- PR #<pr-#> | slice:<slice-#> | merge:<auto|manual> | "<title>"`):

1. **Defense-in-depth re-check** against live state: `gh pr view <pr-#> --json mergeable,statusCheckRollup`. If `mergeable != "MERGEABLE"` OR any rollup state is not SUCCESS / NEUTRAL / SKIPPED → skip (`merge race / no longer eligible`).
2. **Promote draft → ready — always**: `gh pr ready <pr-#>`. Every mergeable draft is opened, regardless of merge-mode.
3. **Auto-close only when `merge:auto`.** If the line's merge-mode is `manual`, stop here: the PR is now open for the user to merge — do NOT merge. If the merge-mode is `auto`, continue.
4. **Squash-merge with branch deletion** (`merge:auto` only): `gh pr merge <pr-#> --squash --delete-branch`. Slice closure happens automatically via the PR body's `Closes #<slice-#>` line (filled in by `implement-slice`'s PR phase).
5. **On merge race** (GitHub recomputed mergeability between step 1 and 4): undo the ready promotion with `gh pr ready <pr-#> --undo` and skip.

No `TaskCreate`, no `Agent`. Never `--force`; never push directly to `main`; never override branch protection.

---

### Step 3 — Emit one summary line

After Stage 9, print exactly one summary line:

```
implement-feature(<feature-name>): pass complete (reconcile <RC> / kickoff <K> / fix-pr <FPR> / close-pr <CP>)
```

Each count is the number of candidates *processed* in this fire (lock releases for stage 0, workflow launches for stage 1, dispatches for stage 8, draft → ready promotions for stage 9 — whether or not the PR was also auto-merged). Skipped candidates (failed the defense-in-depth re-check, lost a merge race) are NOT counted.

### Step 4 — Arm the next trigger (event-driven fast path + slow backstop)

A "pass" is everything Steps 0–3 just did. This step decides what triggers the *next* pass. Every trigger does the same thing: run `task-finder.sh` and process the newly-eligible candidates. The only question is **when**. Three triggers:

- **Fast path (event-driven, primary).** When a backgrounded `implement-slice` Workflow or `fix-pr` engineer dispatched in a prior pass finishes, the harness re-invokes the orchestrator with a `<task-notification>`. Under the `/loop` wrapper that re-enters this command — a fresh pass. A finished `implement-slice` has already opened its draft PR (surfacing it to Stage 8/9) or halted to `status:need-attention`. **Do NOT schedule a short-interval wakeup to poll for in-flight runs** — completion re-invocation is automatic.
- **Slow backstop (timer, safety net).** Three things produce no completion notification, so the fast path is blind to them: (1) a workflow / engineer SIGKILLed under memory pressure never signals "done" — its orphaned lock is only recoverable by **Stage 0 reconcile**; (2) a `Blocked by` chain unblocks when *this command* merges a slice PR (Stage 9), not when any run finishes; (3) the orchestrator session itself may be lost. Cover all three with one long backstop wake, armed at the end of every pass that still has work in flight:

  ```
  ScheduleWakeup({
    delaySeconds: 1800,
    prompt: "/loop /implement-feature <feature-name>",
    reason: "implement-feature backstop for <feature-name>: reconcile dead workflows + flow merge-driven cascades"
  })
  ```

  1800s is a backstop, not a poll — the fast path fires far sooner whenever a run actually finishes. Keep it long.
- **Manual.** `/implement-feature <feature-name>` invoked directly runs exactly one pass and arms the same backstop.

**Choosing the trigger at the end of a pass** — count work still in flight: open tracking tasks in `TaskList` whose `owner` matches this command's dispatch naming (`implement-slice-*`, `engineer-fix-pr-*`), unioned with anything dispatched this pass.

- **Work in flight** → arm the backstop `ScheduleWakeup` above and end the turn. The fast path re-invokes you the moment a run finishes; the backstop only fires if nothing does within 30 min.
- **Nothing in flight AND this pass's finder report was all `- (none)` across every stage** → the milestone is **quiescent**. Emit the summary line, arm **no** wakeup, and end the loop. This is the sole stop condition.

Never stop the loop while any tracking task is still open — a quiet GitHub is not quiescence if a run is mid-flight.

## Iron rules

- **Reconcile (Stage 0) runs first, releases locks, launches nothing.** It only flips an orphaned lock back to its pre-dispatch state so the next `/loop` pass re-launches a fresh run from durable state (WIP commits + slice checklist + workflow journal). It never resurrects the dead run, never merges. Released items are NOT eligible for Stages 1/8/9 this pass — recovery lands next pass.
- **The inner slice cycle lives entirely in one `implement-slice` Workflow.** This command does not author specs, implement, review, or fix slices — it launches the workflow and the workflow does all of that. The only agent this command dispatches directly is the `fix-pr` engineer (Stage 8), an external-wait stage.
- **The next pass is triggered by a run finishing, not by a clock.** A dispatched workflow/agent's completion re-invokes the orchestrator (fast path); a single long `ScheduleWakeup` (default 1800s) is the *backstop* that catches dead runs, merge-driven `Blocked by` cascades, and a lost session — never a poll. The loop stops only on **quiescence**: a pass that dispatches nothing AND has zero open tracking tasks. See Step 4.
- **One milestone per invocation.** `<feature-name>` flows into the `task-finder.sh` invocation and into every per-stage mutation.
- **One `task-finder.sh` run per pass.** Single shot, no LLM. Do NOT call it once per stage; do NOT call it again mid-pass; do NOT dispatch an agent to wrap the call.
- **The `task-finder.sh` report is the SOLE source of truth for what to process.** Do not re-query GitHub for candidate lists — the report is the snapshot. The Stage 9 defense-in-depth re-check (`gh pr view --json mergeable,statusCheckRollup`) is the one allowed live re-read — a go/no-go gate, not a diagnosis.
- **Stages run in order; candidates within a stage fan out in parallel.** There is no per-slice budget — the `status:in-progress` lock (one workflow per slice) is the serialization, and kickoff excludes already-locked slices. Cross-stage cascade *within* a pass is not preserved; the `/loop` wrapper carries it across passes.
- **Lock before launch/dispatch, every mutating stage.** Stage 1's `status:ready-to-implement` → `status:in-progress` flip and Stage 8's `--add-label status:fix-in-progress` are the locks. On synchronous launch/dispatch failure, roll back BOTH the lock AND the tracking task. Do NOT roll back on internal failure — once backgrounded, the run owns the lifecycle.
- **One tracking task per backgrounded run.** Never reuse a `taskId`; never launch a `Workflow` / spawn an `Agent` without a paired `TaskCreate` + `TaskUpdate(owner)` in the same batched response.
- **Close a tracking task the moment its run finishes.** A `<task-notification>` is the close signal: at pass entry match it to the open tracking task by `owner` and mark it `completed`. Stage 0 reconcile only `deleted`s tasks for runs that *died*; this covers runs that *completed normally*.
- **`kind:feature` only.**
- **No code-changing work in this command itself.** Every code change, push, comment, and PR merge beyond `gh pr ready` / `gh pr merge` (Stage 9) is owned by the workflow or the dispatched `fix-pr` agent.
- **Detect-and-dispatch, never analyze.** The orchestrator never inspects code, CI logs, test output, diffs, or failing files to diagnose a candidate. `task-finder.sh` has already gated eligibility (a fix-pr candidate *means* CI failed or there's a conflict). Do NOT run `gh run view` / `gh pr checks` / log greps. The one read the orchestrator may do is the Stage 9 defense-in-depth re-check.
- **Stage 9 promotes every mergeable draft to ready; it auto-closes only `merge:auto`.** `gh pr ready` runs for all mergeable drafts; `gh pr merge --squash --delete-branch` runs only when the candidate line's merge-mode is `auto`. `merge:manual` drafts are left open for the user. Never `--force`, never push to `main`, never override branch protection.
- **Skip, don't fail, on benign outcomes** — `422` from a label flip race, `merge race` from recomputed mergeability, `nothing to pick up` from a stage whose only line is `- (none)`.
- **`status:need-attention` is a user-owned halt — never block, never recover it.** When the `implement-slice` workflow flips a slice to `status:need-attention`, the orchestrator does nothing to it: never call `AskUserQuestion`, never pause the loop, never flip the label back. `task-finder.sh` already drops it from every stage. Recovery is the user's — they comment on the slice and flip `status:need-attention` → `status:ready-to-implement`, after which kickoff re-discovers and relaunches it.
