# CLAUDE.md

Guidance for working **on** this repo. This is **not an application** — it is a
**Claude Code plugin** (`harness-claude-code`) distributed through a marketplace.
There is no app to run, no test suite to execute, no server to boot. The
"product" is a set of Markdown prompts (agents, commands, skills), a few
deterministic JavaScript orchestration scripts (workflows), and shell hooks.
Editing this repo means editing prompts and the contracts between them.

## What it ships

An opinionated product → architecture → implementation → validation workflow:

- **Commands** (`commands/*.md`) — slash-command orchestrators. They never write
  code themselves; they bring agents onto a team, brief them, and (in execution)
  launch background Workflow runs against GitHub-issue state. `/ship` is the
  unified execution command (feature + enhancement + bug); `/implement-feature`
  is its feature-only fallback; `/deep-dive-feature` and `/scaffold-project` are
  the discovery + bootstrap commands; `/create-agent` and `/create-skill` author
  new plugin surfaces.
- **Agents** (`agents/*.md`) — single-role subagents (`product-owner`,
  `design-lead`, `architect`, `engineer`, `e2e-author`, `axis-reviewer`,
  `reviewer`, `doc-writer`, `sre`). Each declares its model and the skills it
  loads (always-on vs. conditional pattern/principle vs. conditional workflow).
- **Skills** (`skills/<name>/SKILL.md`) — auto-activating capability prompts.
  Engineer-facing `pattern-engineer-*` skills are paired 1:1 with reviewer-facing
  `pattern-reviewer-*` skills; `pattern-test-coverage` is the shared, role-neutral
  catalogue both sides gate against. `operation-git` is the single source of
  truth for every `gh`/`git` mechanic (scripts + templates live under it).
- **Workflows** (`workflows/*.mjs`) — deterministic multi-agent orchestration run
  via the `Workflow` tool. `implement-slice.mjs` drives a feature/enhancement
  slice; `fix-bug.mjs` is its lighter bug sibling. Both inline their review
  fan-out as a function (`runReviewSlice()` / `runReview()`) rather than a child
  workflow.
- **Hooks** (`hooks/`, wired by `hooks/hooks.json`) — an engineer pre-push CI
  gate and the `runtime-telemetry/` capture scripts.

## Layout

```
.claude-plugin/   plugin.json (manifest, holds the version) + marketplace.json
agents/           role-based subagents (one .md each)
commands/         slash commands (one .md each)
skills/           auto-activating skills (one directory per skill, SKILL.md + templates/ + scripts/)
workflows/        deterministic Workflow scripts (plain self-contained JS) + README.md
hooks/            PreToolUse / SubagentStart hooks + hooks.json
docs/             workflow.html (visual walkthrough)
README.md         the authoritative prose catalogue of every surface
```

## Conventions

- **Author new surfaces through the meta-skills.** Use `/create-skill` for a new
  skill and `/create-agent` for a new agent rather than hand-rolling the
  frontmatter — they encode the naming, model-choice, and section structure this
  repo expects.
- **Engineer/reviewer pairing is load-bearing.** A new `pattern-engineer-X` should
  have a matching `pattern-reviewer-X`, and coverage *substance* belongs in the
  shared `pattern-test-coverage` (so a dreamed rule reaches both sides).
- **Workflow scripts are plain JavaScript, not TypeScript, and self-contained.**
  No shared imports between `.mjs` files — shared logic (the review fan-out) is
  duplicated inline by design. `Date.now()`/`Math.random()` are unavailable in
  workflow scripts; dates are passed in via `args.today`.
- **`gh` over `git`** for any GitHub operation that has a `gh` equivalent; reserve
  raw `git` for purely local work (rebase, worktree, fetch, force-with-lease).
- **Hook matchers must tolerate namespaced `agent_type`.** Plugin agents fire
  hooks as `harness-claude-code:engineer` (not bare `engineer`). Never gate on
  bare-string equality — use a regex matcher like `^(.+:)?(engineer|reviewer)$`.
  (Claude Code only treats a matcher as regex when it contains characters outside
  `[A-Za-z0-9_|]`.)

## Versioning & commits

- **SemVer**, recorded in `.claude-plugin/plugin.json#version` (the single source
  of truth). Bump it deliberately — group related work under one bump rather than
  incrementing per commit.
- **Commit messages** follow Conventional Commits with a trailing version stamp,
  e.g. `feat(bug-lifecycle): add the unified /ship command (v0.41.0)`.
- **Tag releases** as `vX.Y.Z`. `skills/operation-git/scripts/create-release.sh`
  is the release helper.
- Commit/push only when asked; if on `main`, branch first.

## Keep docs in lockstep

Three surfaces describe the same system and drift apart easily — when you change
behavior, update all that apply in the same change:

1. **`README.md`** — the authoritative per-surface catalogue (commands, agents,
   workflows, skills, hooks, discovery scripts).
2. **`docs/workflow.html`** — the visual walkthrough (hero, big-picture diagram,
   execution stages, label protocol).
3. The **frontmatter `description`** of the agent/skill/command you touched — it
   is what drives activation, so it must match what the body actually does.
