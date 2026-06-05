# Code Review

<!--
  Test-coverage findings are folded into the same `# Code Review` comment that carries
  `pattern-reviewer-coding-standard` findings. The dispatching `reviewer` agent composes
  the final comment — this template only shows the **finding rows** this skill emits.
  Severity for every coverage gap is MEDIUM.
-->

## Findings

### [MEDIUM] AC2 not covered by tests — WHEN order is submitted, the orders service SHALL return 202 with a job id
**Test file:** `services/orders/tests/test_submit.py` (missing case) — task body, `## Done criteria (EARS)` → AC2
**Gap:** AC2 has no test whose assertions check the 202 response or the returned job id. The diff only covers the validation-failure path from AC3.
**Fix:** Add an integration test that posts a valid order body and asserts `response.status_code == 202` and `response.json()["job_id"]` is a non-empty string.

### [MEDIUM] Scenario "Cancels pending order" not exercised by an E2E spec
**Test file:** `e2e/tests/orders/cancel.spec.ts` (missing) — slice body task `e2e.1` `scenario:` → "Cancels pending order"
**Gap:** No Playwright spec walks the Given (pending order exists) → When (user clicks Cancel) → Then (order disappears from the list and a confirmation toast shows).
**Fix:** Add `e2e/tests/orders/cancel.spec.ts` that signs in as a user with a pending order, clicks the Cancel button (`getByRole('button', { name: /cancel/i })`), and asserts the order is no longer in the list (`expect(page.getByRole('row', { name: order.id })).toHaveCount(0)`) and the success toast is visible.

### [MEDIUM] Migration scenario `downgrade` not exercised
**Test file:** `backend/tests/migrations/test_0042_add_orders.py` (missing downgrade case) — task body, `### Migration scenarios (Gherkin)` → "Downgrades cleanly"
**Gap:** The diff includes a `pytest-alembic` upgrade test but no test that runs the downgrade and asserts the rolled-back schema.
**Fix:** Add a downgrade case to `test_0042_add_orders.py` using `pytest_alembic.MigrationContext.migrate_down_one()` and assert the orders table no longer exists.

### [MEDIUM] Edge cases missing on `submitOrder` — empty cart and negative quantity not asserted
**Test file:** `services/orders/tests/test_submit.py` — task body, `## Done criteria (EARS)` → AC3 (validation rejection)
**Gap:** Only the happy path (single line item, quantity ≥ 1) is asserted. AC3's "validation rejection" path has no test for empty cart or negative quantity, both of which the new validator handles.
**Fix:** Add two tests: one posting `{ items: [] }` asserting `response.status_code == 400`, and one posting `{ items: [{ sku: "X", qty: -1 }] }` asserting `response.status_code == 400` with the `quantity_must_be_positive` error code.

<!--
  Comment-shape conventions enforced by `pattern-reviewer-test-coverage`:
  - All test-coverage findings are MEDIUM.
  - Every finding cites the AC/scenario label (`AC2`, `Scenario "<name>"`, `Migration scenarios → "<name>"`) AND the test file that should have covered it.
  - When the test file does not exist yet, write the citation as `<suggested_path>` (missing).
  - Never refer to a finding as `#N` (N a number) — GitHub auto-links `#1`, `#2`, … to issues.
    Use a non-numeric handle: AC/scenario label, quoted finding title, or `F1` / `F2`.
  - The skill never sets the verdict line — the dispatching `reviewer` agent owns
    APPROVE / BLOCK based on the aggregated findings from this skill plus
    `pattern-reviewer-coding-standard`.
-->
