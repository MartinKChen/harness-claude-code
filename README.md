# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships a pickup / close-out lifecycle command (`/implement-feature`) backed by pure-shell discovery scripts that drive issues and PRs through their lifecycle, a roster of role-based agents, a curated skill library covering TDD, coding / frontend / backend / container / observability patterns, git, database migrations, security, and API/module design, and a pre-push hook that gates engineer-driven pushes on lint/type/security/test checks.

> **New here?** Start with [`DESIGN.md`](DESIGN.md) — the two ideas this harness is built on (specs-as-contract + orchestration over prompting). This README is the full per-surface catalogue; [`docs/workflow.html`](docs/workflow.html) is the visual walkthrough.

## Scope & assumptions

Read this before adopting — it sets expectations honestly.

**The orchestration is stack-agnostic; the pattern catalogue currently codifies one stack.** The lifecycle machinery — the commands, the GitHub-issue label protocol, the agents, the `Workflow` scripts, the discovery scripts, the review fan-out — makes no language assumptions. What is stack-specific is the *content* of the `pattern-*` skills and the project templates. Today they codify the stack we build on:

| Layer | Current coverage |
| --- | --- |
| Backend | Python 3.12+, FastAPI, SQLAlchemy + Alembic, `uv`, `ruff` / `mypy` / `bandit` / `pytest` |
| Frontend | TypeScript, React, Vite, TanStack Query, RHF + Zod, `biome` |
| Data | PostgreSQL |
| E2E | Playwright |
| Infra | Docker multi-stage + compose, nginx, OpenTelemetry, GitHub Actions |

**If you are on this stack**, the plugin runs as-is. **If you are not**, the lifecycle still applies but the pattern catalogue won't fit — that is expected, not a defect. The `pattern-engineer-*` / `pattern-reviewer-*` pairing is the deliberate extension seam: add a language or framework by adding a matching engineer/reviewer skill pair (authored via `/create-skill`), and put coverage *substance* in the role-neutral `pattern-test-coverage` so it reaches both sides. The stack-agnostic skills (`pattern-engineer-coding-standard`, `principle-engineer-tdd`, `operation-git`, `pattern-architect-deep-module`) and every `pattern-reviewer-*` catalogue are reusable on any stack today, independent of the lifecycle.

**The `/scaffold-project` templates are stack-specific by nature** (they materialize a FastAPI + React/Vite + compose stack). Greenfield bootstrap assumes that stack; the rest of the lifecycle does not.

**Maturity.** This is a young, opinionated harness under active development on a private project; treat it as a reference implementation to adapt, not a turnkey drop-in. The greenfield feature lifecycle is the most exercised path; bug and enhancement lanes are newer.

## Install from GitHub

In Claude Code:

```
/plugin marketplace add MartinKChen/harness-claude-code
/plugin install harness-claude-code@martinchen-marketplace
```

The first command registers this repo as a marketplace (it reads `.claude-plugin/marketplace.json`). The second installs the plugin defined in `.claude-plugin/plugin.json`. To update later, run `/plugin marketplace update martinchen-marketplace`.

## Status

**As-is — what the harness covers today:** end-to-end automation of the greenfield feature lifecycle. Spec / contract generation (product → design → architecture, each a locked interview) → project scaffold (seeds the locked design tokens) → planning → outside-in TDD implementation → code & security review → fix loop → draft PR → merge. GitHub issues are the source of truth; every lifecycle step is idempotent — the orchestrator can re-enter safely. Discovery for each pass runs as pure shell (`task-finder.sh`) so the loop costs no LLM tokens until there is actual work to dispatch.

A visual walkthrough of how the commands, agents, and labels fit together lives at [`docs/workflow.html`](docs/workflow.html) — open it in a browser.

**To-be — known gaps on the roadmap:**
- **Design / UX as a continuous lane.** The design system is now locked up front: `/deep-dive-feature` runs a `design-lead` interview (product → **design** → architecture) that locks the visual language and a surface + navigation inventory, `/scaffold-project` seeds the resulting tokens, and `create-feature-issues` emits a foundation/shell slice plus a page-reachability gate. Still missing: a dedicated per-feature design *review* phase (visual polish on shipped pages).
- **SRE in the workflow.** The agent exists; nothing dispatches it yet. CI/CD ownership is still manual.
- **Enhancement and bug-fix lifecycles.** ✅ Driven by the unified `/ship` command (superset of `/implement-feature`, which stays as a feature-only fallback). **Bugs:** `/ship` dispatches a read-only `analyze` engineer that reproduces (browser MCP preferred, Playwright fallback, stack booted either way) and posts a `# Bug Analysis` comment → human approves the approach → the lighter `fix-bug.mjs` workflow writes the regression test first, drives it green, reviews, and opens a PR. **Enhancements:** `/create-enhancement-issue` creates one feature-shaped `kind:enhancement` issue (+ linked `enhancement/<n>-…` branch) without the `/deep-dive-feature` interview or doc-lock, and `/ship` routes it through the same `implement-slice.mjs` cycle as a feature slice. Both lanes run repo-wide (no milestone needed) via `/ship` with no argument. The only guard: anything that would change an API contract / data model is a feature, not a bug or enhancement — `/deep-dive-feature` owns those.

## Commands

Slash commands live in [`commands/`](commands/).

| Command | Purpose |
| --- | --- |
| `/deep-dive-feature` | Three-phase feature deep-dive: product discovery with `product-owner`, design discovery with `design-lead` (locks the visual language + surface/navigation inventory), then technical discovery with `architect`. Creates a feature branch, commits each teammate's artifacts, and opens a single PR at the end. |
| `/scaffold-project` | Greenfield-only. Reads `docs/architecture-decision-record/` for stack + topology, creates a scaffold branch, materializes backend + frontend + e2e + `docker-compose.yaml` from templates, verifies the stack boots end-to-end, asserts the design system locked by `/deep-dive-feature` exists and seeds its tokens into the frontend, then pushes and opens a PR. |
| `/ship` | **Unified lifecycle for all three kinds (feature + enhancement + bug).** Superset of `/implement-feature`. Runs `ship-finder.sh` once (pure shell, optional milestone — omit it for the repo-wide maintenance lane) to find candidates across five stages: reconcile dead locks, dispatch the read-only `analyze` engineer for freshly-filed bugs (→ `# Bug Analysis` comment → human approval gate), launch the per-unit workflow at kickoff (routed by `kind:` — `implement-slice.mjs` for feature/enhancement, `fix-bug.mjs` for bug), and the two PR stages (fix-pr, close-pr). Wrap with `/loop /ship [milestone]`. |
| `/implement-feature` | Drive one outer pass over a feature milestone's slice lifecycle. The inner slice cycle (author E2E → coverage gate → implement → pass E2E → review → fix → open draft PR) runs inside ONE background `implement-slice` Workflow per slice, so the command owns only four stages: reconcile dead-workflow locks (0), launch a workflow per eligible slice (1), and the two external-wait PR stages (fix-pr 8, close-pr 9). Runs `skills/operation-git/scripts/task-finder.sh` once (pure shell, read-only, no LLM) to find candidates, then performs the kickoff lock flip + `Workflow` launch, reconcile releases, `fix-pr` `Agent` dispatch, and Stage 9's squash-merge directly. Wrap with `/loop /implement-feature <feature-name>` for end-to-end shipping. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

### Lifecycle discovery scripts

The pickup / close-out lifecycle is driven by an umbrella discovery script that runs once per pass, executes its stage scripts in order against a single GitHub-state snapshot, and emits one canonical markdown report. Everything here is **pure shell** — no LLM, no agent, no skill prompt-include. Every label flip, `Workflow` launch, `Agent` dispatch, draft → ready promotion, and squash-merge is owned by the command itself. These scripts are not invoked directly by users. There are two umbrellas:

- **`ship-finder.sh [milestone]`** — the unified finder behind `/ship`. Five stages — **reconcile**, **analyze-bug**, **kickoff**, **fix-pr**, **close-pr** — across all three kinds; milestone is optional (omit for the repo-wide maintenance lane). Each stage delegates to a `ship-stage-<name>.sh` helper.
- **`task-finder.sh <feature-name>`** — the feature-only fallback behind `/implement-feature`. Four stages (reconcile / kickoff / fix-pr / close-pr) scoped to one milestone; no bug analyze stage. (Stages 2–7 were retired by the per-slice-Workflow redesign — the inner slice cycle they covered now runs inside one background `implement-slice` Workflow per slice.)

| `ship-finder.sh` stage | Purpose |
| --- | --- |
| `ship-stage-reconcile.sh` | Lists orphaned locks: a slice/bug `status:in-progress` whose `implement-slice` / `fix-bug` Workflow died, an analyze `status:in-progress` whose `analyze-bug` engineer died, or a draft PR `status:fix-in-progress` whose `fix-pr` engineer died — gated by a runtime-telemetry liveness heartbeat (a fresh `last_seen` vetoes the reap) with GitHub-activity staleness as the fallback. Emits a `release:<action>` directive (`ready-to-implement` / `clear-analyze` / `clear-fix-pr`) per orphan. |
| `ship-stage-analyze-bug.sh` | Lists freshly-filed `kind:bug` issues with no status — the bugs `/ship` should lock (`status:in-progress`) and dispatch the read-only `analyze-bug` engineer for. |
| `ship-stage-kickoff.sh` | Lists `status:ready-to-implement` units with zero open blockers, each tagged `kind:<feature\|enhancement\|bug>` — the command locks each (`status:in-progress`) and launches its workflow (`implement-slice.mjs` for feature/enhancement, `fix-bug.mjs` for bug). |
| `ship-stage-fix-pr.sh` | Lists draft PRs with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` / `status:need-attention`. |
| `ship-stage-close-pr.sh` | Lists draft PRs that are `MERGEABLE` with every check rollup state SUCCESS / NEUTRAL / SKIPPED, each tagged `merge:<auto\|manual>` and with its linked unit number resolved from the `Closes #<n>` line. |

(`/implement-feature`'s `task-finder-stage-{0,1,8,9}-*.sh` helpers are the feature-only analogues of the reconcile / kickoff / fix-pr / close-pr stages above.)

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `design-lead` | opus | Interviews the user to lock the product's visual language and information architecture, producing the design system (`docs/design-system/{overview,tokens,components,accessibility}.md`) and the surface + navigation inventory (`docs/design-system/surfaces.md`) that closes the orphan-page gap. Read-only / plan-mode; `ui-ux-pro-max` is its toolbox. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity `docs/data-model/<entity>.yaml` + `docs/api-contract/<entity>.yaml` files, and updating `CLAUDE.md` when high-level architecture shifts. Reads the locked surface inventory and models the app shell / nav container as a real C4 component. |
| `engineer` | sonnet (opus for analyze-bug) | Always-fullstack implementer, routed by dispatch verb. From `implement-slice`: **implement** drives backend/frontend slice-checklist tasks through strict outside-in TDD; **diagnose-E2E** integrates main, boots the stack, runs the slice's E2E specs and categorizes any failures into correlated production-fix groups (returning the diagnosis, editing no code) and **fix-E2E** drives production code to GREEN for one diagnosed group via TDD — the Pass-E2E phase loops diagnose → serial per-group fixes until green (bails to `status:need-attention` on a test-case constraint); **fix-slice** addresses slice-review findings; **fix-pr** clears one open draft PR of `conflict` / `ci` blockers. From `/ship`'s bug lane: **analyze-bug** (read-only, dispatched on `opus`) reproduces a `kind:bug` (browser MCP → Playwright fallback, stack booted either way), root-causes it, and posts a `# Bug Analysis` comment; **fix-bug** (inside `fix-bug.mjs`) writes the regression test first and drives it green. Reads the slice body's `## Tasks` checklist as the task ledger, resumes from ticked boxes + the branch's `Task: <id>` WIP commits, ticks its boxes on completion. Loads the full fullstack pattern set upfront, audits Dockerfile / compose before every push, and pulls per-entity context (data-model, api-contract) on demand. On a **frontend** task it also reads the slice's already-authored E2E specs read-only — as an affordance reference (the accessible names / roles / nav path the specs query) so the UI matches what the pass-E2E gate looks for, while the Gherkin AC stays the behavioral oracle. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a slice's e2e checklist tasks, dispatched by the `implement-slice` Workflow with a (slice #, task IDs) pair (`Author E2E …` / `Fix E2E coverage …`). Sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch (`Task: <id>` trailers), pushes, ticks the authored tasks' checklist boxes, and posts a summary comment. PR creation is owned by the workflow's terminal phase; the full Playwright suite is validated by the workflow's pass-E2E phase + CI on the slice PR. |
| `axis-reviewer` | sonnet | Read-only single-axis reviewer: applies exactly ONE `pattern-reviewer-*` catalogue to a slice diff and returns structured findings (no verdict, no comment, no label). The `implement-slice` fan-out review (`runReviewSlice()`) spawns one per applicable pattern; the workflow owns dedup, adversarial verification, scoring, the verdict, and posting. Runs in `production-code` scope (implemented code) or `test-coverage` scope (authored E2E specs, pre-implementation). |
| `reviewer` | sonnet | Read-only single-**context** **fallback** reviewer for one slice, used only when the `implement-slice` fan-out review is unavailable (e.g. the `Workflow` tool is absent). Collapses the fan-out into one context — applying the same per-axis rules (`axis-reviewer`) to every applicable `pattern-reviewer-*` at once on top of the always-on `pattern-test-coverage` gate — posts one structured `# Slice Review` comment, and RETURNS the verdict (APPROVE / BLOCK). Flips no label, opens no PR (the calling `implement-slice` workflow owns the lock, the fix loop, and the terminal PR). |
| `doc-writer` | sonnet | Pure executor invoked by `/deep-dive-feature` to materialize the artifacts a read-only interviewer just settled. Routes by dispatch prompt: a `product-owner` payload → publish the requirement, a `design-lead` payload → publish the design system, an `architect` payload → publish the ADR / implementation-detail / api-contract / data-model / runbook set. Pulls its scoped payload from the matching interviewer via `SendMessage`, then writes and commits — it never decides *what* to write. |
| `sre` | sonnet | Owns the GitHub Actions CI/CD surface — PR validation (lint/type/test, image build, e2e), trunk auto-deploy to dev, and tag-driven release-candidate / release promotions to staging/prod via OIDC, GitHub Environments, and immutable image tags. Defined and ready; not yet auto-dispatched by any command (see the To-be roadmap). |

## Workflows

Beyond one-shot agent dispatch, the plugin ships **deterministic multi-agent orchestration scripts** under [`workflows/`](workflows/), invoked via the `Workflow` tool. A workflow spawns every agent as a peer in one flat pool, so it can express fan-out that the two-level Agent tree forbids. They ship with the plugin and are invoked by `scriptPath` against `${CLAUDE_PLUGIN_ROOT}` (not by `name:`, which resolves in the consuming project). See [`workflows/README.md`](workflows/README.md) for the authoring + wiring contract.

There are **two unit-cycle workflows** — one per `kind:` of work — and in both the review fan-out is inlined as a function rather than a child workflow. `/ship` kickoff routes by kind: feature/enhancement slices launch `implement-slice.mjs`; bugs launch the lighter `fix-bug.mjs`.

| Workflow | Layer | What it does |
| --- | --- | --- |
| `implement-slice.mjs` | Per feature/enhancement slice (launched by `/ship` or `/implement-feature` kickoff, one per slice) | Owns the whole inner cycle: Prep (parse the slice checklist **and derive the Scope Manifest — the closed `acIds` set + the `dontBreak` regression guards — carried into both reviews as the closed scope authority**) → Author E2E (`e2e-author`) → Coverage gate (`runReviewSlice('test-coverage')` + fix loop) → Plan → Implement (`engineer`, serial groups) → Pass E2E (`engineer` diagnose → serial per-group fix loop) → Slice review (`runReviewSlice('production-code')` + fix loop, judging each task at its **owning layer** via a per-task discharge ledger; on APPROVE the workflow ticks every **AC** checkbox — the reviewer-gated verified gate, distinct from the engineer's task-box self-tick which is only a progress claim) → open the `merge:manual` draft PR and release the slice lock. The Author-E2E + Coverage-gate phases stay conditional on the slice having an `e2e` task — and a slice gets an `e2e` task only when it closes a cross-surface journey segment, so backend-only slices skip both. Fix loops are uncapped on *progress* — each loops to confidence-to-pass (`APPROVE` / all tasks ticked) with no fixed round limit, and every round logs its token delta (a cost meter). `halt()` flips `status:need-attention` — the path to a human — on infra failure OR on an **oscillation stall**: the same blocker surviving its own targeted fix for `STALL_ROUNDS` (3) consecutive rounds, fingerprinted by file + title so genuine progress (retiring blockers, even while surfacing new ones) never trips it. Generative phases are single `agent()` dispatches (shared worktree → serial); the two reviewer phases are `runReviewSlice()` fan-outs. |
| `fix-bug.mjs` | Per approved bug (launched by `/ship` kickoff once a human approved the `# Bug Analysis` comment) | The lighter sibling of `implement-slice.mjs` — no E2E-authoring phase and no coverage gate. Prep (create the `fix/<n>-<intent>` branch, pull the approved analysis' regression-test plan) → Fix (write the regression test **first** — RED on pre-fix code — drive it GREEN, refactor) → Review (`runReview()`, production-code scope, + fix loop) → open the `merge:manual` draft PR and release the bug lock. The fails-before/passes-after discipline is enforced by the review's deletable-code lens (`pattern-test-coverage`), not a bespoke gate. |
| `runReviewSlice()` / `runReview()` | inlined function inside each workflow | Fans review out across isolated `pattern-reviewer-*` dimensions — one `axis-reviewer` agent each — dedups overlapping findings, adversarially verifies each through three skeptic lenses (batched per dimension, ≤10 findings per agent, so dispatch scales with dimensions × chunks rather than one agent per finding — the cross-lens majority vote is unchanged), then **posts one `# Slice Review` / `# E2E Coverage Gate` / `# Bug Fix Review` comment and RETURNS the verdict** — flips no label, opens no PR (the surrounding phases own those). Scopes: `test-coverage` (gate the authored E2E specs pre-implementation against the slice AC + non-happy-paths; spec dims only; BLOCK on any gap) and `production-code` (the two-phase walk against implemented code; BLOCK on any surviving `I:H`). **Both scopes are bounded by the Scope Manifest** (rendered into every dimension agent's *and* every verifier's context) plus a **per-task discharge ledger** (each task's owning layer + the `covers:`/`scenario:` it discharges there): the coverage gate covers exactly the manifest's `acIds` + their Gherkin (a behavior with no AC id is not a gap); the production review requires every finding to ground in a declared `acId` or a touched-path rule (no prose-synthesized ACs), judges each task at its **owning layer** (a backend invariant is proven at the backend layer, never demanded through E2E), and treats a missing test for unchanged behavior as at most a Deferred/Nit, never a blocker. On a `production-code` APPROVE the AC checkboxes are ticked — the verified gate. `fix-bug.mjs` duplicates the production-code path inline (workflow scripts are self-contained — no shared import). |

### `runReviewSlice()` pipeline + model tiers

```
Prep ─► Spec (fan-out) ─ dedup ─ verify ─►[ GATE ]─► Quality (fan-out) ─ dedup ─ verify ─► compose ─► Publish
```

Each phase fans out, **dedups, then verifies** before the next consumes it — so the gate trips on *confirmed* blockers, not raw ones (a `I:H` spec finding that survives verification both skips the redundant Phase-2 quality audit and is, by construction, a BLOCK). Phases are split across **two model tiers** by the kind of work each does — retune in one place via `AGENT_MODEL` / `WRITER_MODEL` at the top of the script:

| Phase | Model | Why |
| --- | --- | --- |
| **Prep** — read-only worktree, diff vs `origin/main` | `haiku` | Pure tool-orchestration; carries no review judgment. |
| **Prep · surface classification** — touched paths → the surface flags that drive which dimensions run (full scope only) | `sonnet` | The one judgment call in prep: a misclassified path silently drops a whole review dimension via `applies()`, so it keeps the stronger model (and is biased toward `true`). |
| **Spec / Quality** — one `axis-reviewer` agent per `pattern-reviewer-*` dimension; **Verify** — 3-lens adversarial refutation | `sonnet` | The judgment-bearing review work — pinned to match the single `reviewer` fallback agent (`model: sonnet`). |
| **Publish** — write + `post-comment.sh`; return the verdict | `haiku` | A pure executor performing the only write in the workflow. |

Scoring (`severity → Impact`, `(Impact, Effort) → Fix/Defer/Nit/Drop`, `full verdict = BLOCK iff any surviving I:H`) runs as plain deterministic JS, not an LLM step, so it is identical across runs.

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `principle-engineer-tdd` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `pattern-test-coverage` | The shared, role-neutral catalogue of what makes a test set *complete*: every AC is **discharged at its owning layer** (backend integration / frontend / true-E2E — a compound AC fans across layers, each clause pushed to the lowest layer that can prove it and asserted once), plus Gherkin / migration coverage, edge breadth, named-observable assertions, emitted-artifact correctness, E2E selector quality, and the **deletable-code spine** (the completeness bar, not AC→test count). Loaded by **both** the engineer (TDD red phase) and the reviewer (code gate), so it is the single overlay target for coverage substance — a dreamed rule reaches the side that makes the miss, not only the side that catches it. |
| `pattern-e2e-coding-standard` | The E2E standard for the `e2e-author` agent — asserts **user-visible state only** (never a backend internal through the UI; not every AC maps to an E2E assertion), and the data-seeding contract: seed via API → respect `docs/api-contract/<entity>.yaml` (path / verb / status / body); seed direct-to-DB → respect `docs/data-model/<entity>.yaml` (table / columns / constraints / defaults / FKs). Halt on a missing or contradictory contract; never invent shape. |
| `operation-git` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-feature-issues` | Decomposes a locked-in feature's PRD into thin vertical-slice GitHub issues, each carrying EARS acceptance criteria at the slice level (always present, even backend-only — each AC clause classified by **owning layer**) and a typed task checklist where every task tags `covers:` + its own `scenario:` Gherkin block (Given/When/Then, walked at the task's owning layer — there is no upfront slice-level Gherkin block); an `e2e` task is emitted only when the slice closes a cross-surface journey segment (one `kind:feature` issue per slice + linked branch). The feature member of the three issue-creation skills. |
| `create-enhancement-issue` | Creates one feature-shaped `kind:enhancement` issue against existing code (Context / Modifies / Scope / AC / Tasks / Don't break) + a linked `enhancement/<n>-<intent>` branch — no interview, no doc-lock. Guards that the change touches no contract (else it's a feature). `/ship` runs it through the same `implement-slice.mjs` cycle as a feature slice. |
| `create-bug-issue` | Creates one `kind:bug` issue with a Zone-A symptom body (Summary / Environment / Steps / Expected-vs-actual / Evidence / Severity / Regression) — no status, no branch — so the `/ship` analyze stage picks it up. The diagnosis is posted later as a `# Bug Analysis` comment, not written here. |
| `memory-convention` | Reference doc for how agents **consume** per-project summarized memory — where the `.claude/memory/patterns/<skill>.md` overlays live, their file shape, and the precedence rules for applying them on top of a baseline pattern skill. (Runtime telemetry is hook-owned and out of scope.) |
| `dream-summary-memory` | The "dreaming" pass: reads GitHub issues **and PRs** closed since the last dream run (the cutoff recorded in `dream-log.md`, not a fixed window) — review/fix comment threads + fix commits, plus PR CI-failure and merge-conflict history — distills the recurring pattern-wise mistakes, and writes additive rule overlays under `.claude/memory/patterns/<skill>.md`. Autonomous (schedulable); appends an audit entry to `.claude/memory/dream-log.md`. |

### Engineer patterns

Bullet-form reminders for production-code authoring. Each is matched 1:1 by a `pattern-reviewer-*` skill that carries the detailed audit lens.

| Skill | What it does |
| --- | --- |
| `pattern-engineer-coding-standard` | Language-agnostic standards — Readability → KISS → DRY → YAGNI, naming, immutability, narrow error handling, parallel-by-default async, strong types, AAA tests. |
| `pattern-engineer-backend-standard` | Framework-agnostic backend bullets — REST shape, schema-validated input, authorize-before-act + ownership, error envelope, Idempotency-Key, atomic mutations, rate limits, CSRF, logs, `/healthz` + `/readyz`, graceful SIGTERM, `.env.example` lockstep, locked deps. |
| `pattern-engineer-frontend-standard` | React bullets — composition-first components, custom hooks, route registration + entry-source reachability (a real inbound path from the shell or parent, not just a passing URL-render test), route-param query guards, `onSuccess` invalidation, stable mutation returns, idempotency-key rotation, `src/lib/api`, error boundaries, native a11y, RHF+Zod, mobile-first, Tailwind ↔ tokens. |
| `pattern-engineer-typescript` | TypeScript bullets — strict mode + the non-negotiable flags, `compilerOptions.types` for test matchers, no `any`, discriminated unions, `interface` vs `type`, biome owns import order. |
| `pattern-engineer-python` | Python bullets — `uv` only, full type annotations, EAFP, modern type hints, `Protocol` for seams, dataclass DTOs, `with` for resources, bandit-banned APIs avoided. |
| `pattern-engineer-fastapi` | FastAPI bullets — `APIRouter` + prefix, `Depends()` injection, Pydantic at boundary only, app-level exception handlers, middleware order, trailing-slash, named path constants, async-by-default. |
| `pattern-engineer-vite` | Vite bullets — pick Vite for CSR; `VITE_` prefix on env vars; Vitest setup; route-boundary lazy loading; static-asset imports; dev-server proxy. |
| `pattern-engineer-container` | Multi-stage Dockerfiles, pinned non-root images, mandatory `.dockerignore`, migration-aware entrypoints, `/healthz` endpoints, nginx ordering, deliberate networking/volumes, day-to-day `docker compose` commands. |
| `pattern-engineer-database` | Migrations: autogenerate Alembic revisions from models, test with pytest-alembic (round-trip + named-artifact + extension cleanup), run via the one-shot `migrate` compose service. |
| `pattern-engineer-observability` | OpenTelemetry as the only instrumentation API; traces / metrics / logs through OTel with shared resource attributes, semantic-convention names, bounded label cardinality, source-gated structured logs. |
| `pattern-engineer-security` | Engineer-facing security brief — non-negotiables + quick-lookup table + red flags. Points back to `pattern-reviewer-security` for canonical bars. |

### Design

| Skill | What it does |
| --- | --- |
| `pattern-architect-api-endpoint` | Resource-oriented REST conventions: URLs, verbs, response/error shape, pagination, filtering, sorting, versioning, idempotency. |
| `pattern-architect-data-model` | Data-model shape and naming: predictable naming for tables / columns / constraints / indexes / views, and the SQLAlchemy `MetaData` convention that emits those names automatically. |
| `pattern-architect-deep-module` | Ousterhout-style "deep module" design: narrow interfaces, hidden complexity, no shallow wrappers or pass-through layers. |

### Reviewer patterns

Loaded by the `implement-slice` fan-out's `axis-reviewer` agents (one per dimension) and the single-context `reviewer` fallback. Each skill emits findings in its own shape; they are aggregated into one `# Slice Review` comment with the verdict (APPROVE / BLOCK).

| Skill | What it does |
| --- | --- |
| `pattern-reviewer-test-coverage` | Reviewer lens over the shared `pattern-test-coverage` catalogue — turns a coverage gap into a graded, cited finding (every gap HIGH, blocks the gate; cite AC label + test file; `# Code Review` shape). The substance it gates against lives in `pattern-test-coverage`; this skill owns only detection, severity, and reporting. |
| `pattern-reviewer-coding-standard` | Language-agnostic code-quality patterns — large functions / files / deep nesting / mutation / dead code / `console.log` left behind; performance; best practices; AI-generated-code addendum. |
| `pattern-reviewer-contract` | Conformance audit — every API endpoint matches its `docs/api-contract/<entity>.yaml` (path / verb / status / body / envelope / idempotency / rate-limit), and every ORM model matches its `docs/data-model/<entity>.yaml` (table / columns / constraint names / relationships). |
| `pattern-reviewer-backend-standard` | Backend best-practice audit — input-validation mechanics, unbounded queries, N+1, missing timeouts, 5xx leakage, atomic mutations, `/healthz` shape, log redaction, `.env.example` lockstep, locked deps. Contract conformance lives in `pattern-reviewer-contract`. |
| `pattern-reviewer-frontend-standard` | React audit — hook correctness, route registration + reachability, TanStack Query route-param guards, mutation `onSuccess` + return stability, idempotency-key rotation, API via `src/lib/api`, error boundaries, native a11y, Tailwind ↔ tokens. |
| `pattern-reviewer-typescript` | TypeScript audit — `tsconfig.json` strictness, `compilerOptions.types` for test matchers, `any` usage, `!` non-null without invariant, `interface` vs `type`, discriminated unions, biome `organizeImports`. |
| `pattern-reviewer-python` | Python audit — bandit-banned APIs (B310/B602/B314/B506/B101), type annotations, EAFP discipline, modern type hints, `Protocol` over ABC, dataclass DTOs, context managers, `uv`-only environment. |
| `pattern-reviewer-fastapi` | FastAPI audit — `APIRouter` prefix discipline, `Depends()` injection, Pydantic at boundary only, exception handlers + error envelope, middleware order, trailing-slash conformance, named path constants, `Settings()` footgun, `dependency_overrides` in tests. |
| `pattern-reviewer-vite` | Vite audit — stack choice, `VITE_` prefix discipline, `.env.example` lockstep, `vite.config.ts` scope, vitest setup alignment with tsconfig, lazy-load + Suspense fallback, static-asset imports. |
| `pattern-reviewer-container` | Docker / compose audit — multi-stage build, pinned + `docker scout`-vetted tags, non-root user with writable paths redirected, `.dockerignore`, backend entrypoint runs migrations before serving, `/healthz` shape, nginx SPA-fallback ordering, no secrets in image. |
| `pattern-reviewer-database` | Migration audit — code-first, autogenerate review, `pytest-alembic` round-trip, post-state assertions by name, extension cleanup on downgrade, ORM ↔ migration name parity, both-direction constraint tests, no `conftest.py` pre-warming, `migrate` compose service. |
| `pattern-reviewer-observability` | OTel audit — no vendor SDKs in `src/`, no `print` / `console.log`, span naming low-cardinality, semantic-convention attributes, errors via `record_exception`, bounded metric labels, structured JSON logs with trace correlation, batch processors, single SDK bootstrap, sampling lives in the Collector. |
| `pattern-reviewer-security` | Self-contained detailed security catalogue + iteration flow, run in a slice review's quality phase when the slice touches backend / frontend code. Fourteen patterns; cites `file:line` or `image:<tag>` with each pattern's exact `Required end state`. |

## Memory (per-consuming-project, always-on)

Engineer and reviewer dispatches start from the baseline pattern skills shipped here, but each consuming project grows its own memory — auto-created on the first engineer/reviewer dispatch, never flowing back upstream into this plugin. Memory has two roots split by lifetime: **ephemeral runtime signals** under `/tmp/harness-claude-code/<repo>/signals/` and **durable pattern overlays** under `$MAIN_ROOT/.claude/memory/` (where `<repo>` is `basename "$MAIN_ROOT"` and `$MAIN_ROOT` is the consuming project's main worktree root). There are three concerns:

- **Writing (telemetry).** Every engineer / reviewer dispatch writes exactly one signal: `/tmp/harness-claude-code/<repo>/signals/<agent-id>.meta.json` (keyed on `agent_id`, not the shared `session_id`, so parallel dispatches don't collide), recording session/agent id + initial prompt, start / end / duration, invoked skills, token usage (total **and** per-skill via active-window attribution), a `tool → count` histogram, and stop reason. Captured entirely by the bundled `hooks/runtime-telemetry/` scripts — seeded by a `SubagentStart` hook whose `matcher` is the regex `^(.+:)?(engineer|reviewer)$` (Claude Code only treats a matcher as a regex when it contains characters outside `[A-Za-z0-9_|]`, so a bare `engineer|reviewer` would be exact-string alternation and miss the namespaced `agent_type` plugin agents arrive with). No other agent type produces telemetry.
- **Dreaming.** `/dream-summary-memory` (on demand now, schedulable later) reads the project's GitHub issues **and PRs** closed in the last 24h — issue review/fix comment threads + fix commits, plus PR CI-failure and merge-conflict history — distills the **recurring, pattern-wise** mistakes, and writes them as additive rule overlays under `.claude/memory/patterns/<skill>.md`. It writes autonomously and logs every run to `.claude/memory/dream-log.md`. One-off bugs and lone merge conflicts are dropped; only generalizable patterns (including repeat CI failures and shared-file conflict hotspots) become memory.
- **Consuming.** Every pattern skill (`pattern-engineer-*`, `pattern-reviewer-*`) checks `.claude/memory/patterns/<skill-name>.md` at load time and applies its rules additively (sharpened triggers, project-specific carve-outs, new rules, BAD/GOOD examples worth pinning).

Runtime signals in `/tmp` are throwaway (the OS reclaims them). `.claude/memory/` is a working directory — add `/.claude/memory/` to the project's `.gitignore`. To clear memory: `rm -rf /tmp/harness-claude-code/<repo>/ .claude/memory/` (both re-created on the next dispatch).

See [`skills/memory-convention/SKILL.md`](skills/memory-convention/SKILL.md) for the overlay-reading contract (overlay shape, precedence rules, severity floor, conflict surfacing).

## Hooks

Hooks live in [`hooks/`](hooks/) and are wired up by `hooks/hooks.json`.

| Hook | When it fires | What it does |
| --- | --- | --- |
| `engineer-pre-push.sh` | `PreToolUse` on every `Bash` call, but no-ops unless the command contains `git push` *and* the cwd is an engineer worktree under `/tmp/harness-claude-code/<repo>/worktrees/`. | Runs the **fullstack** check set against the engineer's worktree before allowing the push — each stack's runner is internally gated on its directory existing, so a backend-only or frontend-only project still runs cleanly. Container presence + lockfile-tracked + dep-bootstrap, then backend = `ruff` / `mypy` / `bandit` / `pytest`, frontend = `biome` / `tsc --noEmit` / `npm audit` / `jest`, then container smoke + Playwright E2E + security scans (gitleaks / trivy / semgrep). On failure, denies the `Bash` tool call so the engineer sees the failure summary, fixes it, and retries the push. |
| `runtime-telemetry/bootstrap.sh` | `SubagentStart` with `matcher: "^(.+:)?(engineer\|reviewer)$"` (regex form — must contain non-`[A-Za-z0-9_\|]` chars or Claude Code falls back to exact-string alternation and misses the namespaced `agent_type`) — fires automatically when one of those subagents starts. | Reads `agent_id` / `agent_type` / `cwd` from the payload, derives the `<repo>` basename from the main worktree root, auto-creates `/tmp/harness-claude-code/<repo>/signals/`, and seeds `<agent-id>.meta.json` with agent identity, started timestamp, cwd, session id, and empty `tool_calls` / `per_skill_tokens` / `skills_invoked` (`dispatch_prompt` backfilled at stop). Silent no-op if no `agent_id`. This marker file is the gate (with the matcher) that limits all runtime-telemetry capture to engineer + reviewer dispatches. |
| `runtime-telemetry/pre-tool-use.sh` | `PreToolUse` on every tool call (no matcher). | If a `<agent-id>.meta.json` exists for the firing `agent_id`, increments `meta.json#tool_calls[<tool>]` and, when the tool is `Read` on a `*/skills/*/SKILL.md` file or `Skill` with a `skill` parameter, appends the skill name to `meta.json#skills_invoked` (first-seen order). No `agent_id` (main-thread call) → no-op. Always exits 0; never blocks a tool call. |
| `runtime-telemetry/subagent-stop.sh` | `SubagentStop` once per subagent termination. | If a `<agent-id>.meta.json` exists for the firing `agent_id`, finalizes it with `ended_at`, `duration_ms`, total `token_usage` (summed across all assistant turns), `per_skill_tokens` (active-window attribution from the transcript), `stop_reason`, and `dispatch_prompt` (backfilled from the transcript's first user turn). |

## Layout

```
.claude-plugin/
  plugin.json          # plugin manifest
  marketplace.json     # marketplace manifest (lets users install via /plugin marketplace add)
agents/                # role-based subagents
commands/              # slash commands
skills/                # auto-activating skills (one directory per skill)
workflows/             # deterministic multi-agent Workflow scripts (implement-slice + fix-bug, each with inlined review fan-out)
hooks/                 # PreToolUse hooks (engineer pre-push gate) + hooks.json
```

## Prior art

The skill / agent layout, lifecycle shape, and TDD discipline here draw on ideas from several public Claude Code repos. We reference them for *patterns and taste* — every skill, agent, command, and hook in this repo is authored ourselves, not imported. No `use skills from <other-repo>`; the surface area is ours, the influence is theirs.

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [obra/superpowers](https://github.com/obra/superpowers)
- [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [mattpocock/skills](https://github.com/mattpocock/skills)
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo)
