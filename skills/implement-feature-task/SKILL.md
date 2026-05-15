---
name: implement-feature-task
description: "Implement a single GitHub task issue (`type:backend` or `type:frontend`, never `type:e2e`) end-to-end via strict outside-in TDD. Read the issue, resolve the parent slice issue and its slice branch, materialize a slice-scoped worktree, load the always-on security context and the full fullstack pattern set, pull per-entity architecture context only when the change actually touches that entity, scaffold any missing worktree structure (manifests, configs, Dockerfile/compose/.dockerignore, .env.example) in discrete `chore(scaffold):` / `build:` commits before the first RED, drive implementation via `tdd-workflow` at the prescribed RED/GREEN/REFACTOR cadence with a `Refs #<task-#>` trailer on every commit, audit the container surface and `.env.example` for drift, push the slice branch, and add `review:code-pending` + `review:security-pending` to the task issue. Activate when the dispatch prompt opens with `Implement GitHub task issue #<n>` and the issue carries `type:backend` or `type:frontend`, or when the user types phrases like 'implement #<n>', 'work on the next task issue', '/implement-feature-task'. Do NOT activate to fix CI / merge-conflict scenarios on an open PR (use `fix-pr-blockers`), to address reviewer findings on a task (use `fix-task-feedback`), to implement a `type:e2e` task (use `author-e2e-tests`), or to start ad-hoc work outside the slice-task lifecycle."
---

# implement-feature-task

Take one assigned GitHub task issue and ship it through strict outside-in TDD on the parent slice's branch, inside a slice-scoped worktree at `/tmp/git-worktree/<repo>/<slice-branch>`. Apply the full fullstack pattern set upfront and the always-on security context — even when the task only touches one side of the stack — so a follow-up cycle that crosses the boundary doesn't pay a re-read tax. Stop the moment the issue's `Done criteria` are green; never bundle unrequested improvements.

## When to activate

Activate this skill whenever:

- The dispatch prompt opens with `Implement GitHub task issue #<n>` and the issue carries `level:task` + `kind:feature` + `status:in-progress` + (`type:backend` or `type:frontend`).
- The user types `/implement-feature-task`, or phrases like 'implement #<n>', 'pick up the next ready task', 'work on this task issue', 'ship task #<n>'.

Do NOT activate when:

- The issue carries `type:e2e` — that is `author-e2e-tests`'s lane; a `type:e2e` dispatch arriving here is a routing bug, surface and stop.
- The dispatched unit of work is an open PR with `conflict` and/or `ci` scenarios — use `fix-pr-blockers`.
- The dispatched unit of work is a task with reviewer `need-fix` verdicts — use `fix-task-feedback`.
- The issue is closed, missing `Delivery` / `Done criteria`, or carries no `type:*` label — surface and stop.

## References

| Skill | When to route to it |
|-------|---------------------|
| `tdd-workflow` | To drive the entire implementation loop (acceptance → red/green/refactor → wiring). **Required.** |
| `security-patterns` | At the start of every dispatch, before writing any code; re-open whenever the change touches secrets, input, queries, auth/sessions, output rendering, CSRF, rate limits, logging, errors, or dependencies. **Required (always).** |
## Templates

| Asset | Purpose |
|-------|---------|
| `templates/commit-messages.md` | Conventional Commits format for every commit produced during this implementation pass. Subject line is `<type>(<scope>): <subject>`; the trailer rule (use `Refs #<issue-#>`, never `Closes`, since closure is owned by `close-task-issue`) is spelled out in step 7 below. |

## Scripts

Every gh / git multi-step sequence is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/resolve-slice-branch.sh <issue-#>` | Resolve the parent slice issue from the task and print the slice branch attached to that parent. |
| `scripts/setup-worktree.sh <slice-branch>` | Create-or-reuse the worktree at `/tmp/git-worktree/<repo>/<slice-branch>` and hard-reset it to `origin/<slice-branch>`. Prints the worktree path. Does NOT rebase onto main. |
| `scripts/push-and-open-reviews.sh <issue-#> <slice-branch>` | Push the slice branch and add `review:code-pending` + `review:security-pending` to the task issue. Terminal action. |

## Workflow

Inputs from the orchestrator: a task issue number (and/or URL). Everything else (slice branch, feature name, acceptance criteria) the agent discovers itself.

### 1. Read the issue

Pull the full sub-issue so the rest of the work has its `Delivery`, `Done criteria`, `Dependencies`, and labels in hand:

```bash
gh issue view <issue-#> --json number,title,body,labels,milestone,state,url
```

Halt and surface back to the orchestrator if the issue is closed, missing `Delivery` / `Done criteria`, carries no `type:<type>` label, or carries `type:e2e` (a `type:e2e` dispatch is a routing bug — e2e tasks go to `author-e2e-tests`). Do not invent acceptance criteria.

### 2. Materialize the slice branch in a worktree

The slice branch was attached to the **parent slice issue** at creation time by `create-issues` (via `gh issue develop --create`), not to each task sub-issue. Resolve it, then check it out under `/tmp/git-worktree/<repo-name>/<slice-branch-name>` and **do all subsequent work inside that path** — never in the orchestrator's checkout.

```bash
slice_branch="$(bash scripts/resolve-slice-branch.sh <issue-#>)"
worktree_path="$(bash scripts/setup-worktree.sh "${slice_branch}")"
cd "${worktree_path}"
```

If either script exits non-zero, halt and surface the diagnostic it printed — there is no branch to implement against.

### 3. Load always-on security context

Invoke `security-patterns` to anchor security constraints before any code is written. Carry them through every red/green/refactor step.

### 4. Load the full fullstack pattern set via `tdd-workflow`

Instruct `tdd-workflow` to load every reference upfront: `references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, and `references/docker-patterns.md`. The engineer is fullstack by default — even when this particular task only touches one side, having the other side's references resolved means a follow-up cycle that crosses the boundary doesn't pay a re-read tax. The `type:<type>` label still informs which patterns will drive *most* of the red/green/refactor cycles for this task; it does not narrow which references you load.

### 5. Pull entity-scoped architecture context (only when the issue needs it)

Resolve `<feature-name>` from the issue's milestone (captured in step 1's JSON). From the issue body, identify which entities the change actually touches:

- For each **persistence entity** the change reads/writes/migrates, read `docs/PRDs/<feature-name>/data-models/<entity>.md`.
- For each **API resource** the change exposes or consumes, read `docs/PRDs/<feature-name>/api-contracts/<entity>.md`.

Read these files one at a time, by name. Do NOT `ls` the directory and bulk-read every entity. If the issue is pure plumbing (no persistence, no API surface), skip this step entirely. If a referenced entity file is missing, halt and surface it rather than guessing.

### 6. Scaffold the worktree if needed

Before invoking `tdd-workflow`, survey the worktree against what the task's implementation will need:

- Package manifests (`pyproject.toml`, `package.json` and their lockfiles).
- Source / test directory layout.
- Test-runner config (`pytest.ini`, `vitest.config.ts`).
- Linter / formatter config.
- Framework entry points (FastAPI `app`, React root).
- **Container artifacts (mandatory, not conditional on this task's surface):** every deployable application directory in the worktree (`backend/`, `frontend/`, or a single-package layout shipping code at the repo root) MUST have a `Dockerfile` and a `.dockerignore`. The worktree MUST also have a top-level `docker-compose.yaml` (or `compose.yaml`) wiring those services. If any is missing — even when the current task does not itself add a runtime dependency or port — scaffold it now via `docker-patterns` (multi-stage, pinned tags, non-root user, secrets via env, no `.venv` inside images). The first slice that touches the surface owns this creation; later slices inherit it.
- `.env.example` with placeholder values for every env var the application reads at startup, when one does not already exist and the application reads any env vars.

If a needed piece is missing, create it now as a discrete scaffolding step and commit each logically grouped piece using a `chore(scaffold): <what was created>` subject (format per `templates/commit-messages.md`) — or `build: <what>` when the piece is tooling/dependency work (new dev dep, lockfile bump, test runner install). One commit per piece, landed BEFORE the first RED in step 7. Do not bundle scaffolding into a `feat:` commit — scaffolding has no behavior to test, and bundling it pollutes the TDD trail. If the worktree already has everything the task needs, skip this step entirely.

### 7. Drive implementation via TDD

Invoke `tdd-workflow` and follow its outside-in loop (acceptance test → red → green → refactor → wiring) end to end. All production code must be justified by a failing test first. Commit at the prescribed RED / GREEN / REFACTOR cadence using the format in `templates/commit-messages.md` — commits land directly on `${slice_branch}` inside the worktree. **Every commit MUST mention the assigned sub-issue — include a `Refs #<issue-#>` trailer (use `Refs`, not `Closes`, since closure is owned by `close-task-issue` once review gates are green) so each commit is traceable back to the source issue.** If a fresh dependency surfaces mid-loop (an assertion helper, a fake-adapter package, a missing runtime dep the production code under test requires), pause the loop and land it as a `build: add <dep>` commit before resuming the RED — never fake the import or stub past the missing piece.

### 8. Verify against acceptance criteria, then audit the container surface and `.env.example`

Re-read the issue's `Done criteria` and confirm each criterion is satisfied by a passing test or observable behavior. If any criterion is unmet, drop back to step 7 with a fresh RED — do not declare done. Then run the **two-part container-setup audit**:

- **Presence (unconditional).** Confirm every deployable surface in the worktree (`backend/`, `frontend/`, or a single-package layout) has a `Dockerfile`, that the worktree has a top-level `docker-compose.yaml` (or `compose.yaml`), and that each `Dockerfile` has a sibling `.dockerignore`. If anything is still missing after step 6 (e.g. the task created a new deployable surface mid-loop), scaffold it now via `docker-patterns` and commit using the `chore(scaffold): <what>` subject (format per `templates/commit-messages.md`). Skipping this is not a valid choice — the pre-push hook will deny the push if any deployable surface lacks a `Dockerfile`.
- **Drift (conditional).** Re-read the worktree's `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` and decide whether the changes in this task added or removed a runtime dep, env var, exposed port, mounted volume, build stage, or entrypoint. If yes, update the container files in the same slice and commit using a `chore(docker): <what>` (or `fix(docker): <what>`) subject (format per `templates/commit-messages.md`) before moving to the push step. If the runtime surface did not change, leave the container files alone.

Then run the `.env.example` audit: if this task added, renamed, or removed any env var the app reads, update `.env.example` to match and commit using a `chore(env): <what>` (or `fix(env): <what>`) subject (format per `templates/commit-messages.md`). If no env vars changed, leave `.env.example` alone.

### 9. Push the slice branch and open both review gates

Push the slice branch to remote (the plugin's pre-push hooks re-run the fullstack lint/format/type/test set and the security scans against the worktree and will deny the push if any check fails — if a hook fails, drop back into a red/green/refactor cycle at step 7; never patch around a failing hook, never force-push, never skip hooks), then add `review:code-pending` + `review:security-pending` to the task issue so `review-task-issue` dispatches the `code-reviewer` and `security-reviewer`:

```bash
bash scripts/push-and-open-reviews.sh <issue-#> "${slice_branch}"
```

This is the terminal action. Exit after the label add lands — do not close the task (that's `close-task-issue`'s job once reviews pass), do not touch `status:in-progress`, do not open or promote a PR (PR creation is owned outside this lane), do not message reviewers, do not loop.

## Iron rules

- **Treat the assigned issue as the contract.** If acceptance criteria are missing or ambiguous, stop and ask before writing code.
- **Read `security-patterns` before writing any production code.** Every line written — and every test that locks behaviour in — must satisfy its rules (env-only secrets, schema-validated input at the boundary, parameterized queries, `HttpOnly; Secure; SameSite` session cookies, authorize-before-act, sanitized output, CSRF on cookie-auth state changes, per-route rate limits, redacted logs, generic 5xx messages, locked dependencies). If a constraint conflicts with the task, stop and surface it rather than silently relaxing it.
- **Pull architecture context per-entity, on demand — never bulk-load.** Read only the specific entity file(s) the change actually touches under `docs/PRDs/<feature-name>/data-models/<entity>.md` and `docs/PRDs/<feature-name>/api-contracts/<entity>.md`. If the change touches no persistence and exposes/consumes no API, skip those files entirely.
- **Never write production code without a failing test first; never write more production code than the failing test requires.**
- **Always fullstack — load every language reference upfront.** Mode-A work always reads `references/coding-patterns.md`, `references/python-patterns.md`, `references/frontend-patterns.md`, and `references/docker-patterns.md` via `tdd-workflow` before writing any code.
- **Cite file paths with line numbers** (`path/to/file.py:42`) when reporting what changed or where a behavior lives.
- **Read before every edit; verify after every edit; make logically coupled changes in one Edit call.** Before touching any file, Read the full region that will be affected. After each Edit call, run the relevant static-analysis check (`uv run mypy <file>`, `uv run ruff check <file>`, or `tsc --noEmit`) immediately. When a single logical change requires editing two or more lines that must be true simultaneously (e.g. adding a new import and updating the signature to use it), include all affected lines in a single `old_string`/`new_string` pair — never make them as separate sequential edits.

  **Oscillating-revert trap.** If you issue two sequential Edit calls that target overlapping regions of the same file, the second call's `old_string` must match the file's state *after* the first edit, not its original state. Otherwise the Edit tool silently reverts the first edit and replaces it with the second. Prevention:
  1. One Read per edit. Do not carry the pre-edit text in memory across multiple edits to the same file.
  2. Bundle co-dependent changes (imports + the code that uses them) into one `old_string`/`new_string` pair.
  3. Verify immediately — read back the changed region or run the linter after every Edit before issuing the next Edit on the same file.
- **Container setup is a pre-push gate, not optional polish.** Audit `Dockerfile`, `docker-compose.yaml` (or `compose.yaml`), and `.dockerignore` for both presence (unconditional) and drift (conditional on this task's changes) before declaring the unit of work done. Both compose filenames are valid (`docker-compose.yaml`/`.yml` is the v1 convention, `compose.yaml` is the v2 convention); audit whichever the worktree has — if both exist, surface it as a worktree-shape bug. The pre-push hook enforces presence.
- **`.env.example` is the authoritative inventory of every env var the app reads — keep it in lockstep with the code.** Update it in the same slice whenever a change adds, renames, or removes an env var the application/test/build tooling reads. New vars get a placeholder value (a safe non-secret default, or `changeme` for true secrets) and a short inline comment when the name isn't self-explanatory; renamed vars get both the new name and the old removed; deleted vars get removed outright. Commit using `chore(env): <what>` / `fix(env): <what>` (or `chore(scaffold): add .env.example` if the file is being introduced for the first time), formatted per `templates/commit-messages.md`. Never commit a real `.env`; never put real secrets in `.env.example`.
- **Per-slice container isolation: slug-tag built images and slug-name the compose project; override port conflicts at the shell, never in committed files.** Whenever a step requires building an image or bringing the compose stack up inside the worktree (TDD integration tests, smoke checks, anything that exercises the runtime), derive a deterministic slug from the slice branch and use it as both the image tag and the compose project name:
  ```bash
  slug="$(printf '%s' "${slice_branch}" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')"
  repo_name="$(basename "$(git rev-parse --show-toplevel)")"
  image_tag="${repo_name}:${slug}"

  IMAGE_TAG="${image_tag}" docker compose -p "${slug}" build
  IMAGE_TAG="${image_tag}" docker compose -p "${slug}" up -d
  ```
  If a host port is already in use, **override the port via env vars on the same `docker compose` command** (e.g. `HTTP_PORT=18000 IMAGE_TAG="${image_tag}" docker compose -p "${slug}" up -d` against a `${HTTP_PORT:-8000}:8000` mapping). **Do NOT edit `Dockerfile` or `docker-compose.yaml` to dodge a port conflict** — those files codify the standard runtime contract and must stay identical across slices. The only legitimate compose-file change here is adding `${VAR:-<standard-port>}` indirection when the port previously had none — a one-time conventionalization, not a workaround. Tear the stack down with `docker compose -p "${slug}" down -v` before exiting the worktree.
- **Commit on the cadence prescribed by `tdd-workflow`** (per RED / GREEN / REFACTOR step where applicable); never skip hooks or force-push.
- **Scaffold first, test second.** Scaffolding goes in discrete `chore(scaffold): <what>` (or `build: <what>` for tooling/dep changes) commits BEFORE the first RED. Bundling scaffolding into a `feat:` commit pollutes the TDD trail. If a needed dependency surfaces *mid-loop*, pause the loop, land a `build: add <dep>` commit, then resume the RED — never fake an import or skip a test to dodge a missing dependency.
- **Stop and report when the acceptance criteria are met.** Do not bundle unrequested improvements.
