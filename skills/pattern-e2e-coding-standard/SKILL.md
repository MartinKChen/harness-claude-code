---
name: pattern-e2e-coding-standard
description: "E2E coding standard. Contract is iron on two axes. SEEDING: via API (Playwright `request` fixture, raw HTTP) respect `docs/api-contract/<entity>.yaml` — path, verb, status codes, request/response body; direct-to-DB (SQL fixtures, ORM helpers, factory scripts) respect `docs/data-model/<entity>.yaml` — table, column types, constraints, defaults, FKs. DRIVING/ASSERTING: respect `docs/ui-contract/<screen>.yaml` — query by the declared role + accessible name, scoped to the declared regions, and assert on the declared outcome states. Halt on missing/contradictory contracts; never invent shape or selectors. Activate on any E2E spec / fixture / seed helper."
---

# pattern-e2e-coding-standard

## When to activate

Activate when authoring, extending, or fixing Playwright E2E specs and their supporting fixtures / seed helpers. Specifically:

- Editing `.spec.ts` / `.spec.tsx` files under the E2E test root.
- Editing any fixture, factory, or seed helper used by E2E specs (e.g. `playwright/fixtures/*`, `playwright/seed/*`, `e2e/support/*`).
- Designing the data shape a test will arrive at — whether via the UI, via the Playwright `request` fixture, or via direct DB seeding.
- Driving a surface or asserting an outcome through the rendered UI — the locators and outcome assertions are bound by `docs/ui-contract/<screen>.yaml` (see "Drive and assert through the UI interaction contract").

Skip for production code (engineer's lane) and for backend / frontend unit / integration tests inside the service packages.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-e2e-coding-standard.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Contract is iron (non-negotiable)

Published contracts decide the shape of seeded data. The E2E spec conforms to the contract, never the reverse. The **contract** = whichever of these apply to the seeding path:

- **API seeding** — when the spec (or its fixture) creates state by calling backend HTTP endpoints (Playwright's `request` fixture, raw `fetch`, etc.): `docs/api-contract/<entity>.yaml` is binding. Path (including trailing-slash spelling), HTTP verb, request body schema (field names, casing, types, required vs optional, enums), response body schema, expected status codes per outcome, error envelope shape + `code` values, `Idempotency-Key` policy, and rate-limit budget all apply exactly as published.
- **Direct DB seeding** — when the spec (or its fixture) creates state by writing rows directly to the database (SQL inserts, ORM helpers, factory scripts, fixtures loaded via `psql` / `pg-promise` / `prisma db seed` / `alembic` data migrations): `docs/data-model/<entity>.yaml` is binding. Table / collection names, column names + types, NOT NULL / UNIQUE / CHECK constraints, default values, foreign keys, and required indexes all apply exactly as published.

Rules:

- **Seed against the contract verbatim.** Match names, shapes, status codes, types, and constraints exactly — including spelling, casing, and trailing-slash conventions. If the API contract says `POST /api/v1/groups/` returns `201` with `{ id, name, created_at }`, the seed helper sends `POST /api/v1/groups/` (with the trailing slash) and reads `id`/`name`/`created_at` from the response — not `groupId`, not `groupName`, not `createdOn`.
- **Halt and surface on ambiguity.** If the contract is missing for the entity / endpoint the spec needs to seed, or is internally contradictory, or contradicts what the production code actually does — stop and surface a diagnostic. Do not guess a payload shape to keep moving.
- **Disagreement is a question, not an invented payload.** If the contract looks wrong for the test scenario, open a question on the task. Never silently send a payload that contradicts the published contract just to make the test pass.
- **Seeded data may be stricter than the contract, never looser.** A contract-declared `max_length: 100` field may be seeded with shorter values; it may not be seeded with longer ones, even if production code happens to accept it today.
- **No invented endpoints, fields, error codes, or columns.** If the contract doesn't declare it, the spec does not seed it.
- **Pick the right contract for the seeding path.** API-level seeding reads `docs/api-contract/`; DB-level seeding reads `docs/data-model/`. Cross-checking is fine (and encouraged when the entity touches both), but the binding contract is the one that matches the wire the seed actually crosses.

This rule overrides any local convention the spec might otherwise inherit. Specs conform to the published contract, never the reverse.

### Drive and assert through the UI interaction contract (non-negotiable)

Where the seeding contract governs the shape of *seeded data*, `docs/ui-contract/<screen>.yaml` governs the *interaction surface* — how the spec drives the page and what outcome it asserts on. It is the UI analogue of `api-contract`: the frontend guarantees the declared semantic interface, and the spec queries/asserts against **that interface**, never against whatever DOM the engineer happened to emit. One file per routed surface (1:1 with `docs/design-system/surfaces.md`), plus reused cross-screen components. This is what makes the selector discipline elsewhere in this skill (`getByRole` over `data-testid`, region scoping) **contract-backed** rather than convention-backed — the contract is the published source the spec conforms to.

- **Query by the contract's declared `role` + accessible `name`, scoped to the declared `regions`.** For every control or region the spec drives or reads, use the role + name the contract publishes (`page.getByRole("main", { name: "Article editor" }).getByRole("button", { name: "Publish" })`). Names are binding exactly as published — casing and wording included — the same way an api-contract field name is.
- **Assert on the contract's declared `states`.** A spec's outcome assertion targets a state the contract declares — the `status` / `alert` role+name, a `field_errors` message, the `redirects_to` route. The contract's `states` block is the published list of what's assertable on that surface.
- **Halt and surface on a missing/contradictory contract.** If the surface the spec drives has no `docs/ui-contract/*.yaml`, or its declared interface contradicts what the page renders, stop and surface a diagnostic — identical discipline to a missing api-contract. Do NOT reverse-engineer a selector from the live DOM to keep moving.
- **No invented roles, names, or states — extension is the owner's job.** If the contract doesn't declare a control, the spec doesn't query it; if it doesn't declare a state, the spec doesn't assert it. When the behavior under test needs an element/state the contract lacks, that's a contract gap (`design-lead` owns the skeleton; the owning slice's engineer extends `states`) — surface it as a question, don't paper over it with an off-contract locator.
- **`data-testid` only where the contract sanctions it.** A `getByTestId(...)` selector is legal only for an element the contract lists under `test_ids` (with its stated reason). Everywhere else role + accessible name is mandatory — the chrome/region helper rules below inherit this floor.

### An E2E asserts user-visible state only — never backend internals

An E2E spec proves a **user-visible, cross-surface** result through the live stack — a rendered balance, a status badge, a landing URL, a row appearing in a list. It is the most expensive and most brittle layer, so it asserts only what the user can see, and only for behavior on a journey worth walking.

- **Assert user-visible state, never backend internals through the UI.** A ledger delta, a token's `used_at`, an outbox-row enqueue, "the row was written in the same transaction", a `4xx`/`429` code, "no row created" — these are **backend invariants** owned by the backend-integration layer and proven by an API-level test against real Postgres. Do NOT reach for them through the browser (querying the DB mid-spec, asserting an internal counter, decoding a response envelope the user never sees). If you find yourself wanting to assert a backend internal in an E2E spec, it belongs at the backend layer instead — flag it.
- **Not every AC maps to an E2E assertion.** A slice's ACs fan across owning layers; only the *user-visible cross-surface* clauses land in an E2E spec. A backend-only AC has no E2E assertion at all (and a backend-only slice has no E2E spec). Walking every AC through the UI is the layering error this standard exists to prevent — it produces brittle specs that re-prove what an endpoint test already proves.
- **The seam between mock and real stays at the contract layer.** Where a non-happy-path envelope (e.g. a `409 OVERLAP` body shape) must be verified, that is a contract test / schema-generated client concern — not a branch to enumerate in the single golden-path E2E walk.

### Pick the seeding path deliberately

Default order of preference for setting up E2E state, from most realistic to most invasive:

1. **Drive through the UI** — same critical path the user walks. Highest fidelity; use whenever the precondition is one of the test's own user-facing prerequisites (e.g. "log in", "create the first group").
2. **API seeding via the Playwright `request` fixture** — when UI setup would balloon test length without adding coverage value (e.g. seeding 30 historical records before testing pagination). Honors backend validation, authz, side-effects, and the API contract end-to-end.
3. **Direct DB seeding** — last resort, only when the API genuinely cannot express the precondition (e.g. backfilling a column added in a migration, simulating a partial / corrupted state that the API refuses to produce). Bypasses backend invariants, so use sparingly and always document why API seeding wasn't sufficient in a one-line comment on the seed call.

Never mix: a single precondition is seeded through exactly one path. Don't `INSERT` a row and then `PATCH` it via the API to "round out the state" — pick one and stick to it.

### API seeding — patterns

- Read `docs/api-contract/<entity>.yaml` BEFORE writing the seed call. Identify: path, verb, required request fields, response shape, success status code, the auth header it requires, and any `Idempotency-Key` requirement.
- Use Playwright's `request` fixture (or `request.newContext()` for a fresh context). Never hand-roll `fetch` inside a spec when the fixture is available — the fixture honors base URL config and cookie state.
- Assert the response status matches the contract's success code before reading the body. A `request.post(...)` that returns `500` should fail the seed loudly, not be ignored.
- Read response IDs / timestamps from the response body; don't guess them. A test that hard-codes `id: 1` because "the DB is empty" will break the moment another test runs first.
- Mirror the contract's casing exactly in the request body (snake_case vs camelCase is contract-defined, not stylistic).
- When the contract requires `Idempotency-Key`, generate a fresh UUID per seed call. Reusing one across retries silently no-ops the second call.

### Direct DB seeding — patterns

- Read `docs/data-model/<entity>.yaml` BEFORE writing the insert. Identify: table name, every NOT NULL column (must be set explicitly), default values (skip in the insert to use the default), FK columns (must reference an existing row), and any UNIQUE / CHECK constraint that the seed values must satisfy.
- Insert in FK dependency order: parents first, children second. If `posts.user_id` references `users.id`, seed the user before the post.
- Use the canonical client / helper the project ships (e.g. a `pg-promise` connection, a SQLAlchemy session, a Prisma `prisma.user.create({...})` call). Don't open ad-hoc connections from the spec — re-use the configured client so connection strings and transactions stay consistent.
- Wrap related inserts in a transaction so a partial failure rolls back cleanly. A spec that leaves a half-seeded `user` row makes downstream tests non-deterministic.
- Set timestamps explicitly when the data model declares them NOT NULL with no default. Don't rely on DB-side `now()` defaults if the model says the column is not nullable AND has no default — that's a contract bug to surface, not to paper over.
- Always isolate seeded data per test (unique slugs / emails / IDs) so concurrent specs don't collide on UNIQUE constraints. A test that hard-codes `email: "test@example.com"` will fight every other test that does the same. **Derive that uniqueness from an opaque token (a random suffix / run id), never from the semantic keyword under test** — see "Scope assertions, and keep isolation tokens out of assertion text" below; a `user-archived@…` seed that the spec then asserts with `/archived/i` collides with itself.
- Clean up after the spec (transaction rollback in a fixture teardown, or explicit delete) unless the harness already truncates between tests.

### Route shared global-chrome interactions through one helper (biggest maintenance lever)

The **global chrome** is the persistent app shell every authed flow walks through: the top nav / banner, the sidebar, the user menu, the logout control, and the authed-state indicators (signed-in email, avatar, org switcher). It is the single most cross-cutting surface in the suite — nearly every spec across every slice touches it — so a copy-pasted chrome locator is the highest-leverage duplication to eliminate.

Rules:

- **One module owns chrome.** Every chrome interaction or assertion that more than one spec needs lives in a single shared helper module under the E2E test root (e.g. `e2e/helpers/chrome.ts`), exported as named, intention-revealing functions: `await logout(page)`, `await expectAuthedChrome(page, email)`, `await openUserMenu(page)`. Specs call the helper; they never re-derive the chrome locator chain inline.
- **Extract on the second copy, not the fourth.** The moment a chrome interaction (`getByRole("banner")…logout`, the authed-header assertion, etc.) appears in a *second* spec, lift it into the helper. Don't let it propagate.
- **Why this is the biggest lever.** A chrome locator copy-pasted across N specs means a single shell change (logout button relabeled, user menu restructured, banner role changed) breaks all N specs independently, each fixed in a separate place. Centralized, the same change is one function edit — every downstream spec across every slice goes green again. This converts an N-spec ripple into a 1-edit fix.
- **Helper owns chrome mechanics, not feature assertions.** The helper encapsulates the chrome locator + action (and chrome-state assertions like "the header shows this email"). Feature-specific, page-body interactions and assertions stay in the spec (or a page-scoped helper) — don't collapse everything into one god-helper that every spec depends on for unrelated reasons.
- **Semantic selectors still apply inside the helper.** Centralizing the locator doesn't waive the selector discipline — `getByRole` / `getByLabel` / `getByText` over `data-testid` lives in the helper, justified in writing where a fallback is unavoidable.

### Scope assertions, and keep isolation tokens out of assertion text (biggest false-collision lever)

A page-wide matcher (`page.getByText(/…/)`, `page.getByRole(…, { name: /…/ })`) sweeps the **entire DOM** — which on every authed page includes the persistent global chrome (the signed-in user's email / display name) and every off-region widget (dropdown `<option>` lists, side panels, toasts) that happens to render seeded entity names. A loose regex run page-wide therefore matches strings the test never meant to touch — either failing on a strict-mode violation (two matches) or, worse, passing against the *wrong* element. This is the single most common reason an authored spec has to be rewritten at E2E-validation time, so author against it up front.

Two failure modes, both avoidable:

- **Unscoped match.** `page.getByText(/archived/i)` hits the status badge you meant *and* an "Archived Projects" option in a filter dropdown *and* the signed-in `user-archived@…` in the nav.
- **Isolation token == assertion target.** The per-test uniqueness rule (above) tempts you to bake the scenario's keyword into the seed identity (e.g. `archived`, `pending`), so the unique token *is* the string the assertion hunts for — and it leaks into the chrome and every dropdown, colliding with itself.

Rules:

- **Resolve the region before you assert; never assert feature content page-wide.** Anchor to the smallest stable container first — `page.getByRole("main")`, `page.getByRole("dialog")`, the specific `page.getByRole("table")`, a single `page.getByRole("row", { name: … })` — then locate *within* it: `await expect(main.getByText(/archived/i)).toBeVisible()`. The chrome and off-region widgets are outside that region by construction, so they can't collide.
- **Assert on the feature's rendered output, not a keyword sweep.** Prefer the user-visible artifact the feature produces — a status badge with accessible name `Archived`, a named alert/banner, a row's state cell (`row.getByText(/^archived$/i)` anchored `^…$`) — over a loose substring regex that any seeded name can satisfy.
- **Keep the seed-isolation token lexically disjoint from anything the spec asserts.** Make uniqueness opaque (`entity-${runId}`, `user+${runId}@example.com`); never reuse the scenario keyword as the token. The display name a dropdown renders, and the email the nav renders, must not contain the word your assertion looks for.
- **Treat the signed-in identity as a permanent page-wide collision source.** On any authed surface the chrome always renders the current user's email / name. Any page-wide `/…@example.com/` (or token-bearing) matcher will hit it — scope, or assert exact + anchored, every time.

### Asserting against external-service doubles

When a scenario's outcome lands in an external-service double (mail catcher, queue, object store, fake gateway), assert against the double — never assume its behavior:

- **A double has its own API semantics — never assume them.** Ordering, pagination, indexing lag, and eventual consistency of any emulator / sandbox follow its contract; verify against the double's *actual* behavior, not your expectation. Record the specific fact (e.g. a given mail catcher's result ordering) in the project's `.claude/memory/patterns/` overlay, not here.
- **Wait for the expected count, not merely "≥1".** When one scenario produces several artifacts in the same sink, polling "until at least one exists" returns a stale earlier artifact; wait for count ≥ N, then select the target.
- **One element per assertable locator.** A matcher that hits two elements is a strict-mode violation; use distinct copy or `data-testid`.

### Anti-patterns (flag and fix)

- **Invented payload fields.** Sending `{ "user_name": ... }` because it "looks right" when the contract says `{ "username": ... }`. → Read the contract; halt if missing.
- **Invented columns / tables.** `INSERT INTO accounts ...` when the data model only declares `users`. → Read the data model; halt if missing.
- **Off-contract locator.** Querying by a CSS class / DOM structure, or by a `role`+`name` the surface's `docs/ui-contract/*.yaml` doesn't declare. → Read the UI contract; query the declared role+name; halt (or request a contract extension) if the element isn't there.
- **Asserting an undeclared state.** Asserting on a toast / banner / redirect the surface's UI contract `states` block doesn't list. → The owning slice must extend the contract's `states` first; surface the gap, don't assert against an undocumented element.
- **Hard-coded IDs.** Asserting on `id: 1` instead of capturing it from the API response or the insert's returning clause.
- **Bypassing the API to dodge validation.** Direct DB insert with `status = 'verified'` because the API requires an email round-trip — only acceptable if explicitly documented and necessary; otherwise honor the API flow.
- **Shared mutable seed data across tests.** Hard-coded email / slug / name that two specs both insert. → Use per-test unique identifiers.
- **Silent failures.** Seed call returns 4xx / 5xx and the spec continues. → Always assert the status matches the contract.
- **Mixing seed paths for one precondition.** Half via API, half via DB. → Pick one path per precondition.
- **No FK / constraint awareness.** Inserting children before parents, or omitting NOT NULL columns. → Read the data model; insert in dependency order.
- **Copy-pasted chrome interactions.** The same `getByRole("banner")…logout` chain (or authed-header assertion) inlined in two-plus specs. → Lift it into the shared chrome helper (`logout(page)`, `expectAuthedChrome(page, email)`); a shell change must be a 1-edit fix, not an N-spec ripple.
- **Page-wide loose matcher.** `page.getByText(/archived/i)` that also matches the signed-in email in the nav or an entity name in a dropdown. → Scope to a region (`page.getByRole("main")`, a row, the dialog) and/or anchor exact (`/^archived$/i`).
- **Isolation token doubling as the assertion target.** Seeding `user-archived@…` / "Archived Co" and then asserting `/archived/i`. → Make the uniqueness token opaque (`+${runId}`); assert on the feature's rendered output, not the seed keyword.
