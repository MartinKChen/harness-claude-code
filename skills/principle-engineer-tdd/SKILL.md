---
name: principle-engineer-tdd
description: "Strictly enforce outside-in TDD on every implementation task. Acceptance test first from the issue's EARS/Gherkin scenarios; modules grown via one-behavior RED → GREEN → REFACTOR loops with fake adapters at seams; real adapters earn contract tests; wiring proved by the acceptance test going green. Each step is its own commit per the caller's commit-message template. Encodes scaffold-vs-production boundaries, mandatory edge-case coverage, banned test anti-patterns, and the iron rules."
---

# principle-engineer-tdd

Drive every implementation outside-in with TDD. The acceptance test from the GitHub issue under work is the goalpost; modules are grown inward with one-behavior red/green/refactor loops; real adapters earn their own contract tests; wiring is proven by the acceptance test going green. Each red, green, and refactor step is its own commit, formatted per the dispatched caller's local `templates/commit-messages.md`.

## When to activate

Activate this skill whenever the user:

- Asks to implement, build, add, create, ship, develop, or code a feature, module, component, endpoint, handler, service, function, class, or behavior.
- References a GitHub issue (e.g. `#<n>`, an issue URL, or `gh issue view <n>`), or asks to "satisfy the issue" / "work on the next ticket".
- Says things like "let's implement X", "add support for Y", "build a feature for Z", "make this work", "ship the feature".
- Is about to write production code without a failing test in front of it — pause and start at the acceptance test instead.
- Is fixing a bug in production code — write the failing test that reproduces the bug first, then make it pass.

Do NOT activate when:

- The user is doing pure exploration, prototyping a throwaway spike, or asking conceptual/explanatory questions.
- The change is non-behavioral: formatting, comments, type-only renames, dependency bumps, or doc edits.
- The user has explicitly opted out of TDD for this task (rare — push back once before complying).

## Pattern application

Engineer and architect patterns are loaded at agent kickoff; apply each one whenever its surface comes up in a RED / GREEN / REFACTOR step (coding standard always; backend / frontend / language / framework patterns when those file types are touched; module-shape and API-endpoint guidance when defining a module's public interface or HTTP surface; data-model and database / migration guidance when a real adapter is a DB-backed store).

Commit-message format is owned by the **dispatched caller**, not this skill. Each RED / GREEN / REFACTOR / contract-test / wiring step is committed using the caller's `templates/commit-messages.md`. The cadence and subject conventions in the *Workflow* below are stable; only the surrounding format (trailers, scope rules) is read from the caller's template.

## Workflow

### "Outside" is relative to the unit under construction

Outside-in TDD ≠ "always start from a browser E2E." It means: start at the **outermost boundary of the thing you are building**, write a failing acceptance test *there*, then grow the inner modules with fast unit RED→GREEN→REFACTOR loops until the acceptance test goes green. The outer boundary depends on the task's **owning layer** (Principle 3 of `docs/test-layering-and-gates.md`):

- **Backend-only task** → "outside" is the **HTTP endpoint** (or the worker tick) — the acceptance test is an API test against real Postgres; inner loops are service unit tests with fake adapters at seams. A ledger delta / "same tx" / "no row created" clause is proven here, never through a browser.
- **Frontend-only task** → "outside" is the **rendered/routed tree** (RTL, API mocked at `src/lib/api`); inner loops are component/hook unit tests.
- **Cross-surface journey task** → "outside" is the **browser** (Playwright), through the live stack — and only this layer earns one.

```
OUTER loop (acceptance, at the unit's owning layer):  write RED ──────────────► GREEN
                                                       │  stays red across the work   │
INNER loop (unit):                                     │  R→G→R→G→R→G→R→G→R→G→R→G ...  │
                                                       └── many fast cycles build it ──┘
```

The acceptance test is **written first and is *supposed* to stay red** across the inner loops — a long-red outer test is the north star, not a violation. Writing it *after* implementation forfeits its function: it becomes a regression test asserting what the code happens to do, not what the spec demanded. **An after-the-fact acceptance test is a TDD-method violation even when the resulting file looks identical.**

### Two kinds of E2E: slice-segment vs critical-path

When the unit *is* a cross-surface journey, distinguish the two E2E tests (Principle 5 of `docs/test-layering-and-gates.md`) — conflating them is what makes multi-slice journeys feel impossible to test-first:

- **Slice-segment E2E** — owned by *this slice*, drives *this slice's* design, written **red-first within the slice** against already-merged-green upstream seeded via fixtures. This is where the TDD design pressure lives; it is an *implementation gate* for the slice.
- **Critical-path E2E** — owned by the *milestone*. Its journey **spec** (the frozen `## Journey (Gherkin)` golden path) is authored upfront and decides where the slice seams go, but the **executable full walk** is composed *late*, at milestone close, by stitching the slice-owned segments into one continuous walk against a single seed. It is an acceptance/integration **release gate**, not a per-slice TDD driver — do not try to author it upfront for UI that isn't designed yet (that is the AC-vs-test conflation one level up), and do not hold one monolithic test red across the whole milestone.

### Outside-in TDD loop

0. **Write the acceptance test first, at the unit's owning layer. This step is mandatory when the unit of work is a GitHub issue with Gherkin scenarios or EARS acceptance criteria — it is never optional.** Read the GitHub issue under work (e.g. `gh issue view <n>`) and extract the acceptance criteria from its body — typically EARS + Gherkin scenarios, plus the task's `covers:` AC clause(s) and `scenario:`. Write **one** failing acceptance/integration test at the task's owning layer (HTTP endpoint for backend, rendered tree for frontend, browser only for a cross-surface journey — see *"Outside" is relative to the unit*), derived from the mapped scenario. Run only that single test by name (see *Test scoping during the loop*). Confirm it is a valid RED (see *What counts as a valid RED*). Leave it red. Commit as `test(<feature>): add failing acceptance test for <behavior>` (formatted per the dispatched caller's `templates/commit-messages.md`). This is the goalpost. **Do not write any production code — no function body, no class, no route handler, no ORM model column — until this commit exists in `git log`.**

1. **For each module needed to satisfy the goalpost, run the inner loop.** Define the module's narrow public interface using deep-module discipline (interface narrow relative to the functionality it hides). Identify its seams — anything across a process/IO boundary (store, HTTP client, clock, queue, message bus). For each seam, build a fake adapter (`InMemoryTaskStore`, `FakeClock`, `RecordingHttpClient`). Then loop until the module's behavior is complete:

   - **a. RED.** Write ONE failing test against the module's interface for ONE behavior. Use the fake adapters at seams. Run only that single test by name (see *Test scoping during the loop*). Confirm it is a valid RED (see *What counts as a valid RED*). Commit: `test(<module>): add failing test for <behavior>`.
   - **b. GREEN.** Write the minimum implementation that makes the test pass. No speculative code, no extra branches, no "while I'm here" cleanup. Iterate on production code while running only that single test by name. When it passes, widen to the test file, then the suite, before committing (see *Test scoping during the loop*). Commit: `feat(<module>): implement <behavior>`.
   - **c. REFACTOR.** Clean up names, extract helpers, collapse duplication. Tests must stay green throughout. If they go red, revert and try a smaller refactor — never "fix forward" with another behavior change. Commit: `refactor(<module>): <what was cleaned up>`. If there is genuinely nothing to refactor this round, skip the commit — do not invent busywork.

   Repeat until every behavior the module owes its callers is covered by a passing test.

2. **Write contract tests for every real adapter at the module's seams.** A real adapter (`PostgresTaskStore`, real HTTP client, real S3 client) must be verified against a real instance — real DB, real or recorded endpoint — with tests proving it satisfies the same interface the fake satisfied during step 1. No real adapter ships without contract tests. Commit each: `test(<adapter>): add failing contract test for <real adapter>` → `feat(<adapter>): implement <real adapter>` → `refactor(<adapter>): <cleanup>`.

3. **Run the acceptance test from step 0.** It should now go green. If it doesn't, the failure is informative — module tests couldn't have caught it:
   - **Wiring/composition bug** → fix the wiring. Commit: `fix(composition): wire <module> into <caller>`.
   - **Seam contract is wrong** → fix the interface or adapter, and add the contract test that would have caught it. Commit accordingly.
   - **Missing behavior** → drop back to step 1 with a new failing module test. Do not patch the acceptance test to pass; that destroys the goalpost.

4. **Lock in critical end-to-end coverage, sparingly.** Keep a small number of true E2E tests for the most important user flows. Do not try to cover all behavior at this level — coverage weight belongs in module tests and contract tests; the acceptance/E2E layer only proves the pieces compose.

5. **Final cleanup commit.** Lint, type-check, and any final hygiene. Commit: `chore: lint/type fixes`.

6. **Definition of done — run the full CI-parity gate, not just the task's own tests.** "Done" is **not** "the test I just wrote passes" or "I ran `pytest tests/unit/test_signup_router.py`". Before the unit of work is handed off — before any workflow flips `review:pending` or clears `status:fix-in-progress` — run the shared `scripts/ci-checks.sh` for **every touched stack** (`backend/scripts/ci-checks.sh`, `frontend/scripts/ci-checks.sh`) and proceed only when it is green. That script is the same gate the local pre-push hook and CI run; it includes lint, format, type-check, and the **full test suite incl. DB-backed/integration tests** — exactly the coverage a single-file run skips. Running one test file is sufficient *during* the RED→GREEN loop (see *Test scoping during the loop*); it is never sufficient as the definition of done.

### Green units ≠ integrated — the seams first execute at E2E

Unit and module tests verify each module against its own contract with every external service faked, so the **seams between components — connection config, emitted-artifact shape, async delivery timing, proxy routing — have no test surface until E2E.** Mocked-away seams first execute when the real stack boots. Therefore the acceptance test that proves wiring (step 3) must, for any slice that crosses an external-service seam, run against the **real booted stack with real (or emulated) external services** — not in-process fakes. A suite of green units is not an integrated system.

### What counts as a valid RED

Every RED — acceptance test (step 0), module test (step 1a), contract test (step 2) — must fail for a *reason that proves the missing behavior*, not for incidental noise. Two flavors are legitimate:

- **Runtime RED.** The test target compiles, the new or changed test actually runs, the assertion fails, and the failure message is the one you predicted. This is the default.
- **Compile-time RED.** In a typed language (TS, Go, Rust, Java, Kotlin, Swift, C#), referencing a function, type, class, or method that doesn't exist yet *is* the intended failure signal. The compile error is the RED, provided it points at the symbol you are about to introduce.

A RED is **not** valid if the failure is caused by:

- Unrelated syntax errors, broken imports, or a misconfigured test runner.
- Missing dependencies, fixture setup the test never reaches, or a regression elsewhere.
- A typo in the test itself (mistyped matcher, wrong assertion target).

These invalid-RED causes must still be **fixed before the loop proceeds** — they are not blockers you defer, they are prerequisites you resolve. In particular, if the test legitimately needs a new dependency (a testing library, an assertion helper, a fake-adapter package, a runtime dep the production code under test requires), add it now via the project's package manager and lockfile, then re-run the test. A missing dependency is never a reason to fake the import, stub the function, or skip the test — install it and continue. The same applies to dependency bumps required to unblock the test: bump, lock, and proceed. Treat these as part of preparing the ground for a valid RED, not as RED themselves.

A test that was written but never compiled or executed is not a RED — it is a draft. Before the matching GREEN commit, you must have either (a) run the test and watched it fail, or (b) attempted to build/typecheck and observed the compile failure pointing at the intended missing symbol. Production code does not move until one of those two is true.

### Test scoping during the loop

The inner RED → GREEN loop runs **only the single test case under work**, by name — never the whole file, never the whole suite. The cycle exists to prove that *one specific test* went from failing to passing because of *one specific change*. Running the file (or the suite) on every iteration re-evaluates unrelated tests, buries the signal under noise, and silently re-pays the cost of every other test in the file on every code edit. Widen only after the targeted test is green.

The cadence is exact:

- **RED.** Run only the new test case, by name. Examples:
  - `uv run pytest path/to/test_file.py::test_specific_name -x`
  - `npx vitest run path/to/file.test.ts -t "specific behavior name"`
  - `go test ./pkg -run '^TestSpecificName$'`
  - `npx playwright test path/to/spec.ts -g "specific scenario"`

  Confirm the failure is the one you predicted. If it passes, the assertion already holds against current code — fix the test, not the code.
- **GREEN.** Keep running only that single test case while iterating on the production code. When it passes, **widen to the test file** (`uv run pytest path/to/test_file.py`, `npx vitest run path/to/file.test.ts`) to catch sibling tests this implementation broke. Then **run the suite** to catch cross-file regressions. Only after both broader runs are green do you commit. If the file or suite goes red, you have a real regression — fix it before committing, do not commit the targeted-test-only green.
- **REFACTOR.** Run the file, then the suite, after each refactor step. Observable behavior didn't change, so broader coverage costs nothing and is the only way to detect a refactor that broke an unrelated test.

This scoping applies uniformly to step 0 (acceptance test), step 1a/1b (module tests), and step 2 (contract tests). The acceptance test is one test case too — run it by name during its own RED → GREEN, not the whole acceptance-test directory.

### What counts as scaffold vs. production code

This distinction is the single most important guard against writing code before a RED exists. It applies equally to backend and frontend work.

**Scaffold** — has no behaviour; nothing to test; may be created before step 0:

*Both layers*
- Empty package directories.
- Manifest files: `pyproject.toml`, `package.json`, `uv.lock`, `package-lock.json`.
- Test-runner config: `pytest.ini`, `vitest.config.ts`, `jest.config.ts`, `playwright.config.ts`.
- Linter / formatter config: `ruff.toml`, `.eslintrc`, `biome.json`, `tsconfig.json`.
- `Dockerfile`, `compose.yaml`, `.dockerignore` (when they introduce no new runtime logic).
- `.env.example` files with placeholder values.

*Backend*
- Empty `__init__.py` files with no imports or exports.
- Framework entry-point **stub**: a file whose entire body is `app = FastAPI()` — no routes, no middleware, no exception handlers, no logic.

*Frontend*
- Empty `index.ts` / `index.tsx` barrel files with no exports.
- `main.tsx` whose entire body mounts `<App />` into the DOM — no components, no providers, no logic beyond the mount call.
- `tailwind.config.ts` / `postcss.config.js` with only token/plugin declarations and no custom logic.
- Route-file skeletons that export an empty or `null`-returning component and nothing else.

**Production code** — has behaviour; must be driven by a failing test before it is written:

*Backend*
- Any `.py` file containing a function body, method implementation, or class with attributes.
- ORM models with column definitions (`mapped_column`, `Column`).
- Service functions, middleware, dependency injection helpers.
- Pydantic schema / validation classes with field definitions.
- Alembic migration files that contain `op.create_table`, `op.add_column`, or equivalent DDL.
- Route handlers — any `@router.get` / `@router.post` / etc. decorator with a function body.

*Frontend*
- Any React component that renders real JSX (more than a stub `return null`).
- Custom hooks (`useX`) with logic in their body.
- `lib/api/*.ts` functions that call `fetch` or wrap an HTTP client.
- Context providers, reducers, or state management logic.
- Form validation schemas (`zod`, `yup`).
- Utility / helper functions with logic in their body.
- TanStack Query query/mutation definitions.

**The rule is absolute:** if a file you are about to create or edit contains any production code as defined above, a failing test that demands that code must already exist in `git log`. If it does not, stop, write the test first, confirm the RED, commit it, then write the production code.

### Reading the acceptance criteria

Before step 0, fetch the GitHub issue under work (`gh issue view <n>` or via its URL). The acceptance criteria — typically EARS + Gherkin scenarios in the issue body — are the source of truth for what the acceptance test must assert. The PRD under `docs/product-requirement-document/<feature-name>/` is background context only; do not derive acceptance criteria from `requirement.md`. By the time a task is implemented the PRD pair has usually been archived by `create-feature-issues` into `docs/product-requirement-document/_archive/<feature-name>/` — its absence from the live tree is expected and is **not** a blocker, precisely because it was never load-bearing here. The durable contracts you actually build against (ADR / `docs/data-model/` / `docs/api-contract/`) stay live. If no issue is identified, or the issue's acceptance criteria are missing, vague, or contradict themselves, stop and ask the user to resolve it before writing any test. Do not invent acceptance criteria.

## Companion references

The detailed catalogues that used to live in this file are now sibling docs / skills — load them on demand, not always-on, so the discipline stays terse in normal flow:

- **`pattern-test-coverage`** — the canonical, role-neutral catalogue of *what makes a test set complete*: AC / Gherkin / migration coverage, the full edge-case breadth, named-observable assertions, emitted-artifact correctness, and the **deletable-code spine** (a behavior is done only when deleting any one production line would fail a test). This is the same catalogue the reviewer gates against, so closing its gaps in the RED phase is how you pass the code gate on the first round instead of the second. It carries the project's `pattern-test-coverage.md` overlay — the durable record of coverage gaps this project keeps shipping — so load it (and `memory-convention` when that overlay exists) on every RED step that authors a test. It supersedes the quick checklist in `edge-cases.md`; reach for `edge-cases.md` only as a terse inline reminder.
- **`edge-cases.md`** — terse inline checklist of edge cases every module-test file must cover (null, empty, boundary, error paths, race, large data, special chars). A subset of `pattern-test-coverage` §4, kept for a fast glance mid-loop.
- **`anti-patterns.md`** — testing anti-patterns table + rationalizations table. Load when about to make a TDD-step decision, or when catching yourself reaching for an excuse to skip a step (file-scoped test runs, "I'll test after", inline mocks instead of fakes, etc.).

## Iron rules

These are non-negotiable. They are what makes the discipline a discipline.

- **No production code without a preceding RED commit.** Before writing any function body, class, route handler, ORM model, or migration, a failing test that demands that code must already exist in `git log`. No exceptions. If you are about to type production code and you cannot point to the RED commit that demands it, stop and write the test first.
- **Acceptance test first, and it must fail.** Before any production code, write one failing acceptance/integration test in user-observable terms. Watch it fail for the *right* reason. Leave it red while you build inward. This is never optional when a GitHub issue with Gherkin scenarios exists.
- **One behavior per RED.** Every RED commit introduces exactly one failing test for one behavior. Never bundle behaviors into a single test, and never bundle tests across modules into a single RED.
- **Run only the targeted test case during RED → GREEN; widen to file, then suite, on GREEN before committing.** The loop's value is proving one specific test went from failing to passing. Running the whole file every iteration buries that signal in noise and re-runs unrelated tests on every code change. See *Test scoping during the loop* for exact commands.
- **Fake adapters at seams while driving modules.** When a module crosses a seam (store, HTTP client, clock, queue), use a fake adapter for the module's tests. Real adapters are verified separately by contract tests, not by the module's own tests.
- **Real adapters earn their own contract tests.** A real adapter is verified against a real instance, with tests proving it satisfies the interface the fake satisfied. No real adapter ships without contract tests.
- **Each step is its own commit.** RED, GREEN, and REFACTOR are three commits, never two. The commit trail is part of the deliverable — a future reader should be able to read `git log` and see the cadence.
- **Refactor only under green.** If a refactor step turns the suite red, revert and try smaller. Never "fix forward" with another behavior change masquerading as a cleanup.
- **The acceptance test is the goalpost, not the proof of all behavior.** A green acceptance test proves *wiring*. Module tests and contract tests carry the coverage weight; the acceptance test only proves the pieces compose.
- **Green units ≠ integrated.** Mocked-away seams (connection config, emitted-artifact shape, async delivery timing, proxy routing) first execute at E2E. The acceptance / integration test that proves wiring runs against the real booted stack with real or emulated external services, never in-process fakes.
- **A behavior's tests are complete only against `pattern-test-coverage`.** Each behavior you grow must close every gap in that catalogue that applies to it — the deletable-code spine, edge-case breadth, named-observable assertions, emitted-artifact correctness — *and* whatever the project's `pattern-test-coverage.md` overlay adds. This is the same catalogue the reviewer gates against; an uncovered branch you leave in the RED phase is a `review:need-fix` finding waiting to happen. Close it while authoring, not on the fix round.
- **Done ≠ the task's own tests pass.** Before flipping `review:pending` or clearing `status:fix-in-progress`, run the shared `scripts/ci-checks.sh` for every touched stack — including DB-backed tests — and proceed only when green. Running a single test file (e.g. `pytest tests/unit/test_signup_router.py`) proves the one behavior under the loop; it does not prove the unit of work is done.

## Template

### Commit history shape

After the loop, `git log --oneline` should read like a story of behavior added one slice at a time. Use this exact cadence (format every commit per the dispatched caller's `templates/commit-messages.md`):

```
test(feature): add failing acceptance test for cart total recalculation
test(cart): add failing test for empty cart returns zero
feat(cart): implement empty cart total
refactor(cart): extract Money helper
test(cart): add failing test for sum across items
feat(cart): implement item summing
refactor(cart): collapse loop with reduce
fix(composition): wire pricing into cart route
chore: lint/type fixes
```

Notes on the shape:

- Subject scope (`cart`, `pricing`, `cart-store`, `composition`) names the module or seam under work.
- `test(...)` always precedes its `feat(...)` — never the other way around. If you see a `feat` without a preceding failing `test`, the loop was skipped.
- `refactor(...)` is optional per round but appears under green only. Skip the line if there is genuinely nothing to clean up.
- `fix(composition): ...` appears when step 3 reveals a wiring bug.
- `chore: lint/type fixes` is the final hygiene commit before the PR.

**Remember**: the acceptance test is the goalpost, not the proof. Modules and contract tests carry the weight. Fakes at seams keep the loop fast. Real adapters earn their place by passing contract tests. And every step gets its own commit, because the trail is part of what you ship.
