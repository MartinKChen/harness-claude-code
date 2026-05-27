---
name: operation-git
description: "Single source of truth for every git / GitHub operation the workflow-* skills perform. Owns the shared `gh` + `git` scripts (setup-worktree, resolve-slice-branch, list-candidates-by-label, lock/unlock helpers, post-and-flip, blocker-count, slice-in-flight, draft-PR creation, PR-status check), the shared templates (commit-messages, dispatch-prompt, pr-body), the gh-command and versioning references, and the release/label-init scripts. Activate whenever the user works with git or GitHub directly (commits, branches, PRs, issues, releases, `.gitignore`), and load this skill from inside any workflow-* skill that needs to mutate GitHub state or move work to a worktree."
---

# operation-git

Centralized git + GitHub operations. We follow **GitHub Flow**: `main` is protected and always deployable, and all feature work happens on short-lived branches that merge back via pull request. Workflow skills (`workflow-task-finder-*`, `workflow-e2e-*`, `workflow-engineer-*`, `workflow-reviewer-*`) and the `/implement-feature` command never duplicate `gh` / `git` plumbing — they call the scripts under this skill's `scripts/` directory.

## When to activate

Activate this skill whenever the user:

- Asks for help writing a commit message, branch name, PR title/body, or issue.
- Is about to create, name, or push a branch — including worktrees.
- Wants to open, update, or merge a pull request.
- Wants to create or label an issue, link a blocker, or close one.
- Is preparing a release, bumping a version, or tagging.
- Edits or creates a `.gitignore`.
- Asks "how do I do X with `gh`" or wants the standard GitHub CLI invocation for a task.

Also load this skill implicitly from inside any `workflow-*` skill that needs to mutate GitHub state — the `workflow-*` skill drives the workflow, this skill owns the primitives.

Do NOT activate when the user is asking about git internals unrelated to our workflow (e.g. "explain how rebase works"), or when they are working in a non-GitHub host (GitLab, Bitbucket) — the conventions here assume GitHub Flow + `gh`.

## Label scheme

The Automated Engineer Flow drives off labels. Workflow skills key into the families below; the `init-flow-labels.sh` script creates them all idempotently.

| Family | Labels | Owner of transitions |
|--------|--------|---------------------|
| `status:*` | `ready-to-review`, `ready-to-implement`, `in-progress`, `fix-in-progress`, `need-attention` | `status:ready-to-review` is the human-approval gate (set by `create-issues` on freshly-created slices; human flips to `status:ready-to-implement` to release). `status:ready-to-implement` → `status:in-progress` is the orchestrator's lock on issues. `status:fix-in-progress` is the PR-level lock for fix-pr. `status:need-attention` is set when an agent bails. |
| `level:*` | `slice`, `task` | issue creation only |
| `kind:*` | `feature`, `bug`, `enhancement` | issue creation only |
| `type:*` | `e2e`, `backend`, `frontend` (tasks only) | issue creation only |
| `review:*` | `pending`, `running`, `passed`, `need-fix` | reviewer-review-* flips `pending`→`running`→`passed`/`need-fix`; engineer/e2e fix flips back to `pending` |
| `e2e:*` | `running` | prepare-slice adds `e2e:running` when the slice is ready for end-to-end validation; engineer-e2e removes it and adds `review:pending` on pass, or flips to `status:need-attention` on test-case constraints |
| `merge:*` | `auto`, `manual` | reviewer-review-slice sets `manual` on draft PR creation; user opts into `auto` |
| PR markers | `feature-lockin` | architect during deep-dive |

The `review:*` family is the **only** signal a reviewer is in flight on an issue. There is one gate per issue (no separate code/security gates). Slice issues and task issues use the same `review:*` family.

## References and scripts

When this skill is active, route to the asset that matches the task. Read references on demand; invoke scripts via `bash skills/operation-git/scripts/<name>.sh ...` (or directly — they are executable).

### References

| Asset | When to use |
|-------|-------------|
| `references/gh-commands.md` | Looking up the canonical `gh` invocation for a task, or diagnosing a common `gh` / push error. |
| `references/versioning.md` | Choosing a version bump for a release (major / minor / patch) and tag formatting. |

### Worktree + slice resolution

| Script | Purpose |
|--------|---------|
| `scripts/resolve-slice-branch.sh <issue-#>` | Given a task issue, resolve the parent slice issue and print the slice branch attached to that parent. Given a slice issue directly, print its own attached branch. Non-zero on missing parent or missing branch. |
| `scripts/setup-worktree.sh <slice-branch> [--rebase-onto-main]` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>`, fetch+hard-reset to `origin/<slice-branch>`, optionally rebase onto `origin/main`. Prints the worktree path. |

### Candidate listing (workflow orchestrators)

Each script lists open issues / PRs matching a specific workflow stage. All return JSON; the caller iterates.

| Script | Purpose |
|--------|---------|
| `scripts/list-issues.sh --level <slice\|task> [--label <l>]... [--milestone <name>] [--missing-label <l>]...` | Generic candidate listing for any orchestrator. Returns open `kind:feature` issues at the requested level with the requested labels (and confirmed absent labels). |
| `scripts/list-slices-all-subs-closed.sh [--milestone <name>]` | List open `level:slice`+`kind:feature`+`status:in-progress` slices whose sub-issues are ALL closed (used by prepare-slice). |
| `scripts/list-draft-prs.sh [--label <l>]... [--missing-label <l>]... [--status <green\|broken>] [--milestone <name>]` | List open draft PRs filtered by labels, milestone, and check/conflict status. Output includes the PR body so close-pr can parse `Closes #<slice-#>`. |
| `scripts/blocker-count.sh <issue-#>` | Print the count of OPEN `Blocked by` dependencies (GraphQL `issueDependenciesSummary.blockedBy`). |
| `scripts/slice-in-flight.sh <task-#>` | Print the count of sibling tasks on the parent slice currently being EDITED (predicate: `status:in-progress` AND no `review:*`). |

### Label flipping (atomic)

| Script | Purpose |
|--------|---------|
| `scripts/flip-label.sh <issue-or-pr-#> [--remove <l>]... [--add <l>]...` | One atomic `gh issue edit` / `gh pr edit` call. Touches only the labels named — every other label is preserved. Used by every lock/unlock helper. |
| `scripts/close-issue.sh <issue-#> [--reason completed\|not_planned]` | Close an issue (after stripping `status:in-progress`). |

### Reviewer outputs

| Script | Purpose |
|--------|---------|
| `scripts/post-comment.sh <issue-or-pr-#> <body-file>` | Post a single comment from a file (avoids quoting issues). |
| `scripts/post-and-flip.sh <issue-#> <body-file> [--remove <l>]... [--add <l>]...` | Atomic-ish: post the comment, then flip the labels. Terminal action for reviewer-review-task / reviewer-review-slice. |
| `scripts/create-draft-pr.sh <slice-branch> <title> <body-file> [--label <l>]... [--milestone <m>]` | Create a draft PR from the slice branch against `main`. Prints the PR number. `--milestone` attaches a milestone (name or number) at creation. |
| `scripts/check-pr.sh <pr-#>` | Print a JSON object: `{mergeable, checksStatus, isDraft, labels, headRefName, lastCommitSha, lastCommitDate}`. |

### Release / repo setup

| Script | Purpose |
|--------|---------|
| `scripts/create-release.sh <version> [--prerelease] [--notes-file <path>]` | Tag `main` and publish a GitHub release (after the `chore(release): vX.Y.Z` commit is in). |
| `scripts/init-flow-labels.sh [--repo <owner>/<name>]` | One-time repo setup. Creates every `status:` / `level:` / `kind:` / `type:` / `review:` / `merge:` / PR-marker label. Idempotent. |

### Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format. Subject line + body + trailer rules. Every commit produced by a workflow skill MUST include `Refs #<task-#>` AND `Refs #<slice-#>` trailers so each commit is traceable to both its task and its slice. |
| `templates/dispatch-prompt.md` | Skeleton an orchestrator skill fills before passing to `Agent`'s `prompt`. One line: dispatch verb + issue ID. Everything else the agent discovers from the issue. |
| `templates/pr-body.md` | Draft-PR body skeleton for reviewer-review-slice. First line: `Closes #<slice-#>`. |

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
- **Bypassing the workflow scripts** to call `gh` directly from a workflow-* skill → call `scripts/<name>.sh` instead so behavior stays consistent across skills.
