<!--
Used in step 5b of the create-issues skill as the body of an `e2e` task
sub-issue. The task's type is carried by the `type:e2e` label set on
`gh issue create` — do not duplicate it in the body.

E2E tests exercise behavior end-to-end **through the UI** — never via direct
API calls or backend assertions. Phrase each test case as a user flow: what
the user does in the browser, what they see, what they click next.
-->

## Delivery
E2E test cases to write, each expressed as a **user flow through the UI** (each maps to an AC / Gherkin scenario on the parent issue):
- <user flow 1 — e.g. "User navigates to /entities, clicks 'New', fills the form, submits, and sees the new row in the list">
- <user flow 2 — e.g. "User opens an existing entity, edits the name, saves, and sees the updated name reflected in the detail view and list">
- <user flow 3 — e.g. "User attempts to submit the form with an empty required field and sees the inline validation error without a network call">

## Done criteria
We have written E2E test cases — each driven entirely through the UI — that cover every scenario in the parent issue's acceptance criteria.
