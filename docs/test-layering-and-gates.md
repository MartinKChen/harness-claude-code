# Test layering & gates — where each acceptance criterion is proven, and what blocks what

> Companion to [`DESIGN.md`](../DESIGN.md). DESIGN.md argues *specs-as-contract* and *outside-in TDD with adversarial review*. This doc sharpens one thing that earlier surfaces conflated: **an acceptance criterion is a specification, not a test — and the test that discharges it belongs to exactly one layer.** Getting this wrong is what makes a slice author a dozen brittle E2E specs for what are really backend invariants.

## The three things the word "test" was hiding

The pipeline kept collapsing three distinct concepts into "the AC's test":

| Concept | What it is | Where it lives |
|---|---|---|
| **AC (EARS, the SHALL clause)** | a *specification* — a claim that must be true of the finished system | the issue body |
| **Scenario (Gherkin, Given/When/Then)** | a *test case written in prose* — the seed an acceptance test is transcribed from | the issue body |
| **Test** | executable *evidence* that the claim holds | a source file, at one layer |

An AC is **not** a test. It is the thing a test verifies. The Gherkin scenario beneath it is the closest to "already a test" — which is why outside-in TDD transcribes it into the seed acceptance test. The EARS AC above it is the invariant that scenario (plus edge tests) discharges.

## Principle 1 — Every *assertion* has an *owning layer*; a compound AC fans across layers

The thing that owns a layer is the **assertion (the SHALL/THEN clause)**, not the AC. An EARS AC is routinely compound — *"SHALL create the ledger row AND enqueue the outbox AND the balance the trainer sees updates"* carries three clauses across two owning layers. Classify **per clause**, then split the AC into the tasks that discharge each clause at its layer. Stamping one layer on a whole compound AC re-creates the exact conflation this doc exists to kill.

Each clause is observable — and therefore cheapest to prove faithfully — at exactly one layer. Classify before authoring:

| Owning layer | The acceptance test sits at… | Signals it belongs here |
|---|---|---|
| **Backend integration** | the HTTP endpoint (API test client + real Postgres) or the worker tick | ledger deltas by column, "same transaction", token state (`used_at`/`superseded_at`/`expires_at`), outbox-row enqueue, DB-constraint rejection, "no row created", `FOR UPDATE SKIP LOCKED` concurrency, rate-limit buckets, `4xx`/`429` codes, **server-rendered (zero-JS) HTML pages** |
| **Frontend only** | the rendered/routed component tree (RTL, API mocked at `src/lib/api`) | "the UI shows…", hook guards (`enabled`), cache invalidation, idempotency-key rotation, error display from a stubbed status, layout/landmarks/a11y, derived display math (e.g. a countdown badge) |
| **True E2E** *(two grains — see Principle 5)* | the browser, through the live stack | the *user-visible* result that requires both layers wired together — typically **a rendered balance/status reflecting a real mutation**. Earned by a *journey worth walking*, never by an AC happening to span layers. |

**The completeness bar is the deletable-code lens, not one-test-per-AC.** A test set is complete only when deleting any single production branch/mutation/derivation makes some test fail. The AC list is the *coverage checklist*; the tests are the *coverage*. Mapping is many-to-many: one AC may need several tests (boundary/error/concurrency); several ACs may be covered by one walk.

**Push each assertion to the lowest layer that can prove it, and assert it once.** A ledger delta is asserted at backend integration — never re-asserted in a frontend test (which would have to mock it, proving nothing) or in E2E (slow, brittle). This is the test pyramid; violating it is the direct cause of selector-collision churn in E2E specs.

**A two-layer AC earns two tasks and a seam test — not an E2E.** When AC1's clauses split across backend (ledger/outbox) and frontend (the rendered balance), discharge it with one backend task, one frontend task (API mocked at `src/lib/api`), and **one contract test at the seam**. Spanning two layers does *not* earn a browser walk — E2E is earned by being on a *journey* (Principle 4), which is a property of the slice, not the AC. A slice may legitimately own **zero** E2E even when several of its ACs are full-stack.

**The frontend↔backend contract is its own invariant.** "Assert once" is per *invariant* — and the agreement between the frontend's mock and the real endpoint is a distinct invariant the per-layer tests structurally cannot see (the frontend test mocks the very shape in question; the backend test never renders it). Pin it with a contract test or a schema-generated client. Without it, the only thing guarding drift is the single golden-path critical-path walk — far too thin to catch a non-happy-path envelope mismatch (e.g. the `409 OVERLAP` body shape with `details.conflicting_session_id`).

## Principle 2 — An AC is *discharged*, not "tested"

"Done" means each AC is discharged by the **cheapest durable, faithful proof** at its owning layer. Usually that's a test. Occasionally it's something else:

| Discharge mechanism | Example | Durable? |
|---|---|---|
| Automated test | most ACs | ✅ |
| DB constraint | "overlap impossible by construction" (`EXCLUDE`) | ✅ — but a migration can drop it, so still keep **one** test that the constraint *fires* |
| Type system / compiler | exhaustive discriminated unions | ✅ |
| Manual / review | "looks aligned" | ❌ rots immediately |

A ticked AC checkbox is **never** discharge on its own. In a regression-sensitive domain an undischarged AC is a latent invariant violation — a future "unexplained discrepancy."

## Principle 3 — Outside-in is real, but "outside" is *relative to the unit being built*

Outside-in TDD ≠ "always start from a browser E2E." It means: start at the **outermost boundary of the thing under construction**, write a failing acceptance test there, then grow the inner modules with fast unit RED→GREEN→REFACTOR loops until the acceptance test goes green.

```
OUTER loop (acceptance):  write RED ─────────────────────────► GREEN
                           │  stays red across the slice        │
INNER loop (unit):         │  R→G→R→G→R→G→R→G→R→G→R→G ...        │
                           └── many fast cycles build pieces ───┘
```

- Backend-only AC → "outside" is the **HTTP endpoint**; inner loops are service unit tests with fake adapters at seams.
- Frontend-only AC → "outside" is the **rendered tree**; inner loops are component/hook unit tests.
- Cross-surface journey → "outside" is the **browser**.

The acceptance test is **written first and is *supposed* to stay red** across the inner loops. A long-red outer test is the north star, not a violation. Writing the acceptance test *after* implementation forfeits its function — it becomes a regression test asserting what the code happens to do, not what the spec demanded. **After-the-fact acceptance tests are a TDD-method violation even when the resulting file looks identical.**

## Principle 4 — Not every task or slice gets an E2E

E2E coverage attaches to **user-visible cross-surface journeys**, not to tasks or slices.

- **Backend-only tasks** get their acceptance test at the HTTP/DB/worker layer. No E2E.
- **Frontend-only tasks** get theirs at the rendered-tree layer. No E2E.
- **Whole slices** can legitimately have **zero** true E2E (a pure worker slice; a pure layout slice).

The historical reason every slice *seemed* to owe an E2E is mechanical: the slicer hard-coded `e2e.*` tasks as the blocking prerequisite for `be.*`/`fe.*`. That topology forces an E2E spec to exist before any implementation, regardless of whether the slice contains a cross-surface loop worth walking — and that is how a slice accretes E2E specs for backend invariants. **The fix is at the slicer:** emit an `e2e.*` task only when the slice closes (a segment of) a cross-surface journey.

## Principle 5 — Two kinds of E2E: slice-segment vs critical-path

The word "E2E" hides two tests with different owners, jobs, and gate semantics. Conflating them is what made multi-slice journeys feel impossible to test-first.

| | **Slice-segment E2E** | **Critical-path E2E** |
|---|---|---|
| Owned by | the slice | the **milestone** |
| Job | drive *this slice's* design | prove the segments **compose**; the release gate |
| Red-first? | yes, within the slice | spec frozen upfront; **execution enabled segment-by-segment** |
| Red window | one slice (days) | across slices (expected, and fine) |
| How many | one per cross-surface journey the slice closes | **one golden path** per critical path |
| Seeds upstream state via | API / fixtures | **walks it through the real UI** |
| TDD driver? | **yes** | **no** — an acceptance / integration gate |

### Why the critical-path E2E is not bound to a slice

A critical path (e.g. schedule → mark-complete → student confirm → trainer sees confirmed) spans several slices, so no single slice can close it. Forcing it to be one slice's driving test is wrong; holding one monolithic test red across the whole milestone is useless (it can't even run — the routes 404). Resolve it at **two grains**:

1. **Decompose into slice-owned segments.** Each contributing slice writes the segment-E2E for the portion it makes reachable — **in its own spec file** — red-first within that slice, against already-merged-green upstream seeded via fixtures. This is where the TDD design pressure lives, and it is an *implementation gate* for that slice.
2. **Freeze the journey *spec* upfront; compose the *executable* at milestone close.** Apply this doc's own AC≠test split to the critical path itself — because "written upfront, validated at release" is really talking about two different artifacts:
   - The **journey specification** — the Given→When→Then golden path — is authored upfront at milestone planning. It lives in `docs/critical-path/<flow>.md` as a frozen `## Journey (Gherkin)` block, it is the milestone's AC, and it is what *decides where the slice seams go*. It cannot drift.
   - The **executable full walk** is authored *late*: a single milestone-close step stitches the slice-owned segments into one continuous walk against a **single seed (no re-seeding between steps)** — which is the only point at which the real selectors and routes exist to write against. You cannot author the executable upfront for UI that isn't designed yet; trying to is the AC-vs-test conflation, one level up.

   > Composing the walk at milestone close — rather than un-skipping segments inside one shared spec file as each slice merges — keeps the full-journey spec **out of the per-slice write path**. A shared, incrementally-un-skipped file is a cross-slice wiring surface every contributing slice mutates: the exact app-composition clash `create-feature-issues` serializes against. Slice-owned segment files plus one late composition step has no concurrent writer.

The full-journey test is **not redundant** with the segment tests: segment tests re-seed upstream state via fixtures, so by construction they cannot see UI-level compositional seams (a button rendering on state set by a different slice's real flow, a balance staying consistent across a state boundary walked through the glass). The full walk is the only thing that catches "each slice works alone but they don't compose." Keep it to **one golden happy path**; all branches/variations stay in segment-E2Es or lower layers.

## Principle 6 — Gate taxonomy: implementation gate vs release gate

| Gate | Blocks | Owned by | Green when |
|---|---|---|---|
| **Implementation gate** | a *slice* from being done/merged | the slice | the slice's `be.*`/`fe.*` + segment-E2E + layer tests pass; slice review approves |
| **Release gate** | the *milestone* from shipping | the milestone | the full critical-path walk turns green end-to-end |

The slice-segment E2E, the coverage gate, and slice review are **implementation gates** — red one and *that slice* isn't done. The critical-path E2E is a **release gate** — it may be red while every individual slice is already merged-green, and that red means "the parts exist but don't compose; don't ship." It never blocks an individual slice from merging.

The critical-path test plays two roles at two times: a **milestone design anchor** at planning (the frozen journey decides where the slice seams go) and a **release gate** at CI (enforced as a full walk only at the milestone boundary). For a stack whose production is dormant behind a flag, the full critical-path walk going green is exactly the evidence the production-enable runbook should require.

---

## Implementation plan — how this lands in the plugin

Sequencing principle: change the **artifacts (templates)** first so the new shape is expressible, then the **authoring skills** that fill them, then the **slice workflow** that gates them, and last the **milestone release gate** that composes across them. Each phase is independently shippable.

### Phase 1 — Artifact shape (templates; no behavior change yet)

- **`skills/create-feature-issues/templates/slice-body.md` + `skills/operation-git/templates/enhancement-issue.md`:**
  1. **The AC section is ALWAYS present.** Delete the "include the Acceptance criteria section ONLY when the slice has UI" instruction — that is the old AC=E2E conflation. A backend invariant (ledger deltas, outbox enqueue, "same tx") *is* an acceptance criterion; it simply has a **backend** owning layer. Backend-only slices carry EARS ACs whose tasks point at contracts.
  2. **ACs become ticked checkboxes** — `- [ ] AC1 — …` — a peer ledger to the task checklist.
  3. **Every task's follow-on line tags the AC clause(s) it discharges** via `covers:` (AC ids), uniformly across `e2e` / `backend` / `frontend` — not only e2e. `contract:` stays as the backend spec pointer; `design:` / `entry-source:` / `reached-from:` stay as-is.
  4. **Add a per-task `scenario:` field** — the Gherkin scenario the task walks at *its* layer (the §2 obligation, named with your term "Scenario" rather than "walking"). Example backend line:
     ```
     - [ ] `be.1` · backend · blocked-by: e2e.1 · "POST /sessions …"
           covers: AC1, AC3 · scenario: "Schedule moves 1 credit to held" · contract: docs/api-contract/session.yaml · docs/data-model/session.yaml
     ```
- **`skills/workflow-writer-publish-requirement/templates/critical-path.md`:** the doc becomes **`## Summary` → `## Journey (Gherkin)` → `## History`**. The frozen `## Journey (Gherkin)` golden-path block is the release-gate spec + the seam-decider, and it **replaces** the mechanical `## Entry point` / `## Steps` / `## Exit` (those are just the journey, less precisely — keeping both is the AC-vs-test duplication trap one level up). `## Summary` stays (the *why-critical* rationale Gherkin can't express — what makes it a critical path and informs where slice seams go; fold the old "what's at stake if it breaks" here). `## History` stays (provenance). Failure *scenarios* are slice-owned non-happy-path ACs, not part of the golden journey.

### Phase 2 — Authoring skills (the judgment moves to the orchestrator)

- **`create-feature-issues` *(root cause)* + `create-enhancement-issue`:** when generating the task checklist the orchestrator now (a) classifies each AC **clause** by owning layer (per-assertion — Principle 1); (b) **judges whether the slice closes a cross-surface journey segment** → emits an `e2e.*` task only then (kills the mandatory `e2e.* → be.*/fe.*` prerequisite); (c) writes the AC checkboxes, the per-task `covers:` AC tags, and the per-task `scenario:`; (d) for a journey-closing slice, records which **critical-path journey step** the segment-E2E realizes, so milestone-close composition (Phase 4) knows what to stitch.
- **`workflow-product-owner-interview` + `workflow-writer-publish-requirement`:** emit the frozen `## Journey (Gherkin)` in the critical-path artifact. *(This is the one caveat to "nothing changes to `deep-dive-feature`": its interview **flow** is unchanged; its critical-path **output** gains the Journey block.)*

### Phase 3 — `implement-slice` (engineer claims; one consolidated review ticks the ACs)

The per-slice cycle keeps today's phases and its completion loop. Two roles change: the **task tick is the engineer's claim** (a progress signal — unchanged from today), and the **AC tick is the reviewer's verified gate** (new). There is **one** review after all tasks, not a per-task pass.

- **Author E2E + Coverage gate** stay *conditional* on the slice having an `e2e` task — **already the behavior** (`implement-slice` skips the coverage gate when there are no `e2e` tasks). Job unchanged: the E2E specs cover their mapped `scenario:` + mandated non-happy-path **before** implementation. A slice with no E2E has no pre-impl gate (Decision 4).
- **Implement** — the engineer writes code and **self-ticks each task box on claim**, exactly as today. The tick is the workflow's completion signal, not a verified gate; the loop's re-read of `[x]` is untouched.
- **Slice review (single, after every task is ticked)** — the existing multi-axis `runReviewSlice`, with two additions: (a) it judges every task against its **owning layer**; (b) within the test-coverage / contract axes it verifies, per task, that **`contract:` conformance holds**, the **`scenario:` is walked at its owning layer**, and the **`covers:` AC clause is discharged** (deletable-code lens). When every task tagged with an AC passes, the reviewer **ticks the AC box** — that tick, not the task ticks, is the verified gate. Findings → the existing review/fix cycle.
- **Pass E2E** (segment walk green) and **draft PR** — unchanged; the segment walk is conditional on an `e2e` task.

Net change to `implement-slice` is small: the review phase gains AC-ticking + owning-layer judgment; everything else (engineer self-ticks, completion loop, single review, conditional coverage gate) is already how it works.

### Phase 4 — the milestone release gate (the grain the slice loop omits)

A **milestone-close step** (at the `/ship` or `/implement-feature` milestone boundary — *not* inside a slice) composes the slice-owned segment-E2Es into the single full-journey walk from the frozen `## Journey (Gherkin)`, and runs it as the **release gate**. It may sit red while every slice is already merged-green; that red means "parts exist but don't compose — don't ship." It NEVER blocks an individual slice's PR. For a flag-dormant stack, this walk going green is exactly the evidence the production-enable runbook should require.

### Reviewer / principle / doc surfaces

- **`skills/pattern-test-coverage`** — reframe "every AC needs a test" → "every AC is *discharged* by the cheapest durable proof at its **owning layer**"; add the layer-ownership + discharge-mechanism tables and "push each assertion to the lowest layer, assert once." Correct the `type:e2e` line so it no longer implies every parent-slice scenario is walked through the UI.
- **`skills/pattern-reviewer-test-coverage` / `pattern-reviewer-contract`** — gain the per-task acceptance role + the ticking authority; judge against *owning layer*; stop demanding ledger/outbox/token internals be asserted through E2E. Deletable-code lens is the completeness bar, not AC→test count.
- **`skills/pattern-e2e-coding-standard`** — E2E asserts **user-visible state only**; explicitly forbid asserting backend internals through the UI; note not every AC maps to an E2E assertion.
- **`skills/principle-engineer-tdd`** — add "outside is relative to the unit": acceptance test at the HTTP endpoint for backend-only, the rendered tree for frontend-only, the browser only for cross-surface journeys. Add the double-loop diagram and the slice-segment-vs-critical-path distinction.
- **`DESIGN.md`** — generalize Thesis 2 step 1 ("Author E2E first") to "Author the slice's acceptance test first, at its owning layer" and reference this doc for the slice-segment-vs-critical-path / implementation-gate-vs-release-gate split.

### Decisions

1. **Ticking — RESOLVED.** The **engineer self-ticks the task** on its done-claim (unchanged from today; the completion loop and `task-finder` are untouched). The **reviewer ticks the AC** in the end-of-slice review — that AC tick is the verified gate. The task tick is a claim; the AC tick is the proof.
2. **Milestone release-gate placement — OPEN (deferred).** Whether Phase 4 runs as an extension of `/ship`'s `close-pr` stage, a dedicated step, or a CI job keyed on the milestone's last slice merging is left for a later pass.
3. **Coverage gate vs. per-task review — DISSOLVED by #1.** With no per-task acceptance review, the only structure is the pre-impl **coverage gate** (E2E-only) and the single **end-of-slice review**. No fork remains.
4. **No E2E ⇒ no pre-impl gate — RESOLVED.** A slice without an `e2e` task has no pre-implementation gate (already the behavior). That each slice's *outer acceptance tests cover their ACs at their owning layer* is verified by the reviewer in the end-of-slice test-coverage review, not by a pre-impl gate. (Red-first ordering for non-E2E layers can't be gated from a single-agent diff anyway — Principle 3 — so it stays a `principle-engineer-tdd` discipline.)
