---
name: pattern-test-coverage
description: "Role-neutral catalogue of what makes a test set *complete* — the shared substance both the engineer (authoring tests in the TDD red phase) and the reviewer (gating the code) judge against. Every EARS criterion is discharged by the cheapest durable proof at its owning layer (backend / frontend / E2E); new code paths cover edge breadth. The spine is the deletable-code lens: complete only when deleting any single production branch makes a test fail. Activate when writing or reviewing tests."
---

# pattern-test-coverage

The single, role-neutral catalogue of **what counts as a complete test set** for a unit of work. "Complete" is the same fact whether you are *writing* the tests (the engineer, in the TDD red phase) or *judging* them (the reviewer, at the code gate) — a deletable branch is deletable from either chair, and an off-by-one boundary is missing whether you are authoring it or flagging its absence. This skill owns that shared substance so it lives in exactly one place.

What this skill does **not** own — the role-specific framing layered on top of it:

- **Authoring discipline** (write the test before the code, one behavior per RED, fakes at seams) — `principle-engineer-tdd`.
- **Detection, severity, and reporting** (every gap is HIGH and blocks the gate, the `file:line` finding shape, the `# Code Review` comment template) — `pattern-reviewer-test-coverage`.

Both of those skills reference this catalogue for the substance and add only their own verb.

## When to activate

- An engineer is **authoring or extending tests** for a behavior (every TDD RED step, every fix that adds coverage). Walk the catalogue and close every gap that applies before calling the behavior green.
- A reviewer is **judging the code gate** on any `type:backend` / `type:frontend` / `type:e2e` task or slice. Walk the catalogue to find gaps; `pattern-reviewer-test-coverage` then grades and reports them.
- A user asks "are the tests enough", "did we cover the acceptance criteria", "what edge cases am I missing".
- Do NOT use this as the security catalogue — security coverage has its own skill.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-test-coverage.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the catalogue below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

> This is the **one** overlay target for test-coverage *substance*. Because both the engineer and the reviewer load this skill, a rule the dreaming pass files here reaches the side that *makes* the miss (authoring) and the side that *catches* it (review) at once — which is the whole point of keeping the catalogue shared. Reviewer-*reporting* carve-outs (a finding shape that over-flags in this project) belong in the separate `pattern-reviewer-test-coverage` overlay, not here.

## An AC is *discharged at its owning layer* — not "tested"

An acceptance criterion is a **specification**, not a test. "Complete" does not mean *one test per AC at any layer* — it means each AC's SHALL/THEN clause is **discharged by the cheapest durable, faithful proof at its owning layer**, and a *compound* AC fans across layers (classify per clause, not per AC).

| Owning layer | The proof sits at… | Signals the clause belongs here |
|---|---|---|
| **Backend integration** | the HTTP endpoint (API test + real Postgres) or worker tick | ledger deltas by column, "same transaction", token state (`used_at`/`expires_at`), outbox enqueue, DB-constraint rejection, "no row created", `SKIP LOCKED` concurrency, rate-limit buckets, `4xx`/`429`, server-rendered (zero-JS) HTML |
| **Frontend only** | the rendered/routed tree (RTL, API mocked at `src/lib/api`) | "the UI shows…", hook guards (`enabled`), cache invalidation, idempotency-key rotation, error display from a stubbed status, layout/landmarks/a11y, derived display math |
| **True E2E** | the browser, through the live stack | the *user-visible* result that requires both layers wired together — a rendered balance/status reflecting a real mutation — earned by a *journey worth walking*, never by an AC merely spanning layers |

**Push each clause to the lowest layer that can prove it, and assert it once.** A ledger delta is asserted at backend integration — never re-asserted in a frontend test (which mocks it, proving nothing) or in E2E (slow, brittle). Violating this is the direct cause of selector-collision churn in E2E specs. The **frontend↔backend contract** is its own invariant the per-layer tests structurally can't see — pin it with a contract test / schema-generated client.

Usually the discharge is a test. Occasionally it's something else, still durable:

| Discharge mechanism | Example | Durable? |
|---|---|---|
| Automated test | most ACs | ✅ |
| DB constraint | "overlap impossible by construction" (`EXCLUDE`) | ✅ — but keep **one** test that the constraint *fires* (a migration can drop it) |
| Type system / compiler | exhaustive discriminated unions | ✅ |
| Manual / review | "looks aligned" | ❌ rots immediately — never discharge on its own |

A ticked AC checkbox is **never** discharge on its own.

## The spine: the deletable-code lens

Every rule below is an instance of one test: **could I delete a single line of the production code under test — a branch, a mutation, a derivation, a log call, a parameter — and keep the whole suite green?** If yes, that line is uncovered, however many tests "touch" the area. Before calling a behavior done (engineer) or covered (reviewer), name the line you could delete, then close it. **The completeness bar is this deletable-code lens, not one-test-per-AC** — the AC list is the coverage *checklist*; the tests are the coverage. Mapping is many-to-many: one AC may need several tests (boundary/error/concurrency); several ACs may be covered by one walk.

A test fails this lens when it:

- **pre-seeds the post-state** the production code is supposed to produce (e.g. sets `used_at` then asserts once, instead of a two-call round-trip);
- **mocks above the code under test** (mocking the typed api wrapper so the real request/parse helper never runs);
- **asserts a coarser proxy** (a 204/HTTP status standing in for a named structlog event; the `$argon2id$` prefix standing in for the work-factor params);
- **hand-builds the value the code should derive** (constructing the DTO with the expected field instead of driving the real parse/computation);
- **lacks the adversarial witness** (a `WHERE`-scoped delete tested with only the target row present; a branch with no input that enters it).

## Catalogue — what a complete test set covers

The spec is the **slice issue body** plus each task's checklist pointer. The slice body carries the `## Acceptance criteria (EARS)` block (AC1, AC2, …) — the single AC ceremony for the whole slice; there is no upfront slice-level Gherkin block. The Gherkin scenarios live **per task**: each `## Tasks` checklist entry carries its own `scenario:` Gherkin block (Given / When / Then) walked at that task's owning layer, plus the unit-spec pointer — a `backend` task points at `docs/api-contract/<entity>.yaml` (+ `docs/data-model/<entity>.yaml`, whose migration scenarios apply when it introduces an entity); an `e2e` / `frontend` task discharges the AC clause(s) it `covers:` via its own scenario; a contract-less utility task carries a one-line `done:` criterion. For `e2e` work the canonical scenario text is the e2e task's own Gherkin.

### 1. Acceptance-criteria coverage (every `type:*`)

For every AC in `## Acceptance criteria (EARS)`:

- **AC exercised** — a test whose description names the AC's behavior AND whose assertions check the `SHALL` / `MUST` / `THEN` clause. A test that merely brushes the area without asserting the clause is shallow coverage, not coverage.
- **No skipped sub-clause** — the `IF <condition>, THEN …` branch and any `And it SHOULD …` secondary observable in the same AC each need their own assertion; covering only the happy-path return value is shallow.
- **Right (owning) layer** — discharge each clause at its owning layer (table above), and only there. An HTTP-contract / ledger / token-state clause is proven through the request/response against real Postgres — **not** through the UI/E2E and not re-asserted in a frontend test; a "the UI shows…" clause is proven by rendering the component (API mocked), not by a backend test; a true cross-surface clause is proven by the browser walk. A compound AC splits: prove each clause at its layer, assert once.

### 2. Scenario coverage (every `type:*`)

For every `scenario:` Gherkin block a task carries: a test walks the full `Given → When → Then` **at that task's owning layer**. Given+When with no asserted Then (or a different Then than the spec) is a partial scenario. A backend task's `scenario:` is walked at the endpoint/worker (the ledger delta, the 409, "no row created"); a frontend task's at the rendered tree. Only a `type:e2e` task's scenario is walked through the UI: a Playwright spec drives the browser through the journey and asserts **user-visible** state. Not every task scenario is an E2E walk — a backend invariant's scenario is proven by an API-level test, and demanding it be re-walked through the UI is the layering error this catalogue exists to prevent.

### 3. Migration-scenario coverage (only when `### Migration scenarios (Gherkin)` is present)

Data-model work carries an upgrade and a downgrade scenario. The diff must include a migration test (e.g. `pytest-alembic`) that walks **both** directions. Beyond round-trip: every named schema artifact (FK / PK / unique index / CHECK constraint) is asserted **by its exact name** from the catalog (`pg_constraint` / `information_schema`) so a rename or a dropped `name=` fails a test; every CHECK gets a **negative-direction** test (insert a violating row, assert rejection); downgrade asserts the artifact/extension is actually removed.

### 4. Edge-case breadth (`type:backend` / `type:frontend`)

For each new code path (function, endpoint, hook, component), cover the edges that apply to its signature. A diff that ships only the happy path is under-covered even when every AC is exercised.

- **Boundary values** — empty string, empty array, zero, negative, max-int, very long strings, single-element collections. For any `min_length` / threshold / limit, assert the **off-by-one boundary** (`n−1` rejects, `n` accepts) — far-from-boundary values (`"short"` vs a 19-char string) leave a misconfigured bound green.
- **Defensive guards are live branches.** An `if X is None: raise …` / `assert X is not None` after a lookup (even one annotated "can't happen") is executable code — drive it by queuing the failing condition and asserting the mapped error.
- **Error paths** — every `throw` / `raise` / explicit error return has a test that triggers it and asserts the error shape (status, class, message contract); every new `else` / broad `except` / malformed-input path is entered.
- **Empty / null / undefined inputs** — nullable or optional inputs are exercised with `null` / `undefined` / missing field, including the empty-result branch of a list query and any `value ?? fallback` arm.
- **Concurrency / ordering** — a path that mutates shared state under a possible race (unique constraint, cache, balance) has a test that exercises overlapping calls or asserts the constraint that prevents the race.
- **Idempotency / single-use** — a promised-idempotent or single-use operation is tested as a **round-trip** (call twice; first mutates, second observes the guarantee), never as a pre-seeded post-state.
- **No-mutation invariants** — when a rejecting branch must NOT mutate, assert the row/state is unchanged after the call (not just the response code), and assert it for **every** rejecting branch, not one representative.
- **Authorization edges** — an endpoint/handler with an auth check has both an allowed-user test and a forbidden/anonymous test.
- **Special characters** — Unicode, emoji, SQL/HTML/script chars, RTL — where string inputs cross a trust boundary.

If a category genuinely doesn't apply (no string inputs → no special-char tests), say so out loud rather than silently skipping.

### 5. Named-observable assertions (every `type:*`)

When a clause names a *specific* observable, assert that exact artifact, not a stand-in:

- a **structlog event** → capture logs and assert the event name, `log_level`, and each named field (a status code does not cover a log SHALL);
- **crypto/hash parameters** → `extract_parameters(hash)` and assert `(t, m, p)`, not the family prefix or a bare `verify()`;
- an **exact TTL / expiry window** → assert the window, not just that the row exists;
- a **response-body field** → assert `resp.json()[...]`, not only a DB read or the status code;
- a **positive landing state** → assert the positive URL/region, not only the negative ("not on /login").

Do not hand-construct the value the production code is supposed to derive — drive the real source (mock `fetch` to emit the header; call the real service so the assignment runs) and assert the *extracted/derived* value plus its negative sub-branches. And avoid dead-capture: `assert call_args is not None` after `assert_called_once()`, or `expect(buildReturn().fn).not.toHaveBeenCalled()` on a freshly built fake never wired in, always pass and prove nothing.

### 6. Emitted-artifact correctness (output consumed by an external service)

Where a module emits an artifact handed to another service — a link/redirect/callback URL, a webhook payload, a signed object URL, a queue message — assert it against the **consuming** contract (the route table, the webhook spec, the vendor schema), not just the emitter's own literal. A self-asserting emitter test (`assert build_link() == "https://app/reset?token=..."`) blesses its own output; and when several emitters produce the same artifact, a wrong shape repeats across all of them undetected — assert each against the consumer.

### 7. E2E selector + assertion quality (`type:e2e`)

E2E test code is itself the implementation; the coverage question is the quality of its selectors and assertions.

- **Selectors** — semantic (`getByRole`, `getByLabel`, accessible name) over `data-testid` (justified inline only when no semantic anchor exists); brittle CSS-class / XPath selectors hide breakage. Scope and anchor row-state locators (`row.getByText(/^archived$/i)`) so they don't match incidental page chrome.
- **No page-wide false collision** — a feature assertion must be scoped to its region (`page.getByRole("main")` / a row / the dialog), never a page-wide loose `getByText(/…/)` that can also hit the signed-in identity in the nav chrome or an entity name in an off-region dropdown. A per-test seed-isolation token must be opaque (a random suffix), not the scenario keyword the assertion hunts for — `user-archived@…` seeded then asserted with `/archived/i` collides with itself in the chrome and dropdowns. Flag both as HIGH: they pass-but-wrong or fail on strict-mode, and surface only at validation time.
- **Assertions** — check user-visible state (text, role, URL), not raw HTTP responses or DOM internals; a `toHaveURL` must pin the exact surface, not a permissive prefix that matches list and detail alike; a required confirmation dialog is asserted visible, not merely handled; a state-*removal* is asserted in code, not left as a comment.
- **One critical-path flow per spec** — independent flows in one `test()` break failure isolation.

### 8. Strongest-discriminating-assertion (every `type:*`)

An assertion must fail for the most plausible *wrong* implementation, not merely for an absent one. A proxy that any related output satisfies (a category word, a status set, a substring) is not an assertion — it is the assertion-form of the deletable-code miss: the production branch could be wrong and the test stays green. This is the same dynamic as narrowing a regex one degree per round (`/scheduled|session/` → date → date-AND-phrase → word boundaries); write the maximally-discriminating assertion the first time so neither the author nor the gate has anything left to narrow.

Before finalizing each assertion, run the **adversary check** — name one wrong-but-plausible implementation and ask whether it would still pass:

- wrong email template that happens to contain "session" → bind to the template-specific phrase AND the exact session value (both necessary, not `A|B`);
- balance off by a round number (14 vs 4) → word-boundary-anchor the numeric;
- sibling row mutated by a broad `WHERE` → assert the sibling's surviving state, not just the target;
- 422 where the contract says 400 → pin the exact status + error slug (`VALIDATION_FAILED`), never `in (400, 422)`;
- redirect to `/sessions/{uuid}` instead of the list → anchor the URL to the surface (`/sessions(\?|$)`).

If any named adversary passes, tighten until it can't. Bind to a named observable (exact slug, exact id, exact value) over a category word, and prefer "both A and B must hold" when each alone is insufficient. (This is §5's named-observable rule pushed one step further: §5 says assert the exact artifact, this says make that assertion fail for the nearest wrong artifact too.)

## Role framing (pointers, not duplication)

- **Engineer (authoring).** Apply this catalogue as the red-phase completeness checklist: for each behavior you grow, before you call it green, walk §1–§8 for the parts that apply and write the test that would fail if the production line were deleted. See `principle-engineer-tdd`.
- **Reviewer (gating).** Apply this catalogue to find gaps, then grade and report them per `pattern-reviewer-test-coverage` (every coverage gap is HIGH and blocks the gate; cite the AC label + the test file; use the `# Code Review` comment shape).
