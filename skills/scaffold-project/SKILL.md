---
name: scaffold-project
description: "Bootstrap a greenfield project to a bootable stack. Reads `docs/architecture-decision-record/` for stack + topology, creates a scaffold branch, materializes backend, frontend, e2e, and `docker-compose.yaml` from templates, verifies the stack boots end-to-end, optionally invokes a UI/UX design skill and seeds its tokens into the frontend, then pushes and opens a PR. Activate on '/scaffold-project', 'scaffold the project'. Do NOT activate if any scaffold surface already exists."
---

# scaffold-project

Take a **greenfield** project from empty to a stack that boots end-to-end: backend reachable on its framework-metadata endpoint, frontend reachable on its default page, every Dockerfile builds, `docker compose up` brings the whole topology up, a Playwright smoke spec drives the served frontend, and — if the user opts in — a design system is authored by a UI/UX teammate and its tokens are seeded into the frontend. Each surface commits as it lands, and the run ends by pushing the branch and opening a PR.

No feature endpoints, no routes, no migrations, no auth knobs, no contract-derived paths. Those land later, when a feature task brings them in via the engineer lane.

## When to activate

Activate when:

- The user types `/scaffold-project`, or phrases like 'scaffold the project', 'bootstrap the worktree', 'set up the project skeleton', 'make compose bring everything up', 'kickoff the project skeleton'.

Do NOT activate when:

- The project already has any scaffolded surface (`backend/`, `frontend/`, `compose.yaml` / `docker-compose.yaml`, or `e2e/`) — this skill is **greenfield only**. Surface the gap and STOP; structural additions to an already-bootable project belong to the engineer lane.
- `docs/architecture-decision-record/` is empty or doesn't declare a stack choice and a compose topology — scaffold MUST NOT guess at frameworks or services. Surface the gap and STOP.
- The work the user wants is feature work — adding a health endpoint at a contract path, wiring React Router, adding cookie knobs. Those belong to the engineer lane.

## Scope

Scaffold has no feature code to test, no secrets to handle, no schema to model, and no migrations to ship. Those concerns are out of scope and are picked up once the engineer lane takes over. The design-system step is structural too: tokens land as CSS custom properties consumable by the frontend, not as production components.

## Templates

Each `templates/<variant>/` directory holds a working example that copies as-is into the project and produces a bootable surface. The skill picks variants from the ADR's stack declaration.

| Asset | Purpose |
|-------|---------|
| `templates/python-fastapi/` | Backend variant: minimal `app/main.py` (`app = FastAPI()`), `pyproject.toml`, multi-stage `Dockerfile`. The booted container responds 200 on `GET /openapi.json`. |
| `templates/react-vite/` | Frontend variant: `index.html`, `main.tsx` rendering a placeholder, `package.json` (with `lint` / `format` scripts), `biome.json` (lint + format + import-organize config), multi-stage `Dockerfile` (build → static-serve via nginx, non-root, writable pid path). The booted container responds 200 on `GET /`. |
| `templates/compose.yaml` | Topology skeleton: backend + frontend + db services, `${VAR:-default}` port indirection, named volumes. The skill fills in service names / image targets per the ADR. No `migrate` service — that comes when the first migration lands. |
| `templates/e2e/` | E2E variant: `package.json` (`@playwright/test` + `npm test`), `playwright.config.ts` (env-overridable `baseURL`, `retries: 1` on CI, `workers: 1`), `tests/smoke.spec.ts` (`goto('/')` + one visibility assertion), `.gitignore`. |
| `templates/ci/pr-validation.yml` | Minimal PR-validation pipeline. Triggers on `pull_request` (incl. draft open / `ready_for_review`). Jobs: per-stack lint/type/format/test (`backend-checks` via ruff + mypy; `frontend-checks` via `biome ci` + tsc), per-stack docker image build (`backend-build`, `frontend-build`), then `e2e` against `docker compose up --build`. Backend / frontend job blocks are delimited by `# ---- BEGIN <surface> ----` / `# ---- END <surface> ----` so the skill can remove a block when the ADR omits that surface. |
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

Copy `templates/<backend-stack>/` into `backend/` (per the ADR's layout). Do not edit the framework entry to add routes, middleware, or settings logic — the template ships a bare `app = FastAPI()` (or equivalent) intentionally.

```bash
git add backend/
git commit -m "chore(scaffold): backend (<stack>) — framework entry, manifests, Dockerfile"
```

### 5. Scaffold frontend → commit

Copy `templates/<frontend-stack>/` into `frontend/`. Do not add router wiring, components, or pages beyond the template's placeholder.

```bash
git add frontend/
git commit -m "chore(scaffold): frontend (<stack>) — entry, manifests, Dockerfile"
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

### 9. Scaffold CI pipeline → commit

Materialize a minimal PR-validation pipeline so the draft PR opened at step 13 has CI signal from the first commit. Copy `templates/ci/pr-validation.yml` to `.github/workflows/pr-validation.yml`. The workflow triggers on `pull_request` (`opened`, `synchronize`, `reopened`, `ready_for_review`) — both draft and ready PRs run.

Shape the rendered file to the surfaces that landed:

- **Backend present** (per the ADR): leave the `# ---- BEGIN backend ... ---- END backend ----` block in place. The template's commands assume `python-fastapi`; if the ADR's backend stack differs, surface and STOP — a CI variant for that stack must be added to the template first.
- **Backend absent**: delete the entire backend block and remove `backend-build` from the `e2e` job's `needs:` list.
- **Frontend present** (per the ADR): leave the `# ---- BEGIN frontend ... ---- END frontend ----` block in place. The template's commands assume `react-vite`; if the ADR's frontend stack differs, surface and STOP.
- **Frontend absent**: delete the entire frontend block, remove `frontend-build` from the `e2e` job's `needs:` list, and drop the `BASE_URL` / `FRONTEND_PORT` env wiring and the "Wait for frontend" step.

Do not add deploy jobs, registry pushes, OIDC role assumptions, or environment gates — those belong to the `sre` agent's lane, not to a scaffold-time validation pipeline. Do not add `paths:` filters that skip e2e — the e2e job is the only signal that the system composes correctly.

```bash
git add .github/workflows/pr-validation.yml
git commit -m "chore(scaffold): ci (pr-validation pipeline)"
```

### 10. Offer the design-system step

The frontend currently ships with no opinion on visual language. Discover available UI/UX design skills at runtime — scan the `Skill` tool's available skill list for any skill whose name or description matches `ui`, `ux`, or `design` (e.g. `ui-ux-pro-max:ui-ux-pro-max`). Then ask the user — once, with `AskUserQuestion` — whether to bring in a design skill to author a design system before the PR opens, listing the discovered skills as options plus a "skip" option.

If the user **declines / skips**: jump to step 13.

If no design skill is available: surface "no UI/UX design skill is installed — skipping the design-system step", then jump to step 13.

If the user **picks a skill**: continue to step 11.

### 11. Invoke the selected design skill

Invoke the picked design skill via the `Skill` tool and let it drive the conversation with the user. The dispatched skill owns the interview and the design artifacts under `docs/design-system/` (typically `overview.md`, `tokens.md`, `components.md`, `accessibility.md`, and sample pages). This skill MUST NOT interrupt or batch on top of those questions — wait for the design skill to return.

If the design skill does not produce a `docs/design-system/tokens.md` (or equivalent token source), surface that the design output is missing and jump to step 13 — do not invent tokens.

### 12. Seed design tokens into the frontend + record design taste in CLAUDE.md → commit

Once `docs/design-system/tokens.md` exists, do all three of:

1. Write `frontend/src/styles/tokens.css` with one `:root { --<token-name>: <value>; ... }` block. Each property's name MUST match the token name in `tokens.md` (e.g. `color/brand/500` → `--color-brand-500`). Every color, font, spacing, radius, shadow, and motion token in `tokens.md` MUST appear here.
2. Add `import './styles/tokens.css';` to `frontend/src/main.tsx` (or the entry file the chosen frontend stack uses) so the tokens are loaded at boot. Do not author components, pages, or further styling — the seam stops at "tokens are reachable from production code".
3. Update `CLAUDE.md` at the repo root with a `## Design taste` section so future agents working on the frontend inherit the same visual intent without re-reading every artifact. Append the section if `CLAUDE.md` already exists; create the file with just this section if it does not. The section MUST contain:
   - **A verbose, evocative description of the design taste** — multiple sentences (not bullets, not a single tagline) that name the style family (e.g. "minimalist with a hint of brutalism", "glassmorphism over a dark canvas", "warm editorial with generous whitespace"), the emotional register (calm / energetic / serious / playful), the color philosophy (dominant hues, accent role, contrast posture), the typography character (display vs. body voice, weight contrast, scale rhythm), the spatial rhythm (density, breathing room, alignment posture), the motion philosophy (snappy / soft / restrained / expressive), and the interaction principles (affordance style, focus treatment, feedback timing). Draw the wording verbatim where possible from `docs/design-system/overview.md`; do NOT summarize so tightly that the taste becomes generic. A reader who has never opened the design-system docs should be able to feel the product's voice from this section alone.
   - **Reference paths** pointing to where the canonical design system lives so agents know where to deepen their understanding: `docs/design-system/overview.md` (taste + style rationale), `docs/design-system/tokens.md` (source-of-truth tokens), `docs/design-system/components.md` (component patterns) and `docs/design-system/accessibility.md` (a11y posture) if present, plus `frontend/src/styles/tokens.css` (the CSS custom properties the tokens compile to). Each reference MUST be a backticked relative path on its own line under a `### References` sub-heading so it's machine-greppable.

Commit all three together:

```bash
git add frontend/src/styles/tokens.css frontend/src/main.tsx CLAUDE.md
git commit -m "chore(scaffold): seed design tokens into frontend and record design taste in CLAUDE.md"
```

### 13. Push branch and open the draft PR

```bash
git push -u origin chore/scaffold-project
```

Then open the PR as a **draft** with `gh pr create --draft`, so the CI workflow scaffolded at step 9 fires on draft open and the user gets first-commit signal before the PR flips to ready. Title: `chore(scaffold): bootstrap project skeleton`. Body lists the surfaces that landed (backend stack, frontend stack, compose services, e2e smoke, CI pipeline), a one-line confirmation that `docker compose up` reached 200 on every framework-metadata endpoint locally, and — if step 12 ran — the design-system entry-point files (`docs/design-system/overview.md`, `frontend/src/styles/tokens.css`) plus the `## Design taste` section appended to `CLAUDE.md`.

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
- Design system: <yes — `docs/design-system/` + seeded `frontend/src/styles/tokens.css` + `## Design taste` section appended to `CLAUDE.md` | not included>

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
- **One commit per surface, in the order `backend` → `frontend` → `compose` → `e2e` → `ci` → `design-tokens` (if any).** Subject is `chore(scaffold): <surface> — <short detail>` in Conventional Commits format. Never bundle, never reorder, never use `feat:`.
- **The boot check is mandatory and non-negotiable.** Compose must bring the stack up locally before e2e lands; if it doesn't, STOP and surface — do not mutate templates to mask the failure.
- **CI is scaffold-time validation only.** The pipeline produced at step 9 runs lint/type/format/test, builds images locally, and runs e2e against compose. It MUST NOT push images, assume an OIDC role, reference a registry, or deploy. Deploy pipelines, environment gates, and tag-driven promotion are the `sre` agent's lane — surface and STOP if the user asks scaffold to add any of those.
- **The design-system step is opt-in.** Always ask; never default to "yes" or "no". If the user opts in, the dispatched teammate owns the interview and the design artifacts — this skill only seeds the resulting tokens into the frontend afterwards and records a verbose `## Design taste` section plus reference paths into `CLAUDE.md` so future agents inherit the visual intent. The taste section must be evocative, not a one-liner; the reference paths must be machine-greppable backticked relative paths.
- **The skill ends with a draft PR.** Push the branch and open a draft PR via `gh pr create --draft` so the scaffold-time CI fires on first commit. Do not merge; do not flip the PR to ready; do not switch back to `main`; do not delete the branch.
