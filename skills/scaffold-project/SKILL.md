---
name: scaffold-project
description: "Bootstrap a greenfield project to a bootable stack. Reads `docs/architecture-decision-record/` for stack + topology, creates a scaffold branch, materializes backend, frontend, e2e, and `docker-compose.yaml` from templates, verifies the stack boots end-to-end, asserts the design system locked upstream by `/deep-dive-feature` exists and seeds its tokens into the frontend, then pushes and opens a PR. Activate on '/scaffold-project', 'scaffold the project'. Do NOT activate if any scaffold surface already exists."
---

# scaffold-project

Take a **greenfield** project from empty to a stack that boots end-to-end: backend reachable on its framework-metadata endpoint, frontend reachable on its default page, every Dockerfile builds, `docker compose up` brings the whole topology up, a Playwright smoke spec drives the served frontend, and the design system locked upstream by `/deep-dive-feature` (its `docs/design-system/tokens.md`) is seeded into the frontend as CSS custom properties. Each surface commits as it lands, and the run ends by pushing the branch and opening a PR.

No feature endpoints, no routes, no migrations, no auth knobs, no contract-derived paths. Those land later, when a feature task brings them in via the engineer lane.

## When to activate

Activate when:

- The user types `/scaffold-project`, or phrases like 'scaffold the project', 'bootstrap the worktree', 'set up the project skeleton', 'make compose bring everything up', 'kickoff the project skeleton'.

Do NOT activate when:

- The project already has any scaffolded surface (`backend/`, `frontend/`, `compose.yaml` / `docker-compose.yaml`, or `e2e/`) — this skill is **greenfield only**. Surface the gap and STOP; structural additions to an already-bootable project belong to the engineer lane.
- `docs/architecture-decision-record/` is empty or doesn't declare a stack choice and a compose topology — scaffold MUST NOT guess at frameworks or services. Surface the gap and STOP.
- The work the user wants is feature work — adding a health endpoint at a contract path, wiring React Router, adding cookie knobs. Those belong to the engineer lane.

## Scope

Scaffold has no feature code to test, no secrets to handle, no schema to model, and no migrations to ship. Those concerns are out of scope and are picked up once the engineer lane takes over. The design-system step is consumption, not authoring: the system is locked upstream by `design-lead` during `/deep-dive-feature`, and scaffold only seeds its already-committed tokens into the frontend as CSS custom properties — not as production components, and never by generating the design system itself.

## Templates

Each `templates/<variant>/` directory holds a working example that copies as-is into the project and produces a bootable surface. The skill picks variants from the ADR's stack declaration.

| Asset | Purpose |
|-------|---------|
| `templates/python-fastapi/` | Backend variant: minimal `app/main.py` (`app = FastAPI()`), `pyproject.toml`, multi-stage `Dockerfile`, and `scripts/ci-checks.sh` (the single-sourced backend gate: ruff + ruff format --check + mypy + full pytest against an ephemeral Postgres). The booted container responds 200 on `GET /openapi.json`. |
| `templates/react-vite/` | Frontend variant: `index.html`, `main.tsx` rendering a placeholder, `package.json` (with `lint` / `format` scripts), `biome.json` (lint + format + import-organize config), multi-stage `Dockerfile` (build → static-serve via nginx, non-root, writable pid path), and `scripts/ci-checks.sh` (the single-sourced frontend gate: `biome ci` + `tsc --noEmit` + `vitest run`). The booted container responds 200 on `GET /`. |
| `templates/githooks/pre-push` | Committed pre-push hook wired via `git config core.hooksPath .githooks`. Runs the touched stack's `scripts/ci-checks.sh` — the **same** script CI runs — so a push that would fail CI is denied locally in one run. Bypassable with `git push --no-verify`. |
| `templates/compose.yaml` | Topology skeleton: backend + frontend + db services, `${VAR:-default}` port indirection, named volumes. The skill fills in service names / image targets per the ADR. No `migrate` service — that comes when the first migration lands. |
| `templates/e2e/` | E2E variant: `package.json` (`@playwright/test` + `npm test`), `playwright.config.ts` (env-overridable `baseURL`, `retries: 1` on CI, `workers: 1`), `tests/smoke.spec.ts` (`goto('/')` + one visibility assertion), `.gitignore`. |
| `templates/ci/pr-validation.yml` | Minimal PR-validation pipeline. Triggers on `pull_request` (incl. draft open / `ready_for_review`). Jobs: per-stack checks (`backend-checks` / `frontend-checks`, each a single `bash scripts/ci-checks.sh` step — the **same** script the pre-push hook runs, so CI and local never drift), per-stack docker image build (`backend-build`, `frontend-build`), then `e2e` against `docker compose up --build`. Backend / frontend job blocks are delimited by `# ---- BEGIN <surface> ----` / `# ---- END <surface> ----` so the skill can remove a block when the ADR omits that surface. |
| `templates/commit-messages.md` | Conventional Commits format. Scaffold-produced commits use `chore(scaffold): <surface>` or `build: <surface>`. |

## Scripts

| Asset | Purpose |
|-------|---------|
| `scripts/check-scaffold-needed.sh` | Static, no-build check of the project against each surface. Prints `{"surfaces":["backend","frontend","compose","e2e"]}` listing surfaces that still need scaffolding. For greenfield, all four MUST be present. Exits 0 always. |

## Workflow

The skill operates on the current working directory. It MUST be a git repository with `origin` configured (so the final push + `gh pr create` succeed). If either is missing, surface and STOP.

### 1. Confirm greenfield

```bash
bash skills/scaffold-project/scripts/check-scaffold-needed.sh
```

The `surfaces` array MUST contain every surface (`backend`, `frontend`, `compose`, `e2e`). If even one surface is already present, STOP and surface: "scaffold-project is greenfield-only; <surface> already exists — structural additions to an existing project belong to the engineer lane". Do not attempt a partial fill-in.

### 2. Read the ADR

```bash
ls docs/architecture-decision-record/ 2>/dev/null | head
```

If the directory is missing or empty, STOP. Surface "no ADR found under `docs/architecture-decision-record/` — scaffold needs the architect's stack/topology decisions before it can pick templates".

Read every ADR file and extract:

- **Backend stack** — e.g. `python-fastapi`. MUST match a directory under `templates/<stack>/`. If no matching template exists, STOP and surface "no scaffold template for stack `<name>` — add one under `templates/` or revise the ADR".
- **Frontend stack** — e.g. `react-vite`. Same rule.
- **Compose topology** — the list of services the product needs (e.g. `backend`, `frontend`, `db`). Service names and image references in the rendered `compose.yaml` come from here.
- **Product slug** — short kebab-case name used as the compose project name and image-tag prefix.

### 3. Create the scaffold branch

```bash
git checkout -b chore/scaffold-project
```

If the branch already exists locally, STOP — a prior scaffold run is in flight, and we MUST NOT silently reuse it. Surface the existing branch and ask the user how to proceed.

### 4. Scaffold backend → commit

Copy `templates/<backend-stack>/` into `backend/` (per the ADR's layout). Do not edit the framework entry to add routes, middleware, or settings logic — the template ships a bare `app = FastAPI()` (or equivalent) intentionally. The copy includes `backend/scripts/ci-checks.sh` (the single-sourced check gate); ensure its executable bit survives the copy (`chmod +x backend/scripts/ci-checks.sh`) so the pre-push hook wired at step 9 can invoke it.

```bash
git add backend/
git commit -m "chore(scaffold): backend (<stack>) — framework entry, manifests, Dockerfile, ci-checks"
```

### 5. Scaffold frontend → commit

Copy `templates/<frontend-stack>/` into `frontend/`. Do not add router wiring, components, or pages beyond the template's placeholder. The copy includes `frontend/scripts/ci-checks.sh` (the single-sourced check gate); ensure its executable bit survives the copy (`chmod +x frontend/scripts/ci-checks.sh`) so the pre-push hook wired at step 9 can invoke it.

```bash
git add frontend/
git commit -m "chore(scaffold): frontend (<stack>) — entry, manifests, Dockerfile, ci-checks"
```

### 6. Scaffold compose → commit

Copy `templates/compose.yaml` to the project root as `docker-compose.yaml`. Replace placeholders (`<PRODUCT>`, `<DB_NAME>`, `<DB_USER>`) with values from the ADR. Service names and `image:` / `build:` targets MUST match the ADR's topology. Use `${VAR:-default}` indirection on every host-exposed port. Do not add a `migrate` service unless the ADR explicitly says migrations are bootstrapped at scaffold time — by default, migrations come later with the first feature migration.

```bash
git add docker-compose.yaml
git commit -m "chore(scaffold): compose topology (<services>)"
```

### 7. Verify the full stack boots

This is the gate that distinguishes a "templated" project from a "bootable" one. Run:

```bash
docker compose up -d --build
```

Then poll, with a sensible per-service timeout:

- **Backend** — `curl -fsS http://127.0.0.1:${BACKEND_PORT:-8000}/openapi.json` (FastAPI) or the equivalent framework-metadata endpoint for the chosen stack. Must return 200.
- **Frontend** — `curl -fsS http://127.0.0.1:${FRONTEND_PORT:-5173}/`. Must return 200.
- **Db** (if in topology) — `docker compose ps` reports `healthy`.

If any check fails, capture the failing container's logs (`docker compose logs <service> --tail 100`), surface the diagnostic, and STOP **before** committing any fix — the user must see what the template produced and decide whether to patch the template, the ADR, or the run. Do not silently mutate templates to make the boot succeed.

On success, bring the stack down:

```bash
docker compose down
```

### 8. Scaffold e2e → commit

Copy `templates/e2e/` into `e2e/`. Run `npm install` inside `e2e/` so `package-lock.json` is produced; commit the lockfile alongside the manifest. Do not author task specs here — only `tests/smoke.spec.ts` lands.

```bash
cd e2e && npm install && cd ..
git add e2e/
git commit -m "chore(scaffold): e2e (playwright + smoke spec)"
```

### 9. Scaffold CI pipeline + CI-parity pre-push hook → commit

Materialize a minimal PR-validation pipeline so the draft PR opened at step 12 has CI signal from the first commit. Copy `templates/ci/pr-validation.yml` to `.github/workflows/pr-validation.yml`. The workflow triggers on `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`) — both draft and ready PRs run.

**Materialize and wire the CI-parity pre-push hook (mandatory).** The workflow's per-stack check jobs run `bash scripts/ci-checks.sh`; the committed pre-push hook runs the *same* script for every touched stack, so a push that would fail CI is denied locally in one run — no peeling failures apart one PR-cycle at a time. Wire it:

```bash
mkdir -p .githooks
cp skills/scaffold-project/templates/githooks/pre-push .githooks/pre-push
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
```

`core.hooksPath` is a **local** git setting (not committed), so the hook file alone isn't enough — every clone must run `git config core.hooksPath .githooks` once. Record that one-liner in the repo's `README.md` (or `CONTRIBUTING.md`) setup section so contributors enable it; the hook itself is committed under `.githooks/` so it travels with the repo. (The per-stack `scripts/ci-checks.sh` the hook invokes already landed with the backend/frontend surfaces at steps 4–5.)

Commit the workflow and the hook together as the `ci` surface:

Shape the rendered file to the surfaces that landed:

- **Backend present** (per the ADR): leave the `# ---- BEGIN backend ... ---- END backend ----` block in place. The template's commands assume `python-fastapi`; if the ADR's backend stack differs, surface and STOP — a CI variant for that stack must be added to the template first.
- **Backend absent**: delete the entire backend block and remove `backend-build` from the `e2e` job's `needs:` list.
- **Frontend present** (per the ADR): leave the `# ---- BEGIN frontend ... ---- END frontend ----` block in place. The template's commands assume `react-vite`; if the ADR's frontend stack differs, surface and STOP.
- **Frontend absent**: delete the entire frontend block, remove `frontend-build` from the `e2e` job's `needs:` list, and drop the `BASE_URL` / `FRONTEND_PORT` env wiring and the "Wait for frontend" step.

Do not add deploy jobs, registry pushes, OIDC role assumptions, or environment gates — those belong to the `sre` agent's lane, not to a scaffold-time validation pipeline. Do not add `paths:` filters that skip e2e — the e2e job is the only signal that the system composes correctly.

```bash
git add .github/workflows/pr-validation.yml .githooks/pre-push
git commit -m "chore(scaffold): ci (pr-validation pipeline + ci-parity pre-push hook)"
```

### 10. Assert the locked design system exists

The design system is **locked upstream by `design-lead` and committed by `design-writer` during `/deep-dive-feature`** — scaffold no longer generates it, it consumes it. Before seeding, assert the artifact is present:

```bash
test -f docs/design-system/tokens.md && test -f docs/design-system/surfaces.md
```

If either file is missing, **STOP and fail loudly**: surface "`docs/design-system/` is absent or incomplete (`tokens.md` / `surfaces.md` not found) — the design system must be locked via `/deep-dive-feature` before scaffolding. Run the design phase first, then re-run `/scaffold-project`." Do NOT invoke any UI/UX skill, do NOT invent tokens, do NOT proceed to the seed step. This assertion is what prevents a silent regression to the old "scaffold generates the design system" behavior.

### 11. Seed design tokens into the frontend → commit

Read the locked `docs/design-system/tokens.md` and seed it into the frontend (the design taste prose and `## Design taste` section of `CLAUDE.md` are already authored by `design-writer` — scaffold does not re-write them):

1. Write `frontend/src/styles/tokens.css` with one `:root { --<token-name>: <value>; ... }` block. Each property's name MUST match the token name in `tokens.md` (e.g. `color/brand/500` → `--color-brand-500`). Every color, font, spacing, radius, shadow, and motion token in `tokens.md` MUST appear here.
2. Add `import './styles/tokens.css';` to `frontend/src/main.tsx` (or the entry file the chosen frontend stack uses) so the tokens are loaded at boot. Do not author components, pages, or further styling — the seam stops at "tokens are reachable from production code".

Commit both together:

```bash
git add frontend/src/styles/tokens.css frontend/src/main.tsx
git commit -m "chore(scaffold): seed locked design tokens into frontend"
```

### 12. Push branch and open the draft PR

```bash
git push -u origin chore/scaffold-project
```

Then open the PR as a **draft** with `gh pr create --draft`, so the CI workflow scaffolded at step 9 fires on draft open and the user gets first-commit signal before the PR flips to ready. Title: `chore(scaffold): bootstrap project skeleton`. Body lists the surfaces that landed (backend stack, frontend stack, compose services, e2e smoke, CI pipeline), a one-line confirmation that `docker compose up` reached 200 on every framework-metadata endpoint locally, and the seeded design tokens (`frontend/src/styles/tokens.css`, compiled from the locked `docs/design-system/tokens.md`).

```bash
gh pr create \
  --draft \
  --title "chore(scaffold): bootstrap project skeleton" \
  --body "$(cat <<'EOF'
## Summary
- Backend: <stack>
- Frontend: <stack>
- Compose services: <list>
- E2E: Playwright smoke spec
- CI: `.github/workflows/pr-validation.yml` (per-stack checks → docker build → e2e)
- Design tokens: seeded `frontend/src/styles/tokens.css` (compiled from locked `docs/design-system/tokens.md`)

## Boot check
Locally verified `docker compose up` reaches 200 on backend framework-metadata and frontend `/`.

## Test plan
- [ ] `docker compose up --build` brings the stack up
- [ ] Backend framework-metadata endpoint returns 200
- [ ] Frontend `/` returns 200
- [ ] `cd e2e && npm test` passes against the running stack
- [ ] `pr-validation` workflow run is green on this draft PR
EOF
)"
```

Report the PR URL and stop.

## Iron rules

- **Greenfield only.** If any scaffold surface (`backend/`, `frontend/`, compose file, `e2e/`) already exists, STOP. This skill does not partial-fill.
- **No defaulted URIs, service names, ports, or framework choices.** Stack variants and topology come from `docs/architecture-decision-record/`. If the ADR doesn't say, STOP and surface — never guess.
- **Templates materialize; they do not author code.** No routes beyond what the template ships (which is none). No components / pages beyond the placeholder. No middleware, no settings logic, no auth, no migrations, no router. If the next step needs any of those, that's the engineer lane's job.
- **One commit per surface, in the order `backend` → `frontend` → `compose` → `e2e` → `ci` → `design-tokens`.** Subject is `chore(scaffold): <surface> — <short detail>` in Conventional Commits format. Never bundle, never reorder, never use `feat:`.
- **The boot check is mandatory and non-negotiable.** Compose must bring the stack up locally before e2e lands; if it doesn't, STOP and surface — do not mutate templates to mask the failure.
- **CI is scaffold-time validation only.** The pipeline produced at step 9 runs lint/type/format/test, builds images locally, and runs e2e against compose. It MUST NOT push images, assume an OIDC role, reference a registry, or deploy. Deploy pipelines, environment gates, and tag-driven promotion are the `sre` agent's lane — surface and STOP if the user asks scaffold to add any of those.
- **CI checks are single-sourced; the pre-push hook is mandatory.** Each per-stack check job runs `bash scripts/ci-checks.sh`, and the committed `.githooks/pre-push` (wired with `git config core.hooksPath .githooks`) runs that *same* script for every touched stack. Never inline the check commands into the workflow — that reintroduces the drift this exists to kill. The hook must be materialized and wired at step 9; record the one-time `git config core.hooksPath .githooks` in the README so every clone enables it.
- **The design system is consumed, not generated.** Scaffold never invokes a UI/UX skill and never authors `docs/design-system/`. The system is locked upstream by `design-lead` and committed by `design-writer` during `/deep-dive-feature` (the `## Design taste` section of `CLAUDE.md` is written there too). At step 10 scaffold asserts `docs/design-system/tokens.md` and `surfaces.md` exist and **fails loudly** if either is absent — it does not invent tokens or fall back to generating a design system. Step 11 only seeds the locked `tokens.md` into `frontend/src/styles/tokens.css` and imports it at boot.
- **The skill ends with a draft PR.** Push the branch and open a draft PR via `gh pr create --draft` so the scaffold-time CI fires on first commit. Do not merge; do not flip the PR to ready; do not switch back to `main`; do not delete the branch.
