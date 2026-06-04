# `workflows/` — plugin-shipped Workflow scripts

Deterministic multi-agent orchestration scripts invoked via the `Workflow` tool. Unlike a single subagent (which cannot spawn subagents), a workflow script spawns every `agent()` as a peer in one flat pool — so it can express fan-out that the 2-level Agent tree forbids.

**These ship with the plugin.** They live here (not in a consuming project's `.claude/workflows/`, which is where the `Workflow` tool resolves `name:`-addressed workflows). The plugin therefore invokes them by **`scriptPath`** against `${CLAUDE_PLUGIN_ROOT}`, exactly as `hooks/hooks.json` references its hook scripts — never by `name:`, which would resolve in the user's project and miss.

## Two layers, two files

The slice lifecycle is exactly **two workflow layers** (`Workflow` nesting is one level deep — a child calling `workflow()` throws):

```
/loop /implement-feature <feature>   (outer driver: 4 stages — reconcile / kickoff / fix-pr / close-pr)
  └─ Stage 1 LAUNCHES (background, one per slice):
       implement-slice.mjs            ← TOP workflow: owns author→implement→review→fix→PR
          ├─ agent()  e2e-author / engineer        (generative, sequential — shared worktree)
          └─ workflow('review-slice') ← CHILD workflow: assessment fan-out (coverage gate + slice review)
                └─ agent() ×N         (one per pattern-reviewer dimension + adversarial verify)
```

The split rule: **assessment work that is parallel-decomposable → a fan-out child workflow; generative work that is sequential → a single agent.** Only the reviewer stages qualify as workflows — the author / implement / pass-E2E / fix stages are TDD chains on one shared slice worktree, so they can't parallelize and stay single `agent()` dispatches.

`review-slice` is a *separate file* (not inlined) only because workflow scripts can't `import` shared modules — `workflow('review-slice', …)` is the reuse mechanism, and it keeps the reviewer independently runnable. The call is an **inline subroutine**: the child runs in the same run (shared concurrency cap, agent counter, token budget, resume journal) and returns its verdict object; control comes straight back to `implement-slice`. No re-launch between phases, no label round-trip.

## `implement-slice.mjs` — the per-slice cycle (TOP)

One background run per slice, launched by `/implement-feature` Stage 1 after it flips `status:ready-to-implement` → `status:in-progress` (the slice lock). It owns the whole inner cycle; the outer `/loop` only handles the PR afterward (`fix-pr` / `close-pr`).

| Phase | What it does | Realization |
|-------|--------------|-------------|
| **Prep** | One agent reads the slice body, parses the `## Tasks` checklist (the durable task ledger), resolves the branch + PR metadata. | `agent()` |
| **Author E2E** | One `e2e-author` dispatch for every not-yet-`[x]` e2e task. | `agent({agentType: e2e-author})` |
| **Coverage gate** | `review-slice` (scope `coverage`) over the authored specs, looping to an `e2e-author` fix until the specs cover every AC + non-happy-path. Cap `FIX_CAP`. | `workflow('review-slice')` + `agent()` |
| **Plan** | One planner groups the implementation tasks into ordered engineer dispatches (DAG-respecting, ≤3 tasks / group). | `agent()` |
| **Implement** | Groups run **serially** (shared worktree); each is one `engineer` dispatch. Done groups are skipped (resume). | `agent({agentType: engineer})` |
| **Pass E2E** | One `engineer` runs the E2E specs vs a booted stack and drives production code to GREEN. `need-attention` → halt. | `agent({agentType: engineer})` |
| **Slice review** | `review-slice` (scope `full`) looping to an `engineer` fix-slice until APPROVE. Cap `FIX_CAP`. | `workflow('review-slice')` + `agent()` |
| **PR** | Open the idempotent `merge:manual` draft PR (`Closes #<slice>`). The slice stays locked until the PR merges. | `agent()` |

- **`FIX_CAP`** (default 4) is the circuit breaker that replaces the deleted engineer budget gate's "stop a runaway loop" role. The deleted gate's "bound the context" role is covered by the planner's ≤3-tasks-per-group size cap + small-task scoping.
- **`halt()`** flips `status:in-progress` → `status:need-attention` and posts a comment — the only path to a human. The outer `/loop` never recovers it; the user does.
- **Resume.** A cold restart re-reads the checklist (durable: ticked `[x]` boxes = done tasks, skipped) in Prep, and the `Workflow` resume journal replays unchanged `agent()` prefixes. No handoff docs.

## `review-slice.mjs` — fan-out review (CHILD)

Called by `implement-slice` for **both** the pre-implementation E2E coverage gate (`scope:'coverage'`) and the post-implementation slice review (`scope:'full'`). It isolates each review dimension and adversarially verifies every finding.

**Boundary (the new contract):** it **posts the verdict comment and RETURNS the verdict object** — it flips **no** label and opens **no** PR. The parent `implement-slice` owns the lock and the terminal draft PR. (Previously, when the outer `/loop` called it directly, it flipped `review:running` → `review:passed/need-fix` and opened the PR; that boundary moved into `implement-slice`.)

### Pipeline (scope `full`)

```
                          ┌─ dedup ─ verify ─┐                ┌─ dedup ─ verify ─┐
Prep ─► Spec (fan-out) ────┤                  ├─►[ GATE ]─► Quality (fan-out) ───┤                  ├─► compose ─► Publish
(1 agent)                  └──────────────────┘  skip-P2?                        └──────────────────┘   (code)    (1 agent)
```

Each phase fans out, **dedups, then verifies** before the next phase consumes it — so the gate decides on confirmed blockers, not raw ones.

| Phase | What it does | Why |
|-------|--------------|-----|
| **Prep** | Two agents: a mechanical agent (read-only worktree, diff vs `origin/main`) returns the *raw* touched paths, then a surface-classification agent turns those paths into the surface flags that drive `applies()`. (Coverage scope skips classification — only `test-coverage` runs.) | All shell/`gh` work in one place; hands a worktree path to every dimension agent. |
| **Spec** | Fan out Phase-1 dimensions (`test-coverage`, `contract`) → **dedup** → **verify**. **Barrier** — the gate needs the confirmed spec findings. | "Did this slice build what was asked?" |
| **Gate** | Plain code: if any *verified* spec finding is `I:H`, skip Phase 2. (Coverage scope is always "gated" — no production code, so no Phase 2.) | Don't audit quality on code that's about to be reworked. |
| **Quality** | Fan out Phase-2 dimensions selected by touched paths (security, coding-standard, …) → **dedup** → **verify**. (Skipped entirely in coverage scope.) | "Is what was built well-built?" |
| **Dedup** | Plain code: collapse findings on the same `file` with title Jaccard ≥ 0.5; keep highest severity, record co-reporting dimensions. | Independent dimensions surface the same defect. |
| **Verify** | Per finding, 3 independent skeptic lenses (`correctness`, `context`, `severity`) read the real code and try to **refute** it; survives on a majority. | Kills false `I:H` before it triggers a fix cycle. |
| **Publish** | One agent: write + `post-comment.sh`. Returns `{verdict}`. No label flip, no PR. | The only write in the workflow. |

**Scope `coverage`** runs only the Spec-phase `test-coverage` dimension over the **authored E2E specs**, pre-implementation: the usual "test files are out of scope" rule **inverts** (the specs are the deliverable), the verdict is BLOCK on **any** confirmed coverage gap (not just `I:H`), and Quality is skipped.

Scoring (`severity → Impact`, `(Impact, Effort) → Fix/Defer/Nit/Drop`, `full verdict = BLOCK iff any surviving I:H`) is pure JS so it is deterministic rather than re-derived by an LLM each run.

### Model tiers

Agents run on **two tiers** (retune via `AGENT_MODEL` / `WRITER_MODEL` at the top of the script):

| Tier | Agents | Why |
|------|--------|-----|
| `sonnet` (`AGENT_MODEL`) | Surface classification + every Spec / Quality / Verify dimension and skeptic lens | The judgment-bearing work. Matches the single `reviewer` agent (`model: sonnet`). |
| `haiku` (`WRITER_MODEL`) | The mechanical Prep agent and the terminal Publish agent | Tool-orchestration and pure execution. |

## How it's wired

`/implement-feature` Stage 1 launches the top workflow per eligible slice:

```
Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs", args: { slice: <n>, today: "<YYYY-MM-DD>" } })
```

`implement-slice` calls `workflow('review-slice', { slice, scope })` inline for the coverage gate and the slice review. The per-dimension catalogues are still the `pattern-reviewer-*` skills — each dimension agent reads exactly one (staying anonymous keeps its context clean), and also applies that skill's per-project `.claude/memory/patterns/<skill>.md` overlay via `memory-convention` when one exists, so dreamed rules reach the fan-out the same way they reach the single-agent `reviewer`. The generative dispatches load the re-pointed `workflow-e2e-author` / `workflow-engineer-implement-task` / `workflow-engineer-e2e` / `workflow-engineer-fix-slice` skills via their trigger phrases.

### Assumptions to verify before trusting it in production

1. **`Workflow` availability.** It is an Opus-4.8 main-loop tool. If the running harness lacks it, the slice cycle can't run as designed — there is no single-agent fallback for the *whole* cycle (the old per-stage label dispatch was removed). The `workflow-reviewer-review-slice` skill is retained as a single-agent reviewer fallback for the review step only.
2. **`scriptPath` resolution (the linchpin).** Stage 1 passes `${CLAUDE_PLUGIN_ROOT}/workflows/implement-slice.mjs`. Confirm the orchestrator can resolve `$CLAUDE_PLUGIN_ROOT` to an absolute path at invocation time and that `Workflow`'s `scriptPath` accepts it. The child `workflow('review-slice', …)` is resolved by `name:` within the same run, so it does not need a path.
3. **`agentType` resolution.** `implement-slice` dispatches `harness-claude-code:e2e-author` / `harness-claude-code:engineer`. Confirm the namespaced plugin agent types resolve from the workflow's `agent()` registry (the same registry the `Agent` tool uses); fall back to the bare names if the harness strips the namespace.
4. **operation-git script path resolution.** Agents invoke `bash skills/operation-git/scripts/<name>.sh …` — confirm those paths resolve from the workflow agents' working directory in a *consuming* project; adjust to an absolute plugin-root path if not.
5. **Cross-workflow concurrency cap.** The per-workflow cap is `min(16, cores-2)`. Multiple `implement-slice` runs (one per slice, launched across passes) share the host — confirm whether the cap is global or per-run and pace launches accordingly.
6. **Date.** `args.today` is required — the workflow runtime has no clock; the orchestrator must pass `YYYY-MM-DD` for the PR body's verdict line.

### Tuning knobs (top of the scripts)

- `implement-slice.mjs`: `FIX_CAP` (gate/review fix-loop rounds before halt) and the planner's ≤3-tasks-per-group size cap (in the Plan prompt).
- `review-slice.mjs`: `DIMENSIONS` (the catalogue; each row's `phase` + `applies(surfaces)`), `VERIFY_LENSES` (skeptic lenses + survival threshold `>= 2`), and the dedup `jaccard >= 0.5` threshold.
