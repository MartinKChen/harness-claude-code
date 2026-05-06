# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships a feature deep-dive command, a roster of role-based agents, and a curated skill library covering TDD, coding patterns, frontend/backend conventions, git, Docker, and database migrations.

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
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR and an implementation-detail document and updating `CLAUDE.md` when high-level architecture shifts. |
| `engineer` | sonnet | Implements one task at a time via strict outside-in TDD, applying backend or frontend pattern skills and touching container setup when needed. |
| `e2e-runner` | sonnet | Maintains and executes Playwright E2E tests against the docker-compose stack; routes failures to the right engineer instead of patching tests around bugs. |
| `security-reviewer` | sonnet | Read-only validator that checks the codebase and built images against the `security-patterns` skill, dispatches fixes to engineer teammates, and re-validates until clean. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `tdd-workflow` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `git-workflow` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-issues` | Decomposes a PRD or requirement into thin vertical-slice GitHub issues with EARS + Gherkin acceptance criteria. |
| `implement-issue` | Drives a single GitHub issue from "ready" to "merged PR" by orchestrating an implementation team and a separate validation team. |

### Coding patterns

| Skill | What it does |
| --- | --- |
| `coding-patterns` | Language-agnostic standards: naming, KISS/DRY/YAGNI, immutability, error handling, AAA tests, code-smell detection. |
| `python-patterns` | Idiomatic Python: `uv`, PEP 8, type annotations, EAFP, Protocols, dataclasses, context managers, standard lint/test commands. |
| `frontend-patterns` | React + TypeScript conventions: Next vs. Vite, composition, custom hooks, Context + Reducer, Tailwind tokens, accessibility, i18n. |
| `database-patterns` | Code-first data modeling with SQLAlchemy + Alembic, naming conventions for tables / columns / constraints, migration testing with pytest-alembic. |
| `docker-patterns` | Multi-stage builds, pinned tags, non-root runtime, narrow port exposure, deliberate volume choices, `docker compose` operations. |
| `security-patterns` | Baseline app-sec checks: CVEs, secret handling, input validation, parameterized queries, auth/cookies, CSRF + rate limits, redacted logs. |

### Design

| Skill | What it does |
| --- | --- |
| `design-api-endpoint` | Resource-oriented REST conventions: URLs, verbs, response/error shape, pagination, filtering, sorting, versioning, idempotency. |
| `design-deep-module` | Ousterhout-style "deep module" design: narrow interfaces, hidden complexity, no shallow wrappers or pass-through layers. |

## Layout

```
.claude-plugin/
  plugin.json          # plugin manifest
  marketplace.json     # marketplace manifest (lets users install via /plugin marketplace add)
agents/                # role-based subagents
commands/              # slash commands
skills/                # auto-activating skills (one directory per skill)
```
