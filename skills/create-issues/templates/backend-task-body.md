<!--
Used in step 5b of the create-issues skill as the body of a `backend` task
sub-issue. The task's type is carried by the `type:backend` label set on
`gh issue create` — do not duplicate it in the body.

When the task changes a data model, the **Migration scenarios** block is
mandatory; otherwise omit it entirely.
-->

## Delivery
What is being created or modified:
- API endpoint: `POST /<resource>` — <purpose>
- Data model: `<Entity>` — <columns / relations added or changed>
- Utility: `<fn>` — <purpose>

## Done criteria (EARS)
- AC1 — The `<service>` SHALL `<response>`.
- AC2 — WHEN `<trigger>`, the `<service>` SHALL `<response>`.
- AC3 — IF `<condition>`, THEN the `<service>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC2>
  Given <fact about request / state>
  When <trigger>
  Then the <service> MUST <response>
  And it SHOULD <secondary response>
```

<!-- INCLUDE this Migration scenarios block ONLY when this task changes a data model. -->
### Migration scenarios (Gherkin)
```gherkin
Scenario: upgrade migration applies cleanly
  Given the database is at the previous schema version
  When the upgrade migration runs
  Then the schema MUST match the new version
  And existing rows MUST NOT be lost or corrupted

Scenario: downgrade migration reverts cleanly
  Given the database is at the new schema version
  When the downgrade migration runs
  Then the schema MUST match the previous version
  And rollback-relevant data MUST NOT be lost
```
