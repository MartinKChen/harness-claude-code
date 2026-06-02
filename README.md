# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships a pickup / close-out lifecycle command (`/implement-feature`) backed by pure-shell discovery scripts that drive issues and PRs through their lifecycle, a roster of role-based agents, a curated skill library covering TDD, coding / frontend / backend / container / observability patterns, git, database migrations, security, and API/module design, and a pre-push hook that gates engineer-driven pushes on lint/type/security/test checks.

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
- **Design / UX as a continuous lane.** The design system is now locked up front: `/deep-dive-feature` runs a `design-lead` interview (product → **design** → architecture) that locks the visual language and a surface + navigation inventory, `/scaffold-project` seeds the resulting tokens, and `create-issues` emits a foundation/shell slice plus a page-reachability gate. Still missing: a dedicated per-feature design *review* phase (visual polish on shipped pages).
- **SRE in the workflow.** The agent exists; nothing dispatches it yet. CI/CD ownership is still manual.
- **Enhancement and bug-fix lifecycles.** Only `kind:feature` slices get the full slice → task → review → merge treatment. `kind:bug` and `kind:enhancement` need their own (lighter) loop.

## Commands

Slash commands live in [`commands/`](commands/).

| Command | Purpose |
| --- | --- |
| `/deep-dive-feature` | Three-phase feature deep-dive: product discovery with `product-owner`, design discovery with `design-lead` (locks the visual language + surface/navigation inventory), then technical discovery with `architect`. Creates a feature branch, commits each teammate's artifacts, and opens a single PR at the end. |
| `/scaffold-project` | Greenfield-only. Reads `docs/architecture-decision-record/` for stack + topology, creates a scaffold branch, materializes backend + frontend + e2e + `docker-compose.yaml` from templates, verifies the stack boots end-to-end, asserts the design system locked by `/deep-dive-feature` exists and seeds its tokens into the frontend, then pushes and opens a PR. |
| `/implement-feature` | Drive one end-to-end pass through the lifecycle for a single feature milestone. Runs `skills/operation-git/scripts/task-finder.sh` once (pure shell, read-only, no LLM) to identify eligible candidates across the nine lifecycle stages, then performs the per-stage label flips + `TaskCreate` + `Agent` dispatch + `TaskUpdate(owner)` (and Stage 9's squash-merge + per-slice memory signal) directly. At pass entry it closes the tracking tasks of agents that finished since the last pass (matched by `owner` to the `<task-notification>` that re-invoked it). Wrap with `/loop /implement-feature <feature-name>` for end-to-end shipping. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

### Lifecycle discovery scripts

The pickup / close-out lifecycle is driven by the `/implement-feature` command, which runs the umbrella discovery script `skills/operation-git/scripts/task-finder.sh <feature-name>` once per pass. The umbrella runs the nine per-stage scripts below in order against a single GitHub-state snapshot and emits one canonical markdown report. Everything here is **pure shell** — no LLM, no agent, no skill prompt-include. Every label flip, `TaskCreate`, `Agent` dispatch, draft → ready promotion, squash-merge, and memory signal is owned by the `/implement-feature` command itself. These scripts are not invoked directly by users.

| Stage script | Purpose |
| --- | --- |
| `task-finder-stage-1-kickoff-slice.sh` | Lists `level:slice` + `kind:feature` + `status:ready-to-implement` slices with zero open blockers — slices the command should promote to `status:in-progress` (and whose `kind:feature` task sub-issues should receive `status:ready-to-implement`). |
| `task-finder-stage-2-implement-task.sh` | Lists `level:task` + `kind:feature` + `status:ready-to-implement` tasks with zero open blockers and no sibling currently editing the same slice worktree, classified by `type:*` (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). |
| `task-finder-stage-3-review-task.sh` | Lists `level:task` + `kind:feature` + `status:in-progress` tasks carrying `review:pending` — tasks awaiting code review. |
| `task-finder-stage-4-fix-task.sh` | Lists `level:task` + `kind:feature` + `status:in-progress` tasks carrying `review:need-fix` (no sibling slice-locking the worktree), classified by `type:*`. |
| `task-finder-stage-5-prepare-slice.sh` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices whose sub-issues are ALL closed AND that carry no `review:*` / `e2e:*` label yet — slices ready to enter E2E validation. The sticky `e2e:validated` marker (set on the first E2E pass) is what keeps this stage from re-adopting a slice that's already in the review/fix loop. |
| `task-finder-stage-6-review-slice.sh` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices carrying `review:pending` — slices awaiting slice-level review. |
| `task-finder-stage-7-fix-slice.sh` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices carrying `review:need-fix`. |
| `task-finder-stage-8-fix-pr.sh` | Lists draft PRs in the milestone with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` / `status:need-attention`. |
| `task-finder-stage-9-close-pr.sh` | Lists draft PRs that are `MERGEABLE` with every check rollup state SUCCESS / NEUTRAL / SKIPPED, each tagged `merge:<auto\|manual>` and with its linked slice number resolved from the `Closes #<slice-#>` line. |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `design-lead` | opus | Interviews the user to lock the product's visual language and information architecture, producing the design system (`docs/design-system/{overview,tokens,components,accessibility}.md`) and the surface + navigation inventory (`docs/design-system/surfaces.md`) that closes the orphan-page gap. Read-only / plan-mode; `ui-ux-pro-max` is its toolbox. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity `docs/data-model/<entity>.yaml` + `docs/api-contract/<entity>.yaml` files, and updating `CLAUDE.md` when high-level architecture shifts. Reads the locked surface inventory and models the app shell / nav container as a real C4 component. |
| `engineer` | sonnet | Always-fullstack implementer with four modes. **Mode A** drives one assigned `type:backend` / `type:frontend` task through strict outside-in TDD. **Mode B** fixes one open draft PR for `conflict` and/or `ci` scenarios (and bails to `status:need-attention` when the CI failure needs an E2E-spec rewrite). **Mode C** addresses reviewer `need-fix` findings on a task, propagating the fix across every equivalent site found in the codebase. **Mode D** prepares a slice's draft PR — runs the slice's touched E2E specs in a worktree, fixes any production-code regressions surfaced, and either opens the draft PR (clearing `status:prepare-pr`) or flips the slice to `status:need-attention` when an E2E spec itself needs human editing. Loads the full fullstack pattern set upfront in every mode, audits Dockerfile / compose against the runtime surface before every push, and pulls per-entity architecture context (data-model, api-contract) on demand from `docs/data-model/` and `docs/api-contract/` instead of bulk-loading. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a single task issue. Self-driven from an issue ID — sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch, pushes, and flips `review:pending` on the task. PR creation is owned by the `reviewer` agent on a passing slice review (and the `/implement-feature` command's close-pr stage handles the eventual squash-merge). The full Playwright suite is validated by a GitHub Actions workflow on the slice PR. |
| `reviewer` | sonnet | Read-only one-shot reviewer for a single task issue. Picks the pattern-skill set from the task's `type:*` label — the `pattern-test-coverage` catalogue read through its `pattern-reviewer-test-coverage` lens for every `type:*`, plus `pattern-reviewer-coding-standard` and `pattern-reviewer-security` for `type:backend` / `type:frontend` (the security patterns are skipped for `type:e2e`). Builds the slug-tagged image when running security patterns, posts one structured `# Review` comment with every finding, and flips `review:running` to `review:passed` / `review:need-fix`. Fix work is delegated separately. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `principle-engineer-tdd` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `pattern-test-coverage` | The shared, role-neutral catalogue of what makes a test set *complete* (AC / Gherkin / migration coverage, edge breadth, named-observable assertions, emitted-artifact correctness, E2E selector quality, and the deletable-code spine). Loaded by **both** the engineer (TDD red phase) and the reviewer (code gate), so it is the single overlay target for coverage substance — a dreamed rule reaches the side that makes the miss, not only the side that catches it. |
| `operation-git` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-issues` | Decomposes a PRD or requirement into thin vertical-slice GitHub issues with EARS + Gherkin acceptance criteria. |
| `memory-convention` | Reference doc for how agents **consume** per-project summarized memory — where the `.claude/memory/patterns/<skill>.md` overlays live, their file shape, and the precedence rules for applying them on top of a baseline pattern skill. (Runtime telemetry is hook-owned and out of scope.) |
| `dream-summary-memory` | The "dreaming" pass: reads GitHub issues closed in the last 24h (review/fix comments, PRs, fix commits), distills the recurring pattern-wise mistakes, and writes additive rule overlays under `.claude/memory/patterns/<skill>.md`. Autonomous (schedulable); appends an audit entry to `.claude/memory/dream-log.md`. |

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

Loaded by the `reviewer` agent. Each skill emits findings in its own shape; the agent aggregates them into one `# Review` comment and sets the verdict (APPROVE / BLOCK).

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
| `pattern-reviewer-security` | Self-contained detailed security catalogue + iteration flow for `type:backend` / `type:frontend` task reviews (skipped for `type:e2e`). Fourteen patterns; cites `file:line` or `image:<tag>` with each pattern's exact `Required end state`. |

## Memory (per-consuming-project, always-on)

Engineer and reviewer dispatches start from the baseline pattern skills shipped here, but each consuming project grows its own memory — auto-created on the first engineer/reviewer dispatch, never flowing back upstream into this plugin. Memory has two roots split by lifetime: **ephemeral runtime signals** under `/tmp/harness-claude-code/<repo>/signals/` and **durable pattern overlays** under `$MAIN_ROOT/.claude/memory/` (where `<repo>` is `basename "$MAIN_ROOT"` and `$MAIN_ROOT` is the consuming project's main worktree root). There are three concerns:

- **Writing (telemetry).** Every engineer / reviewer dispatch writes exactly one signal: `/tmp/harness-claude-code/<repo>/signals/<agent-id>.meta.json` (keyed on `agent_id`, not the shared `session_id`, so parallel dispatches don't collide), recording session/agent id + initial prompt, start / end / duration, invoked skills, token usage (total **and** per-skill via active-window attribution), a `tool → count` histogram, and stop reason. Captured entirely by the bundled `hooks/runtime-telemetry/` scripts — seeded by a `SubagentStart` hook whose `matcher` is the regex `^(.+:)?(engineer|reviewer)$` (Claude Code only treats a matcher as a regex when it contains characters outside `[A-Za-z0-9_|]`, so a bare `engineer|reviewer` would be exact-string alternation and miss the namespaced `agent_type` plugin agents arrive with). No other agent type produces telemetry.
- **Dreaming.** `/dream-summary-memory` (on demand now, schedulable later) reads the project's GitHub issues **and PRs** closed in the last 24h — issue review/fix comment threads + fix commits, plus PR CI-failure and merge-conflict history — distills the **recurring, pattern-wise** mistakes, and writes them as additive rule overlays under `.claude/memory/patterns/<skill>.md`. It writes autonomously and logs every run to `.claude/memory/dream-log.md`. One-off bugs and lone merge conflicts are dropped; only generalizable patterns (including repeat CI failures and shared-file conflict hotspots) become memory.
- **Consuming.** Every pattern skill (`pattern-engineer-*`, `pattern-reviewer-*`) checks `.claude/memory/patterns/<skill-name>.md` at load time and applies its rules additively (sharpened triggers, project-specific carve-outs, new rules, BAD/GOOD examples worth pinning).

Runtime signals in `/tmp` are throwaway (the OS reclaims them). `.claude/memory/` is a working directory — add `/.claude/memory/` to the project's `.gitignore`. To clear memory: `rm -rf /tmp/harness-claude-code/<repo>/ .claude/memory/` (both re-created on the next dispatch).

See [`skills/memory-convention/SKILL.md`](skills/memory-convention/SKILL.md) for the overlay-reading contract (overlay shape, precedence rules, severity floor, conflict surfacing).

## Engineer handoff files

Separate from memory: short-lived **handoff docs** for the engineer agent live under `/tmp/harness-claude-code/<repo>/handoffs/<unit>.md`. One unit of work → one doc. The `PreCompact` hook (`engineer-precompact-handoff.sh`) writes it when an engineer session is about to hit the context-compaction boundary; the next engineer dispatched on the same unit reads it at kickoff (via the `operation-engineer-handoff` skill) and resumes from the recorded stop point. The doc is overwritten on every outgoing handoff so it always reflects the most recent stop point, and is removed on a clean pickup. Shares the same `<repo>` basename and `/tmp/` root as the worktree (`/tmp/harness-claude-code/<repo>/worktrees/<slice-branch>`) and signal (`/tmp/harness-claude-code/<repo>/signals/`) trees.

## Hooks

Hooks live in [`hooks/`](hooks/) and are wired up by `hooks/hooks.json`.

| Hook | When it fires | What it does |
| --- | --- | --- |
| `engineer-pre-push.sh` | `PreToolUse` on every `Bash` call, but no-ops unless the command contains `git push` *and* the cwd is an engineer worktree under `/tmp/harness-claude-code/<repo>/worktrees/`. | Runs lint / type / security / test checks against the engineer's worktree before allowing the push. If no draft PR exists for the slice yet (first push of the slice), narrows checks to the active task's `type:backend` / `type:frontend` stack via the most recent `Refs #<n>` trailer; once a PR is open, runs both stacks. Backend = `ruff` / `mypy` / `bandit` / `pytest`; frontend = `biome` / `tsc --noEmit` / `npm audit` / `jest`. On failure, denies the `Bash` tool call so the engineer sees the failure summary, fixes it, and retries the push. |
| `engineer-budget-gate.sh` | `PreToolUse` on `Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`, but no-ops unless the firing agent is an `engineer` (bare or namespaced `agent_type`) inside a slice worktree. | The **primary** handoff trigger. Measures live-window occupancy (latest assistant turn's `input` + `cache_read` + `cache_creation` tokens) and, once it crosses `ENGINEER_HANDOFF_THRESHOLD` (default 150000), DENIES the current mutating call with an instruction to run `operation-engineer-handoff`'s Outgoing handoff. Records the firing occupancy in a per-agent marker, then steps aside so the handoff's own commit / push / doc-write aren't blocked; re-arms once occupancy grows another `ENGINEER_HANDOFF_REARM` (default 20000) tokens. Always exits 0 on any error path. |
| `engineer-precompact-handoff.sh` | `PreCompact` with `matcher: "^(.+:)?engineer$"` (regex form — same load-bearing reason as the SubagentStart matcher), but no-ops unless the firing agent is an `engineer` inside a slice worktree. | The handoff **safety net** for when a single huge turn blew past the budget gate. Writes a git-state breadcrumb to the canonical handoff-doc path (only if no doc exists — never clobbering an agent-authored doc), then BLOCKS the first AUTO compaction once per agent and surfaces the handoff instruction as the block reason. Manual `/compact` is never blocked. Always exits 0 on the allow path. |
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
hooks/                 # PreToolUse hooks (engineer pre-push gate) + hooks.json
```

## Prior art

The skill / agent layout, lifecycle shape, and TDD discipline here draw on ideas from several public Claude Code repos. We reference them for *patterns and taste* — every skill, agent, command, and hook in this repo is authored ourselves, not imported. No `use skills from <other-repo>`; the surface area is ours, the influence is theirs.

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- [obra/superpowers](https://github.com/obra/superpowers)
- [affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code)
- [mattpocock/skills](https://github.com/mattpocock/skills)
- [ruvnet/ruflo](https://github.com/ruvnet/ruflo)
