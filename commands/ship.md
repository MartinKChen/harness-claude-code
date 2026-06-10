---
description: Drive one outer pass over the unified ship lifecycle for ALL three kinds — feature, enhancement, and bug. Runs ship-finder.sh once (read-only) to find candidates across five stages — reconcile dead locks, analyze new bugs, launch the per-unit workflow (implement-slice or fix-bug), and two external-wait PR stages — then does the label flips + dispatch. Milestone is OPTIONAL: scope to a feature, or omit for the repo-wide maintenance lane. Run under self-paced `/loop /ship [milestone]`.
argument-hint: "[milestone]"
---

# ship

Run one full sweep across the five outer-loop stages, in order, for the whole repo or a single milestone. This is the unified superset of `/implement-feature`: it adds the bug lifecycle (analyze → human gate → fix) and the enhancement lane on top of the feature flow. `/implement-feature` remains as a feature-only fallback.

- **Discovery** is owned by `ship-finder.sh` (read-only, single run, no LLM).
- **Every state mutation** — reconcile lock releases, the analyze lock + `Agent` dispatch, the kickoff lock + `Workflow` launch, the `fix-pr` `Agent` dispatch, draft → ready promotion, squash-merge — is owned by this command.

The inner cycle is NOT this command's concern. Once kickoff launches a unit's workflow (`implement-slice.mjs` for a feature/enhancement/refactor slice, `fix-bug.mjs` for a bug), that one background run owns the whole inner cycle by itself. This command only kicks it off, reaps it if it dies, and handles the PR afterward.

## Arguments

Exactly zero or one positional argument: an optional `<milestone>`.

- **With `<milestone>`** — scope every stage to that GitHub milestone (the feature flow, plus any enhancements/bugs tagged to it).
- **Without** — the **repo-wide maintenance lane**: process all open `kind:bug` + `kind:enhancement` + `kind:refactor` (and any milestone-less features) across the repo.

A named milestone that does not exist is a hard error from `ship-finder.sh` (surface and stop). No argument is NOT an error — it selects repo-wide mode.

## Workflow

### Step 0 — Resolve the repo

`gh repo view --json nameWithOwner --jq .nameWithOwner`. If the working dir isn't a GitHub repo, surface and stop.

### Step 0.5 — Close finished tracking tasks

If this pass was re-invoked by one or more `<task-notification>` messages, each names a backgrounded run that has now finished (an `implement-slice` / `fix-bug` Workflow, an `analyze-bug` engineer, or a `fix-pr` engineer) dispatched in a prior pass. Call `TaskList`; for each notification, find the open tracking task whose `owner` matches the finished run's name and `TaskUpdate({ taskId, status: "completed" })`. A notification with no matching open task is benign; skip silently.

### Step 1 — Run `ship-finder.sh` (single shot, no LLM)

Run the discovery script **once**, passing the milestone if one was given (omit the argument entirely for repo-wide mode):

```
Bash({
  command: "bash skills/operation-git/scripts/ship-finder.sh '<milestone-or-omit>'",
  description: "Discover ship lifecycle candidates"
})
```

The script returns ONE markdown report on stdout. Parse positionally:

- Each stage section is `## Stage: <name>` (`reconcile`, `analyze-bug`, `kickoff`, `fix-pr`, `close-pr`) followed by one or more `- ...` lines.
- Every listed candidate is ELIGIBLE — `ship-finder.sh` and its stage scripts drop ineligible candidates silently.
- Pipe-delimited fields per candidate are positional (see each `ship-stage-<name>.sh` header for field order).
- A stage whose only line is `- (none)` has no work this pass.

If the script exits non-zero, stderr carries a diagnostic (`ship-finder: not a GitHub repo`, `ship-finder: milestone "<n>" not found`, `ship-finder: stage <name> failed: …`). Surface that verbatim and stop. Do not improvise.

### Step 2 — Process the report, stage by stage

Process the stages **in order: reconcile → analyze-bug → kickoff → fix-pr → close-pr**. Cross-stage cascade *within* a pass is not preserved (the snapshot is frozen at `ship-finder.sh` time; the `/loop` wrapper carries it across passes). Within each stage, eligible candidates **fan out in parallel** — emit all per-candidate dispatch + `TaskUpdate(owner)` calls together in one batched response. There is no per-unit budget: a unit is either locked (`status:in-progress` / `status:fix-in-progress`) or it isn't, and each unit's inner work is serialized inside its own workflow.

If a stage's candidate list is `- (none)`, log `Stage <name>: nothing to pick up` and move on.

Use the `operation-git` skill's `gh-commands` reference and `dispatch-prompt` template as the source of truth for query / mutation shapes. Fill **only** the issue/PR number into the chosen `dispatch-prompt.md` skeleton — never add failure context, CI output, or diagnosis.

---

#### Stage `reconcile` (release orphaned locks; no launch)

Process **first**. It launches nothing — it only flips an orphaned lock back to its pre-dispatch state so the next `/loop` pass re-launches a fresh run from durable state (branch WIP commits + the unit's spec/checklist/analysis + the Workflow resume journal). Released items are NOT eligible for later stages *this* pass.

For each orphan line, apply the flip named by its `release:<action>` token, then best-effort delete the dead run's tracking task:

| `release:<action>` | Line prefix | Label flip |
|--------------------|-------------|------------|
| `ready-to-implement` | `issue:#<n>` | `gh issue edit <n> --remove-label "status:in-progress" --add-label "status:ready-to-implement"` |
| `clear-analyze`      | `issue:#<n>` | `gh issue edit <n> --remove-label "status:in-progress"` (back to no status → re-analyze next pass) |
| `clear-fix-pr`       | `pr:#<n>`    | `gh pr edit <n> --remove-label "status:fix-in-progress"` |

After flipping, if a tracking task whose `owner` encodes this number is still open in `TaskList` (`implement-slice-<n>`, `fix-bug-<n>`, `analyze-bug-<n>`, `engineer-fix-pr-<n>`), `TaskUpdate({ taskId, status: "deleted" })`. A missing tracking task (different session) is benign. Treat a `422` from a flip (label already moved by a concurrent fire) as benign and skip. The death gate is owned by the script — do NOT second-guess a listed orphan.

---

#### Stage `analyze-bug` (lock + `TaskCreate` + `Agent`)

For each eligible bug (line format: `- #<n> | "<title>"`):

1. **Lock**: `gh issue edit <n> --add-label "status:in-progress"`. This is the analyze lock — it removes the bug from the analyze-eligible set (no second analyze dispatch) and is what reconcile's `clear-analyze` releases on death. On `422` treat as benign and skip.
2. **TaskCreate** (capture `taskId`):
   ```
   subject:     Analyze bug #<n>: <title>
   description: <issue-url>. Read-only diagnosis: reproduce (browser MCP first,
                Playwright fallback, stack booted either way), root-cause, post a
                # Bug Analysis comment, and swap to status:ready-to-review for a
                human to approve. Writes no code, opens no PR.
   activeForm:  Analyzing bug #<n>
   ```
3. **`Agent` + `TaskUpdate(owner)` in the same batched response**:
   - `subagent_type`: `engineer`
   - `model`: `opus` — root-causing from logs/screenshots is harder than implementing; bump this dispatch above the engineer's default sonnet.
   - `mode`: `default` — so the analyze agent CAN surface a browser-MCP permission request when one is interactively grantable. In an unattended `/loop` it falls back to Playwright per the `workflow-engineer-analyze-bug` skill (never hard-blocks on an MCP install).
   - `name`: `analyze-bug-<n>`
   - `run_in_background`: `true`
   - `prompt`: `Analyze bug #<n>.`
   - Pair with `TaskUpdate({ taskId, owner: "analyze-bug-<n>" })`.

The analyze agent owns its lifecycle: on success it posts the `# Bug Analysis` comment and swaps `status:in-progress` → `status:ready-to-review` (the human approval gate); on NOT-REPRODUCED / contract-change-required it swaps to `status:need-attention`. Roll back on synchronous dispatch failure: remove `status:in-progress` AND delete the tracking task.

> **Human gate (not a command stage).** A human reviews the `# Bug Analysis` comment and approves by flipping `status:ready-to-review` → `status:ready-to-implement`. Only then does the next pass's `kickoff` stage pick the bug up. The command never auto-approves.

---

#### Stage `kickoff` (lock flip + `Workflow` launch, routed by kind)

For each eligible issue (line format: `- #<n> | kind:<feature|enhancement|bug> | "<title>"`):

1. **Lock**: `gh issue edit <n> --remove-label "status:ready-to-implement" --add-label "status:in-progress"`. On `422` treat as benign and skip; anything else → surface and stop.
2. **TaskCreate** (capture `taskId`). Subject/description name the kind and the workflow being launched.
3. **`Workflow` + `TaskUpdate(owner)` in the same batched response**, routed by the line's `kind:`:

   - **`kind:feature`, `kind:enhancement`, or `kind:refactor`** → `implement-slice.mjs`:
     - `scriptPath`: `${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs`
     - `args`: `{ "slice": <n>, "today": "<YYYY-MM-DD>", "verifyLenses": <true|false> }`
     - `TaskUpdate({ taskId, owner: "implement-slice-<n>" })`
   - **`kind:bug`** → `fix-bug.mjs`:
     - `scriptPath`: `${CLAUDE_PLUGIN_ROOT}/workflows/fix-bug.mjs`
     - `args`: `{ "issue": <n>, "today": "<YYYY-MM-DD>", "verifyLenses": <true|false> }`
     - `TaskUpdate({ taskId, owner: "fix-bug-<n>" })`

   Pass `today` explicitly (the workflow runtime has no clock — it stamps the PR body's verdict line). Resolve `$CLAUDE_PLUGIN_ROOT` from the environment the same way the plugin's hooks do, then pass the absolute path.

   Pass `verifyLenses` explicitly too (the workflow sandbox has no env access — same reason `today` is threaded in). Read `$HCC_VERIFY_LENSES` from the environment (e.g. `printenv HCC_VERIFY_LENSES`) and set `verifyLenses: true` only when it is one of `1` / `true` / `on` / `yes` (case-insensitive); otherwise `false`. **Default is OFF** — an unset / empty / any-other value means `false`. When off, the inlined review skips the adversarial correctness/context/severity lenses (a self-review pass) and the dimension reviewer's own severity stands; turn it on to re-enable the three-lens refutation. The workflow runs in the background and notifies on completion; it owns everything internally and either opens a `merge:auto` draft PR + releases the lock on success, or flips `status:in-progress` → `status:need-attention` on halt.

   > **Enhancement / refactor prerequisite.** `implement-slice.mjs` resolves the slice branch via `gh issue develop` and reads a `## Tasks` checklist from the body. An enhancement **or refactor** issue must therefore carry a linked branch and a tasks checklist before kickoff routes it — otherwise the workflow halts to `status:need-attention`. A **refactor** issue's checklist carries NO `e2e` tasks and NO acceptance criteria (it is behavior-preserving), so `implement-slice`'s Author-E2E / coverage-gate / Pass-E2E phases all no-op; both kinds are created with branch + body already in place (`create-enhancement.sh` / `create-refactor.sh`, run by the review-debt triage or the `/create-enhancement-issue` command). Bugs need neither (their branch is created by `fix-bug.mjs` Prep; their spec is the approved analysis comment).

   > **Fallback.** If `Workflow` is unavailable in the running harness, there is no single-agent equivalent for a whole unit cycle. Surface that and stop — do NOT hand-drive the cycle.

Roll back on synchronous launch failure: restore `status:ready-to-implement` AND delete the tracking task. Do NOT roll back on internal workflow failure — once backgrounded, the workflow owns the lifecycle.

---

#### Stage `fix-pr` (lock + `TaskCreate` + `Agent`)

For each eligible draft PR (line format: `- PR #<pr-#> | issue:<issue-#> | "<title>"`):

1. **Lock**: `gh pr edit <pr-#> --add-label "status:fix-in-progress"`.
2. **TaskCreate** (subject `Fix PR #<pr-#>`, capture `taskId`).
3. **`Agent` + `TaskUpdate(owner)`**:
   - `subagent_type`: `engineer`; `mode`: `auto`; `name`: `engineer-fix-pr-<pr-#>`; `run_in_background`: `true`
   - `prompt`: fill the "Fix a PR" skeleton from `operation-git/templates/dispatch-prompt.md` with `<pr-#>`
   - `TaskUpdate({ taskId, owner: "engineer-fix-pr-<pr-#>" })`

Roll back on dispatch failure by removing `status:fix-in-progress` and deleting the tracking task.

---

#### Stage `close-pr` (sequential, no agent dispatch)

Process PRs **sequentially** — concurrent `gh pr merge` calls race on the base branch. For each eligible draft PR (line format: `- PR #<pr-#> | issue:<issue-#> | merge:<auto|manual> | "<title>"`):

1. **Defense-in-depth re-check**: `gh pr view <pr-#> --json mergeable,statusCheckRollup`. If `mergeable != "MERGEABLE"` OR any rollup state is not SUCCESS / NEUTRAL / SKIPPED → skip (`merge race / no longer eligible`).
2. **Promote draft → ready — always**: `gh pr ready <pr-#>`.
3. **Auto-close only when `merge:auto`.** If `manual`, stop here (the PR is open for the user to merge). If `auto`, continue.
4. **Squash-merge with branch deletion** (`merge:auto` only): `gh pr merge <pr-#> --squash --delete-branch`. The linked unit closes automatically via the PR body's `Closes #<issue-#>` line.
5. **On merge race** (mergeability recomputed between step 1 and 4): `gh pr ready <pr-#> --undo` and skip.

No `TaskCreate`, no `Agent`. Never `--force`; never push directly to `main`; never override branch protection.

---

### Step 3 — Emit one summary line

```
ship(<milestone-or-repo-wide>): pass complete (reconcile <RC> / analyze <AN> / kickoff <K> / fix-pr <FPR> / close-pr <CP>)
```

Each count is the number of candidates *processed* in this fire. Skipped candidates (failed the re-check, lost a merge race) are NOT counted.

### Step 4 — Arm the next trigger (event-driven fast path + slow backstop)

A "pass" is everything Steps 0–3 just did. Three triggers fire the next pass; all do the same thing (run `ship-finder.sh`, process the newly-eligible candidates). The only question is **when**:

- **Fast path (event-driven, primary).** When a backgrounded run dispatched in a prior pass finishes, the harness re-invokes the orchestrator with a `<task-notification>`. Under `/loop` that re-enters this command — a fresh pass. A finished `analyze-bug` has flipped the bug to `status:ready-to-review` (awaiting the human); a finished `implement-slice` / `fix-bug` has opened its draft PR or halted. **Do NOT schedule a short-interval poll for in-flight runs** — completion re-invocation is automatic.
- **Slow backstop (timer, safety net).** Three things produce no completion notification: (1) a run SIGKILLed under memory pressure (recoverable only by `reconcile`); (2) a `Blocked by` chain unblocks when *this command* merges a PR (`close-pr`); (3) the orchestrator session is lost. Cover all three with one long backstop, armed at the end of every pass that still has work in flight:

  ```
  ScheduleWakeup({
    delaySeconds: 1800,
    prompt: "/loop /ship <milestone-or-omit>",
    reason: "ship backstop: reconcile dead runs + flow merge-driven cascades"
  })
  ```

  1800s is a backstop, not a poll — the fast path fires far sooner when a run finishes. Keep it long.
- **Manual.** `/ship [milestone]` invoked directly runs one pass and arms the same backstop.

**Choosing the trigger at end of pass** — count work still in flight: open tracking tasks in `TaskList` whose `owner` matches this command's naming (`implement-slice-*`, `fix-bug-*`, `analyze-bug-*`, `engineer-fix-pr-*`), unioned with anything dispatched this pass.

- **Work in flight** → arm the backstop `ScheduleWakeup` and end the turn.
- **Nothing in flight AND this pass's finder report was all `- (none)` across every stage** → **quiescent**. Emit the summary, arm **no** wakeup, end the loop. This is the sole stop condition.

> **Note on the human gate.** A bug sitting at `status:ready-to-review` (analyzed, awaiting human approval) is NOT work-in-flight — no tracking task owns it, and it appears in no finder stage. So a milestone whose only remaining work is awaiting-approval bugs is quiescent and the loop stops; the user approves on their own time, and a later `/ship` (manual or fast-path from another event) picks the approved bug up at kickoff. Never block the loop waiting for the human.

## Iron rules

- **Reconcile runs first, releases locks, launches nothing.** `clear-analyze` releases a dead analyze (→ no status, re-analyze); `ready-to-implement` releases a dead implement-slice/fix-bug (→ re-kickoff); `clear-fix-pr` releases a dead fix-pr. Released items are NOT eligible for later stages this pass.
- **The inner unit cycle lives entirely in one Workflow.** This command launches `implement-slice` / `fix-bug` and they do the author/implement/review/fix/PR. The only agents this command dispatches directly are the read-only `analyze-bug` engineer (pre-approval) and the `fix-pr` engineer (external-wait) — both with a paired `TaskCreate`.
- **Kickoff routes by `kind:`.** feature/enhancement/refactor → `implement-slice.mjs` (args `{slice}`); bug → `fix-bug.mjs` (args `{issue}`). Never launch the wrong workflow for a kind.
- **The bug human gate is the user's, never the command's.** Analyze flips to `status:ready-to-review`; only a human flips it to `status:ready-to-implement`. The command never auto-approves and never blocks the loop waiting.
- **Milestone is optional.** With one → scoped; without → repo-wide maintenance lane. Pass it (or omit it) identically to `ship-finder.sh` and to the `/loop /ship` backstop prompt.
- **One `ship-finder.sh` run per pass.** Single shot, no LLM. Do NOT call it per stage or re-call mid-pass.
- **The finder report is the SOLE source of truth for what to process.** The Stage `close-pr` defense-in-depth re-check is the one allowed live re-read.
- **Lock before launch/dispatch, every mutating stage.** analyze adds `status:in-progress`; kickoff swaps `ready-to-implement` → `status:in-progress`; fix-pr adds `status:fix-in-progress`. On synchronous failure, roll back BOTH the lock AND the tracking task. Never roll back on internal failure.
- **One tracking task per backgrounded run.** Never reuse a `taskId`; never dispatch without a paired `TaskCreate` + `TaskUpdate(owner)`.
- **Detect-and-dispatch, never analyze.** The orchestrator never inspects code, CI logs, or diffs to diagnose a candidate — `ship-finder.sh` already gated eligibility. The one allowed read is the close-pr re-check.
- **`status:need-attention` is a user-owned halt — never block, never recover it.** The finder drops it from every stage. Recovery is the user's.
- **No code-changing work in this command itself.** Every code change, comment, and PR merge beyond `gh pr ready` / `gh pr merge` is owned by a workflow or a dispatched agent.
