---
name: git-workflow
description: "Standardize GitHub integration using GitHub Flow. Activate whenever the user works with git or GitHub: making a commit, naming a branch, opening or updating a pull request, creating an issue, cutting a release, tagging a version, writing a .gitignore, or running `gh` commands. Triggers on verbs like commit, branch, push, merge, rebase, tag, release, open/create PR, open/create issue, draft, link, close, and on phrases like 'commit message for…', 'name this branch', 'open a PR', 'create a release', 'bump the version', 'add a worktree', 'link this issue as a blocker'. Also activates on .gitignore files, CHANGELOG edits, and when the user asks how to structure git work or interact with GitHub from the CLI."
---

# git-workflow

Standardize how we work with git and GitHub. We follow **GitHub Flow**: `main` is protected and always deployable, and all work happens on short-lived branches that merge back via pull request. This skill encodes the conventions for commits, branches, PRs, issues, releases, and `.gitignore`, plus the canonical `gh`-based workflows for everyday tasks.

## When to activate

Activate this skill whenever the user:

- Asks for help writing a commit message, PR title, PR body, or issue.
- Is about to create, name, or push a branch — including worktrees.
- Wants to open, update, review, or merge a pull request.
- Wants to create an issue, link it to a parent, or mark it as a blocker.
- Is preparing a release, bumping a version, or tagging.
- Edits or creates a `.gitignore`.
- Asks "how do I do X with `gh`" or wants the standard GitHub CLI invocation for a task.

Do NOT activate when the user is asking about git internals unrelated to our workflow (e.g. "explain how rebase works"), or when they are working in a non-GitHub host (GitLab, Bitbucket) — the conventions here assume GitHub Flow + `gh`.

## References and scripts

When this skill is active, route to the asset that matches the task. Read references on demand; invoke scripts via `bash` (or directly — they are executable). The PR-body template ships with the `create-draft-pr` skill (at `create-draft-pr/templates/pr-body.md`), not here.

| Asset | Type | When to use |
|-------|------|-------------|
| `references/branch-naming.md` | reference | Naming a new branch — picking a prefix and a short kebab-case description. |
| `references/commit-messages.md` | reference | Writing a commit message or PR title — Conventional Commits format, type table, and examples. |
| `references/versioning.md` | reference | Choosing a version bump for a release (major / minor / patch) and tag formatting. |
| `references/gh-commands.md` | reference | Looking up the canonical `gh` invocation for a task, or diagnosing a common `gh` / push error. |
| `scripts/create-release.sh` | script | Tagging `main` and publishing a GitHub release (after the `chore(release): vX.Y.Z` commit is in). |
| `scripts/init-flow-labels.sh` | script | One-time repo setup for the Automated Engineer Flow — creates the status / level / kind / type / review-gate / PR-marker labels (idempotent). |

## Pattern

### `.gitignore` baseline

Start every repo with at least these entries; add language/framework-specific entries on top.

```gitignore
# Dependencies
node_modules/
vendor/

# Build outputs
dist/
build/
*.o
*.exe

# Environment files
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS files
.DS_Store
Thumbs.db

# Logs
*.log
logs/

# Test coverage
coverage/

# Cache
.cache/
*.tsbuildinfo
```

### Anti-patterns

- **Committing directly to `main`** → always branch + PR.
- **Committing secrets** (`.env`, keys) → add to `.gitignore`, use env vars / secret managers.
- **Giant PRs (1000+ lines)** → split into smaller, focused PRs.
- **"update" / "fix" / "WIP" commit messages** → use Conventional Commits with context.
- **Force-pushing to `main` or shared branches** → use `git revert` to undo public history.
- **Long-lived feature branches** (weeks/months) → keep branches short, rebase on `main` often.
- **Committing generated files** (`dist/`, `node_modules/`) → add to `.gitignore`.
