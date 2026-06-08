---
name: pattern-reviewer-test-coverage
description: "Reviewer lens for the test-coverage gate on any `type:*` task or slice. The catalogue of *what counts as a complete test set* lives in `pattern-test-coverage` (shared with the engineer); this skill adds the reviewer's verb — turning a gap into a finding: a gap mapping to a declared AC / Gherkin / contract clause on a touched surface is HIGH and blocks the gate, while edge breadth no spec names is a non-blocking Defer/Nit. Activate on every code-gate review."
---

# pattern-reviewer-test-coverage

The reviewer's lens for the test-coverage pillar of the code gate. It does **not** restate what makes a test set complete — that catalogue (AC / Gherkin / migration coverage, edge-case breadth, named-observable assertions, emitted-artifact correctness, E2E selector + assertion quality, and the deletable-code spine) is owned by **`pattern-test-coverage`** and is shared verbatim with the engineer who authors the tests. This skill governs only the reviewer's verb: **detect a gap against that catalogue, grade it, cite it, and report it** so the engineer's fix flow can act on it.

> **Load `pattern-test-coverage` first.** Walk its catalogue against the scoped diff to find gaps; everything below is how you turn each gap into a posted finding.

This skill is invoked on every task whose code gate is being reviewed, regardless of `type:*`, and as the always-loaded Phase-1 pattern on every slice review.

## When to activate

- The dispatched caller is reviewing the **code gate** on any `type:backend` / `type:frontend` / `type:e2e` task or slice. Run on every code-gate dispatch.
- A user says "are the tests enough", "did we cover the acceptance criteria", "review test coverage on this diff".
- Do NOT activate on the security gate — security has its own catalogue.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-test-coverage.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently.

> Scope note: this overlay is for **reviewer-reporting** adjustments only — finding shapes that over-flag in this project (carve-outs), severity carve-outs, citation conventions. Test-coverage *substance* (a class of gap the project keeps shipping) belongs in the shared **`pattern-test-coverage`** overlay, because that one reaches the engineer's authoring side too. See `memory-convention` for the precedence contract.

## References

| Reference | When to read |
|-----------|--------------|
| `pattern-test-coverage` | Always — the catalogue of coverage gaps you are detecting against. |
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows must match this shape verbatim so downstream fix passes can parse them. |

## Iron rules for every finding

These govern *how* a coverage gap is identified and reported. The engineer's fix flow keys off the citation (which AC, which test file) — vague gaps that say "needs more tests" cannot be acted on.

- **The slice body is the spec, and each AC has an owning layer.** Coverage is judged against the slice body's `## Acceptance criteria (EARS)` block (and the data-model contract's `### Migration scenarios (Gherkin)` for data-model tasks), and each task's `covers:` (AC clause ids) + its own `scenario:` Gherkin block (Given / When / Then) — there is no upfront slice-level Gherkin block; the Gherkin lives per task. Judge each task at **its owning layer** (its `type`: `backend`→HTTP endpoint/worker, `frontend`→rendered tree, `e2e`→browser): the `covers:` clause must be discharged there, the `scenario:` walked there. The completeness bar is the **deletable-code lens, not AC→test count** — one AC may need several tests; several ACs may ride one walk.
- **A test covers an AC when its description names the behavior AND its assertions check the SHALL / MUST / THEN clause.** A description that merely brushes the area without asserting the clause is shallow coverage, not coverage. (This is the deletable-code spine from `pattern-test-coverage`, applied as a gate.)
- **Do not demand a backend invariant be proven through E2E.** A ledger delta, "same transaction", token state (`used_at`/`expires_at`), outbox enqueue, DB-constraint rejection, "no row created", or `4xx`/`429` is owned by the **backend integration** layer and discharged by an API-level test against real Postgres. Flagging it as "missing E2E coverage" is itself the finding-error — it forces brittle UI assertions for what an endpoint test proves directly. Equally, a "the UI shows…" clause is owned by the frontend layer (RTL, API mocked) and a backend test does not cover it. The **frontend↔backend contract** is its own invariant the per-layer tests can't see — a drift there is a real gap (block via the contract dimension).
- **Only a gap that maps to the closed spec set is HIGH and blocks the gate.** A coverage gap is HIGH **when, and only when, it maps to a declared spec clause on a surface the diff touched** — a manifest AC id's `SHALL` / `MUST` / `THEN`, a mapped Gherkin `Then` (or `Migration scenario`), or a contract-declared field / status / outcome. Those are the holes that mean the slice *did not build what was asked*: block on them, and enumerate every one (the blocking set is the CLOSED AC list, so round one must list it whole — there is no "find one more next round"). **A gap that no declared spec clause names — a boundary / special-char / concurrency / stand-in edge you surfaced from §4–§5 by reviewer judgement, or a missing test for behavior this slice did not change — is at MOST Deferred (MEDIUM) or Nit (LOW), NEVER HIGH.** Surface it as advice; it must never block the gate or expand the slice. **Never synthesize an AC** from prose, a heading, a comment, or a Gherkin line with no id in the manifest — if you cannot point at an `ACn` id (or a contract clause on a touched surface), you do not have a blocker. The other LOW carve-out is purely stylistic noise in E2E test files (naming, mixed quotes). (Safety-critical edges are not lost: the security and contract dimensions still block on their own catalogues — this lens governs only spec-coverage blocking.)
- **Cite the gap by AC/scenario label AND the test file that should have covered it.** "AC2 is missing" is not actionable; "AC2 not covered — `services/orders/tests/test_submit.py` has no test asserting the 202 response or returned job id" is.
- **A coverage gap is a class, not a line.** When a missing assertion recurs — five new functions all skip the same spec-mapped check, three sibling services all lack the terminal-status rejection test — state the invariant once, grep the reviewed surface for every sibling sharing it, and file ONE finding listing all of them with a `Class:` line. Filing site A this round and its identical sibling next round manufactures avoidable gate cycles and is itself a review defect; the engineer's class-sweep gate keys off the full sibling list you hand over.
- **Do not down-grade for "the implementation looks right anyway".** Coverage is the gate, not implementation correctness. An AC with no test is a gap regardless of how the production code reads.
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the AC label (`AC2`, `Scenario "Cancels pending order"`), the quoted finding title, or `F1` / `F2` / `Finding 1`.
- **Read surrounding code, not just the diff.** Open the test file; follow imports; check whether a sibling test under a different name already covers the AC. If a test is named misleadingly but actually asserts the SHALL clause, that's coverage — credit it.
- **The AC checkbox tick is the reviewer's verified gate.** The engineer self-ticks *task* boxes as a progress claim; an *AC* box is ticked only by the review, on a clean production-code APPROVE, once every task `covers:`-ing it discharges its clause at its owning layer. A ticked AC checkbox is never discharge on its own — it records that this lens verified the discharge. Never tick an AC a surviving HIGH finding maps to. (The mechanical edit is owned by the calling workflow / `workflow-reviewer-review-slice`; this lens supplies the per-AC discharge verdict.)

## Grading a gap

Walk `pattern-test-coverage` §1–§8 against the scoped diff. For each gap, collect a record:

```
{title, severity, location (test_file_path or "missing — should live at <suggested_path>"),
 AC/scenario reference, gap (what is not asserted), fix (concrete suggestion)}
```

Severity is **HIGH only for a gap that maps to the closed spec set** — a manifest AC id, its mapped Gherkin / `Migration scenario`, or a contract-declared field / status / outcome on a touched surface — left unasserted. **Reviewer-judgement edge breadth (§4–§5) that no spec clause names, and any gap on a surface this slice did not change, is MEDIUM (Deferred) or LOW (Nit) — never HIGH.** **LOW** is also reserved for purely stylistic E2E noise (naming, mixed quotes). Consolidate repeats — if five new functions all miss the same spec-mapped assertion, file one finding listing all five.

## Constructing the finding

Every finding matches this shape (the wrapper the agent composes around it is in `templates/review-comment.md`):

```markdown
### [SEVERITY] <AC/scenario label> — <one-line title — no leading `#N`>
**Test file:** `path/to/test_file.ext` (or "missing — should live at `<suggested_path>`") — task body, `<section reference>` → `<AC/Scenario label>`
**Gap:** <what is not asserted, in one or two sentences; quote the SHALL/MUST/THEN clause that is uncovered>
**Fix:** <concrete corrective action — name the test description and the assertions to add>
```

Worked example:

```markdown
### [HIGH] AC2 not covered by tests — WHEN order is submitted, the orders service SHALL return 202 with a job id
**Test file:** `services/orders/tests/test_submit.py` (missing case) — task body, `## Done criteria (EARS)` → AC2
**Gap:** AC2 has no test whose assertions check the 202 response or the returned job id. The diff only covers the validation-failure path from AC3.
**Fix:** Add an integration test that posts a valid order body and asserts `response.status_code == 202` and `response.json()["job_id"]` is a non-empty string.
```

- Cross-references in the same comment use the AC/scenario label, the quoted finding title, or `F1` / `F2`.
- BAD/GOOD code snippets are not required — the "fix" sentence + the AC reference is usually enough. Include a GOOD snippet only when the test's shape is non-obvious (e.g., a Playwright spec that needs a specific `waitFor` pattern).

Hand the collected list of findings back to the dispatching `reviewer` agent — it owns the comment composition, severity-count summary, verdict line, scope note, and posting (folding these into the same `# Code Review` comment that carries the code-quality findings).
