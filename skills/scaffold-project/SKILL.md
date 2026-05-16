---
name: scaffold-project
description: "Bring a worktree from empty (or partially-empty) to a bootable stack — backend process starts and exposes its framework-metadata endpoint, frontend process starts and serves the default page, every deployable surface has a buildable Dockerfile, a top-level `docker-compose.yaml` brings up all services the ADR declares, and an `e2e/tests/smoke.spec.ts` drives the served frontend through one visibility assertion. Reads `docs/ADRs/` to pick stack variants and topology; never reads `docs/PRDs/<feature>/api-contracts/` or `data-models/` (those are feature-time concerns). Materializes from per-stack templates under `templates/<stack>/`, fills in service names / image targets per the ADR, commits each surface as a discrete `chore(scaffold): <surface>` / `build: <surface>` commit on the architect's feature-lockin branch so the scaffold artifacts ship in the same lockin PR. Dispatched by the `architect` agent during `/deep-dive-feature` right after the ADR / implement-detail commit lands — that's the moment the ADR exists, the worktree on `docs/<feature-name>` is checked out, and the project is either greenfield (every surface flagged) or it's the first feature-lockin that needs structural pieces filled in. Idempotent: on later lockins the detector returns empty and the skill is a no-op. Do NOT activate to add feature endpoints, routes, pages, migrations, health-contract paths, router wiring, or cookie/auth knobs — those are feature work in `implement-feature-task`'s lane."
---

# scaffold-project

Take a worktree from empty (or partially-empty) to a stack that can boot end-to-end: backend reachable on its framework-metadata endpoint, frontend reachable on its default page, every Dockerfile builds, compose brings the whole topology up, and a Playwright smoke spec drives the served frontend. Nothing more. No feature endpoints, no routes, no migrations, no auth knobs, no contract-derived paths. Those land later, owned by `implement-feature-task` when a feature task brings them in.

The skill is dispatched by the `architect` agent during `/deep-dive-feature`, immediately after the ADR / implement-detail / data-models / api-contracts commit lands on the `docs/<feature-name>` branch. By that point the ADR exists (so the skill can read stack choices and topology), the worktree is on the lock-in branch (so scaffold commits ride the same feature-lockin PR), and the detector decides whether the work is greenfield (every surface flagged), partial fill-in (some surfaces flagged), or a no-op (already scaffolded — every subsequent lockin).

## When to activate

Activate this skill whenever:

- The `architect` agent reaches the post-artifact scaffold step in `/deep-dive-feature` (see `agents/architect.md`'s workflow and `commands/deep-dive-feature.md` Step 10) and the detector reports at least one flagged surface. This is the only routine entrypoint.
- The user types `/scaffold-project`, or phrases like 'scaffold the stack', 'bootstrap the worktree', 'set up the project skeleton', 'make compose bring everything up' — typically only useful as a manual rescue when an earlier lockin shipped without scaffold.

Do NOT activate when:

- The detector reports an empty surface list — the stack is already bootable, scaffold is a no-op.
- `implement-feature-task` or `author-e2e-tests` notices missing scaffold. Those skills are NOT dispatchers — they STOP and surface the gap so a human can re-run the lockin flow. Scaffold belongs to architect's lane; running it from inside a task lane bypasses the lockin PR's review of the structural pieces.
- The work the user wants is *feature* work — adding a health endpoint at a contract path, wiring React Router, adding a migrate service, adding cookie knobs. Those belong in `implement-feature-task` and the pattern skills it loads.
- `docs/ADRs/` is empty or doesn't declare a stack choice and a compose topology. Surface the gap to architect (or to the user, if invoked directly) and STOP — scaffold MUST NOT guess at frameworks or services.

## References

| Skill | When to route to it |
|-------|---------------------|
| `git-workflow` | For Conventional Commits subject format on every `chore(scaffold):` / `build:` commit produced here. **Required.** |

This skill does NOT load `tdd-workflow`, `security-patterns`, `database-patterns`, or any other pattern skill. Scaffold has no feature code to test, no secrets to handle, no schema to model. Those skills come in once `implement-feature-task` takes over.

## Templates

Each `templates/<variant>/` directory holds a working example that copies as-is into the worktree and produces a bootable surface. The skill picks the variant from the ADR's stack declaration.

| Asset | Purpose |
|-------|---------|
| `templates/python-fastapi/` | Backend variant: minimal `app/main.py` (`app = FastAPI()`), `pyproject.toml`, multi-stage `Dockerfile`. The booted container responds 200 on `GET /openapi.json`. |
| `templates/react-vite/` | Frontend variant: `index.html`, `main.tsx` rendering a placeholder, `package.json`, multi-stage `Dockerfile` (build → static-serve via nginx, non-root, writable pid path). The booted container responds 200 on `GET /`. |
| `templates/compose.yaml` | Topology skeleton: backend + frontend + db services, `${VAR:-default}` port indirection, named volumes. The skill fills in service names / image targets per the ADR. No migrate service — that comes when the first migration lands. |
| `templates/e2e/` | E2E variant: `package.json` (with `@playwright/test` and an `npm test` script), `playwright.config.ts` (env-overridable `baseURL`, `retries: 1` on CI, `workers: 1`), `tests/smoke.spec.ts` (`goto('/')` + one visibility assertion), `.gitignore`. |
| `templates/commit-messages.md` | Pointer to `git-workflow`'s Conventional Commits format. Subject is `<type>(<scope>): <subject>`. Scaffold-produced commits use `chore(scaffold): <surface>` or `build: <surface>`. |

## Scripts

Every detection step is factored into `scripts/`. Invoke each via `bash scripts/<name>.sh ...` (or directly — they are executable).

| Asset | Purpose |
|-------|---------|
| `scripts/check-scaffold-needed.sh` | Static (no live build / compose run) check of the worktree against each surface. Prints a JSON object `{"surfaces":["backend","compose","e2e"]}` listing surfaces that still need scaffolding. Exits 0 always; the caller reads the JSON. |

## Workflow

Inputs from the caller: nothing. The skill operates on the current working directory (the worktree the caller already `cd`'d into). The set of surfaces to scaffold is computed by running the detector script — the caller MAY also pass a pre-computed subset, but the skill always re-runs the detector to confirm before writing.

### 1. Confirm the ADR is in place

```bash
ls docs/ADRs/ 2>/dev/null | head
```

If `docs/ADRs/` is missing or empty, STOP and surface "no ADR found — scaffold needs the architect's stack/topology decisions before it can pick templates". Do not invent a stack.

Read every ADR file and extract:

- **Backend stack** — e.g. `python-fastapi`, `python-django`, `node-express`. Must match a directory under `templates/<stack>/`. If no matching template exists, STOP and surface "no scaffold template for stack <name> — add one under templates/ or revise the ADR".
- **Frontend stack** — e.g. `react-vite`, `react-next`. Same rule.
- **Compose topology** — the list of services the product needs (e.g. `backend`, `frontend`, `db`). Service names and image references in the rendered `compose.yaml` come from here.

### 2. Run the detector

```bash
bash scripts/check-scaffold-needed.sh
```

Read the JSON; the `surfaces` array is the work list. If empty, exit — the worktree is already bootable.

### 3. Scaffold each flagged surface

For each surface in the work list, in this order (so later surfaces can reference earlier ones):

1. **`backend`** — copy `templates/<backend-stack>/` into the worktree's backend directory (per the ADR's layout; default `backend/`). Do not edit the framework entry to add routes, middleware, or settings logic — the template ships a bare `app = FastAPI()` (or equivalent) intentionally. Commit:

   ```bash
   git add backend/
   git commit -m "chore(scaffold): backend (<stack>) — framework entry, manifests, Dockerfile"
   ```

2. **`frontend`** — copy `templates/<frontend-stack>/` into the worktree's frontend directory (default `frontend/`). Do not add router wiring, components, or pages beyond the template's placeholder. Commit:

   ```bash
   git add frontend/
   git commit -m "chore(scaffold): frontend (<stack>) — entry, manifests, Dockerfile"
   ```

3. **`compose`** — copy `templates/compose.yaml` to the worktree root. Fill in service names and `image:` / `build:` targets per the ADR's topology. Use `${VAR:-default}` indirection on every host-exposed port. Do not add a `migrate` service unless the ADR explicitly says migrations are bootstrapped at scaffold time — by default migrations come in with the first migration via `database-patterns` guidance. Commit:

   ```bash
   git add compose.yaml
   git commit -m "chore(scaffold): compose topology (<services>)"
   ```

4. **`e2e`** — copy `templates/e2e/` to the worktree's `e2e/` directory. Run `npm install` inside `e2e/` so `package-lock.json` is produced; commit the lockfile alongside the manifest. Do not author task specs here — only the smoke spec lands. Commit:

   ```bash
   git add e2e/
   git commit -m "chore(scaffold): e2e (playwright + smoke spec)"
   ```

Each commit is its own surface. Never bundle two surfaces into one commit. Never bundle scaffold work into a `feat:` commit.

### 4. Hand back to the caller

This skill is terminal at the end of step 3. Do not push, do not open a PR — the caller (`architect`, mid-lockin) resumes from its workflow and either reports the new commits to the orchestrator or moves on to the next step. The orchestrator's later push of `docs/<feature-name>` and the `feature-lockin` PR carries the scaffold commits to remote.

## Iron rules

- **Scaffold is feature-agnostic.** Never read `docs/PRDs/<feature>/api-contracts/` or `docs/PRDs/<feature>/data-models/`. The only doc surface this skill consults is `docs/ADRs/`.
- **Scaffold materializes templates; it does not author code.** No routes beyond what the template ships (which is none). No components / pages beyond the placeholder. No middleware, no settings logic, no auth, no migrations, no router. If the next step needs any of those, that's `implement-feature-task`'s job using its pattern skills.
- **No defaulted URIs, service names, ports, or framework choices.** Stack variants come from the ADR (`python-fastapi` vs `python-django` etc.). Compose service names come from the ADR's topology. If the ADR doesn't say, STOP and surface — never guess.
- **No live builds in the detector.** `scripts/check-scaffold-needed.sh` is static-only (file existence + presence of framework instances). Live `docker build` / `docker compose up` validation belongs to the smoke spec running in CI, not to scaffold.
- **One commit per surface, in the order `backend` → `frontend` → `compose` → `e2e`.** Subject is `chore(scaffold): <surface> — <short detail>` (per `git-workflow`'s Conventional Commits). Never bundle, never reorder, never use `feat:`.
- **Skip surfaces that aren't flagged.** Re-running scaffold on a worktree where the detector reports an empty surface list is a no-op — the skill exits without commits.
- **Terminal on success.** After the last surface commit, the skill returns to the caller. It does not push, does not open a PR, does not author tests.
