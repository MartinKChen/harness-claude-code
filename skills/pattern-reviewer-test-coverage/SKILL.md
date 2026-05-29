---
name: pattern-reviewer-test-coverage
description: "Test-coverage patterns for the code gate on any `type:*` task. Every AC in `Done criteria (EARS)` needs a test that names the behavior and asserts the SHALL/MUST/THEN clause; every `Scenarios (Gherkin)` (and `Migration scenarios`) walks Given→When→Then; backend/frontend cover happy path + edges (boundary, error, empty, concurrency, idempotency, authz) at the right layer; `type:e2e` covers parent-slice scenarios through the UI via semantic selectors with assertions on user-visible state. Every coverage gap is HIGH and blocks the gate. Findings cite AC + test file."
---

# pattern-reviewer-test-coverage

Encodes the canonical patterns for evaluating whether the tests in a scoped diff are *enough* — every acceptance criterion the task promised has a test that actually exercises it, every Gherkin scenario walks Given → When → Then, and the obvious edge cases (boundary, error, empty input, concurrency, idempotency) are covered at the appropriate layer. This skill describes **what counts as a coverage gap and how to format the finding**. Driving the review (fetch issue, scope commits, post the comment, flip the gate) and computing the overall verdict (APPROVE / BLOCK) belong to the dispatched caller (the `reviewer` agent).

This skill is the test-coverage pillar of the code gate — invoked on every task whose code gate is being reviewed, regardless of `type:*`.

## When to activate

- The dispatched caller is reviewing the **code gate** on any `type:backend` / `type:frontend` / `type:e2e` task. Run this skill on every code-gate dispatch.
- A user says "are the tests enough", "did we cover the acceptance criteria", "review test coverage on this diff".
- Do NOT activate on the security gate — security has its own catalogue.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-test-coverage.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows must match this shape verbatim so downstream fix passes can parse them. |

## Iron rules for every finding

These govern *how* a coverage gap is identified and reported. The engineer's fix flow keys off the citation (which AC, which test file) — vague gaps that say "needs more tests" cannot be acted on.

- **The task body is the spec.** Coverage is judged against the task issue body's `## Done criteria (EARS)` block (AC1, AC2, …) and `### Scenarios (Gherkin)` block. For data-model tasks, also `### Migration scenarios (Gherkin)`. For `type:e2e` tasks, the slice's Gherkin / EARS scenarios in the **parent slice issue** body are the spec (the task body lists which scenarios this task's specs must cover; the parent slice body has the canonical scenario text).
- **A test covers an AC when its description names the behavior AND its assertions check the SHALL / MUST / THEN clause.** A test whose `it(...)` / `test(...)` description merely brushes the area without asserting the clause is shallow coverage, not coverage.
- **Every coverage gap is HIGH and blocks the gate.** Issue-body criteria (AC, Gherkin `Scenario`, `Migration scenario`), edge-case breadth (boundary, error, empty, concurrency, idempotency, authz), and `type:e2e` selector + assertion quality are all HIGH. Tests are the safety net; a hole anywhere in the net is a HIGH gap, regardless of whether the hole was spelled out in the issue body or is reviewer-judgment edge breadth. The only LOW carve-out is purely stylistic noise in E2E test files (naming, mixed quotes) that has no effect on what the spec covers.
- **Cite the gap by AC/scenario label AND the test file that should have covered it.** "AC2 is missing" is not actionable; "AC2 not covered — `services/orders/tests/test_submit.py` has no test asserting the 202 response or returned job id" is.
- **Do not down-grade for "the implementation looks right anyway".** Coverage is the gate, not implementation correctness. An AC with no test is a gap regardless of how the production code reads.
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the AC label (`AC2`, `Scenario "Cancels pending order"`), the quoted finding title, or `F1` / `F2` / `Finding 1` / `Finding 2`.
- **Read surrounding code, not just the diff.** Open the test file; follow imports; check whether a sibling test under a different name already covers the AC. If a test is named misleadingly but actually asserts the SHALL clause, that's coverage — credit it.

## Patterns to review

Walk the patterns in order. Collect findings as `{title, severity, location (test_file_path or "missing — should live at <suggested_path>"), AC/scenario reference, gap (what is not asserted), fix (concrete suggestion)}` records — the agent composes the final comment. Severity is HIGH for every coverage gap in this skill (issue-body criteria AND edge-case breadth AND E2E selector/assertion quality); LOW is reserved for purely stylistic E2E noise.

### AC coverage from `## Done criteria (EARS)` — every `type:*` (HIGH)

For every AC in the task body (`AC1`, `AC2`, …):

- **AC not exercised** — no test in the diff whose description names the AC's behavior and whose assertions check the `SHALL` / `MUST` / `THEN` clause. File a HIGH finding citing the AC label + the test file that should have covered it.
- **Shallow coverage** — a test exists but asserts only the happy-path return value and skips the `IF <condition>, THEN …` branch in the same AC, or only the `MUST` clause and skips the `And it SHOULD …` clause when that secondary response is observable. File a HIGH citing the missed clause.
- **Wrong layer** — an AC about an HTTP endpoint covered only by a pure-function unit test (the request/response contract is never exercised), or a frontend AC about user-visible state covered only by a hook test that never renders the component. File a HIGH citing both layers (where it's covered, where it should be covered).

Finding shape:

```markdown
### [HIGH] AC2 not covered by tests — WHEN order is submitted, the orders service SHALL return 202 with a job id
**Test file:** `services/orders/tests/test_submit.py` (missing case) — task body, `## Done criteria (EARS)` → AC2
**Gap:** AC2 has no test whose assertions check the 202 response or the returned job id. The diff only covers the validation-failure path from AC3.
**Fix:** Add an integration test that posts a valid order body and asserts `response.status_code == 202` and `response.json()["job_id"]` is a non-empty string.
```

### Scenario coverage from `### Scenarios (Gherkin)` — every `type:*` (HIGH)

For every `Scenario:` block in the task body (or in the parent slice body for `type:e2e`):

- **Scenario not exercised** — no test walks the `Given → When → Then` sequence. File a HIGH citing the scenario name.
- **Partial scenario** — a test covers Given + When but never asserts the Then (or asserts a different Then than the spec). File a HIGH citing the missed assertion.

For `type:e2e`, "covers" means a Playwright spec drives the UI through the scenario with semantic selectors and asserts user-visible state. A spec that hits the backend API directly does not cover an E2E scenario.

### Migration scenario coverage — only when `### Migration scenarios (Gherkin)` is present (HIGH)

For data-model tasks the task body carries an extra `### Migration scenarios (Gherkin)` block — typically an upgrade scenario and a downgrade scenario.

- **Missing migration test** — the diff must include a migration test (e.g., `pytest-alembic` upgrade/downgrade) that walks both upgrade and downgrade. Missing either side is a HIGH gap.

### Edge-case breadth — `type:backend` / `type:frontend` only (HIGH)

Beyond the spec, the implementation has obvious edge cases that the spec rarely enumerates but every reviewer expects to see. A diff that ships only the happy path is under-covered even when every AC is exercised.

For each new code path (function, endpoint, hook, component) in the diff, expect tests for the following edges *when they apply to the signature*:

- **Boundary values** — empty string, empty array, zero, negative numbers, max-int, very long strings, single-element collections.
- **Error paths** — every `throw` / `raise` / explicit error return in the new code has a test that triggers it and asserts the error shape (status code, error class, message contract).
- **Empty / null / undefined inputs** — the input is optional or nullable per its type, but no test passes `null` / `undefined` / missing field.
- **Concurrency / ordering** — when the code path mutates shared state (cache, in-memory map, DB row with a unique constraint) and the AC implies more than one caller can hit it, expect at least one test that exercises overlapping calls (or asserts the constraint that prevents the race).
- **Idempotency** — when the spec promises an operation is idempotent (retries safe, same input → same output), expect a test that calls the operation twice and asserts the second call doesn't double-apply.
- **Authorization edges** — when the endpoint / handler has an auth check, expect both a "authenticated allowed user" test and a "authenticated forbidden user" / "anonymous" test. A handler with auth but no negative test is shallow coverage.

For each edge that applies but is missing, file one HIGH finding. Consolidate — if five new functions all miss boundary-value coverage in the same way, file one consolidated finding listing all five functions.

Finding shape:

```markdown
### [HIGH] Edge cases missing on `submitOrder` — empty cart and negative quantity not asserted
**Test file:** `services/orders/tests/test_submit.py` — task body, `## Done criteria (EARS)` → AC2 (`SHALL return 202`)
**Gap:** Only the happy path (single line item, quantity ≥ 1) is asserted. AC2's "valid order body" implicitly excludes empty carts and negative quantities, but the validation rejection path from AC3 has no test for either.
**Fix:** Add two tests: one posting `{ items: [] }` asserting `response.status_code == 400`, and one posting `{ items: [{ sku: "X", qty: -1 }] }` asserting `response.status_code == 400` with the `quantity_must_be_positive` error code.
```

### Emitted-artifact correctness — output consumed by an external service (HIGH)

A unit test asserting a module's *own* output still passes when that output is wrong for its consumer. Where a module emits an artifact handed to an external service and consumed elsewhere — a link / redirect / callback URL, a webhook payload, a signed object URL, a queue message — the coverage gap is a test that asserts the emitted value against the **consuming** contract (the route table, the webhook spec, the vendor's expected schema), not just the emitter's intent.

- **Self-asserting emitter test** — the only test asserts the emitter reproduces its own literal (`assert build_link() == "https://app/reset?token=..."`) without checking that value resolves against the consumer's route table / schema. File a HIGH: the emitter's contract is the consumer's, not its own.
- **Copy-pasted emitter defect** — several emitters of the same artifact (multiple mail templates building the same reset URL, multiple producers of one queue message) each have their own passing unit test; a wrong shape repeats across all of them undetected. File one consolidated HIGH listing every emitter, since each test blesses its own output.

### Selector + assertion quality — `type:e2e` only (HIGH)

E2E test code is itself the implementation; review *coverage* and the *quality of the assertions*, not implementation cleverness.

- **Selector quality** — semantic selectors (`getByRole`, `getByLabel`, `getByPlaceholder`, accessible name) preferred over `data-testid`. `data-testid` is acceptable only when there is no semantic anchor; the test must justify the exception inline. Brittle CSS-class / XPath selectors are HIGH — they hide breakage behind selector churn rather than asserting user-visible behavior.
- **Assertion quality** — assertions check user-visible state (text, role, visible class, URL), not raw HTTP responses or DOM internals. A spec that only awaits a network response without asserting the rendered UI is a HIGH gap (the user-visible outcome is unverified, so the scenario is effectively uncovered).
- **One critical-path flow per spec** — do not bundle independent flows into a single spec. A spec that walks login + checkout + profile-edit in one `test()` is HIGH (failure isolation breaks; a failure in one step masks coverage of the others).
- **Stylistic issues** in test files (variable naming, mixed quotes) are LOW — these don't affect what's covered.

## Constructing the finding

Every finding emitted by this skill matches this shape (the template under `templates/review-comment.md` shows the full comment wrapper the agent will compose around it):

```markdown
### [SEVERITY] <AC/scenario label> — <one-line title — no leading `#N`>
**Test file:** `path/to/test_file.ext` (or "missing — should live at `<suggested_path>`") — task body, `<section reference>` → `<AC/Scenario label>`
**Gap:** <what is not asserted, in one or two sentences; quote the SHALL/MUST/THEN clause that is uncovered>
**Fix:** <concrete corrective action — name the test description and the assertions to add>
```

- Severity is `HIGH` for every coverage gap in this skill — issue-body criteria (AC from `## Done criteria (EARS)`, `Scenario` from `### Scenarios (Gherkin)`, `### Migration scenarios (Gherkin)`), edge-case breadth, and E2E selector + assertion quality + bundled-flow gaps. The only `LOW` carve-out is purely stylistic noise in E2E test files (naming, mixed quotes).
- Cross-references in the same comment use the AC/scenario label (`AC2`, `Scenario "Cancels pending order"`), the quoted finding title, or `F1` / `F2`.
- BAD/GOOD code snippets are not required — the "fix" sentence + the AC reference is usually enough. Include a GOOD snippet only when the test's shape is non-obvious (e.g., a Playwright spec that needs a specific waitFor pattern).

Hand the collected list of findings back to the dispatching `reviewer` agent — it owns the comment composition, severity-count summary, verdict line, scope note, and posting (folding these MEDIUM findings into the same `# Code Review` comment that carries the code-quality findings).
