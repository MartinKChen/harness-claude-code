<!--
Used in step 5a of the create-feature-issues skill as the body of the slice GitHub issue
(the ONLY issue created per slice). The `kind:feature` + `status:ready-to-review`
labels are set on the create command, not in the body.

There are NO task sub-issues. The task breakdown lives inline in the ## Tasks
section as a static-ID checklist — that checklist IS the task ledger. The
engineer ticks each task box as it completes (a claim); the reviewer ticks each
AC box at end-of-slice review (the verified gate).

Acceptance criteria (EARS + Gherkin) live HERE, on the slice, and ONLY here —
this is the single AC ceremony for the whole slice.

AN AC IS A SPECIFICATION, NOT A TEST. Every slice carries ACs — including a
backend-only or database-only slice. A backend invariant (ledger deltas, outbox
enqueue, "same transaction", token state, "no row created") IS an acceptance
criterion; it simply has a **backend owning layer**. Do NOT omit the AC section
because the slice has no UI — that is the old AC=E2E conflation. Classify each
AC's SHALL/THEN clause by its owning layer:
  - backend integration → HTTP endpoint / worker tick (ledger, tx, token state,
    outbox, DB-constraint rejection, 4xx/429, server-rendered zero-JS HTML).
  - frontend only → rendered/routed tree, API mocked at src/lib/api (UI shows…,
    hook guards, cache invalidation, error display, layout/a11y, derived display).
  - true E2E → the browser, through the live stack — EARNED only by a cross-surface
    journey worth walking, never by an AC merely spanning two layers.

A compound AC fans ACROSS layers: split it into the tasks that discharge each
clause at its layer (one backend task + one frontend task + one seam/contract
test, NOT an E2E). Each task's follow-on line carries:
  - `covers:` the AC clause id(s) it discharges — uniformly across e2e/backend/frontend.
  - `scenario:` the Gherkin scenario it walks at ITS layer (the per-task §2 obligation).
  - backend task  → also `contract:` docs/api-contract/<entity>.yaml (+ docs/data-model/<entity>.yaml) — the contract is the unit spec.
  - frontend task → also `design:` tokens; for a PAGE also `entry-source:` + `reached-from:`.
  - a contract-less utility task → a one-line `done:` bullet instead of `contract:`.

Static-ID convention: the checklist writes the SHORT form (`e2e.1`, `be.1`,
`fe.1`, `fe.2`) because the slice issue number already scopes them. The
fully-qualified permanent key is `s<slice#>.<type>.<n>` — e.g. task `be.1` on
slice issue #42 has permanent key `s42.be.1`. Engineers reference the short form
inside the slice; commit trailers use the qualified key (`Task: s42.be.1`).
These IDs are permanent — they are NEVER translated to issue numbers.
-->

## Context
<1–3 sentence summary tying this slice to the source requirement / PRD. Use glossary vocabulary.>

## User stories covered
- <story id / quoted line> — <short paraphrase>
<!-- omit this section entirely if the source has no user stories -->

## Scope
**In scope**
- <bullet>
- <bullet>

**Out of scope**
- <bullet>

<!--
ALWAYS present — every slice carries ACs (backend-only included). Classify each
AC's clause by owning layer before writing tasks; a compound AC splits into
tasks at each layer. ACs are ticked CHECKBOXES — a peer ledger to ## Tasks —
ticked by the reviewer at end-of-slice review, never by the engineer.
-->
## Acceptance criteria (EARS)
- [ ] AC1 — The `<system>` SHALL `<response>`.
- [ ] AC2 — WHEN `<trigger>`, the `<system>` SHALL `<response>`.
- [ ] AC3 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact>
  And <fact>
  When <trigger>
  Then the <system> MUST <response>
  And it SHOULD <secondary response>
```

## Tasks
<!--
The task ledger. Each line is a checklist entry; the engineer ticks the box on
its done-claim. Short static IDs (`e2e.1`, `be.1`, `fe.1`) are permanent keys
scoped by this issue's number — never replaced with issue numbers. `blocked-by:`
lists every real upstream task ID (1-up, DAG — never a transitive ancestor); use
`—` for none.

EMIT AN `e2e.*` TASK ONLY WHEN THIS SLICE CLOSES (a segment of) a cross-surface
journey worth walking. There is NO mandatory `e2e.* → be.*/fe.*` prerequisite —
a backend-only or pure-layout slice legitimately has ZERO e2e tasks, and its
be.*/fe.* tasks have no e2e blocker. Do not invent an e2e task to "cover" a
backend invariant; that invariant is discharged at the backend layer.

The follow-on indented line tags, uniformly across task types:
  - `covers:` the AC clause id(s) this task discharges (e.g. `AC1, AC3`).
  - `scenario:` the Gherkin scenario this task walks at ITS owning layer.
  - e2e      → also the mapped slice scenario (+ non-happy-path per pattern-test-coverage).
  - backend  → also `contract:` the api-contract file (+ data-model file when it introduces the model).
  - frontend → also `design:` tokens; for a PAGE also `entry-source:` (route) +
               `reached-from:` (the inbound control/nav), copied verbatim from
               docs/design-system/surfaces.md (the reachability gate).
  - contract-less utility → a single `done:` one-line criterion (the ONLY place a task carries its own AC).
-->
- [ ] `e2e.1` · **e2e** · blocked-by: — · "User creates a `<entity>` through the UI"
      covers: AC2 · scenario: "User creates a `<entity>` and sees it listed"  (+ non-happy-path per pattern-test-coverage)
- [ ] `be.1` · **backend** · blocked-by: — · "POST /`<entities>` (introduces `<Entity>` model + migration)"
      covers: AC1, AC3 · scenario: "Create moves the row into `<state>`" · contract: docs/api-contract/<entity>.yaml · docs/data-model/<entity>.yaml
- [ ] `fe.1` · **frontend** · blocked-by: — · "useCreate`<Entity>` hook"
      covers: AC2 · scenario: "Hook posts and invalidates the list cache" · design: docs/design-system/tokens.md
- [ ] `fe.2` · **frontend** · blocked-by: `fe.1` · "`<Entity>`CreateForm component"
      covers: AC2 · scenario: "Form renders and submits via the hook" · entry-source: route /`<entities>`/new · reached-from: control "New" on /`<entities>`

## Notes
<Any relevant ADRs, glossary terms, feature-flag names, or rollout caveats.>
