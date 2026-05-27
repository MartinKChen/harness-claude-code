---
name: workflow-reviewer-review-slice
description: "Review a single slice issue end-to-end. Read the slice body and every closed task sub-issue, set up the slice worktree (read-only), run the loaded slice-level reviewer pattern set (cross-task integration, contract coverage, slice-level seams), compose one `# Slice Review` comment, post it, flip `review:running` → `review:passed` or `review:need-fix`. On pass, also create the draft PR labeled `merge:manual` with `Closes #<slice-#>` body. Activate when dispatched with `Review GitHub slice issue #<n>` or '/workflow-reviewer-review-slice'."
---

# workflow-reviewer-review-slice

Slice-level counterpart of `workflow-reviewer-review-task`. The dispatcher (`/implement-feature` command's review-slice stage) has flipped `review:pending` → `review:running` on the slice as its lock. This skill reviews the slice as a whole (cross-task integration, contract coverage, seams between tasks), composes one structured `# Slice Review` comment, and flips the gate. On pass, it also opens the draft slice PR labeled `merge:manual` so the `/implement-feature` command's close-pr stage (for `merge:auto`) or the user (for `merge:manual`) can take it from there.

The reviewer agent loads its own pattern set at kickoff. This skill owns workflow primitives only.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Review GitHub slice issue #<n>` and the slice carries `level:slice` + `kind:feature` + `status:in-progress` + `review:running`.
- The user types `/workflow-reviewer-review-slice`.

Do NOT activate for task-level review (use `workflow-reviewer-review-task`), or when `review:running` is missing on the slice.

## Workflow

### 1. Fetch the slice issue and its closed task sub-issues

Fetch the slice issue (number, title, body, labels, url, milestone) via `gh issue view` — include the `milestone` field so step 8 can carry it onto the draft PR. Pull the slice's sub-issue list via GraphQL (`repository.issue.subIssues.nodes`) and filter to those in state `CLOSED`.

Verify the slice has `review:running`. If missing, halt and surface `no running review lock on this slice`.

### 2. Set up a read-only worktree on the slice branch

Resolve the slice's attached branch, create-or-reuse the slice-scoped worktree on that branch (read-only), then `cd` into the worktree path.

### 3. Walk the loaded slice-level reviewer pattern set

The reviewer agent's patterns for the slice level cover cross-task integration, end-to-end contract conformance, seams (do the e2e specs cover all the task-level features?), and slice-wide coherence. Each pattern emits raw findings as `{title, severity, location, evidence, fix}` records.

### 4. Score each finding on Impact × Effort/Risk and derive its fix-now class

Identical to the task-side scoring — see `workflow-reviewer-review-task` step 5 for the full Impact / Effort / fix-class definitions and the projection matrix. Summary:

- **Impact** is derived mechanically from pattern severity: CRITICAL/HIGH → `I:H`, MEDIUM → `I:M`, LOW → `I:L`.
- **Effort/Risk** is the reviewer's judgement of cost-to-fix-now: `E:L` (localized, ≲ 30 min), `E:M` (multi-file or new tests), `E:H` (design rework, schema/contract change, or unknown blast radius).
- **Fix-class** is the deterministic projection: `I:H × any` and `I:M × E:L` → `Fix`; `I:M × E:M/H` and `I:L × E:M/H` → `Defer`; `I:L × E:L` → `Nit`; the rest are `Drop` and never reach the comment.

Slice-level findings tend toward higher Effort (cross-task integration fixes often require touching multiple tasks' code or the slice's seams), so expect a heavier `Defer` column than at the task level.

### 5. Compose the verdict comment and compute APPROVE / BLOCK

Header: `# Slice Review` (single literal — downstream flows may grep for it).

Compose, in order:

1. **Summary matrix** — a 3×3 count of `(Impact, Effort)` cells over all reported findings (Drop excluded).
2. **Disposition line** — `Fix now: <n>  •  Deferred: <n>  •  Nits: <n>`.
3. **Findings** — each printed with the bracketed prefix `### [<class> · I:<x>/E:<y>] <title>` followed by `**Impact (<x>):**`, `**Effort/Risk (<y>):**`, `**Fix:**`, and the BAD / GOOD snippets per the pattern's template.
4. **Verdict** line.

Verdict is computed from Impact alone — Effort never blocks:

- **APPROVE** — no `I:H` finding remains. Terminal label: `review:passed`.
- **BLOCK** — at least one `I:H` finding. Terminal label: `review:need-fix`.

The downstream engineer pickup uses the per-finding `Fix` / `Defer` / `Nit` class, not the verdict — see `workflow-engineer-fix-slice` step 3.

Write to `/tmp/review-slice-<slice-#>.md`.

### 6. Post the verdict + flip the gate label

Atomically post the verdict comment on the slice issue and flip the gate label — on APPROVE: remove `review:running`, add `review:passed`. On BLOCK: remove `review:running`, add `review:need-fix`.

### 7. Capture signal to the consuming project's memory store

Per `memory-convention`, if `$MAIN_ROOT/.claude/memory/` exists in the consuming project, append the slice review's signal rows. If it does not exist, skip silently. Never block the terminal label flip or PR creation.

```bash
MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
MEMORY_ROOT="$MAIN_ROOT/.claude/memory"
[ -d "$MEMORY_ROOT" ] || exit 0
```

Write one JSON Lines row per finding to `$MEMORY_ROOT/signals/reviews/slice-<slice#>.jsonl` (append, create parent dir; note the `slice-` prefix). The schema retains `severity` for backward compatibility and adds `impact`, `effort`, and `fix_class`:

```json
{"ts": "<iso8601>", "task": null, "slice": <n>, "finding_handle": "<F1|…>", "pattern_skill": "<pattern-skill-name>", "category": "<kebab-case>", "severity": "<CRITICAL|HIGH|MEDIUM|LOW>", "impact": "<H|M|L>", "effort": "<L|M|H>", "fix_class": "<Fix|Defer|Nit>", "location": "<file:line>", "title": "<one-line>"}
```

**Missed-catch detection.** For each finding emitted in this slice review, cross-reference the slice's closed task sub-issues' review rows in `$MEMORY_ROOT/signals/reviews/<task#>.jsonl`. If the slice finding's `location` falls inside a path that one of those tasks' commits touched (`git diff --name-only` against the task's `Refs #<task#>` commits) AND no row in that task's review file shares `(pattern_skill, category)`, the task review missed it. Append one row to `$MEMORY_ROOT/signals/missed/<slice#>.jsonl`:

```json
{"ts": "<iso8601>", "slice": <n>, "parent_task": <task#>, "caught_by": "slice-review", "missed_by": "task-review", "pattern_skill": "<pattern-skill-name>", "category": "<kebab-case>", "location": "<file:line>", "title": "<one-line>"}
```

These rows are the primary input that `workflow-consolidate-memory` uses to propose **new rules** for the task-level reviewer's pattern set.

### 8. On APPROVE, create the draft PR

Compose the PR body from the project's PR-body template:

- First line: `Closes #<slice-#>` (auto-closes the slice on merge).
- Then: brief summary, the closed task sub-issues list, the review verdict line, the test-plan checklist.

Title is the slice's title prefixed with the slice's conventional type/scope (e.g. `feat(auth): add SSO login`).

Create the draft PR for the slice branch with the title, the body file, `merge:manual` as a label, and the slice's milestone (from step 1) via `--milestone` so the PR lands in the same milestone as the slice it closes. If the slice carries no milestone, omit the flag. PR creation is idempotent — if a PR already exists for the branch (e.g. a previous run created it before failing later), use the existing PR number and do not attempt re-creation.

Terminal action. Exit. The user (or the `/implement-feature` command's close-pr stage if the user opts into `merge:auto` later) handles the merge.

### Blocked-run branch

If something prevents the review (worktree setup failed, slice branch missing, draft-PR creation failed mid-pass), post a single diagnostic comment on the slice **without** flipping any label. Leave `review:running` in place for human triage.

## Iron rules

- **Read-only on code.** No edits, no pushes, no `git reset --hard` outside the worktree setup. Writes are: one verdict comment, one terminal label flip, on pass one draft-PR create.
- **One review, one comment, one terminal label, one draft PR.** Single-shot. No loop, no re-validation.
- **Every finding carries `(I:<x>, E:<y>, <class>)`.** Impact is derived mechanically from pattern severity; Effort is the reviewer's judgement; class is the matrix projection onto Fix / Defer / Nit / Drop. `Drop` findings never reach the comment.
- **APPROVE / BLOCK is computed from Impact alone — Effort never blocks.** Any `I:H` survivor → BLOCK; otherwise APPROVE. The per-finding `Fix` / `Defer` / `Nit` class drives the *engineer's* pickup, not the verdict.
- **The slice-level reviewer pattern set is owned by the agent.**
- **GitHub is the single source of truth.** The verdict comment + terminal label + (on pass) draft PR are the only outputs.
- **PR body's first line is `Closes #<slice-#>`.** GitHub auto-closes the slice when the PR merges; this skill never closes the slice directly.
- **Draft PR gets `merge:manual` by default.** The user opts into `merge:auto` if they want the `/implement-feature` command's close-pr stage to handle the merge automatically.
- **Draft PR inherits the slice's milestone.** Pass the slice's milestone to `--milestone` at creation so the PR is tracked in the same milestone; if the slice has none, omit it.
- **PR creation is idempotent.** Re-running the skill after a partial failure doesn't create duplicate PRs.
- **Refuse what the labels forbid.** Missing `review:running` → halt.
- **On a blocked run, do NOT flip the label.** Leave `review:running` for human triage.
- **Signal capture is fire-and-forget.** If `$MAIN_ROOT/.claude/memory/` is missing or any write fails, swallow the error and continue. Memory is per-consuming-project opt-in (see `memory-convention`); a review must never be blocked by it.
