<!--
Used in step 5a of the create-issues skill as the body of a slice (parent) GitHub
issue. The `kind` / `level` / `status` labels are set on the create command, not
in the body.

Include the **Acceptance criteria** section ONLY when the slice has UI; for
backend-only / database-only slices, omit it entirely (those criteria live on
the typed task sub-issues instead).
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
<!-- Scope: behavior a user can validate from the UI (E2E). -->
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

## Notes
<Any relevant ADRs, glossary terms, feature-flag names, or rollout caveats.>
