<!--
Used in step 5b of the create-issues skill as the body of a `frontend` task
sub-issue. The task's type is carried by the `type:frontend` label set on
`gh issue create` — do not duplicate it in the body.
-->

## Delivery
What is being created or modified:
- Page: `<path/to/page>` — <purpose>
- Component: `<ComponentName>` — <purpose>
- Hook: `use<Thing>` — <purpose>

## Done criteria (EARS)
- AC1 — The `<component>` SHALL `<response>`.
- AC2 — WHEN `<user action>`, the `<component>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<component>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact about UI state>
  When <user action>
  Then the <component> MUST <response>
  And it SHOULD <secondary response>
```
