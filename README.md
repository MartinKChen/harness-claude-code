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

**As-is — what the harness covers today:** end-to-end automation of the greenfield feature lifecycle. Spec / contract generation → planning → outside-in TDD implementation → code & security review → fix loop → draft PR → merge. GitHub issues are the source of truth; every lifecycle step is an idempotent skill the orchestrator can re-enter safely.

**To-be — known gaps on the roadmap:**
- **Design / UX as an upstream lane.** Today visual work backdoors in through the frontend task — there's no dedicated discovery or review phase before code lands.
- **SRE in the workflow.** The agent exists; nothing dispatches it yet. CI/CD ownership is still manual.
- **Enhancement and bug-fix lifecycles.** Only `kind:feature` slices get the full slice → task → review → merge treatment. `kind:bug` and `kind:enhancement` need their own (lighter) loop.

## Commands

Slash commands live in [`commands/`](commands/).

| Command | Purpose |
| --- | --- |
| `/deep-dive-feature` | Two-phase feature deep-dive: product discovery with `product-owner`, then technical discovery with `architect`. Creates a feature branch, commits each teammate's artifacts, and opens a single PR at the end. |
| `/implement-feature` | Drive one end-to-end pass through the lifecycle skills in order — `workflow-orchestrator-kickoff-slice-issue` → `workflow-orchestrator-implement-task-issue` → `workflow-orchestrator-review-task-issue` → `workflow-orchestrator-fix-task-issue` → `workflow-orchestrator-close-task-issue` → `workflow-orchestrator-create-draft-pr` → `workflow-orchestrator-fix-pr` → `workflow-orchestrator-close-pr`. Each skill self-skips when there's nothing eligible. Wrap with `/loop /implement-feature` for end-to-end shipping. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

### Lifecycle skills

The pickup / close-out lifecycle is now driven by skills under [`skills/`](skills/) — invoke each manually as `/<skill-name>`, or loop with `/loop /<skill-name>`.

| Skill | Purpose |
| --- | --- |
| `/workflow-orchestrator-kickoff-slice-issue` | Promotes ready-and-unblocked slice issues to in-progress and appends `status:ready-to-implement` to every `kind:feature` task sub-issue underneath, priming them for `/workflow-orchestrator-implement-task-issue`. Skips slices with open `Blocked by` dependencies. |
| `/workflow-orchestrator-implement-task-issue` | Dispatches a one-shot sub-agent for every `level:task` + `kind:feature` + `status:ready-to-implement` task with zero open blockers (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer` in Mode A). |
| `/workflow-orchestrator-review-task-issue` | Scans in-progress tasks carrying `review:code-pending` or `review:security-pending`, flips the pending gate(s) to `-running`, and dispatches the `reviewer` sub-agent in the background — one per `(task, gate)` pair; the agent picks the pattern-skill set from the labels. Reviews are scoped to the task issue, not the slice PR. |
| `/workflow-orchestrator-fix-task-issue` | For tasks carrying `review:*-need-fix` and no in-flight gate, dispatches `engineer` Mode C (`type:backend` / `type:frontend`) or `e2e-author` (`type:e2e`) to address the reviewer findings on the slice branch. |
| `/workflow-orchestrator-close-task-issue` | Closes every in-progress task whose required review gates have all reached `*-passed` (backend / frontend need `code` + `security`; e2e needs only `code`). |
| `/workflow-orchestrator-create-draft-pr` | For every open slice issue whose task sub-issues have all closed (and which is not already labeled `status:prepare-pr` or `status:need-attention`), locks the slice with `status:prepare-pr` and dispatches an `engineer` in Mode D (`workflow-orchestrator-prepare-slice-pr`) to run the slice's touched E2E specs, fix any production-code regressions surfaced, and either open the draft PR (success — engineer removes `status:prepare-pr`) or flip the slice to `status:need-attention` when an E2E spec itself needs human editing. |
| `/workflow-orchestrator-fix-pr` | Scans draft PRs (excluding any carrying `status:fix-in-progress` or `status:need-attention`) for failing CI checks and/or merge conflicts; locks each with `status:fix-in-progress` and dispatches `engineer` Mode B with the scenario list (any non-empty subset of `{conflict, ci}`). When the failing CI is confirmed to need an E2E-spec rewrite, the engineer bails by flipping the PR to `status:need-attention` instead of pushing a partial fix. |
| `/workflow-orchestrator-close-pr` | Promotes draft PRs that are `MERGEABLE` with all CI green, squash-merges them, and strips `status:in-progress` from the linked slice issue (closing the slice). |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity `docs/data-model/<entity>.yaml` + `docs/api-contract/<entity>.yaml` files, and updating `CLAUDE.md` when high-level architecture shifts. |
| `engineer` | sonnet | Always-fullstack implementer with four modes. **Mode A** drives one assigned `type:backend` / `type:frontend` task through strict outside-in TDD. **Mode B** fixes one open draft PR for `conflict` and/or `ci` scenarios (and bails to `status:need-attention` when the CI failure needs an E2E-spec rewrite). **Mode C** addresses reviewer `need-fix` findings on a task, propagating the fix across every equivalent site found in the codebase. **Mode D** prepares a slice's draft PR — runs the slice's touched E2E specs in a worktree, fixes any production-code regressions surfaced, and either opens the draft PR (clearing `status:prepare-pr`) or flips the slice to `status:need-attention` when an E2E spec itself needs human editing. Loads the full fullstack pattern set upfront in every mode, audits Dockerfile / compose against the runtime surface before every push, and pulls per-entity architecture context (data-model, api-contract) on demand from `docs/data-model/` and `docs/api-contract/` instead of bulk-loading. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a single task issue. Self-driven from an issue ID — sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch, pushes, and flips `review:code-pending` on the task. PR creation is owned entirely by the `/workflow-orchestrator-create-draft-pr` skill once every task sub-issue under a slice has closed. The full Playwright suite is validated by a GitHub Actions workflow on the slice PR. |
| `reviewer` | sonnet | Read-only one-shot reviewer for a single `(task, gate)` pair. Picks the pattern-skill set from the task's `(type:*, gate)` labels — code gate runs `pattern-reviewer-test-coverage` for every `type:*` plus `pattern-reviewer-coding-standard` for `type:backend`/`type:frontend`; security gate runs `pattern-reviewer-security` (backend / frontend only; refuses `type:e2e`). Builds the slug-tagged image for security scans, posts one structured comment with every finding, and flips the gate label from `-running` to `-passed` / `-need-fix`. Fix work is delegated separately. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `principle-engineer-tdd` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `operation-git` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-issues` | Decomposes a PRD or requirement into thin vertical-slice GitHub issues with EARS + Gherkin acceptance criteria. |

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

Loaded by the `reviewer` agent. Each skill emits findings in its own shape; the agent aggregates them into one `# Code Review` or `# Security Review` comment and sets the verdict (APPROVE / BLOCK).

| Skill | What it does |
| --- | --- |
| `pattern-reviewer-test-coverage` | Test adequacy on every `type:*` code gate — AC + scenario coverage, edge breadth (boundary, error, empty, concurrency, idempotency, authz), `type:e2e` semantic-selector coverage. |
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
| `pattern-reviewer-security` | Self-contained detailed security catalogue + iteration flow for the security gate on `type:backend` / `type:frontend`. Fourteen patterns; cites `file:line` or `image:<tag>` with each pattern's exact `Required end state`. |

## Hooks

Hooks live in [`hooks/`](hooks/) and are wired up by `hooks/hooks.json`.

| Hook | When it fires | What it does |
| --- | --- | --- |
| `engineer-pre-push.sh` | `PreToolUse` on every `Bash` call, but no-ops unless the command contains `git push` *and* the cwd is an engineer worktree under `/tmp/git-worktree/`. | Runs lint / type / security / test checks against the engineer's worktree before allowing the push. If no draft PR exists for the slice yet (first push of the slice), narrows checks to the active task's `type:backend` / `type:frontend` stack via the most recent `Refs #<n>` trailer; once a PR is open, runs both stacks. Backend = `ruff` / `mypy` / `bandit` / `pytest`; frontend = `biome` / `tsc --noEmit` / `npm audit` / `jest`. On failure, denies the `Bash` tool call so the engineer sees the failure summary, fixes it, and retries the push. |

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
