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

## Pattern

### Branch naming

Use a prefix that signals intent, then a short kebab-case description.

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New feature | `feature/payment-integration` |
| `bugfix/` | Non-urgent bug fix | `bugfix/login-error` |
| `hotfix/` | Urgent production fix | `hotfix/memory-leak` |
| `release/` | Release prep | `release/v1.2.0` |
| `docs/` | Documentation | `docs/update-readme` |
| `refactor/` | Code restructuring | `refactor/db-layer` |
| `test/` | Test additions/improvements | `test/api-endpoints` |
| `chore/` | Maintenance | `chore/dependency-bump` |

Branches stay short-lived (days, not weeks). Rebase on `main` frequently.

### Commit messages — Conventional Commits

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

| Type | Use for | Example |
|------|---------|---------|
| `feat` | New feature | `feat(auth): add OAuth2 login` |
| `fix` | Bug fix | `fix(api): handle null response in user endpoint` |
| `docs` | Documentation | `docs(readme): update installation instructions` |
| `style` | Formatting only | `style: fix indentation in login component` |
| `refactor` | Refactor, no behavior change | `refactor(db): extract connection pool to module` |
| `test` | Tests | `test(auth): add unit tests for token validation` |
| `chore` | Maintenance | `chore(deps): update dependencies` |
| `perf` | Performance | `perf(query): add index to users table` |
| `ci` | CI/CD | `ci: add PostgreSQL service to test workflow` |
| `revert` | Revert a prior commit | `revert: revert "feat(auth): add OAuth2 login"` |

**Bad**

```
git commit -m "fixed stuff"
git commit -m "updates"
git commit -m "WIP"
```

**Good**

```
git commit -m "fix(api): retry requests on 503 Service Unavailable

The external API occasionally returns 503 errors during peak hours.
Added exponential backoff retry logic with max 3 attempts.

Closes #123"
```

### PR titles

Same format as commits: `<type>(<scope>): <description>`.

```
feat(auth): add SSO support for enterprise users
fix(api): resolve race condition in order processing
docs(api): add OpenAPI specification for v2 endpoints
```

### Semantic versioning

```
MAJOR.MINOR.PATCH

MAJOR: Breaking changes
MINOR: New features, backward compatible
PATCH: Bug fixes, backward compatible

1.0.0 → 1.0.1   patch: bug fix
1.0.1 → 1.1.0   minor: new feature
1.1.0 → 2.0.0   major: breaking change
```

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

## Template

### PR description

Populate this template for every PR. Drop sections that genuinely don't apply (e.g. Screenshots for a backend-only change).

```markdown
## What

Brief description of what this PR does.

## Why

Explain the motivation and context.

## How

Key implementation details worth highlighting.

## Testing

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Screenshots (if applicable)

Before/after screenshots for UI changes.

## Checklist

- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings introduced
- [ ] Tests pass locally
- [ ] Related issues linked

Closes #<issue-number>
```

## Workflow

### Start a new feature or doc update (with worktree)

Use a worktree so the new branch lives in its own directory and `main` stays untouched.

1. Sync `main`: `git fetch origin && git switch main && git pull --ff-only`.
2. Pick a branch name with the right prefix (see Pattern → Branch naming).
3. Create the worktree off `main`:
   ```
   git worktree add ../<repo>-<branch-suffix> -b feature/<short-description> origin/main
   ```
4. `cd` into the new worktree directory and start working.
5. Commit using Conventional Commits. Keep commits small and topical.
6. When done, push: `git push -u origin feature/<short-description>`.
7. After the PR merges, remove the worktree: `git worktree remove ../<repo>-<branch-suffix>` and delete the local branch.

### Create a PR

1. Confirm the branch is rebased on latest `main`: `git fetch origin && git rebase origin/main`.
2. Push the branch if not already pushed: `git push -u origin <branch>`.
3. Open the PR with the standard title format and the PR description template:
   ```
   gh pr create \
     --base main \
     --title "feat(auth): add SSO support for enterprise users" \
     --body-file .github/pr-body.md
   ```
   Or pass the body inline via `--body "$(cat <<'EOF' … EOF)"`.
4. Link the issue it closes in the body (`Closes #123`) so GitHub auto-closes it on merge.
5. Add reviewers and labels: `gh pr edit <num> --add-reviewer <user> --add-label <label>`.
6. If it's still in progress, mark draft: `gh pr ready <num> --undo` (or open with `--draft`).

### Create an issue and link blockers / parent

1. Create the issue:
   ```
   gh issue create \
     --title "fix(api): 503 retries missing on user endpoint" \
     --body-file <path-or-heredoc> \
     --label bug \
     --assignee @me
   ```
2. Capture the new issue number from the URL `gh` prints (e.g. `#456`).
3. Link relationships by editing the parent or blocker issue's body. GitHub renders these markers as cross-references:
   - **Blocked by:** add `Blocked by #456` to the parent issue body.
   - **Parent / tracking:** add `- [ ] #456` to the parent's task list.
   - **Closes on merge:** in a PR body, `Closes #456`.
4. Update the parent:
   ```
   gh issue edit <parent-number> --body-file <updated-body>
   ```
   Or use `gh issue comment <parent-number> --body "Tracking blocker: #456"` if you'd rather leave the body alone.

### Update an existing PR with new changes

1. From the PR's branch, pull any remote updates: `git pull --rebase origin <branch>`.
2. Make and commit changes using Conventional Commits — one logical change per commit.
3. Rebase on latest `main` to keep history linear: `git fetch origin && git rebase origin/main`. Resolve conflicts file-by-file; never `git checkout --theirs/--ours` blindly.
4. Push:
   - Normal push if no rebase: `git push`.
   - After rebase: `git push --force-with-lease` (never `--force` — `--force-with-lease` refuses to overwrite work you haven't seen).
5. If the scope changed materially, update the PR title/body: `gh pr edit <num> --title "…" --body-file <path>`.
6. Re-request review if needed: `gh pr edit <num> --add-reviewer <user>`.

### Create a release

1. Decide the version bump per SemVer (breaking → major, feature → minor, fix → patch).
2. From an up-to-date `main`, create a release branch if you need a stabilization window: `git switch -c release/vX.Y.Z origin/main`. For straightforward releases, you can tag `main` directly.
3. Update version files (e.g. `package.json`, `pyproject.toml`, `Cargo.toml`) and `CHANGELOG.md`. Commit:
   ```
   chore(release): vX.Y.Z
   ```
4. Open a PR for the release branch (if used), get it reviewed, merge to `main`.
5. Tag and publish the release:
   ```
   gh release create vX.Y.Z \
     --target main \
     --title "vX.Y.Z" \
     --generate-notes
   ```
   Use `--notes-file CHANGELOG-vX.Y.Z.md` instead of `--generate-notes` when you've written curated notes.
6. For pre-releases, add `--prerelease`. For drafts, add `--draft` and publish later via `gh release edit vX.Y.Z --draft=false`.

## Command

### `gh` reference

| Command | What it does | Common flags / notes |
|---------|--------------|----------------------|
| `gh auth status` | Verify you're authenticated and on the right account. | Run once per session in unfamiliar environments. |
| `gh auth login` | Authenticate the CLI; grant scopes when prompted. | Re-run when you see `Resource not accessible by integration`. |
| `gh repo view --web` | Open the current repo in the browser. | Handy for branch protection / settings checks. |
| `gh pr create` | Open a PR from the current branch. | `--base main --title "<conventional>" --body-file <path>`; also `--draft`, `--reviewer`, `--label`, `--assignee @me`, `--web`. |
| `gh pr list` | List open PRs in the repo. | `--author @me`, `--state all`, `--label <label>`. |
| `gh pr view <num>` | Show a PR's details in the terminal. | `--web` to open in browser; `--comments` to include discussion. |
| `gh pr checks <num>` | Show CI status for a PR. | Run before asking a reviewer to look. |
| `gh pr edit <num>` | Edit title, body, reviewers, labels, base branch. | Pair with `--body-file` to avoid quoting issues. |
| `gh pr ready <num>` | Mark a draft PR ready for review. | `--undo` to flip back to draft. |
| `gh pr merge <num>` | Merge after approval and green checks. | Default `--squash --delete-branch`; use `--merge` only when preserving branch history matters. |
| `gh issue create` | Create an issue. | `--title --body-file --label --assignee @me`. |
| `gh issue edit <num>` | Update an existing issue. | Use `--body-file` to add `Blocked by #X` / parent task-list links. |
| `gh issue comment <num>` | Comment on an issue. | Useful for linking a blocker without editing the body. |
| `gh release create vX.Y.Z` | Cut a release tag and publish notes. | `--target main --title "vX.Y.Z" --generate-notes`; `--notes-file`, `--prerelease`, `--draft`. |
| `gh release edit vX.Y.Z` | Edit a published or draft release. | `--draft=false` to publish a previously drafted release. |
| `gh run list` | List recent GitHub Actions runs. | `--workflow <name>`, `--branch <name>`. |
| `gh run view <id> --log` | Inspect a failed CI run from the CLI. | Faster than clicking through the web UI. |

### Common failure modes

| Error | Cause | Fix |
|-------|-------|-----|
| `gh: command not found` | CLI not installed. | `brew install gh` (macOS), then `gh auth login`. |
| `could not resolve to a Repository` | Not in a git repo, or remote isn't GitHub. | Check `git remote -v`; add a GitHub remote. |
| `Resource not accessible by integration` | Token lacks required scopes. | Re-run `gh auth login` and grant the requested scopes. |
| `fatal: refusing to merge unrelated histories` (on rebase) | Branched from the wrong base. | Re-create the branch off `origin/main`. |
| `! [rejected] ... (non-fast-forward)` after rebase | Local history rewritten; remote is ahead. | `git push --force-with-lease` (never `--force`). |
