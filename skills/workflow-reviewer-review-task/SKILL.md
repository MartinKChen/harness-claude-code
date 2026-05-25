---
name: workflow-reviewer-review-task
description: "Review a single task issue end-to-end. Read the issue body, set up the slice worktree (read-only), scope to commits carrying `Refs #<task-#>`, run the loaded reviewer pattern set, compose one structured `# Review` comment, post it, flip `review:running` → `review:passed` or `review:need-fix`. On pass, also strip `status:in-progress` and close the issue. Activate when dispatched with `Review GitHub task issue #<n>` or '/workflow-reviewer-review-task'."
---

# workflow-reviewer-review-task

Review a single task issue dispatched by `workflow-orchestrator-review-task`. The orchestrator has already flipped `review:pending` → `review:running` as its lock. This skill is read-only on code, walks the reviewer's loaded pattern set, aggregates findings into one structured comment, and flips the gate to its terminal state. On pass, it also closes the task issue.

The reviewer agent loads its own pattern set at kickoff (code quality, security, language-specific, contract conformance, container, observability, etc.) — pattern *selection* is the agent's responsibility. This skill owns the workflow primitives only.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Review GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `status:in-progress` + `review:running`.
- The user types `/workflow-reviewer-review-task`, or phrases like "review task #<n>".

Do NOT activate when the unit of work is a slice (use `workflow-reviewer-review-slice`), or when the matching `review:running` lock is missing (refuse to invent a verdict).

## Workflow

### 1. Fetch the task issue

Fetch the task issue (number, title, body, labels, url) via `gh issue view`.

Verify the labels: `level:task` + `kind:feature` + exactly one `type:*` + `status:in-progress` + `review:running`. If `review:running` is missing, halt and surface `no running review lock on this task — refusing to invent a verdict`. If the issue is closed, halt and surface.

### 2. Set up a read-only worktree on the slice branch

Resolve the parent slice's attached branch, create-or-reuse the slice-scoped worktree on that branch (read-only — do NOT rebase onto main), then `cd` into the worktree path.

Every subsequent read happens inside the worktree — never the orchestrator's checkout.

### 3. Scope the review to commits that reference this task

- `scoped_commits = git log origin/main..HEAD --format='%H' --grep="Refs #<task-#>"`.
- If empty, fall back to the full diff: `scoped_commits = git log origin/main..HEAD --format='%H'` and note `No 'Refs #<task-#>' trailers found on the slice branch — review scoped to the full diff vs. main.` for inclusion in the verdict.
- `touched_paths = git show --name-only --format='' ${scoped_commits} | sort -u`.
- `scoped_diff = git diff origin/main..HEAD -- ${touched_paths}`.

### 4. Walk the loaded reviewer pattern set

The reviewer agent's loaded pattern set chooses which patterns apply based on the task's `type:*` label and the touched paths. Each pattern emits findings as `{title, severity, location, evidence, fix}` records. Collect all of them; do not post per-pattern.

### 5. Compose the verdict comment and compute APPROVE / BLOCK

Header: `# Review` (single literal header — downstream fix flows grep for it).

Compose: severity-count summary table → every finding → verdict. If a fall-back scope note was set in step 3, include it as a `**Note:**` line above the verdict.

Verdict:

- **APPROVE** — no CRITICAL or HIGH findings. Terminal label: `review:passed`.
- **BLOCK** — any CRITICAL or HIGH finding. Terminal label: `review:need-fix`.

Write the comment body to `/tmp/review-task-<task-#>.md`.

### 6. Post the verdict + flip the gate label

Atomically post the verdict comment on the task issue and flip the gate label — on APPROVE: remove `review:running`, add `review:passed`. On BLOCK: remove `review:running`, add `review:need-fix`.

### 7. Capture signal to the consuming project's memory store

Per `memory-convention`, if `$MAIN_ROOT/.claude/memory/` exists in the consuming project, append the review's signal rows. If it does not exist, skip silently (the project has not opted in). Never let this step block the terminal label flip or issue close — write failures are logged and swallowed.

Resolve the memory root:

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
[ -d "$MEMORY_ROOT" ] || exit 0   # opt-in by directory presence
```

Write one JSON Lines row per finding to `$MEMORY_ROOT/signals/reviews/<task#>.jsonl` (append mode, create parent dir if missing). Row shape per `memory-convention`:

```json
{"ts": "<iso8601>", "task": <n>, "slice": <parent#>, "finding_handle": "<F1|…>", "pattern_skill": "<pattern-skill-name>", "category": "<kebab-case>", "severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "location": "<file:line>", "title": "<one-line>"}
```

`pattern_skill` and `category` come from the pattern that emitted the finding — every pattern skill tags its findings with both. If a finding has no clear category, use the rule's short kebab-case slug.

On **APPROVE only**, also write `$MEMORY_ROOT/signals/cycles/<task#>.json` (overwrite). Compute `total_cycles` from `git log origin/<slice-branch> --grep="Refs #<task-#>" --oneline | wc -l`. Compute `by_pattern.<skill>.findings` and `cycles_to_resolve` by joining this review's findings with the per-cycle history in `$MEMORY_ROOT/signals/reviews/<task#>.jsonl` and `$MEMORY_ROOT/signals/fixes/<task#>.jsonl`.

### 8. On APPROVE, strip `status:in-progress` and close the issue

On APPROVE only: remove the `status:in-progress` label from the task, then close the issue.

Terminal action. Exit.

### Blocked-run branch

If something prevents the review from being completed (worktree fetch failed, diff unreadable, slice branch missing, a pattern errors, scope too large for one pass), post a single diagnostic comment on the task issue **without** flipping any label. Leave `review:running` in place for human triage. Do NOT fabricate a verdict from incomplete evidence.

## Iron rules

- **Read-only on code.** Never edit, never push, never `git reset --hard` outside the worktree setup. Only writes are: one verdict comment, one terminal label flip, on pass only `status:in-progress` removal + issue close.
- **One review, one comment, one terminal label.** Single-shot. Don't loop. Don't re-validate after fixes — that's a fresh dispatch.
- **APPROVE / BLOCK is computed here from aggregated findings.** The agent's patterns emit findings only; the verdict line is this skill's.
- **The reviewer pattern set is owned by the agent, not this skill.** Pattern selection follows the task's `(type:*, paths-touched)` combination.
- **GitHub is the single source of truth.** The verdict comment + the terminal label + (on pass) the issue closure are the only outputs.
- **Refuse what the labels forbid.** Missing `review:running` → halt and surface. Closed issue → halt and surface.
- **On a blocked run, do NOT flip the label.** Leave `review:running` in place for human triage.
- **Signal capture is fire-and-forget.** If `$MAIN_ROOT/.claude/memory/` is missing or any write fails, swallow the error and continue. Memory is per-consuming-project opt-in (see `memory-convention`); a review must never be blocked by it.
