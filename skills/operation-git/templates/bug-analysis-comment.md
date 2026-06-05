<!--
The analysis COMMENT posted on a kind:bug issue by the analyze step (workflow-engineer-analyze-bug). This is Zone B of a bug — the diagnosis — and it lives as a comment, never in the issue body (the body is the reporter's immutable symptom record, Zone A: operation-git/templates/bug-issue.md).

Contract role: this comment is the SPEC the fix-bug workflow reads after a human approves it. fix-bug.mjs (Prep) pulls the newest comment whose header is `# Bug Analysis` and drives the regression-test + fix from its "Regression-test plan" and "Proposed fix" sections. So fill every section concretely — a vague analysis comment produces a vague fix.

Posted with `bash skills/operation-git/scripts/post-comment.sh <n> <file>`. After posting, the analyze step flips the issue status:* (no status) → `status:ready-to-review`. A human reviews THIS comment and, to approve the approach, flips `status:ready-to-review` → `status:ready-to-implement`, which releases the bug to the kickoff stage.

Reproduce-first is mandatory: do not propose a fix you have not confirmed reproduces. If you cannot reproduce, say so under "Reproduction" with verdict NOT-REPRODUCED and stop — do not guess a root cause.

CONTRACT GUARD: a bug never changes an API contract or data model. If the only correct fix requires editing docs/api-contract/* or docs/data-model/*, set "Contract impact" to REQUIRES-CHANGE, recommend reclassifying to a feature, and stop — do NOT propose a contract-violating workaround.
-->

# Bug Analysis

## Reproduction
- **Verdict:** <REPRODUCED | NOT-REPRODUCED>
- **How:** <browser MCP against the booted stack | Playwright against the booted stack | direct API call / unit harness>
- **Evidence:** <screenshot / trace path / failing request+response / stack trace observed during repro>
- **Notes:** <anything the reporter's steps missed, or the minimal repro you narrowed to>

<!-- If NOT-REPRODUCED: stop here. State what you tried and what you'd need to reproduce. Do not fill the sections below. -->

## Root cause
<The actual defect, cited to `path/to/file.ext:line`. Explain the mechanism — why the code produces the actual behavior instead of the expected one. Not "the button is broken" but "the handler swallows the 422 because …".>

## Proposed fix
<The approach, in 2–5 sentences. Name the files you expect to touch.>
- **Touches:** `<file>`, `<file>`
- **Class-of-bug?:** <none | the same anti-pattern also lives at `<file:line>`, `<file:line>` — fix all, each with its own RED→GREEN>

## Regression-test plan
<The exact failing test the fix-bug workflow will add FIRST (RED), that fails on current code and passes after the fix. This is the bug's acceptance criterion.>
- **Kind:** <Playwright E2E | API/integration test | unit test>
- **Asserts:** <the observable the test pins — "POST /x returns 200 with body Y", "the row count is unchanged", "the toast reads Z">
- **Seed/setup:** <fixtures or state the test needs>

## Blast radius
- **What else could break:** <adjacent behavior / callers the fix could affect>
- **Contract impact:** <NONE | REQUIRES-CHANGE — reclassify to feature (see CONTRACT GUARD)>
- **Severity confirmed:** <restate or correct the issue's severity given what you found>

---
**To approve this approach:** flip `status:ready-to-review` → `status:ready-to-implement` on this issue. The fix-bug workflow then drives the regression test + fix to a draft PR.
