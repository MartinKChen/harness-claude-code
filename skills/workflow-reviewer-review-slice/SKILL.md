---
name: workflow-reviewer-review-slice
description: "Review a single slice issue end-to-end. Read the slice body and every closed task sub-issue, set up the slice worktree (read-only), run the loaded slice-level reviewer pattern set (cross-task integration, contract coverage, slice-level seams), compose one `# Slice Review` comment, post it, flip `review:running` → `review:passed` or `review:need-fix`. On pass, also create the draft PR labeled `merge:manual` with `Closes #<slice-#>` body. Activate when dispatched with `Review GitHub slice issue #<n>` or '/workflow-reviewer-review-slice'."
---

# workflow-reviewer-review-slice

Slice-level counterpart of `workflow-reviewer-review-task`. The orchestrator has flipped `review:pending` → `review:running` on the slice as its lock. This skill reviews the slice as a whole (cross-task integration, contract coverage, seams between tasks), composes one structured `# Slice Review` comment, and flips the gate. On pass, it also opens the draft slice PR labeled `merge:manual` so `workflow-orchestrator-close-pr` (for `merge:auto`) or the user (for `merge:manual`) can take it from there.

The reviewer agent loads its own pattern set at kickoff. This skill owns workflow primitives only.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Review GitHub slice issue #<n>` and the slice carries `level:slice` + `kind:feature` + `status:in-progress` + `review:running`.
- The user types `/workflow-reviewer-review-slice`.

Do NOT activate for task-level review (use `workflow-reviewer-review-task`), or when `review:running` is missing on the slice.

## Workflow

### 1. Fetch the slice issue and its closed task sub-issues

Fetch the slice issue (number, title, body, labels, url) via `gh issue view`. Pull the slice's sub-issue list via GraphQL (`repository.issue.subIssues.nodes`) and filter to those in state `CLOSED`.

Verify the slice has `review:running`. If missing, halt and surface `no running review lock on this slice`.

### 2. Set up a read-only worktree on the slice branch

Resolve the slice's attached branch, create-or-reuse the slice-scoped worktree on that branch (read-only), then `cd` into the worktree path.

### 3. Walk the loaded slice-level reviewer pattern set

The reviewer agent's patterns for the slice level cover cross-task integration, end-to-end contract conformance, seams (do the e2e specs cover all the task-level features?), and slice-wide coherence. Each pattern emits findings as `{title, severity, location, evidence, fix}` records.

### 4. Compose the verdict comment and compute APPROVE / BLOCK

Header: `# Slice Review` (single literal — downstream flows may grep for it).

Compose: severity-count summary → every finding → verdict. Verdict logic same as task review (CRITICAL / HIGH → BLOCK; otherwise APPROVE).

Write to `/tmp/review-slice-<slice-#>.md`.

### 5. Post the verdict + flip the gate label

Atomically post the verdict comment on the slice issue and flip the gate label — on APPROVE: remove `review:running`, add `review:passed`. On BLOCK: remove `review:running`, add `review:need-fix`.

### 6. On APPROVE, create the draft PR

Compose the PR body from the project's PR-body template:

- First line: `Closes #<slice-#>` (auto-closes the slice on merge).
- Then: brief summary, the closed task sub-issues list, the review verdict line, the test-plan checklist.

Title is the slice's title prefixed with the slice's conventional type/scope (e.g. `feat(auth): add SSO login`).

Create the draft PR for the slice branch with the title, the body file, and `merge:manual` as a label. PR creation is idempotent — if a PR already exists for the branch (e.g. a previous run created it before failing later), use the existing PR number and do not attempt re-creation.

Terminal action. Exit. The user (or `workflow-orchestrator-close-pr` if the user opts into `merge:auto` later) handles the merge.

### Blocked-run branch

If something prevents the review (worktree setup failed, slice branch missing, draft-PR creation failed mid-pass), post a single diagnostic comment on the slice **without** flipping any label. Leave `review:running` in place for human triage.

## Iron rules

- **Read-only on code.** No edits, no pushes, no `git reset --hard` outside the worktree setup. Writes are: one verdict comment, one terminal label flip, on pass one draft-PR create.
- **One review, one comment, one terminal label, one draft PR.** Single-shot. No loop, no re-validation.
- **APPROVE / BLOCK is computed here from aggregated findings.**
- **The slice-level reviewer pattern set is owned by the agent.**
- **GitHub is the single source of truth.** The verdict comment + terminal label + (on pass) draft PR are the only outputs.
- **PR body's first line is `Closes #<slice-#>`.** GitHub auto-closes the slice when the PR merges; this skill never closes the slice directly.
- **Draft PR gets `merge:manual` by default.** The user opts into `merge:auto` if they want `workflow-orchestrator-close-pr` to handle the merge automatically.
- **PR creation is idempotent.** Re-running the skill after a partial failure doesn't create duplicate PRs.
- **Refuse what the labels forbid.** Missing `review:running` → halt.
- **On a blocked run, do NOT flip the label.** Leave `review:running` for human triage.
