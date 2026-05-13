---
name: tdd-workflow
description: "Strictly enforce Test-Driven Development whenever implementing, building, adding, or shipping a feature, module, function, class, endpoint, handler, service, or behavior. Activate on any implementation task across all languages and file types (.ts, .tsx, .js, .py, .go, .rs, .java, .rb, .swift, .kt, .cpp, .cs). Triggers on verbs like implement, build, add, create, ship, develop, code, write paired with feature-shaped nouns (feature, module, component, endpoint, handler, service, function, class, behavior, requirement). Triggers on phrases like 'implement X', 'build a feature for Y', 'add support for Z', 'ship the feature', 'work on the next ticket', 'satisfy the issue'. Also activates when a GitHub issue (e.g. `gh issue view <n>`, an issue URL, or `#<n>`) is referenced as the unit of work. Encodes the outside-in TDD loop (acceptance test → red/green/refactor module loop → adapter contract tests → wiring), the per-step commit cadence via the git-workflow skill, mandatory edge-case coverage, banned test anti-patterns, and the iron rules that make TDD a discipline."
---

# tdd-workflow

Drive every implementation outside-in with TDD. The acceptance test from the GitHub issue under work is the goalpost; modules are grown inward with one-behavior red/green/refactor loops; real adapters earn their own contract tests; wiring is proven by the acceptance test going green. Each red, green, and refactor step is its own commit, produced via the `git-workflow` skill.

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

## References

Read the reference files under `references/` on demand. They are not auto-activated — load them only when the conditions below apply.

| Reference | When to read |
|-----------|--------------|
| `references/coding-patterns.md` | Always. Read at the start of every task — naming, KISS/DRY/YAGNI, immutability, error handling apply to every GREEN and REFACTOR step. |
| `references/docker-patterns.md` | When the task is container-related — modifying `Dockerfile`, `docker-compose.yaml` / `.yml`, `.dockerignore`, or otherwise changing the runtime image surface. |
| `references/frontend-patterns.md` | When the task implements frontend code — React/TypeScript components, hooks, pages, forms, or anything under the frontend package. |
| `references/python-patterns.md` | When the task implements backend code in Python — `.py` files, FastAPI/Flask/Django handlers, SQLAlchemy models, pytest tests. |

Other skills still apply (route to them as you would any skill, not as files under this one):

| Skill | When to route to it |
|-------|---------------------|
| `git-workflow` | Every RED, GREEN, REFACTOR, contract-test, and wiring step — produce a commit message and commit via this skill. Also for branch naming. |
| `design-deep-module` | When defining the module's public interface before the first RED — keep the interface narrow relative to the functionality it hides. |
| `design-api-endpoint` | When the module under test is an HTTP endpoint — for URL/verb/shape decisions before the acceptance test is written. |
| `database-patterns` | When a real adapter under contract test is a DB-backed store (e.g. `PostgresTaskStore`) — for schema/migration/naming. |

## Workflow

### Outside-in TDD loop

0. **(Optional, outside-in) Write the acceptance test first.** Read the GitHub issue under work (e.g. `gh issue view <n>`) and extract the acceptance criteria from its body — typically EARS + Gherkin scenarios. Write **one** failing acceptance/integration test that describes the slice end-to-end in the user's terms, derived from those scenarios. Run it. Confirm it is a valid RED (see *What counts as a valid RED*). Leave it red. Commit via `git-workflow` as `test(<feature>): add failing acceptance test for <behavior>`. This is the goalpost.

1. **For each module needed to satisfy the goalpost, run the inner loop.** Define the module's narrow public interface (lean on `design-deep-module`). Identify its seams — anything across a process/IO boundary (store, HTTP client, clock, queue, message bus). For each seam, build a fake adapter (`InMemoryTaskStore`, `FakeClock`, `RecordingHttpClient`). Then loop until the module's behavior is complete:

   - **a. RED.** Write ONE failing test against the module's interface for ONE behavior. Use the fake adapters at seams. Run it. Confirm it is a valid RED (see *What counts as a valid RED*). Commit: `test(<module>): add failing test for <behavior>`.
   - **b. GREEN.** Write the minimum implementation that makes the test pass. No speculative code, no extra branches, no "while I'm here" cleanup. Run the suite. Commit: `feat(<module>): implement <behavior>`.
   - **c. REFACTOR.** Clean up names, extract helpers, collapse duplication. Tests must stay green throughout. If they go red, revert and try a smaller refactor — never "fix forward" with another behavior change. Commit: `refactor(<module>): <what was cleaned up>`. If there is genuinely nothing to refactor this round, skip the commit — do not invent busywork.

   Repeat until every behavior the module owes its callers is covered by a passing test.

2. **Write contract tests for every real adapter at the module's seams.** A real adapter (`PostgresTaskStore`, real HTTP client, real S3 client) must be verified against a real instance — real DB, real or recorded endpoint — with tests proving it satisfies the same interface the fake satisfied during step 1. No real adapter ships without contract tests. Commit each: `test(<adapter>): add failing contract test for <real adapter>` → `feat(<adapter>): implement <real adapter>` → `refactor(<adapter>): <cleanup>`.

3. **Run the acceptance test from step 0.** It should now go green. If it doesn't, the failure is informative — module tests couldn't have caught it:
   - **Wiring/composition bug** → fix the wiring. Commit: `fix(composition): wire <module> into <caller>`.
   - **Seam contract is wrong** → fix the interface or adapter, and add the contract test that would have caught it. Commit accordingly.
   - **Missing behavior** → drop back to step 1 with a new failing module test. Do not patch the acceptance test to pass; that destroys the goalpost.

4. **Lock in critical end-to-end coverage, sparingly.** Keep a small number of true E2E tests for the most important user flows. Do not try to cover all behavior at this level — coverage weight belongs in module tests and contract tests; the acceptance/E2E layer only proves the pieces compose.

5. **Final cleanup commit.** Lint, type-check, and any final hygiene. Commit: `chore: lint/type fixes`.

### What counts as a valid RED

Every RED — acceptance test (step 0), module test (step 1a), contract test (step 2) — must fail for a *reason that proves the missing behavior*, not for incidental noise. Two flavors are legitimate:

- **Runtime RED.** The test target compiles, the new or changed test actually runs, the assertion fails, and the failure message is the one you predicted. This is the default.
- **Compile-time RED.** In a typed language (TS, Go, Rust, Java, Kotlin, Swift, C#), referencing a function, type, class, or method that doesn't exist yet *is* the intended failure signal. The compile error is the RED, provided it points at the symbol you are about to introduce.

A RED is **not** valid if the failure is caused by:

- Unrelated syntax errors, broken imports, or a misconfigured test runner.
- Missing dependencies, fixture setup the test never reaches, or a regression elsewhere.
- A typo in the test itself (mistyped matcher, wrong assertion target).

A test that was written but never compiled or executed is not a RED — it is a draft. Before the matching GREEN commit, you must have either (a) run the test and watched it fail, or (b) attempted to build/typecheck and observed the compile failure pointing at the intended missing symbol. Production code does not move until one of those two is true.

### Reading the acceptance criteria

Before step 0, fetch the GitHub issue under work (`gh issue view <n>` or via its URL). The acceptance criteria — typically EARS + Gherkin scenarios in the issue body — are the source of truth for what the acceptance test must assert. The PRD under `docs/PRDs/<feature-name>/` is background context only; do not derive acceptance criteria from `requirement.md`. If no issue is identified, or the issue's acceptance criteria are missing, vague, or contradict themselves, stop and ask the user to resolve it before writing any test. Do not invent acceptance criteria.

## Pattern

### Edge cases every module test file must cover

"Probably works" is the most common way TDD silently degrades. For each public behavior, walk this checklist and add tests for every item that applies:

- **Null / undefined input** — every parameter, every prop, every query param.
- **Empty arrays / empty strings / empty objects** — including the empty-result branch of any list query.
- **Invalid types at trust boundaries** — wrong-shape input from API request bodies, user input, external API responses.
- **Boundary values** — min, max, off-by-one (`0`, `1`, `n`, `n+1`, `MAX_INT`).
- **Error paths** — network failures, DB errors, third-party 5xx, timeouts, validation failures. Not just the happy path.
- **Race conditions** — concurrent operations on the same resource, double-submits, parallel writes.
- **Large data** — performance and correctness at 10k+ items where relevant.
- **Special characters** — Unicode, emoji, SQL chars (`'`, `;`, `--`), HTML/script chars, RTL text.

If a category genuinely doesn't apply (e.g. no string inputs → no special-character tests), say so out loud in the PR description rather than silently skipping.

### Test anti-patterns to avoid

- **Testing implementation details.** Test what callers observe at the public interface, not private fields, internal state, or call counts. If you must assert "method X was called", you are probably testing the wrong layer — push the assertion outward to observable behavior.
- **Tests that depend on each other.** Each test sets up its own data and tears down its own state. Order independence is mandatory. No shared mutable fixtures.
- **Asserting too little.** A test that "passes" without verifying behavior is worse than no test — it is a false-confidence signal. Every test must have a meaningful, specific assertion on observable output.
- **Mocking what you should fake.** Heavy `jest.mock` / `MagicMock` / monkey-patch setups inside module tests usually mean you should have introduced a seam and a fake adapter. The fake is reusable, type-checked, and earns its own contract test against the real adapter.
- **Testing the fake.** Asserting properties of `InMemoryTaskStore` itself is wasted work. The fake is test infrastructure; what matters is the module that uses it. (Exception: a small sanity test that the fake conforms to the interface, when shared across many modules.)
- **Acceptance tests that test internals.** The acceptance test asserts user-observable behavior, end-to-end. If it pokes module internals to "make it pass", it has stopped being an acceptance test — back it out.
- **Refactoring that changes behavior.** A REFACTOR commit must not change observable behavior. If a test goes red during refactor, revert and try smaller. New behavior belongs in a new RED, not a "while I was cleaning up" GREEN.

### Rationalizations to refuse

If you catch yourself reaching for any of these, stop. Each is the loop trying to skip a step.

| Excuse | Reality |
|--------|---------|
| "This is too simple to need a test." | Simple code still breaks under empty input, null, or a boundary. The test takes 30 seconds; debugging the regression six weeks from now takes hours. |
| "I'll write the test after — it'll pass right away and that's the same thing." | A test that passes on first run proves nothing. You never saw it catch the absence. Tests-after answer *what does this do?*; tests-first answer *what should this do?* |
| "I already verified this manually." | Manual verification is ad-hoc, unrecorded, and unrepeatable. The next change has no safety net. |
| "I'll bundle these two behaviors into one RED — they're related." | One behavior per RED. Bundling hides which assertion is doing the work and makes the GREEN commit lie about what was added. |
| "The fake is trivial, let me write it inline in the module test." | A seam crossed inline becomes a permanent inline mock. Define the fake adapter once, reuse it, and let it earn its own contract test against the real one. |
| "This adapter is a thin wrapper, it doesn't need a contract test." | If it crosses a process or IO boundary, the wrapper *is* where the behavior diverges from the fake. No real adapter ships without contract tests. |
| "While I'm refactoring, let me also add this small behavior." | Refactor is under green only. New behavior is a new RED. Bundling them means a red suite mid-refactor with no clean revert point. |
| "The acceptance test goes green if I poke the module's internals from it." | Then it has stopped being an acceptance test. The acceptance test asserts user-observable behavior; if it reaches inside the module, back it out. |
| "I explored first and the code already works — let me write tests around it and commit." | The exploration code has no RED behind it. Delete it, write the failing test, reimplement from the test. The exploration was the spike; the commit history is the deliverable. |
| "The issue's acceptance criteria are obvious, I don't need to read them carefully." | The acceptance test *is* the criteria, in code. If you guess the criteria you'll write the wrong goalpost and every module test underneath inherits the error. |
| "TDD is slowing me down on this slice — I'll catch up by skipping the inner loop." | The inner loop is what makes the acceptance test trustable. Skip it and the acceptance going green proves only that *something* runs end-to-end, not that the modules under it are correct. |

### Iron rules

These are non-negotiable. They are what makes the discipline a discipline.

- **Acceptance test first, and it must fail.** Before any production code, write one failing acceptance/integration test in user-observable terms. Watch it fail for the *right* reason. Leave it red while you build inward.
- **One behavior per RED.** Every RED commit introduces exactly one failing test for one behavior. Never bundle behaviors into a single test, and never bundle tests across modules into a single RED.
- **Fake adapters at seams while driving modules.** When a module crosses a seam (store, HTTP client, clock, queue), use a fake adapter for the module's tests. Real adapters are verified separately by contract tests, not by the module's own tests.
- **Real adapters earn their own contract tests.** A real adapter is verified against a real instance, with tests proving it satisfies the interface the fake satisfied. No real adapter ships without contract tests.
- **Each step is its own commit.** RED, GREEN, and REFACTOR are three commits, never two. The commit trail is part of the deliverable — a future reader should be able to read `git log` and see the cadence.
- **Refactor only under green.** If a refactor step turns the suite red, revert and try smaller. Never "fix forward" with another behavior change masquerading as a cleanup.
- **The acceptance test is the goalpost, not the proof of all behavior.** A green acceptance test proves *wiring*. Module tests and contract tests carry the coverage weight; the acceptance test only proves the pieces compose.

## Template

### Commit history shape

After the loop, `git log --oneline` should read like a story of behavior added one slice at a time. Use this exact cadence (delegate the actual commit to `git-workflow`):

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
