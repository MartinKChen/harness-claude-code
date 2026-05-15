---
name: fix-task-feedback
description: "Fix reviewer findings on a single GitHub task issue (`type:backend` or `type:frontend`, never `type:e2e`) per the gates dispatched by `fix-task-issue`. Read the task body, resolve the parent slice issue and its slice branch, locate the slice branch's most recent commit, read every non-reviewer comment newer than that commit first (user directives in that window override reviewer suggestions / ADRs / default conventions), then scope reviewer comment(s) to those created strictly after the last commit so previously-addressed rounds aren't re-processed, materialize the slice-scoped worktree, load the always-on security context and the full fullstack pattern set, address each must-fix finding with `rg`-driven pattern propagation (each equivalent site gets its own RED → GREEN), audit the container surface and `.env.example` for drift, push, and flip every `review:{code,security}-passed` / `review:{code,security}-need-fix` back to `review:{code,security}-pending` so a fresh review cycle picks up the fix. Activate when the dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `type:backend` or `type:frontend`, or when the user types phrases like 'address the reviewer findings on #<n>', '/fix-task-feedback'. Do NOT activate to implement fresh work on a task (use `implement-feature-task`), to fix CI / merge-conflict on a PR (use `fix-pr-blockers`), or to fix reviewer findings on a `type:e2e` task (use `fix-e2e-tests`)."
---

# fix-task-feedback

Address reviewer findings on a single `type:backend` / `type:frontend` GitHub task issue dispatched by `fix-task-issue`. The orchestrator has already flipped the task's `review:{code,security}-need-fix` and `review:{code,security}-passed` labels to `review:{code,security}-pending` as its lock, so scope is read from the dispatch prompt verbatim, not from labels. User directives posted as comments between review rounds **override** reviewer suggestions, ADRs, and default conventions — read those before reading the reviewer findings.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Fix the review feedback on GitHub task issue #<n>` and the task carries `level:task` + `kind:feature` + `status:in-progress` + (`type:backend` or `type:frontend`), with at least one of `review:code-need-fix` or `review:security-need-fix` (the orchestrator may have flipped these to `review:*-pending` as its lock).
- The user types `/fix-task-feedback`, or phrases like 'address the reviewer findings on #<n>', 'fix the code review on this task', 'address the security findings on this task'.

Do NOT activate when:

- The task is `type:e2e` — that's `fix-e2e-tests`'s lane.
- The unit of work is an open PR (`conflict` / `ci`) — use `fix-pr-blockers`.
- No `# Code Review` / `# Security Review` comment newer than the slice branch's last commit exists on the task — stop and surface "fix dispatched but no reviewer comment newer than the last commit".

## References

| Skill | When to route to it |
|-------|---------------------|
| `tdd-workflow` | To drive each finding's RED → GREEN → REFACTOR cycle (and each propagated site's). **Required.** |
| `security-patterns` | At the start of every dispatch, before writing any code. **Required (always).** |
## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every commit produced during this fix pass. Subject line is `<type>(<scope>): <subject>`; the trailer rule (use `Refs #<task-#>`, never `Closes`) is spelled out in step 5 below. |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <task-#>` | Resolve the parent slice issue from the task and print the slice branch attached to that parent. |
| `scripts/last-commit-iso.sh <slice-branch>` | Print the ISO-8601 committer timestamp of the most recent commit on the remote slice branch. Used as the cutoff for filtering reviewer comments. |
| `scripts/read-user-directives.sh <task-#> <cutoff-iso>` | Print every non-reviewer comment created strictly after the cutoff (user directives that override reviewer suggestions / ADRs). |
| `scripts/read-latest-review-comment.sh <task-#> <cutoff-iso> <gate>` | Print the body of the most recent `# Code Review` (gate=code) or `# Security Review` (gate=security) comment newer than the cutoff. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. |
| `scripts/push-and-reset-all-reviews.sh <task-#> <slice-branch>` | Push the slice branch and idempotently reset every `review:{code,security}-*` label back to `review:*-pending`. Terminal action. |

## Workflow

Inputs from the orchestrator: a task issue number **and** the list of reviewer gates that returned `need-fix` — any non-empty subset of `{code, security}`. The orchestrator (`fix-task-issue`) has already flipped the task's `review:{code,security}-need-fix` and `review:{code,security}-passed` labels to `review:{code,security}-pending` (its lock), so do not infer scope from labels — read the gates from the dispatch prompt verbatim and read the matching reviewer's findings comment(s) on the **task issue**. Everything else (slice branch, worktree path, parent slice issue, comment bodies) you discover yourself.

### 1. Fetch the task body, resolve the slice branch's last commit, and pull only the reviewer comments newer than that commit

Read the task body in full once — it is the contract the fix must still satisfy, independent of round number:

```bash
gh issue view <task-#> --json number,title,body,labels,milestone,url
```

Resolve the slice branch (its parent slice issue is implicit in the script) and the most recent commit's timestamp — both are reused by step 2's worktree setup and by the comment-window filters below, so do not re-resolve them there:

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <task-#>)"
last_commit_iso="$(bash scripts/last-commit-iso.sh "${slice_branch}")"
```

**Before reading the reviewer comments, read every non-reviewer comment created strictly after `${last_commit_iso}`.** These are the channel through which the user posts inline corrections, decision overrides, and implementation directives between review cycles. A user directive in this window **overrides** both the reviewer's suggested fix path and any existing ADR or prior constraint — the user is the decision authority and their comment is the current ground truth:

```bash
bash scripts/read-user-directives.sh <task-#> "${last_commit_iso}"
```

Read every comment returned in full. If any comment contains explicit implementation instructions (e.g. "use X instead of Y", "modify the ADR to …", "switch to psycopg3"), record those as **binding directives** and apply them when addressing the reviewer findings — even if an existing ADR, prior review suggestion, or default convention says otherwise. Do not silently skip a user directive because it contradicts a reviewer's proposed fix path; the user's comment is always the higher-priority signal.

For each gate in the dispatch's list, pull only the most recent reviewer comment **created strictly after `${last_commit_iso}`**:

```bash
# Per gate — pass `code` or `security`.
bash scripts/read-latest-review-comment.sh <task-#> "${last_commit_iso}" code
bash scripts/read-latest-review-comment.sh <task-#> "${last_commit_iso}" security
```

Comments created **at or before** `${last_commit_iso}` are previous review rounds — the findings they raised are already addressed by the commits on the slice branch, and re-reading them would re-do completed work. If a dispatched gate has no matching reviewer comment newer than the cutoff, the script exits non-zero — halt and surface "fix dispatched for gate `<gate>` but no `# <Gate> Review` comment newer than the slice's last commit (`${last_commit_iso}`) on the task". The orchestrator and the live state disagree, and guessing a fix from a blank tree only churns the diff.

Triage every finding in the in-scope reviewer comment(s) by severity:

- **CRITICAL / HIGH / MEDIUM** → must-fix. In scope unconditionally.
- **LOW / NIT / suggestion (no severity)** → fix only when the effort is small and obviously in-scope. Skip anything that would expand the diff materially or pull in unrelated refactors; note skipped items in your commit message body so the reviewer can see they were considered.

### 2. Materialize the slice branch in a worktree

Reuse the `${slice_branch}` already resolved in step 1; check it out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and **do all subsequent work inside that path** — never in the orchestrator's checkout.

```bash
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

### 3. Load always-on security context

Invoke `security-patterns` before any code is written.

### 4. Load the full fullstack pattern set via `tdd-workflow`

Same as `implement-feature-task` step 4 — load every reference upfront (`references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, `references/docker-patterns.md`).

### 5. Address every must-fix finding from the reviewer comment(s)

For each finding, BEFORE writing the RED, `rg` the codebase for the same anti-pattern the reviewer flagged — a "missing CSRF check on endpoint X", a "raw SQL string in handler Y", a "secret read from a config file in module Z" is rarely a one-off, and the re-review will fail (or worse, the security gate will pass while the bug still lives elsewhere) if you only fix the cited site. Treat each equivalent site as its own RED → GREEN → REFACTOR cycle so the regression suite locks the pattern out everywhere, per the pattern-propagation rule in *Iron rules*. The RED test must encode the demand as a failing test (security: a regression test that proves the fix prevents the documented attack vector; code: a unit/integration test that asserts the corrected behavior). Drive GREEN with the minimum production change; REFACTOR under green. Format every commit per `templates/commit-messages.md` at the prescribed cadence. Each commit message must reference the finding(s) it addresses, list any additional sites fixed via pattern propagation, and include a `Refs #<task-#>` trailer so `code-reviewer` / `security-reviewer` can scope the re-review correctly.

After the last must-fix finding is GREEN, run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, a top-level `docker-compose.yaml` (or `compose.yaml`), and a `.dockerignore` next to each `Dockerfile`. If a reviewer's fix introduced a new deployable surface (a new service, a worker process, an additional package) and its container artifacts are still missing, scaffold them now via `docker-patterns` and commit using a `chore(scaffold): <what>` subject (format per `templates/commit-messages.md`). The pre-push hook enforces this.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` against every fix you just landed. A security reviewer's "secret in a config file" fix often moves the secret to an env var that the Dockerfile / compose must now expose; a code reviewer's "missing dep" fix may need that dep installed in the image; a "remove this debug endpoint" fix may free an exposed port. If the runtime surface drifted, update the container files in the same slice and commit using `chore(docker): <what>` / `fix(docker): <what>` (format per `templates/commit-messages.md`) before moving to the push step. If it did not drift, leave the container files alone.

Then run the `.env.example` audit: reviewer-driven fixes routinely add env vars (a security fix that pulls a secret out of a config file, a code fix that exposes a new feature flag, a config-cleanup fix that renames an existing var). If any env var the app reads was added, renamed, or removed by this fix pass, update `.env.example` in the same slice and commit using `chore(env): <what>` / `fix(env): <what>` (format per `templates/commit-messages.md`). If env vars did not drift, leave `.env.example` alone.

### 6. Push the slice branch and reset every `review:*` gate to pending

Push to remote (the pre-push hooks gate the fullstack lint/format/type/test set and the security scans against the worktree — drop back into step 5 if any hook denies; never force-push, never skip hooks), then idempotently reset every `review:{code,security}-*` label back to `review:*-pending`. A fix can invalidate a previously-passed gate, so even passed gates are reopened:

```bash
bash scripts/push-and-reset-all-reviews.sh <task-#> "${slice_branch}"
```

This is the terminal action. Exit after the label flip lands — do not close the task (that's `close-task-issue`'s job once the next review cycle returns `*-passed`), do not touch `status:in-progress`, do not message reviewers, do not loop.

## Iron rules

- **User directives in the comment window override everything else.** Before reading reviewer findings, read every non-reviewer comment newer than the slice branch's last commit. An explicit instruction there beats a reviewer's suggested fix path, an ADR, or a default convention.
- **Scope is read from the dispatch prompt verbatim — never from labels.** The orchestrator's lock flipped `review:*-need-fix` to `review:*-pending`, so the labels alone can't tell you which gates returned `need-fix`. Read the gates list from the dispatch prompt.
- **Skip previously-addressed rounds.** Only consider reviewer comments created **strictly after** the slice branch's last commit timestamp. Earlier comments are previous rounds — the fixes they demanded are already in `git log`, and re-reading them would re-do completed work.
- **Read `security-patterns` before writing any code.**
- **Always fullstack — load every language reference upfront.** Same as `implement-feature-task`.
- **Treat each finding as a *class* of issue, not a single instance — propagate via `rg` before declaring the fix done.** Each additional equivalent site gets its own RED → GREEN so the regression suite locks the pattern out everywhere. List the additional sites in the commit body. Only skip propagation when a search confirms the pattern is genuinely isolated. This is *not* license to expand into unrelated refactors.
- **Each must-fix finding starts with a failing test.** Security findings: a regression test proving the fix prevents the documented attack vector. Code findings: a unit/integration test asserting the corrected behavior. Drive GREEN with the minimum production change; REFACTOR under green.
- **Read before every edit; verify after every edit; bundle co-dependent changes.** Same oscillating-revert prevention as `implement-feature-task`.
- **Container setup is a pre-push gate.** Run the two-part audit (presence + drift) after the last must-fix finding is GREEN; the pre-push hook enforces presence.
- **`.env.example` is the authoritative inventory.** Update it in the same slice whenever a fix adds, renames, or removes an env var the app reads.
- **Reset *every* `review:*` gate to `*-pending` after push.** A fix can invalidate a previously-passed gate, so the terminal flip removes all four terminal labels and adds both pending labels. `gh issue edit` ignores `--remove-label` targets that aren't currently set, so the idempotent call is safe.
- **Format every commit per `templates/commit-messages.md` with a `Refs #<task-#>` trailer.** Never use `Closes` — closure is owned by `close-task-issue` once the next review cycle returns `*-passed`.
- **Stop and exit after the terminal label flip.** Do not close the task, do not touch `status:in-progress`, do not message reviewers, do not loop.
