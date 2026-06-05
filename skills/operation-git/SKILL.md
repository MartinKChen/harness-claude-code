---
name: operation-git
description: "Single source of truth for every git / GitHub operation the workflow-* skills and the implement-slice Workflow perform. Owns the shared `gh` + `git` scripts (setup-worktree, resolve-slice-branch, list-issues, the four task-finder stage scripts, flip-label, post-comment, post-and-flip, blocker-count, draft-PR creation, PR-status check), the shared templates (commit-messages, dispatch-prompt, pr-body), the gh-command and versioning references, and the release/label-init scripts. Activate whenever the user works with git or GitHub directly (commits, branches, PRs, issues, releases, `.gitignore`), and load this skill from inside any workflow that needs to mutate GitHub state or move work to a worktree."
---

# operation-git

Centralized git + GitHub operations. We follow **GitHub Flow**: `main` is protected and always deployable, and all feature work happens on short-lived branches that merge back via pull request. Workflow skills (`workflow-e2e-*`, `workflow-engineer-*`, `workflow-reviewer-*`), the `implement-slice` Workflow script, and the `/implement-feature` command never duplicate `gh` / `git` plumbing — they call the scripts under this skill's `scripts/` directory. (Outer-loop candidate discovery for `/implement-feature` lives entirely as scripts here too — `task-finder.sh` + the four stage scripts: reconcile (0), kickoff-slice (1), fix-pr (8), close-pr (9) — with no agent or skill layer in between. The inner slice cycle runs inside the per-slice `implement-slice` Workflow, not here.)

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

The Automated Engineer Flow drives off a deliberately small label set — the inner slice cycle runs inside one `implement-slice` Workflow per slice, so everything that used to round-trip through labels (per-task typing, the review gate family, the e2e markers, the level split) is now in-memory workflow state or lives in the slice body's task checklist. The `init-flow-labels.sh` script creates the survivors and DELETES the retired labels, idempotently.

| Family | Labels | Owner of transitions |
|--------|--------|---------------------|
| `status:*` | `ready-to-review`, `ready-to-implement`, `in-progress`, `fix-in-progress`, `need-attention` | `status:ready-to-review` is the human-approval gate (set by `create-feature-issues` on freshly-created slices; human flips to `status:ready-to-implement` to release). `status:ready-to-implement` → `status:in-progress` is the kickoff lock = "an `implement-slice` Workflow is running on this slice"; the workflow releases it when it opens the draft PR, or flips it to `status:need-attention` on halt. `status:fix-in-progress` is the PR-level lock for the outer-loop fix-pr stage. `status:need-attention` is the durable, user-owned halt. |
| `kind:*` | `feature`, `bug`, `enhancement` | issue creation only |
| `merge:*` | `auto`, `manual` | `implement-slice`'s PR phase sets `manual` on draft PR creation; user opts into `auto` |
| PR markers | `feature-lockin` | architect during deep-dive |

There are no `level:*`, `type:*`, `review:*`, or `e2e:*` labels — those were retired by the per-slice-Workflow redesign. Task typing and per-task done-state live in the slice body's `## Tasks` static-ID checklist; review/coverage gating is an in-memory phase of the `implement-slice` Workflow.

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
| `scripts/setup-worktree.sh <slice-branch> [--merge-main]` | Create-or-reuse the worktree at `/tmp/harness-claude-code/<repo>/worktrees/<slice-branch>`, fetch + hard-reset to `origin/<slice-branch>` (always — agents always enter on the latest remote tip), then optionally integrate `origin/main`. `--merge-main` merges `origin/main` INTO the slice branch with an explicit merge commit (push-safe — no history rewrite, no force-push; on conflict it leaves the conflicted worktree for the caller to resolve+commit+push and exits 3). With no flag the slice branch is left untouched (push-safe). There is deliberately no rebase-onto-main mode — rewriting slice history would require a force-push, violating the never-force-push iron rule. Prints the worktree path on stdout (even on a merge conflict, so the caller can `cd` in to resolve). |
| `scripts/issue-body.sh <issue-#> [fields-csv]` | Wrap `gh issue view --json` to fetch the slice spec (default: `number,title,body,labels,milestone,url,state`) WITHOUT the auto-rendered comments / reactions / cross-references chrome that bare `gh issue view` injects (3–8K of noise on any issue with discussion). Use this for first-fetch in `workflow-engineer-implement-task`, `-e2e`, `workflow-e2e-author`, `workflow-reviewer-review-slice`, and the `implement-slice` workflow's Prep + `runReviewSlice()` phases. Do NOT use in `-fix-slice` / `-fix-pr` / `-e2e-fix` workflows where the reviewer comments ARE the spec — those still call `gh issue view <n> --comments` directly. |

### Candidate listing (workflow orchestrators)

Each script lists open issues / PRs matching a specific workflow stage. All return JSON; the caller iterates.

| Script | Purpose |
|--------|---------|
| `scripts/list-issues.sh [--kind <k>]... [--label <l>]... [--milestone <name>] [--missing-label <l>]...` | Generic candidate listing for any orchestrator. Returns open issues of the requested `kind:*` (OR semantics across kinds; default `kind:feature` for backward compatibility) carrying the requested labels (and confirmed absent labels), sorted by issue number. The kind filter is applied in jq because `gh --label` ANDs. |
| `scripts/list-draft-prs.sh [--label <l>]... [--missing-label <l>]... [--status <green\|broken>] [--milestone <name>]` | List open draft PRs filtered by labels, milestone, and check/conflict status. Output includes the PR body so close-pr can parse `Closes #<slice-#>`. |
| `scripts/blocker-count.sh <issue-#>` | Print the count of OPEN `Blocked by` dependencies (GraphQL `issueDependenciesSummary.blockedBy`). |

### Lifecycle discovery (driven by `/implement-feature`)

Pure shell — no LLM, no agent, no skill layer. The umbrella driver runs the four stage scripts against ONE GitHub-state snapshot and emits the canonical markdown report `/implement-feature` parses positionally. Each stage script's header comment documents its line format and gate set. (Stages 2–7 were retired — the inner slice cycle they covered now runs inside the per-slice `implement-slice` Workflow.)

| Script | Stage | Purpose |
|--------|-------|---------|
| `scripts/task-finder.sh <feature-name>` | — | Umbrella driver. Prechecks repo + milestone, runs the four stages (0, 1, 8, 9) in order, emits the canonical `# task-finder report` markdown + a summary line. Exits non-zero with a diagnostic on stderr on precheck failure or any per-stage failure. |
| `scripts/task-finder-stage-0-reconcile.sh` | 0 | Orphaned locks — a slice `status:in-progress` whose `implement-slice` Workflow died mid-run, or a draft-PR `status:fix-in-progress` whose fix-pr engineer died. Death gate (priority order): (1) the runtime-telemetry liveness heartbeat — a signal meta with `ended_at==null` whose `last_seen` is stale ≥ `RECONCILE_HEARTBEAT_STALE_MINUTES` (default = `RECONCILE_STALE_MINUTES`); a fresh `last_seen` (any of the workflow's child engineer/reviewer agents) VETOES the reap; (2) GitHub-activity staleness ≥ `RECONCILE_STALE_MINUTES` (default 30; activity = `updatedAt` + slice-branch last commit) as the fallback. Emits `release:<action>` directives the orchestrator flips to release the lock. |
| `scripts/task-finder-stage-1-kickoff-slice.sh` | 1 | `kind:feature`+`status:ready-to-implement` slices with zero open blockers and NOT already `status:in-progress` (the orchestrator flips the lock and launches the `implement-slice` Workflow). |
| `scripts/task-finder-stage-8-fix-pr.sh` | 8 | Draft PRs with a merge-blocking signal (CI failure or merge conflict), no `status:fix-in-progress` / `status:need-attention`, slice resolved from `Closes #<n>`. |
| `scripts/task-finder-stage-9-close-pr.sh` | 9 | Draft PRs MERGEABLE with every check rollup SUCCESS / NEUTRAL / SKIPPED, tagged `merge:<auto\|manual>`, slice resolved from `Closes #<n>`. |

### Lifecycle discovery (driven by `/ship` — all three kinds)

Pure shell, same shape as the `task-finder` family but covering **feature + enhancement + bug** with an **optional** milestone (omit it for the repo-wide maintenance lane). `ship-finder.sh` runs five named stages against ONE snapshot and emits a `# ship-finder report` the `/ship` command parses by stage name. The `/implement-feature` `task-finder` family above is left intact as a feature-only fallback.

| Script | Stage | Purpose |
|--------|-------|---------|
| `scripts/ship-finder.sh [milestone]` | — | Umbrella. Prechecks repo (+ milestone only when named), runs the five stages in order, emits the report + summary. Milestone optional → repo-wide when omitted. |
| `scripts/ship-stage-reconcile.sh [milestone]` | reconcile | Orphaned locks across all kinds: a `status:in-progress` slice/bug whose workflow died, or a draft-PR `status:fix-in-progress` whose fix-pr engineer died. Bug `status:in-progress` is disambiguated by the `# Bug Analysis` comment — present → dead fix (`release:ready-to-implement`); absent → dead analyze (`release:clear-analyze`). Same telemetry-heartbeat + GitHub-staleness death gate as stage 0. Parses the linked issue from `feature/<n>-` or `fix/<n>-` branches. |
| `scripts/ship-stage-analyze-bug.sh [milestone]` | analyze-bug | `kind:bug` with NO `status:*` label (freshly filed) — the orchestrator locks (`+status:in-progress`) and dispatches the read-only analyze engineer. |
| `scripts/ship-stage-kickoff.sh [milestone]` | kickoff | `kind:feature\|enhancement\|bug` at `status:ready-to-implement`, 0 open blockers, not `status:in-progress`. Emits `kind:` so the command routes feature/enhancement → `implement-slice.mjs`, bug → `fix-bug.mjs`. |
| `scripts/ship-stage-fix-pr.sh [milestone]` | fix-pr | Draft PRs blocked on CI / conflict, no `status:fix-in-progress` / `status:need-attention`; linked issue from `Closes #<n>`. Works for slice and bug-fix PRs. |
| `scripts/ship-stage-close-pr.sh [milestone]` | close-pr | Mergeable draft PRs (every rollup SUCCESS / NEUTRAL / SKIPPED), tagged `merge:<auto\|manual>`; linked issue from `Closes #<n>`. |

### Label flipping (atomic)

| Script | Purpose |
|--------|---------|
| `scripts/flip-label.sh <issue-or-pr-#> [--remove <l>]... [--add <l>]...` | One atomic `gh issue edit` / `gh pr edit` call. Touches only the labels named — every other label is preserved. Used by every lock/unlock helper. |
| `scripts/close-issue.sh <issue-#> [--reason completed\|not_planned]` | Close an issue (after stripping `status:in-progress`). |
| `scripts/create-enhancement.sh --title <t> --body-file <p> --intent <kebab> [--milestone <m>]` | Create one `kind:enhancement` issue (+ `status:ready-to-review`) from a feature-shaped body and link an `enhancement/<n>-<intent>` branch via `gh issue develop` — the single-issue analog of a create-feature-issues slice. Prints `issue:<n>` + `branch:<…>`. Called by the `create-enhancement-issue` skill. |
| `scripts/create-bug.sh --title <t> --body-file <p> [--milestone <m>]` | Create one `kind:bug` issue from a Zone-A symptom body — NO `status:*` label, NO branch (the analyze-eligible state the `/ship` analyze stage keys off; the fix branch is cut later by `fix-bug.mjs`). Prints `issue:<n>`. Called by the `create-bug-issue` skill. |

### Reviewer outputs

| Script | Purpose |
|--------|---------|
| `scripts/post-comment.sh <issue-or-pr-#> <body-file>` | Post a single comment from a file (avoids quoting issues). The reviewer / `runReviewSlice()` terminal write (it posts the verdict comment and returns the verdict — no label flip). |
| `scripts/post-and-flip.sh <issue-#> <body-file> [--remove <l>]... [--add <l>]...` | Atomic-ish: post the comment, then flip the labels. A general comment-plus-flip helper (the reviewer no longer flips labels, but this stays available for any post+label operation). |
| `scripts/create-draft-pr.sh <slice-branch> <title> <body-file> [--label <l>]... [--milestone <m>]` | Create a draft PR from the slice branch against `main`. Prints the PR number. `--milestone` attaches a milestone (name or number) at creation. Called by `implement-slice`'s terminal PR phase. |
| `scripts/check-pr.sh <pr-#>` | Print a JSON object: `{mergeable, checksStatus, isDraft, labels, headRefName, lastCommitSha, lastCommitDate}`. |

### Release / repo setup

| Script | Purpose |
|--------|---------|
| `scripts/create-release.sh <version> [--prerelease] [--notes-file <path>]` | Tag `main` and publish a GitHub release (after the `chore(release): vX.Y.Z` commit is in). |
| `scripts/init-flow-labels.sh [--repo <owner>/<name>]` | One-time repo setup. Creates the surviving `status:` / `kind:` / `merge:` / PR-marker labels and DELETES the retired `level:` / `type:` / `review:` / `e2e:` labels. Idempotent. |

### Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format. Subject line + body + trailer rules. Every commit produced by a slice-phase workflow skill carries a `Task: <static-id>` trailer + `Refs #<slice-#>` (fix-pr drops `Task:` and uses `Refs #<pr-#>` + `Refs #<slice-#>`). |
| `templates/dispatch-prompt.md` | Skeleton the `implement-slice` Workflow (and the outer loop, for fix-pr) fills before passing to `Agent`'s `prompt`. One line: dispatch verb + slice # + task IDs. Everything else the agent discovers from the slice body's checklist. |
| `templates/pr-body.md` | Draft-PR body skeleton (`Closes #<slice-#>`) — the shape `implement-slice`'s terminal PR phase builds. |
| `templates/bug-issue.md` | Body of a `kind:bug` issue — Zone A (the reporter's symptom) only. The diagnosis is posted as a comment by the analyze step, not written into the body. The fix-bug workflow reads the approved analysis comment as its spec. |
| `templates/bug-analysis-comment.md` | The `# Bug Analysis` comment the analyze step posts (Zone B — the diagnosis): Reproduction, Root cause, Proposed fix, Regression-test plan, Blast radius + Contract impact. After a human approves it, `fix-bug.mjs` reads it as the fix spec. |
| `templates/enhancement-issue.md` | Body of a `kind:enhancement` issue — the slice-body shape (Context / Scope / Acceptance criteria / Tasks) plus `## Modifies` + `## Don't break`, minus any contract-change section (an enhancement never changes a contract). The `## Tasks` checklist matches the slice format so `implement-slice.mjs` parses it. Authored by `/create-enhancement-issue`. |

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
