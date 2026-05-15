<!--
Used in step 5b of the create-issues skill as the body of a `backend` task
sub-issue. The task's type is carried by the `type:backend` label set on
`gh issue create` — do not duplicate it in the body.

ATOMIC: one `backend` task delivers **exactly one** of:
- a single API endpoint, OR
- a single utility function/module.

Data-model + migration changes are NOT their own task. When the endpoint
(or utility) introduces a new model or modifies an existing one, the schema
change rides along in this same task — note it in the Delivery section
and INCLUDE the Migration scenarios block. A second endpoint that uses
the same model lives in its own task and `Blocked by` the task that
introduced the model.

Do NOT bundle two endpoints or two utilities. If the Delivery section
needs the word "and" between two endpoints or two utilities, split the task.
-->

## Delivery
The **single** unit being created or modified — pick exactly one of the lines below and delete the other:
- API endpoint: `POST /<resource>` — <purpose>. *If this endpoint introduces or changes a data model, note it here: e.g. "introduces `<Entity>` model with columns `<...>`".*
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

<!-- INCLUDE this Migration scenarios block ONLY when this task introduces or changes a data model alongside its endpoint/utility. -->
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
