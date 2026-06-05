<!--
Body of a `kind:enhancement` GitHub issue in the unified /ship lifecycle.

An enhancement is a single, feature-SHAPED issue that modifies an EXISTING
surface — one issue, 1+ tasks (possibly including new E2E), run through the
identical `implement-slice.mjs` cycle as a feature slice. It skips the
`/deep-dive-feature` interview + doc-lock; the issue itself is the spec.

This body is therefore the slice-body shape (Context / Scope / Acceptance
criteria / Tasks / Notes) PLUS two enhancement-only sections — `## Modifies` and
`## Don't break` — and MINUS any contract-change section: an enhancement NEVER
changes an API contract or data model. If the change requires editing
docs/api-contract/* or docs/data-model/*, it is a FEATURE (architecture decision
needed) — route it through /deep-dive-feature, not /create-enhancement-issue. The
`## Modifies` section points at the contract(s) the work implements AGAINST
(read-only), never one it rewrites.

Created by `/create-enhancement-issue` (via create-enhancement.sh) with labels
`kind:enhancement` + `status:ready-to-review`, and a linked
`enhancement/<n>-<intent>` branch (`gh issue develop`). A human reviews the
drafted issue and flips `status:ready-to-review` → `status:ready-to-implement` to
release it to the /ship kickoff stage — exactly the create-feature-issues slice gate.

The `## Tasks` checklist is the durable task ledger implement-slice parses, so it
MUST use the same line format as a feature slice (short static IDs `e2e.1` /
`be.1` / `fe.1`, a `blocked-by:` field, and a follow-on pointer line with
`covers:` + `scenario:`).

Acceptance criteria are ALWAYS present — every enhancement carries ACs, including
a backend-only one. A backend invariant IS an acceptance criterion with a
**backend owning layer**; do NOT omit the AC section because there's no UI (the
old AC=E2E conflation). Classify each AC clause by owning layer
(docs/test-layering-and-gates.md, Principle 1), and emit an `e2e.*` task ONLY
when the enhancement closes a cross-surface journey segment worth walking — a
backend-only enhancement legitimately has zero e2e tasks. ACs are ticked
CHECKBOXES, ticked by the reviewer at end-of-slice review, never by the engineer.
-->

## Context
<1–3 sentences: what existing behavior this enhances and why. Use glossary vocabulary.>

## Modifies
<The existing surface this changes, as read-only pointers — what it implements
AGAINST, never rewrites. Replaces a feature's source-PRD pointer.>
- **Critical path / feature:** <OPTIONAL — the existing flow being extended, when this enhancement maps to one named feature. Omit the line entirely for a standalone / cross-cutting enhancement that doesn't extend a single feature.>
- **Contracts (conform to, do not change):** docs/api-contract/<entity>.yaml · docs/data-model/<entity>.yaml
- **Surfaces / pages:** <existing route(s) / component(s) touched, from docs/design-system/surfaces.md>

## Scope
**In scope**
- <bullet>

**Out of scope**
- <bullet>

<!-- ALWAYS present (backend-only included). ACs are ticked checkboxes — a peer
     ledger to ## Tasks — ticked by the reviewer at end-of-slice review. -->
## Acceptance criteria (EARS)
- [ ] AC1 — WHEN `<trigger>`, the `<system>` SHALL `<new/changed response>`.
- [ ] AC2 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

### Scenarios (Gherkin)
```gherkin
Scenario: <name tied to AC1>
  Given <existing state>
  When <trigger>
  Then the <system> MUST <new/changed response>
```

## Tasks
<!--
Same format + static-ID convention as a feature slice (see slice-body.md): short
ids (`e2e.1`, `be.1`, `fe.1`), a `blocked-by:` field (1-up DAG, `—` for none),
and a follow-on pointer line that tags, uniformly across task types:
  - `covers:` the AC clause id(s) this task discharges.
  - `scenario:` the Gherkin scenario this task walks at ITS owning layer.
  - e2e      → also the mapped AC scenario (+ non-happy-path per pattern-test-coverage).
  - backend  → also `contract:` the api-contract file it conforms to (NOT a new/changed contract).
  - frontend → also `design:` tokens; for a PAGE also entry-source + reached-from.
  - contract-less utility → a single `done:` one-line criterion.
Emit an `e2e.*` task ONLY when the enhancement closes a cross-surface journey
segment — there is NO mandatory `e2e.* → be.*/fe.*` prerequisite. An enhancement
may have just one task (e.g. a single backend tweak, no e2e) or several.
-->
- [ ] `be.1` · **backend** · blocked-by: — · "<the backend change>"
      covers: AC2 · scenario: "<what the endpoint/worker does at the backend layer>" · contract: docs/api-contract/<entity>.yaml  (conform to — do not change)
- [ ] `fe.1` · **frontend** · blocked-by: `be.1` · "<the frontend change>"
      covers: AC1 · scenario: "<what the rendered tree shows>" · design: docs/design-system/tokens.md
- [ ] `e2e.1` · **e2e** · blocked-by: `fe.1` · "<user-visible behavior through the UI — only if a journey segment>"
      covers: AC1 · scenario: "<the mapped AC scenario>"  (+ non-happy-path per pattern-test-coverage)

## Don't break
<The existing behavior this enhancement must NOT regress — the guard rail. An
enhancement changes live behavior, so name the existing E2E specs / critical-path
flows that must still pass after the change.>
- <existing spec / flow that must stay green>

## Notes
<Relevant ADRs (read-only), glossary terms, feature-flag names, rollout caveats.>
