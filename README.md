# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships pickup / close-out lifecycle skills that drive issues and PRs through their lifecycle, a roster of role-based agents, a curated skill library covering TDD, coding / frontend / backend / container / observability patterns, git, database migrations, security, and API/module design, and a pre-push hook that gates engineer-driven pushes on lint/type/security/test checks.

## Install from GitHub

In Claude Code:

```
/plugin marketplace add MartinKChen/harness-claude-code
/plugin install harness-claude-code@martinchen-marketplace
```

The first command registers this repo as a marketplace (it reads `.claude-plugin/marketplace.json`). The second installs the plugin defined in `.claude-plugin/plugin.json`. To update later, run `/plugin marketplace update martinchen-marketplace`.

## Status

**As-is — what the harness covers today:** end-to-end automation of the greenfield feature lifecycle. Spec / contract generation → project scaffold (with optional design-system seeding) → planning → outside-in TDD implementation → code & security review → fix loop → draft PR → merge. GitHub issues are the source of truth; every lifecycle step is an idempotent skill the orchestrator can re-enter safely.

A visual walkthrough of how the commands, agents, and labels fit together lives at [`docs/workflow.html`](docs/workflow.html) — open it in a browser.

**To-be — known gaps on the roadmap:**
- **Design / UX as a continuous lane.** Greenfield projects get a design system via `/scaffold-project` (optional opt-in to a UI/UX design skill, then tokens seeded into the frontend). Per-feature visual work still backdoors in through the frontend task — there's no dedicated per-feature design review phase yet.
- **SRE in the workflow.** The agent exists; nothing dispatches it yet. CI/CD ownership is still manual.
- **Enhancement and bug-fix lifecycles.** Only `kind:feature` slices get the full slice → task → review → merge treatment. `kind:bug` and `kind:enhancement` need their own (lighter) loop.

## Commands

Slash commands live in [`commands/`](commands/).

| Command | Purpose |
| --- | --- |
| `/deep-dive-feature` | Two-phase feature deep-dive: product discovery with `product-owner`, then technical discovery with `architect`. Creates a feature branch, commits each teammate's artifacts, and opens a single PR at the end. |
| `/scaffold-project` | Greenfield-only. Reads `docs/architecture-decision-record/` for stack + topology, creates a scaffold branch, materializes backend + frontend + e2e + `docker-compose.yaml` from templates, verifies the stack boots end-to-end, optionally invokes a UI/UX design skill and seeds its tokens into the frontend, then pushes and opens a PR. |
| `/implement-feature` | Drive one end-to-end pass through the lifecycle for a single feature milestone. Dispatches the `task-finder` agent once (foreground, read-only) to identify eligible candidates across the nine lifecycle stages, then performs the per-stage label flips + `TaskCreate` + `Agent` dispatch + `TaskUpdate(owner)` (and Stage 9's squash-merge + per-slice memory signal) directly. Wrap with `/loop /implement-feature <feature-name>` for end-to-end shipping. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

### Lifecycle discovery skills

The pickup / close-out lifecycle is driven by the `/implement-feature` command, which dispatches the `task-finder` agent once per pass. `task-finder` invokes the nine discovery skills below in order against a single GitHub-state snapshot and aggregates their outputs into one report. Each skill is **read-only** — every label flip, `TaskCreate`, `Agent` dispatch, draft → ready promotion, squash-merge, and memory signal is owned by the `/implement-feature` command. These skills are not invoked directly by users.

| Skill | Purpose |
| --- | --- |
| `workflow-task-finder-kickoff-slice` | Lists `level:slice` + `kind:feature` + `status:ready-to-implement` slices with zero open blockers — slices the command should promote to `status:in-progress` (and whose `kind:feature` task sub-issues should receive `status:ready-to-implement`). |
| `workflow-task-finder-implement-task` | Lists `level:task` + `kind:feature` + `status:ready-to-implement` tasks with zero open blockers and no sibling currently editing the same slice worktree, classified by `type:*` (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). |
| `workflow-task-finder-review-task` | Lists `level:task` + `kind:feature` + `status:in-progress` tasks carrying `review:pending` — tasks awaiting code review. |
| `workflow-task-finder-fix-task` | Lists `level:task` + `kind:feature` + `status:in-progress` tasks carrying `review:need-fix` (no sibling slice-locking the worktree), classified by `type:*`. |
| `workflow-task-finder-prepare-slice` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices whose sub-issues are ALL closed AND that carry no `review:*` / `e2e:*` label yet — slices ready to enter E2E validation. |
| `workflow-task-finder-review-slice` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices carrying `review:pending` — slices awaiting slice-level review. |
| `workflow-task-finder-fix-slice` | Lists `level:slice` + `kind:feature` + `status:in-progress` slices carrying `review:need-fix`. |
| `workflow-task-finder-fix-pr` | Lists draft PRs in the milestone with a merge-blocking signal (failing CI and/or merge conflict), excluding those carrying `status:fix-in-progress` / `status:need-attention`. |
| `workflow-task-finder-close-pr` | Lists draft PRs labeled `merge:auto` that are `MERGEABLE` with every check rollup state SUCCESS / NEUTRAL / SKIPPED, with each PR's linked slice number resolved from the `Closes #<slice-#>` line. |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity `docs/data-model/<entity>.yaml` + `docs/api-contract/<entity>.yaml` files, and updating `CLAUDE.md` when high-level architecture shifts. |
| `engineer` | sonnet | Always-fullstack implementer with four modes. **Mode A** drives one assigned `type:backend` / `type:frontend` task through strict outside-in TDD. **Mode B** fixes one open draft PR for `conflict` and/or `ci` scenarios (and bails to `status:need-attention` when the CI failure needs an E2E-spec rewrite). **Mode C** addresses reviewer `need-fix` findings on a task, propagating the fix across every equivalent site found in the codebase. **Mode D** prepares a slice's draft PR — runs the slice's touched E2E specs in a worktree, fixes any production-code regressions surfaced, and either opens the draft PR (clearing `status:prepare-pr`) or flips the slice to `status:need-attention` when an E2E spec itself needs human editing. Loads the full fullstack pattern set upfront in every mode, audits Dockerfile / compose against the runtime surface before every push, and pulls per-entity architecture context (data-model, api-contract) on demand from `docs/data-model/` and `docs/api-contract/` instead of bulk-loading. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a single task issue. Self-driven from an issue ID — sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch, pushes, and flips `review:pending` on the task. PR creation is owned by the `reviewer` agent on a passing slice review (and the `/implement-feature` command's close-pr stage handles the eventual squash-merge). The full Playwright suite is validated by a GitHub Actions workflow on the slice PR. |
| `reviewer` | sonnet | Read-only one-shot reviewer for a single task issue. Picks the pattern-skill set from the task's `type:*` label — `pattern-reviewer-test-coverage` for every `type:*`, plus `pattern-reviewer-coding-standard` and `pattern-reviewer-security` for `type:backend` / `type:frontend` (the security patterns are skipped for `type:e2e`). Builds the slug-tagged image when running security patterns, posts one structured `# Review` comment with every finding, and flips `review:running` to `review:passed` / `review:need-fix`. Fix work is delegated separately. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `principle-engineer-tdd` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
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
| `pattern-engineer-frontend-standard` | React bullets — composition-first components, custom hooks, route registration + reachability test, route-param query guards, `onSuccess` invalidation, stable mutation returns, idempotency-key rotation, `src/lib/api`, error boundaries, native a11y, RHF+Zod, mobile-first, Tailwind ↔ tokens. |
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
| `pattern-reviewer-test-coverage` | Test adequacy on every `type:*` task review — AC + scenario coverage, edge breadth (boundary, error, empty, concurrency, idempotency, authz), `type:e2e` semantic-selector coverage. |
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

Engineer and reviewer dispatches start from the baseline pattern skills shipped here, but each consuming project grows its own memory — auto-created on the first engineer/reviewer dispatch, never flowing back upstream into this plugin. Memory has two roots split by lifetime: **ephemeral runtime signals** under `/tmp/claude-memory/<repo-slug>/` and **durable pattern overlays** under `$MAIN_ROOT/.claude/memory/` (slug = `<basename>-<sha256[:8]>` of the main-worktree path). There are three concerns:

- **Writing (telemetry).** Every engineer / reviewer dispatch writes exactly one signal: `/tmp/claude-memory/<repo-slug>/signals/runtime/<agent-id>.meta.json` (keyed on `agent_id`, not the shared `session_id`, so parallel dispatches don't collide), recording session/agent id + initial prompt, start / end / duration, invoked skills, token usage (total **and** per-skill via active-window attribution), a `tool → count` histogram, and stop reason. Captured entirely by the bundled `hooks/runtime-telemetry/` scripts — seeded by a `SubagentStart` hook with a `matcher` of `engineer|reviewer`, so no other agent type produces telemetry.
- **Dreaming.** `/dream-summary-memory` (on demand now, schedulable later) reads the project's GitHub issues **and PRs** closed in the last 24h — issue review/fix comment threads + fix commits, plus PR CI-failure and merge-conflict history — distills the **recurring, pattern-wise** mistakes, and writes them as additive rule overlays under `.claude/memory/patterns/<skill>.md`. It writes autonomously and logs every run to `.claude/memory/dream-log.md`. One-off bugs and lone merge conflicts are dropped; only generalizable patterns (including repeat CI failures and shared-file conflict hotspots) become memory.
- **Consuming.** Every pattern skill (`pattern-engineer-*`, `pattern-reviewer-*`) checks `.claude/memory/patterns/<skill-name>.md` at load time and applies its rules additively (sharpened triggers, project-specific carve-outs, new rules, BAD/GOOD examples worth pinning).

Runtime signals in `/tmp` are throwaway (the OS reclaims them). `.claude/memory/` is a working directory — add `/.claude/memory/` to the project's `.gitignore`. To clear memory: `rm -rf /tmp/claude-memory/<repo-slug>/ .claude/memory/` (both re-created on the next dispatch).

See [`skills/memory-convention/SKILL.md`](skills/memory-convention/SKILL.md) for the overlay-reading contract (overlay shape, precedence rules, severity floor, conflict surfacing).

## Hooks

Hooks live in [`hooks/`](hooks/) and are wired up by `hooks/hooks.json`.

| Hook | When it fires | What it does |
| --- | --- | --- |
| `engineer-pre-push.sh` | `PreToolUse` on every `Bash` call, but no-ops unless the command contains `git push` *and* the cwd is an engineer worktree under `/tmp/git-worktree/`. | Runs lint / type / security / test checks against the engineer's worktree before allowing the push. If no draft PR exists for the slice yet (first push of the slice), narrows checks to the active task's `type:backend` / `type:frontend` stack via the most recent `Refs #<n>` trailer; once a PR is open, runs both stacks. Backend = `ruff` / `mypy` / `bandit` / `pytest`; frontend = `biome` / `tsc --noEmit` / `npm audit` / `jest`. On failure, denies the `Bash` tool call so the engineer sees the failure summary, fixes it, and retries the push. |
| `runtime-telemetry/bootstrap.sh` | `SubagentStart` with `matcher: "engineer\|reviewer"` — fires automatically when one of those subagents starts. | Reads `agent_id` / `agent_type` / `cwd` from the payload, derives the `<repo-slug>`, auto-creates `/tmp/claude-memory/<repo-slug>/signals/runtime/`, and seeds `<agent-id>.meta.json` with agent identity, started timestamp, cwd, session id, and empty `tool_calls` / `per_skill_tokens` / `skills_invoked` (`dispatch_prompt` backfilled at stop). Silent no-op if no `agent_id`. This marker file is the gate (with the matcher) that limits all runtime-telemetry capture to engineer + reviewer dispatches. |
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
