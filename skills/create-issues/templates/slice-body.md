<!--
Used in step 5a of the create-issues skill as the body of the slice GitHub issue
(the ONLY issue created per slice). The `kind:feature` + `status:ready-to-review`
labels are set on the create command, not in the body.

There are NO task sub-issues. The task breakdown lives inline in the ## Tasks
section as a static-ID checklist — that checklist IS the task ledger. The
engineer ticks each box as it completes the task.

Acceptance criteria (EARS + Gherkin) live HERE, on the slice, and ONLY here —
this is the single AC ceremony for the whole slice. Each task in the checklist
carries a delivery line + a pointer to its spec, NOT a duplicate AC:
  - backend task  → pointer to docs/api-contract/<entity>.yaml (+ docs/data-model/<entity>.yaml) — the contract is the unit spec.
  - e2e / frontend task → the mapped slice Gherkin scenario (+ entry-source for pages, design tokens for frontend).
  - a contract-less utility task → a one-line `done:` bullet (the only place a task carries its own criterion).

Include the **Acceptance criteria** section ONLY when the slice has UI
(E2E-validatable behavior). For backend-only / database-only slices, omit it —
each backend task points at its api-contract / data-model file, and a
contract-less utility task carries a one-line `done:` bullet instead.

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

<!-- INCLUDE the Acceptance criteria section ONLY when the slice has UI. -->
<!-- Scope: behavior a user can validate from the UI (E2E). This is the ONLY AC ceremony. -->
## Acceptance criteria (EARS)
- AC1 — The `<system>` SHALL `<response>`.
- AC2 — WHEN `<trigger>`, the `<system>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

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
completion. Short static IDs (`e2e.1`, `be.1`, `fe.1`) are permanent keys scoped
by this issue's number — never replaced with issue numbers. `blocked-by:` lists
every real upstream task ID (1-up, DAG — never a transitive ancestor); use `—`
for none. The follow-on indented line carries the spec pointer:
  - e2e      → `covers:` the mapped AC scenario (+ non-happy-path per pattern-test-coverage).
  - backend  → `contract:` the api-contract file (+ data-model file when it introduces the model).
  - frontend → `covers:` the AC behavior + `design:` tokens; for a PAGE, also
               `entry-source:` (route) + `reached-from:` (the inbound control/nav), copied
               verbatim from docs/design-system/surfaces.md (the reachability gate).
  - contract-less utility → a single `done:` one-line criterion (the ONLY place a task carries its own AC).
-->
- [ ] `e2e.1` · **e2e** · blocked-by: — · "User creates a `<entity>` through the UI"
      covers: AC2 scenario  (+ non-happy-path per pattern-test-coverage)
- [ ] `be.1` · **backend** · blocked-by: `e2e.1` · "POST /`<entities>` (introduces `<Entity>` model + migration)"
      contract: docs/api-contract/<entity>.yaml · docs/data-model/<entity>.yaml
- [ ] `fe.1` · **frontend** · blocked-by: `e2e.1` · "useCreate`<Entity>` hook"
      covers: AC2 (behavior); design: docs/design-system/tokens.md
- [ ] `fe.2` · **frontend** · blocked-by: `fe.1` · "`<Entity>`CreateForm component"
      entry-source: route /`<entities>`/new · reached-from: control "New" on /`<entities>`

## Notes
<Any relevant ADRs, glossary terms, feature-flag names, or rollout caveats.>
