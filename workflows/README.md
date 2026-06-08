# `workflows/` — plugin-shipped Workflow scripts

Deterministic multi-agent orchestration scripts invoked via the `Workflow` tool. Unlike a single subagent (which cannot spawn subagents), a workflow script spawns every `agent()` as a peer in one flat pool — so it can express fan-out that the 2-level Agent tree forbids.

**These ship with the plugin.** They live here (not in a consuming project's `.claude/workflows/`, which is where the `Workflow` tool resolves `name:`-addressed workflows). The plugin therefore invokes them by **`scriptPath`** against `${CLAUDE_PLUGIN_ROOT}`, exactly as `hooks/hooks.json` references its hook scripts — never by `name:`, which would resolve in the user's project and miss.

## Two workflows, self-contained

Two workflows ship, one per unit of work:

- **`implement-slice.mjs`** — the per-slice cycle for `kind:feature` **and** `kind:enhancement` (an enhancement is a single feature-shaped issue with a `## Tasks` checklist; it runs the identical cycle).
- **`fix-bug.mjs`** — the lighter per-bug cycle for `kind:bug` (no E2E authoring, no coverage gate; the regression test is the spec, written inside the Fix phase).

Each is **self-contained**: the review fan-out used to be a second file (`review-slice.mjs`) called as a child workflow, but it is now **inlined** into each workflow as a `runReview*()` function — `runReviewSlice()` in `implement-slice.mjs`, `runReview()` (production-code only) in `fix-bug.mjs`. Workflow scripts can't `import`, and nesting is one level deep (a child calling `workflow()` throws), so the review block is duplicated rather than shared — the cost of the self-contained-script model. Both copies carry the same `DIMENSIONS` / `VERIFY_LENSES` / scoring; keep them in sync when tuning.

```
/loop /implement-feature <feature>   (outer driver: 4 stages — reconcile / kickoff / fix-pr / close-pr)
  └─ Stage 1 LAUNCHES (background, one per slice):
       implement-slice.mjs            ← the only workflow: owns author→implement→review→fix→PR
          ├─ agent()  e2e-author / engineer        (generative, sequential — shared worktree)
          └─ runReviewSlice()  (inlined fan-out: coverage gate + slice review)
                └─ agent() ×N  one axis-reviewer agent per pattern + adversarial verify skeptics
```

The split rule: **assessment work that is parallel-decomposable → a fan-out (here, `runReviewSlice()`); generative work that is sequential → a single agent.** The author / implement / pass-E2E / fix stages are TDD chains on one shared slice worktree, so they can't parallelize and stay single `agent()` dispatches. The review is the one parallel-decomposable step, so it fans out one `axis-reviewer` agent per applicable pattern.

## `implement-slice.mjs` — the per-slice cycle

One background run per slice, launched by `/implement-feature` Stage 1 after it flips `status:ready-to-implement` → `status:in-progress` (the slice lock). It owns the whole inner cycle, including the review fan-out; the outer `/loop` only handles the PR afterward (`fix-pr` / `close-pr`).

| Phase | What it does | Realization |
|-------|--------------|-------------|
| **Prep** | One agent reads the slice body, parses the `## Tasks` checklist (the durable task ledger), resolves the branch + PR metadata. | `agent()` |
| **Author E2E** | One `e2e-author` dispatch for every not-yet-`[x]` e2e task. | `agent({agentType: e2e-author})` |
| **Coverage gate** | `runReviewSlice('test-coverage')` over the authored specs, looping to an `e2e-author` fix until the specs cover every AC + non-happy-path. No round cap — loops to APPROVE. | `runReviewSlice()` + `agent()` |
| **Plan** | One planner groups the implementation tasks into ordered engineer dispatches (DAG-respecting, ≤3 tasks / group). | `agent()` |
| **Implement** | Groups run **serially** (shared worktree); each is one `engineer` dispatch. Done groups are skipped (resume). | `agent({agentType: engineer})` |
| **Pass E2E** | One `engineer` runs the E2E specs vs a booted stack and drives production code to GREEN. `need-attention` → halt. | `agent({agentType: engineer})` |
| **Slice review** | `runReviewSlice('production-code')` looping to an `engineer` fix-slice until APPROVE. No round cap. | `runReviewSlice()` + `agent()` |
| **PR** | Open the idempotent `merge:manual` draft PR (`Closes #<slice>`). The slice stays locked until the PR merges. | `agent()` |

- **No convergence cap.** Every fix loop (coverage gate, implement re-dispatch, slice review) runs until it reaches confidence to pass — review `APPROVE`, or every task ticked `[x]` — rather than halting after a fixed number of rounds. The review fan-out is tuned for aggressive recall; its adversarial verify phase is **opt-in (`verifyLenses` arg, default OFF)** — when on, only a finding that survives refutation holds a gate open. With it off (the default) the dimension reviewer's own severity stands. Either way `production-code` review blocks on `I:H` alone, so once the real blockers are fixed the loop ends. The deleted engineer budget gate's "bound the context" role is covered by the planner's ≤3-tasks-per-group size cap + small-task scoping.
- **`halt()`** flips `status:in-progress` → `status:need-attention` and posts a comment — the only path to a human. The outer `/loop` never recovers it; the user does. A review that can't set up its worktree (or otherwise crashes) returns `{ error }` and halts here, so an infra failure never spins the uncapped loop forever.
- **Resume.** A cold restart re-reads the checklist (durable: ticked `[x]` boxes = done tasks, skipped) in Prep, and the `Workflow` resume journal replays unchanged `agent()` prefixes. No handoff docs.

## `runReviewSlice(scope, phaseTitle, sliceBranch)` — the inlined fan-out review

Called by `implement-slice` for **both** the pre-implementation E2E coverage gate (`scope:'test-coverage'`) and the post-implementation slice review (`scope:'production-code'`). It sets up a read-only worktree on the slice branch tip, isolates each review dimension onto its own `axis-reviewer` agent, and — when the `verifyLenses` arg is on (default OFF) — adversarially verifies every finding before it counts.

**Boundary:** it **posts the verdict comment and RETURNS the verdict object** (`{ verdict, publishError }`, or `{ error }` on infra failure) — it flips **no** label and opens **no** PR. The surrounding `implement-slice` phases own the lock, the fix loops, and the terminal draft PR.

### Pipeline (scope `production-code`)

```
                          ┌─ dedup ─ verify ─┐                ┌─ dedup ─ verify ─┐
Prep ─► Spec (fan-out) ────┤                  ├─►[ GATE ]─► Quality (fan-out) ───┤                  ├─► compose ─► Publish
(worktree/diff)            └──────────────────┘  skip-P2?                        └──────────────────┘   (code)    (1 agent)
```

Each phase fans out, **dedups, then verifies** before the next phase consumes it — so the gate decides on confirmed blockers, not raw ones.

| Step | What it does | Why |
|-------|--------------|-----|
| **Prep** | Two agents: a mechanical agent (read-only worktree on the passed `sliceBranch`, diff vs `origin/main`) returns the *raw* touched paths, then a surface-classification agent turns those paths into the surface flags that drive `applies()`. (Coverage scope skips classification — only `test-coverage` runs.) | All shell/`gh` work in one place; hands a worktree path to every dimension agent. |
| **Spec** | Fan out Phase-1 dimensions (`test-coverage`, `contract`) as `axis-reviewer` agents → **dedup** → **verify**. **Barrier** — the gate needs the confirmed spec findings. | "Did this slice build what was asked?" |
| **Gate** | Plain code: if any *verified* spec finding is `I:H`, skip Phase 2. (Coverage scope is always "gated" — no production code, so no Phase 2.) | Don't audit quality on code that's about to be reworked. |
| **Quality** | Fan out Phase-2 dimensions selected by touched paths (security, coding-standard, …) → **dedup** → **verify**. (Skipped entirely in coverage scope.) | "Is what was built well-built?" |
| **Dedup** | Plain code: collapse findings on the same `file` with title Jaccard ≥ 0.5; keep highest severity, record co-reporting dimensions. | Independent dimensions surface the same defect. |
| **Verify** *(opt-in)* | **Only when `verifyLenses` is on (default OFF).** Per finding, 3 independent skeptic lenses (`correctness`, `context`, `severity`) read the real code and try to **refute** it; survives on a majority. These run on the default workflow agent (refute ≠ find), not `axis-reviewer`. With verify off, every finding is trusted as the reviewer graded it (severity included) and this step is skipped. | Kills false `I:H` before it triggers a fix cycle — at the cost of a self-review pass, which is why it's off by default. |
| **Publish** | One agent: write + `post-comment.sh`. Returns `{verdict}`. No label flip, no PR. | The only write in the review. |

**Scope `test-coverage`** runs only the Spec-phase `test-coverage` dimension over the **authored E2E specs**, pre-implementation: the usual "test files are out of scope" rule **inverts** (the specs are the deliverable), the verdict is BLOCK on **any** confirmed coverage gap (not just `I:H`), and Quality is skipped.

Scoring (`severity → Impact`, `(Impact, Effort) → Fix/Defer/Nit/Drop`, `full verdict = BLOCK iff any surviving I:H`) is pure JS so it is deterministic rather than re-derived by an LLM each run.

### The `axis-reviewer` agent

Each Spec / Quality finder is one dispatch of the `axis-reviewer` agent (`agents/axis-reviewer.md`) — a single-axis reviewer that reads exactly ONE `pattern-reviewer-*` skill and returns structured findings. The stable review framing (recall-over-precision stance, honesty floor, reporting shape, memory-overlay handling, the full-vs-coverage rules) lives in that agent so it is defined once; `runReviewSlice()` passes only the dynamic facts (which skill, the scope, the worktree/diff). The whole-slice `reviewer` agent is the single-context fallback that applies those same per-axis rules to every applicable pattern at once when the `Workflow` tool is unavailable.

### Model tiers

Agents run on **two tiers** (retune via `AGENT_MODEL` / `WRITER_MODEL` at the top of the script):

| Tier | Agents | Why |
|------|--------|-----|
| `sonnet` (`AGENT_MODEL`) | Surface classification + every `axis-reviewer` finder and Verify skeptic lens | The judgment-bearing work. Matches the single `reviewer` agent (`model: sonnet`). |
| `haiku` (`WRITER_MODEL`) | The mechanical review-prep agent, the terminal Publish agent, and the Implement completion-check | Tool-orchestration and pure execution. |

## `fix-bug.mjs` — the per-bug cycle

One background run per approved bug, launched by the unified implement command's kickoff stage after a human approved the `# Bug Analysis` comment (flipping `status:ready-to-implement`) and the orchestrator flipped `status:ready-to-implement` → `status:in-progress` (the bug lock). The read-only **analyze** step + the human approval gate happen *before* this workflow (see `workflow-engineer-analyze-bug`); `fix-bug.mjs` owns only the automatic post-approval half.

| Phase | What it does | Realization |
|-------|--------------|-------------|
| **Prep** | One agent reads the bug body + the newest approved `# Bug Analysis` comment, creates-or-reuses the `fix/<n>-<intent>` branch on origin (idempotent → resume-safe), and carries the Regression-test plan forward. Halts if there is no approved analysis, it's NOT-REPRODUCED, or Contract impact is REQUIRES-CHANGE (reclassify to feature). | `agent()` |
| **Fix** | One `engineer` dispatch (`Fix bug #<n>`): write the regression test FIRST (RED, fails on pre-fix code), drive it GREEN, refactor, propagate the class-of-bug, push. | `agent({agentType: engineer})` |
| **Review** | `runReview('production-code')` looping to an `engineer` fix (`Fix the review feedback on bug #<n>`) until APPROVE. No round cap. The `test-coverage` dimension enforces the regression test fails-before / passes-after. | `runReview()` + `agent()` |
| **PR** | Open the idempotent `merge:manual` draft PR (`Closes #<n>`) and release the `status:in-progress` lock. | `agent()` |

`runReview(phaseTitle, fixBranch)` is the production-code-only port of `runReviewSlice()` — same Prep → Spec → Gate → Quality → dedup → verify → compose → Publish pipeline, but with no `test-coverage` *scope* (the coverage gate is an `implement-slice`-only pre-implementation phase; for a bug, test-coverage is just one spec **dimension** over the fix diff). It posts a `# Bug Fix Review` comment on the bug issue and returns the verdict. `halt()` flips `status:in-progress` → `status:need-attention`, the only path to a human.

## How it's wired

`/implement-feature` Stage 1 launches the workflow per eligible slice:

```
Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs", args: { slice: <n>, today: "<YYYY-MM-DD>" } })
```

There is no longer a `reviewScriptPath` to pass — the review fan-out is inlined. The per-dimension catalogues are the `pattern-reviewer-*` skills — each `axis-reviewer` agent reads exactly one, and also applies that skill's per-project `.claude/memory/patterns/<skill>.md` overlay via `memory-convention` when one exists, so dreamed rules reach the fan-out the same way they reach the single-agent `reviewer`. The generative dispatches load the `workflow-e2e-author` / `workflow-engineer-implement-task` / `workflow-engineer-diagnose-e2e` / `workflow-engineer-fix-e2e` / `workflow-engineer-fix-slice` skills via their trigger phrases.

### Assumptions to verify before trusting it in production

1. **`Workflow` availability.** It is an Opus-4.8 main-loop tool. If the running harness lacks it, the slice cycle can't run as designed — there is no single-agent fallback for the *whole* cycle (the old per-stage label dispatch was removed). The `workflow-reviewer-review-slice` skill + the `reviewer` agent are retained as a single-context reviewer fallback for the review step only.
2. **`scriptPath` resolution.** Stage 1 passes `${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs` as the scriptPath. Confirm the orchestrator can resolve `$CLAUDE_PLUGIN_ROOT` to an absolute path at invocation time and that `Workflow`'s `scriptPath` accepts it. (There is no child workflow to resolve anymore — the review runs in-process.)
3. **`agentType` resolution.** `implement-slice` dispatches `harness-claude-code:e2e-author` / `harness-claude-code:engineer` / `harness-claude-code:axis-reviewer`. Confirm the namespaced plugin agent types resolve from the workflow's `agent()` registry (the same registry the `Agent` tool uses); fall back to the bare names if the harness strips the namespace.
4. **operation-git script path resolution.** Agents invoke `bash skills/operation-git/scripts/<name>.sh …` — confirm those paths resolve from the workflow agents' working directory in a *consuming* project; adjust to an absolute plugin-root path if not.
5. **Cross-workflow concurrency cap.** The per-workflow cap is `min(16, cores-2)`. Multiple `implement-slice` runs (one per slice, launched across passes) share the host — confirm whether the cap is global or per-run and pace launches accordingly.
6. **Date.** `args.today` is required — the workflow runtime has no clock; the orchestrator must pass `YYYY-MM-DD` for the PR body's verdict line.

### Tuning knobs (top of the script)

- `implement-slice.mjs`: the planner's ≤3-tasks-per-group size cap (in the Plan prompt); the review catalogue `DIMENSIONS` (each row's `phase` + `applies(surfaces)`); `VERIFY_LENSES` (skeptic lenses + survival threshold `>= 2`); the dedup `jaccard >= 0.5` threshold; and the `AGENT_MODEL` / `WRITER_MODEL` tiers. Fix loops are uncapped (loop to APPROVE / all-ticked); only infra failures `halt()`.
