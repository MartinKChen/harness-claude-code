<!--
Used in step 5b of the create-issues skill as the body of an `e2e` task
sub-issue. The task's type is carried by the `type:e2e` label set on
`gh issue create` — do not duplicate it in the body.

ATOMIC: one `e2e` task = one E2E test case = one user flow through the UI,
mapped to one acceptance-criteria scenario on the parent issue. If the slice
has multiple scenarios (e.g. happy path + validation error + edge case),
create one `e2e` task per scenario — never bundle.

E2E tests exercise behavior end-to-end **through the UI** — never via direct
API calls or backend assertions. Phrase the test case as a user flow: what
the user does in the browser, what they see, what they click next.
-->

## Delivery
The **single** E2E test case to write, expressed as **one** user flow through the UI. This maps to **one** acceptance-criteria scenario on the parent issue.

- <one user flow — e.g. "User navigates to /entities, clicks 'New', fills the form with valid values, submits, and sees the new row in the list">

Mapped parent AC scenario: `<scenario name from parent-issue Gherkin>`

## Done criteria
The E2E test case described above has been written and exercises the mapped acceptance-criteria scenario entirely through the UI (no direct API calls or backend assertions).
