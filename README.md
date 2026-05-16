# harness-claude-code

An opinionated Claude Code plugin that wraps a full product → architecture → implementation → validation workflow. Ships pickup / close-out lifecycle skills that drive issues and PRs through their lifecycle, a roster of role-based agents, a curated skill library covering TDD (with bundled coding/frontend/backend/Docker references), git, database migrations, security, and API/module design, and a pre-push hook that gates engineer-driven pushes on lint/type/security/test checks.

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
| `/implement-feature` | Drive one end-to-end pass through the lifecycle skills in order — `kickoff-slice-issue` → `implement-task-issue` → `review-task-issue` → `fix-task-issue` → `close-task-issue` → `create-draft-pr` → `fix-pr` → `close-pr`. Each skill self-skips when there's nothing eligible. Wrap with `/loop /implement-feature` for end-to-end shipping. |
| `/create-agent` | Author a new Claude Code subagent under `.claude/agents/<name>.md` — walks through naming, model choice, role, and section content, then writes the file. |
| `/create-skill` | Author a new Claude Code skill under `.claude/skills/<name>/SKILL.md` — walks through naming, summary, triggers, and which optional sections apply. |

### Lifecycle skills

The pickup / close-out lifecycle is now driven by skills under [`skills/`](skills/) — invoke each manually as `/<skill-name>`, or loop with `/loop /<skill-name>`.

| Skill | Purpose |
| --- | --- |
| `/kickoff-slice-issue` | Promotes ready-and-unblocked slice issues to in-progress and appends `status:ready-to-implement` to every `kind:feature` task sub-issue underneath, priming them for `/implement-task-issue`. Skips slices with open `Blocked by` dependencies. |
| `/implement-task-issue` | Dispatches a one-shot sub-agent for every `level:task` + `kind:feature` + `status:ready-to-implement` task with zero open blockers (`type:e2e` → `e2e-author`; `type:backend` / `type:frontend` → `engineer` in Mode A). |
| `/review-task-issue` | Scans in-progress tasks carrying `review:code-pending` or `review:security-pending`, flips the pending gate(s) to `-running`, and dispatches the matching reviewer (`code-reviewer` / `security-reviewer`) in the background. Reviews are scoped to the task issue, not the slice PR. |
| `/fix-task-issue` | For tasks carrying `review:*-need-fix` and no in-flight gate, dispatches `engineer` Mode C (`type:backend` / `type:frontend`) or `e2e-author` (`type:e2e`) to address the reviewer findings on the slice branch. |
| `/close-task-issue` | Closes every in-progress task whose required review gates have all reached `*-passed` (backend / frontend need `code` + `security`; e2e needs only `code`). |
| `/create-draft-pr` | For every open slice issue whose task sub-issues have all closed (and which is not already labeled `status:prepare-pr` or `status:need-attention`), locks the slice with `status:prepare-pr` and dispatches an `engineer` in Mode D (`prepare-slice-pr`) to run the slice's touched E2E specs, fix any production-code regressions surfaced, and either open the draft PR (success — engineer removes `status:prepare-pr`) or flip the slice to `status:need-attention` when an E2E spec itself needs human editing. |
| `/fix-pr` | Scans draft PRs (excluding any carrying `status:fix-in-progress` or `status:need-attention`) for failing CI checks and/or merge conflicts; locks each with `status:fix-in-progress` and dispatches `engineer` Mode B with the scenario list (any non-empty subset of `{conflict, ci}`). When the failing CI is confirmed to need an E2E-spec rewrite, the engineer bails by flipping the PR to `status:need-attention` instead of pushing a partial fix. |
| `/close-pr` | Promotes draft PRs that are `MERGEABLE` with all CI green, squash-merges them, and strips `status:in-progress` from the linked slice issue (closing the slice). |

## Agents

Subagents live in [`agents/`](agents/). Each one is scoped to a single role and is normally driven by a command or skill rather than invoked directly.

| Agent | Model | Role |
| --- | --- | --- |
| `product-owner` | opus | Interviews the user to clarify a feature, then produces the PRD, Critical Path, and Glossary and updates `CLAUDE.md`. |
| `architect` | opus | Designs a ship-ready architecture without over-engineering, generating an ADR, an implementation-detail document, per-entity data-model and api-contract files under `docs/PRDs/<feature>/`, and updating `CLAUDE.md` when high-level architecture shifts. |
| `engineer` | sonnet | Always-fullstack implementer with four modes. **Mode A** drives one assigned `type:backend` / `type:frontend` task through strict outside-in TDD. **Mode B** fixes one open draft PR for `conflict` and/or `ci` scenarios (and bails to `status:need-attention` when the CI failure needs an E2E-spec rewrite). **Mode C** addresses reviewer `need-fix` findings on a task, propagating the fix across every equivalent site found in the codebase. **Mode D** prepares a slice's draft PR — runs the slice's touched E2E specs in a worktree, fixes any production-code regressions surfaced, and either opens the draft PR (clearing `status:prepare-pr`) or flips the slice to `status:need-attention` when an E2E spec itself needs human editing. Loads the full fullstack pattern set upfront in every mode, audits Dockerfile / compose against the runtime surface before every push, and pulls per-entity architecture context (data-models, api-contracts) on demand from `docs/PRDs/<feature>/` instead of bulk-loading. |
| `e2e-author` | sonnet | Authors and extends Playwright E2E tests for a single task issue. Self-driven from an issue ID — sets up its own slice-scoped worktree rebased onto main, writes tests, smoke-runs them, commits to the slice branch, pushes, and flips `review:code-pending` on the task. PR creation is owned entirely by the `/create-draft-pr` skill once every task sub-issue under a slice has closed. The full Playwright suite is validated by a GitHub Actions workflow on the slice PR. |
| `code-reviewer` | sonnet | Read-only one-shot PR reviewer. Walks a quality/security checklist on the diff, posts a single structured comment with every finding, and flips the PR's `review:code-running` label to `review:code-passed` or `review:code-need-fix`. Fix work is delegated separately. |
| `security-reviewer` | sonnet | Read-only validator that checks the codebase and built images against the `security-patterns` skill, posts findings to the PR, and flips the `review:security-running` label to `-passed` or `-need-fix`. Fix work is delegated separately. |

## Skills

Skills live in [`skills/`](skills/) and auto-activate when their triggers match the task at hand.

### Workflow

| Skill | What it does |
| --- | --- |
| `tdd-workflow` | Outside-in TDD loop — acceptance test → red/green/refactor module loop → adapter contract tests → wiring, with per-step commits. |
| `git-workflow` | GitHub Flow conventions for commits, branches, PRs, issues, releases, and `gh` usage. |
| `create-issues` | Decomposes a PRD or requirement into thin vertical-slice GitHub issues with EARS + Gherkin acceptance criteria. |

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
