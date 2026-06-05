<!--
Body of a `kind:bug` GitHub issue in the unified implement lifecycle.

Authored by the `create-bug-issue` skill (via create-bug.sh).

This template is ZONE A ONLY — the reporter's symptom. It is the immutable
record of what was observed and how to reproduce it. The diagnosis (root cause,
proposed fix, regression-test plan) is NOT written here: the analyze step posts
it as a COMMENT (see operation-git/templates/bug-analysis-comment.md), the human
approves on that comment thread, and the fix-bug workflow reads the newest
approved analysis comment as its spec.

Labels (`kind:bug`, and later `status:*`) are set on the issue, never in the
body. A freshly-filed bug carries `kind:bug` and no `status:*` — that is what the
finder's analyze stage keys off. Lifecycle:

  kind:bug (filed)
    → analyze stage dispatches a browser-enabled engineer; it reproduces,
      posts the analysis comment, and flips → status:ready-to-review
    → human approves the approach → status:ready-to-implement
    → kickoff stage launches fix-bug.mjs → status:in-progress
    → regression-test RED → fix GREEN → refactor → review → draft PR → close-pr

A bug NEVER changes an API contract or data model. If the fix would require a
contract / data-model change, it is not a bug — reclassify it as a feature
(architecture decision needed). The analyze step flags this and stops; mid-fix
discovery halts the workflow to status:need-attention for human reclassification.

Fill every section. "Unknown" is a valid answer for Regression? / Environment
details you don't have — but Steps to reproduce and Evidence are what make a bug
actionable, so invest there.
-->

## Summary
<One sentence: what is broken. Observed behavior vs. what should happen.>

## Environment
- **Where:** <prod | staging | local>
- **App version / commit:** <release tag or git SHA, if known — anchors a bisect>
- **Browser / OS:** <e.g. Chrome 124 / macOS 14 — omit for backend-only bugs>
- **User / role:** <the account or role that hit it, if relevant to auth/ownership>

## Steps to reproduce
<Numbered, deterministic. For a UI bug, start from the entry URL and list the
exact clicks — this is the path the browser-enabled analyze step replays.>
1. <step>
2. <step>
3. <step>

## Expected vs. actual
- **Expected:** <what should have happened>
- **Actual:** <what actually happened>

## Evidence
<The raw signal the analyze step needs to root-cause. Paste, don't paraphrase.>
- **Logs:** <stack trace / error message / request id / timestamp — in a code block>
- **Screenshot / recording:** <attach or link; for a visual bug this is primary>
- **Failing request/response:** <method + path + status + payload, if an API call>

## Severity / impact
- **Severity:** <critical (data loss / outage) | high | medium | low>
- **Who's affected:** <all users | a role | one tenant | an edge case>
- **Workaround:** <any known workaround, or "none">

## Regression?
- **Used to work:** <yes | no | unknown>
- **Last known good:** <version / commit / date where it last worked, if known>
