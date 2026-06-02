# `workflows/` — plugin-shipped Workflow scripts

Deterministic multi-agent orchestration scripts invoked via the `Workflow` tool. Unlike a single subagent (which cannot spawn subagents), a workflow script spawns every `agent()` as a peer in one flat pool — so it can express fan-out that the 2-level Agent tree forbids.

**These ship with the plugin.** They live here (not in a consuming project's `.claude/workflows/`, which is where the `Workflow` tool resolves `name:`-addressed workflows). The plugin therefore invokes them by **`scriptPath`** against `${CLAUDE_PLUGIN_ROOT}`, exactly as `hooks/hooks.json` references its hook scripts — never by `name:`, which would resolve in the user's project and miss.

## `review-slice.mjs` — fan-out slice review

The fan-out replacement for dispatching a single `reviewer` agent at the **review-slice stage** of `/implement-feature` (Stage 6). Same external contract as the agent — read-only on code, one `# Slice Review` comment, terminal `review:running` → `review:passed` / `review:need-fix` flip, and an idempotent `merge:manual` draft PR on APPROVE — but internally it isolates each review dimension and adversarially verifies every finding.

### Pipeline

```
                          ┌─ dedup ─ verify ─┐                ┌─ dedup ─ verify ─┐
Prep ─► Spec (fan-out) ────┤                  ├─►[ GATE ]─► Quality (fan-out) ───┤                  ├─► compose ─► Publish
(1 agent)                  └──────────────────┘  skip-P2?                        └──────────────────┘   (code)    (1 agent)
```

Each phase fans out, **dedups, then verifies** before the next phase consumes it — so the gate decides on confirmed blockers, not raw ones.

| Phase | What it does | Why |
|-------|--------------|-----|
| **Prep** | One agent: read-only worktree, diff vs `origin/main`, closed sub-issues, touched-surface flags, dimension selection inputs. | All shell/`gh` work in one place; hands a worktree path to every dimension agent. |
| **Spec** | Fan out Phase-1 dimensions (`test-coverage`, `contract`) → **dedup** → **verify**. **Barrier** — the gate needs the confirmed spec findings. | "Did this slice build what was asked?" |
| **Gate** | Plain code: if any *verified* spec finding is `I:H`, skip Phase 2. Gating on confirmed blockers (not raw) means we never skip quality on a finding that wouldn't survive scrutiny, and keeps "Phase 2 skipped" coherent with a BLOCK verdict. | Don't audit quality on code that's about to be reworked — pure noise. |
| **Quality** | Fan out Phase-2 dimensions selected by touched paths (security, coding-standard, …) → **dedup** → **verify**. | "Is what was built well-built?" — each in a clean context. |
| **Dedup** | Plain code, run per phase (and once more across phases before compose): collapse findings on the same `file` (line-insensitive) with title Jaccard ≥ 0.5; keep highest severity, record co-reporting dimensions. | Independent dimensions surface the same defect; without this the count matrix multi-counts and the comment repeats. Running it before each verify also avoids refuting the same bug twice. |
| **Verify** | Per finding, 3 independent skeptic lenses (`correctness`, `context`, `severity`) read the real code and try to **refute** it; survives on a majority. | Replaces the single agent's self-attested Pre-Report Gate; kills false `I:H` before it triggers a fix cycle. |
| **Publish** | One agent: write comment, `post-and-flip.sh`, and on APPROVE the idempotent `create-draft-pr.sh`. | The only writes in the workflow. |

Scoring (`severity → Impact`, `(Impact, Effort) → Fix/Defer/Nit/Drop`, `verdict = BLOCK iff any surviving I:H`) is identical to `workflow-reviewer-review-task` step 5 / `workflow-reviewer-review-slice`, implemented as pure JS so it is deterministic rather than re-derived by an LLM each run.

### How it's wired

`/implement-feature` Stage 6 calls `Workflow({ scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/review-slice.mjs", args: { slice, today } })` instead of dispatching the `reviewer` agent, pairing it with the usual `reviewer-review-slice-<slice-#>` tracking task. Because the workflow performs the terminal label flip itself, the orchestrator's existing loop-continuation accounting (which keys off that flip and the tracking owner) is unchanged. The per-dimension catalogues are still the `pattern-reviewer-*` skills — each dimension agent reads exactly one.

### Assumptions to verify before trusting it in production

1. **`Workflow` availability.** It is an Opus-4.8 main-loop tool. If the running harness lacks it, Stage 6 documents an exact fallback to the single `reviewer` agent (retained, unchanged). Behaviour then matches today minus dimension isolation + verify.
2. **`scriptPath` resolution (the linchpin).** Stage 6 passes `${CLAUDE_PLUGIN_ROOT}/workflows/review-slice.mjs`. Confirm the orchestrator can resolve `$CLAUDE_PLUGIN_ROOT` to an absolute path at invocation time (hooks get it injected; a main-loop slash command may need to read it from the env or expand it itself) and that `Workflow`'s `scriptPath` accepts that absolute path. If the env var isn't visible to the orchestrator, hardcode/derive the installed plugin path instead. Until this is confirmed, the script can't be reached in a *consuming* project even though it now ships with the plugin.
3. **operation-git script path resolution.** The prep/publish agents invoke `bash skills/operation-git/scripts/<name>.sh …`, the same convention the existing `workflow-reviewer-*` skills use. Confirm those paths resolve from the workflow agents' working directory in a *consuming* project (not just this plugin repo); adjust the prompts to an absolute plugin-root path if not.
4. **Cross-workflow concurrency cap.** The per-workflow cap is `min(16, cores-2)`. When the orchestrator fans out several `review-slice` workflows in one pass (review stages carry no per-slice limit), confirm whether that cap is global or per-run; if per-run, throttle how many review workflows launch per pass to avoid host oversubscription and to pace the shared token budget.
5. **Date.** `args.today` is required — the workflow runtime has no clock (`Date.*` is unavailable inside scripts), so the orchestrator must pass `YYYY-MM-DD` for the PR body's verdict line.

### Trialling side-by-side

Pick a live slice with `review:running` and run the workflow directly: `Workflow({ scriptPath: "$CLAUDE_PLUGIN_ROOT/workflows/review-slice.mjs", args: { slice: <n>, today: '<YYYY-MM-DD>' } })` (or point `scriptPath` at the repo checkout while developing). Compare its verdict and findings against a `reviewer`-agent review of the same slice before switching Stage 6 over for real.

### Tuning knobs (top of the script)

- `DIMENSIONS` — the catalogue; each row's `phase` (spec/quality) and `applies(surfaces)` trigger. Mirrors the reviewer agent's pattern table.
- `VERIFY_LENSES` — the skeptic lenses and their refute bias. Add lenses or raise the survival threshold (`>= 2`) to tighten.
- Dedup `jaccard >= 0.5` threshold in `dedupeFindings` — raise to merge less aggressively.
