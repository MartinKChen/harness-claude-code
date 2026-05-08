# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships a feature deep-dive command, a roster of role-based agents, and a curated skill library covering TDD (with bundled coding/frontend/backend/Docker references), git, database migrations, security, and API/module design.

## Install from GitHub

In Claude Code:

```
/plugin marketplace add MartinKChen/harness-claude-code
/plugin install harness-claude-code@martinchen-marketplace
```

The first command registers this repo as a marketplace (it reads `.claude-plugin/marketplace.json`). The second installs the plugin defined in `.claude-plugin/plugin.json`. To update later, run `/plugin marketplace update martinchen-marketplace`.

## Commands

Slash commands live in [`commands/`](commands/).

| Command | Purpose |
| --- | --- |
| `/deep-dive-feature` | Two-phase feature deep-dive: product discovery with `product-owner`, then technical discovery with `architect`. Creates a feature branch, commits the artifacts each teammate produces, and opens a single PR at the end. |
| `/pickup-task-for-implementation` | Promotes ready-and-unblocked slice issues to in-progress, then dispatches a one-shot sub-agent for every `level:task` + `status:ready-to-implement` + `kind:feature` task with zero open blockers (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer`). Designed to be looped via `/loop /pickup-task-for-implementation`. |
| `/pickup-pr-for-review` | Scans open PRs, flips each `review:<gate>-pending` label to `-running`, and dispatches the matching one-shot reviewer (`code` → `code-reviewer`, `security` → `security-reviewer`). The e2e gate is owned by a GitHub Actions workflow and is not picked up here. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity data-model and api-contract files under `docs/PRDs/<feature>/`, and updating `CLAUDE.md` when high-level architecture shifts. |
| `engineer` | sonnet | Implements one task at a time via strict outside-in TDD, applying backend or frontend pattern skills and touching container setup when needed. Pulls per-entity architecture context (data-models, api-contracts) on demand from the feature's `docs/PRDs/<feature>/` directory — resolved from the sub-issue's milestone — instead of bulk-loading. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a single task issue. Self-driven from an issue ID — sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch, pushes, and opens a draft PR. The full Playwright suite is validated by a GitHub Actions workflow on the PR. |
| `code-reviewer` | sonnet | Read-only one-shot PR reviewer. Walks a quality/security checklist on the diff, posts a single structured comment with every finding, and flips the PR's `review:code-running` label to `review:code-passed` or `review:code-need-fix`. Fix work is delegated separately. |
| `security-reviewer` | sonnet | Read-only validator that checks the codebase and built images against the `security-patterns` skill, posts findings to the PR, and flips the `review:security-running` label to `-passed` or `-need-fix`. Fix work is delegated separately. |
| `sre` | sonnet | Owns `.github/workflows/` for CI/CD — PR validation (lint/type/test, image build, e2e), trunk auto-deploy to dev, and tag-driven release-candidate / release promotions to staging/prod via OIDC, GitHub Environments, and immutable image tags. Builds once and promotes; never rebuilds across environments. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `tdd-workflow` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `git-workflow` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-issues` | Decomposes a PRD or requirement into thin vertical-slice GitHub issues with EARS + Gherkin acceptance criteria. |
| `implement-issue` | Drives a single GitHub issue from "ready" to "merged PR" by dispatching one-shot sub-agents per typed sub-issue (an `e2e-author` for e2e, an `engineer` instructed as backend/frontend for the rest), then running a validation phase that dispatches further one-shot `security-reviewer`, `code-reviewer`, and `engineer` sub-agents until the gates are clean. The full Playwright E2E suite is validated separately by a GitHub Actions workflow on the PR. |

### Coding patterns

| Skill | What it does |
| --- | --- |
| `database-patterns` | Code-first data modeling with SQLAlchemy + Alembic, naming conventions for tables / columns / constraints, migration testing with pytest-alembic. |
| `security-patterns` | Baseline app-sec checks: CVEs, secret handling, input validation, parameterized queries, auth/cookies, CSRF + rate limits, redacted logs. |

### Design

| Skill | What it does |
| --- | --- |
| `design-api-endpoint` | Resource-oriented REST conventions: URLs, verbs, response/error shape, pagination, filtering, sorting, versioning, idempotency. |
| `design-deep-module` | Ousterhout-style "deep module" design: narrow interfaces, hidden complexity, no shallow wrappers or pass-through layers. |

### `tdd-workflow` references

These were standalone skills; they now live under [`skills/tdd-workflow/references/`](skills/tdd-workflow/references/) and are loaded on demand by `tdd-workflow` (or read directly by agents that need them).

| Reference | Read it when |
| --- | --- |
| `coding-patterns.md` | Always — language-agnostic standards (naming, KISS/DRY/YAGNI, immutability, error handling, AAA tests). |
| `docker-patterns.md` | The task is container-related — modifying `Dockerfile`, `docker-compose.yaml`, or `.dockerignore`. |
| `frontend-patterns.md` | The task implements frontend code — React + TypeScript, hooks, pages, forms, etc. |
| `python-patterns.md` | The task implements backend code in Python — handlers, models, pytest tests. |

## Layout

```
.claude-plugin/
  plugin.json          # plugin manifest
  marketplace.json     # marketplace manifest (lets users install via /plugin marketplace add)
agents/                # role-based subagents
commands/              # slash commands
skills/                # auto-activating skills (one directory per skill)
```
