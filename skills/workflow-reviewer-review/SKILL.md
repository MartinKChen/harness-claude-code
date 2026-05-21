---
name: workflow-reviewer-review
description: "Review a single `(task issue, gate)` pair end-to-end — derive the applicable reviewer pattern set from `(type:*, gate)` labels, check the parent slice branch out in a worktree, scope to `Refs #<task-#>` commits (on the security gate, build a slug-tagged compose image so CVE scans target this PR's artifact), aggregate every pattern's findings into one structured `# Code Review` / `# Security Review` comment on the task, post it, and flip `review:<gate>-running` to its terminal `*-passed`/`*-need-fix`. Read-only on code. Activate on `Review GitHub task issue #<n> for the <code|security> gate` / '/workflow-reviewer-review'. Skip for slice-PR review, fix work, or any `type:e2e` + security pairing (refuse and surface)."
---

# workflow-reviewer-review

Review a single `(task issue, gate)` pair dispatched by the orchestrator. The orchestrator has already flipped `review:<gate>-pending` → `review:<gate>-running` as its lock; this skill is read-only on code, walks every reviewer pattern the labels select, aggregates findings into one structured comment on the task issue, and flips the gate label to its terminal `*-passed` / `*-need-fix` state. There is no loop and no re-validation — re-review after a fix is a fresh dispatch driven by the engineer / e2e-author flipping the terminal label back to `review:<gate>-pending`.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Review GitHub task issue #<n> for the <code|security> gate` and the task carries `level:task` + `kind:feature` + `status:in-progress` with `review:<gate>-running` present.
- The user types `/workflow-reviewer-review`, or phrases like 'review task #<n>', 'run the code gate on this task', 'run the security gate on this task'.

Do NOT activate when:

- The dispatched gate is `security` and the task carries `type:e2e` — the security gate does not apply to test code. Halt and surface the violation rather than inventing a verdict.
- The matching `review:<gate>-running` lock is missing on the task — halt and surface "no running review lock on this task — refusing to invent a verdict". The orchestrator's lock is the contract.
- The unit of work is a slice PR (the `review:*` label family lives on tasks, not PRs) or a task whose verdict has already been written (`review:<gate>-passed` / `review:<gate>-need-fix` present without `*-running`).
- The task is closed — there is nothing to review.

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <task-#>` | Resolve the parent slice issue from the task and print the slice branch attached to that parent. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. **Does NOT rebase onto main — the reviewer is read-only on code.** |
| `scripts/build-scan-image.sh <slice-branch>` | Security gate only. Build the worktree's compose image(s) with a slug tag derived from the slice branch so vulnerability scans target this PR's exact artifact; print the image tag. Run inside the worktree. |
| `scripts/cleanup-scan-image.sh <slice-branch>` | Security gate only. Remove every image whose tag matches the slug; safe to call after a build failure or after the gate completes. |
| `scripts/post-review-and-flip-gate.sh <task-#> <gate> <verdict> <body-file>` | Terminal action. Post the aggregated `# Code Review` / `# Security Review` comment on the task and flip `review:<gate>-running` → `review:<gate>-<verdict>` (where `<verdict>` is `passed` or `need-fix`). |

## Workflow

Inputs from the orchestrator: the **task issue number** and the **gate** (`code` or `security`). Everything else (issue body, labels, parent slice, slice branch, worktree path, scoped commits, image tag) you discover or derive yourself.

### 1. Fetch the task issue

Pull body + labels in one go so the rest of the review has everything it needs:

```bash
gh issue view <task-#> --json number,title,body,labels,url
```

Confirm the labels: `level:task` + `kind:feature` + exactly one `type:*`, with `review:<gate>-running` present. If the issue is closed, halt and surface the error — there is nothing to review. If `review:<gate>-running` is missing, halt and surface "no running review lock on this task — refusing to invent a verdict". On the security gate, if the type is `type:e2e`, halt and surface the violation — refuse to invent a verdict (test code has no production attack surface).

### 2. Resolve the parent slice and slice branch, then materialize the worktree

The slice branch is attached to the **parent slice issue** (set when the slice was created), not to each task sub-issue.

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <task-#>)"
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

If either script exits non-zero, halt and surface the diagnostic it printed — there is no branch to review against. **Every subsequent step (3–8) MUST run inside `$worktree_path` — never against the orchestrator's checkout.**

### 3. Scope the review to commits that mention the task

The slice branch may carry commits for sibling tasks too; only review what is in scope for *this* task. Filter commits by the `Refs #<task-#>` trailer that the engineer / e2e-author injected:

```bash
scoped_commits="$(git log origin/main..HEAD --format='%H' --grep="Refs #<task-#>")"
if [ -z "${scoped_commits}" ]; then
  # Fall back to the full slice diff if the slice carries no Refs trailer (legacy commits).
  # Surface the fallback in the comment as a NOTE so the engineer can fix the trailer convention going forward.
  scoped_commits="$(git log origin/main..HEAD --format='%H')"
  scope_note="No \`Refs #<task-#>\` trailers found on the slice branch — review scoped to the full diff vs. main."
fi

touched_paths="$(git show --name-only --format='' ${scoped_commits} | sort -u | grep -v '^$' || true)"
scoped_diff="$(git diff origin/main..HEAD -- ${touched_paths})"
```

`${touched_paths}` is the file set this review covers; `${scoped_diff}` is the diff to walk. On the security gate, apply the pattern skill's test-code exclusion list on top of `${touched_paths}`.

### 4. Load project conventions and architecture decisions

`CLAUDE.md` is already loaded by default — do not re-read it. Read every ADR in `docs/ADRs/` (start with `docs/ADRs/README.md` for the index, then read every `ADR-*.md` — superseded ADRs have been deleted, so what remains is load-bearing), and any nearby `*.md` rule files in the changed directories — all inside the worktree. ADR-prescribed hard limits (file size, naming, immutability, error classes, RLS, migration patterns) become CRITICAL / HIGH bars for this review specifically.

On the **code gate**, also re-read the **task issue body** you fetched in step 1 and extract the `## Done criteria (EARS)` block (AC1, AC2, …) and the `### Scenarios (Gherkin)` block (and `### Migration scenarios (Gherkin)` if the task changed a data model). For `type:e2e`, also pull the **parent slice issue body** to extract its Gherkin / EARS scenarios:

```bash
gh issue view "${parent_number}" --json body --jq .body
```

Keep this list of ACs + scenarios open while you walk the test-coverage pattern — every one of them is a coverage obligation.

### 5. Security gate only — build the image(s) with a slug tag for vulnerability scanning

Derive a deterministic image tag from the slice branch so the scanner targets exactly this PR's artifact (never `:latest`, never a base image):

```bash
image_tag="$(bash scripts/build-scan-image.sh "${slice_branch}")"
```

If the build fails, do not proceed to scanning — compose a blocked-review comment (step 8, blocked-run branch) explaining the build error and exit without flipping to a terminal state. Capture the resulting image tag(s) — every CVE scan must run against these exact tag(s), not against `:latest` or a base image.

### 6. Walk each applicable reviewer pattern, in order

The reviewer patterns are loaded at agent kickoff; apply each one only when its trigger conditions match this dispatch:

- Code gate, `type:e2e` → test-coverage audit only (AC / scenario / migration-scenario gaps).
- Code gate, `type:backend` / `type:frontend` → walk in this order, invoking each only when its trigger paths appear in `${touched_paths}`:
  1. **Test coverage** — always. Emits MEDIUM findings for AC / scenario / migration-scenario gaps and shallow coverage.
  2. **Coding standard** — always. Language-agnostic code-quality patterns (large functions, deep nesting, mutation, dead code, performance, best practices, AI-generated-code addendum).
  3. **Contract conformance** — when API route handlers OR ORM models are touched AND a sibling contract file exists under `docs/api-contract/` or `data-model/`. Walk before the per-tech reviewers so a contract violation is named first.
  4. **Backend standard** — when backend code is touched. Best-practice audit (unvalidated input, unbounded queries, N+1, missing timeouts, 5xx leakage, atomic mutations, `/healthz` shape, middleware order, log redaction, `.env.example` lockstep, locked deps, CORS).
  5. **Frontend standard** — when React code is touched. React audit (hook correctness, route registration, TanStack Query guards, mutation invalidation, API via `src/lib/api`, error boundaries, native a11y, Tailwind ↔ tokens).
  6. **TypeScript** — when any `.ts` / `.tsx` / `tsconfig.json` is touched. Strictness flags, `any`, `!`, discriminated unions, biome import order.
  7. **Python** — when any `.py` is touched. Bandit-banned APIs, type annotations, EAFP, modern type hints, `Protocol`, dataclass DTOs, context managers, `uv`-only env.
  8. **FastAPI** — when FastAPI routes / deps / middleware / handlers are touched. `Depends` discipline, Pydantic at boundary, middleware order, trailing-slash, `Settings()` footgun, test factory.
  9. **Vite** — when `vite.config.*` / `vitest.config.*` / `import.meta.env` is touched. Stack choice, `VITE_` prefix, dev-proxy, lazy-load Suspense, static-asset imports.
  10. **Container** — when `Dockerfile` / `docker-compose.yaml` / `.dockerignore` / nginx config / entrypoint scripts are touched. Multi-stage, pinned + scout-vetted, non-root, nginx SPA-fallback order, no secrets in image.
  11. **Database / migration** — when `alembic/versions/*` / ORM model edits / `migrate` compose service is touched. Code-first, post-state by name, extension cleanup, both-direction constraint tests, no `conftest.py` pre-warming.
  12. **Observability** — when OTel instrumentation / logs / spans / metrics / `OTEL_*` env vars / Collector config is touched. No vendor SDKs, no `print`, span cardinality, metric labels, structured logs with trace correlation, batch processors, single bootstrap.
- Security gate, `type:backend` / `type:frontend` → walk the security catalogue (CVEs, secrets, input, SQL, auth/cookies/IDOR/JWT, XSS + headers, CSRF, rate limits, log redaction, deps, SSRF, CORS, webhooks/OAuth, race conditions).
- Security gate, `type:e2e` → already refused in step 1; do not reach this step.

Invoke each applicable pattern against `${touched_paths}` / `${scoped_diff}`. Each pattern emits findings as `{title, severity, location (file:line OR image:<tag>), evidence, fix, ...}` records — collect them all. On the security gate, also capture per-image CVE counts (CRITICAL / HIGH / MEDIUM / LOW). Do not post yet; do not flip any label yet.

On the security gate, **remove the built image(s) once every pattern has been scanned**. The slug-tagged artifact is single-use:

```bash
bash scripts/cleanup-scan-image.sh "${slice_branch}"
```

If the cleanup fails (e.g., still in use by another container), log the error but continue — the verdict does not depend on cleanup succeeding.

### 7. Compose the comment and compute the verdict

Pick the comment header from the gate — `# Code Review` for the code gate, `# Security Review` for the security gate. Downstream fix flows grep for these literal headers, so the wording is load-bearing. Fill in the severity-count summary table, every finding (matching the pattern's prescribed finding shape verbatim), and the verdict. On the security gate, also include the per-image CVE-count table and the `Left unfixed (LOW only): <reason>` line if any LOW counts were left unfixed. If `scope_note` from step 3 is set, include it as a `**Note:**` line above the verdict.

Compute the verdict from the aggregated severity counts:

- **APPROVE** — no CRITICAL or HIGH findings across every invoked pattern skill (MEDIUM and LOW may be reported). Terminal label: `review:<gate>-passed`.
- **BLOCK** — any CRITICAL or HIGH finding. Terminal label: `review:<gate>-need-fix`.

Write the comment body to a file (e.g. `/tmp/review-<task-#>-<gate>.md`) so the terminal action can post it atomically.

### 8. Post the task-issue comment and flip the gate label

```bash
bash scripts/post-review-and-flip-gate.sh <task-#> <gate> <passed|need-fix> <body-file>
```

This is the terminal action — comment + label flip both happen here. Exit after the call returns; do not follow up, do not loop, do not message anyone. Re-review after a fix is a fresh dispatch driven by a later stage flipping `review:<gate>-need-fix` / `review:<gate>-passed` back to `review:<gate>-pending` and the orchestrator picking it up again.

**Blocked-run branch.** If something prevents the review from being completed (worktree fetch failed mid-run, diff is unreadable, parent slice's branch is missing locally, referenced file is binary/encrypted, image build failed on the security gate, a pattern skill is missing, scope exceeds what one pass can review), post a single task-issue comment stating the blocker and what would unblock it — without invoking `post-review-and-flip-gate.sh`:

```bash
gh issue comment <task-#> --body-file <diagnostic-file>
```

Leave the gate label as `review:<gate>-running` for an operator to triage — do NOT flip to `*-passed` or `*-need-fix` on a blocked run. The reviewer fabricating a verdict from incomplete evidence is worse than leaving the gate visibly stuck.

## Iron rules

- **Pattern selection follows the label combination, not the dispatch prompt's wording.** The orchestrator sends `(task-#, gate)`. Read the task's `type:*` label and the gate to derive the applicable reviewer patterns per the step-6 ordering — never invent a pattern, never skip one that the labels select.
- **Aggregate, then post once.** Run every selected pattern to completion, collect every finding, then compose ONE structured comment and post it as a single atomic write (the `post-review-and-flip-gate.sh` script handles the comment + label flip together). Do not stream partial findings. Do not post per-pattern.
- **The verdict line is this skill's, not the patterns'.** The reviewer patterns emit findings only — APPROVE / BLOCK is computed here from the aggregated severity counts (any CRITICAL / HIGH → BLOCK; otherwise APPROVE — MEDIUM and LOW are reported but do not block).
- **GitHub is the single source of truth.** Findings live as a single structured comment on the **task issue**, and the verdict lives as the task's terminal label (`review:<gate>-passed` / `review:<gate>-need-fix`). Do not return a structured summary, do not `SendMessage` other agents, do not maintain side-channel state. The task-issue comment + the label are the only output.
- **One review, one comment, one terminal label.** This skill is single-shot — fetch → derive → worktree → scope → (build image, on security) → walk patterns → comment → flip label → exit. Do NOT loop, do NOT re-validate after fixes, do NOT wait for engineer acknowledgements.
- **Refuse what the labels forbid.** Security gate + `type:e2e` → halt and surface the violation; test code skips the security gate by design. Missing the `*-running` lock for the gate you were dispatched on → halt and surface "no running review lock on this task — refusing to invent a verdict". Closed issue → halt and surface.
- **Read-only on code.** Never edit files, never push, never `git reset --hard` outside the worktree setup script, never open or close issues or PRs. The only permitted writes are `gh issue comment` (one comment on the task issue) and `gh issue edit --remove-label/--add-label` (the gate label flip) — both go through `post-review-and-flip-gate.sh`.
- **On a blocked run, do NOT flip the label.** Leave `review:<gate>-running` in place for an operator to triage and post a single diagnostic comment via `gh issue comment` directly. Fabricating a verdict from incomplete evidence is worse than a visibly stuck gate.
- **The reviewer patterns own what to flag, how to grade severity, citation rules, the BAD/GOOD snippet shape, the no-`#N` handle rule, the test-code exclusion list, and the `Required end state` quotation.** Apply each one before walking it; do not duplicate its rules here.
