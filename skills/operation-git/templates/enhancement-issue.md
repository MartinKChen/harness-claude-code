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
`be.1` / `fe.1`, a `blocked-by:` field, and a follow-on pointer line). Include
the Acceptance criteria + Gherkin ONLY when the enhancement has UI
(E2E-validatable behavior); for backend-only work, omit it and have each backend
task point at its api-contract / data-model file (read-only conformance).
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

<!-- INCLUDE the Acceptance criteria section ONLY when the enhancement has UI (E2E-validatable behavior). -->
## Acceptance criteria (EARS)
- AC1 — WHEN `<trigger>`, the `<system>` SHALL `<new/changed response>`.
- AC2 — IF `<condition>`, THEN the `<system>` SHALL `<response>`.

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
and a follow-on pointer line:
  - e2e      → `covers:` the mapped AC scenario (+ non-happy-path per pattern-test-coverage).
  - backend  → `contract:` the api-contract file it conforms to (NOT a new/changed contract).
  - frontend → `covers:` the AC behavior + `design:` tokens; for a PAGE also entry-source + reached-from.
  - contract-less utility → a single `done:` one-line criterion.
An enhancement may have just one task (e.g. a single backend tweak) or several.
-->
- [ ] `e2e.1` · **e2e** · blocked-by: — · "<user-visible behavior through the UI>"
      covers: AC1 scenario  (+ non-happy-path per pattern-test-coverage)
- [ ] `be.1` · **backend** · blocked-by: `e2e.1` · "<the backend change>"
      contract: docs/api-contract/<entity>.yaml  (conform to — do not change)
- [ ] `fe.1` · **frontend** · blocked-by: `be.1` · "<the frontend change>"
      covers: AC1 (behavior); design: docs/design-system/tokens.md

## Don't break
<The existing behavior this enhancement must NOT regress — the guard rail. An
enhancement changes live behavior, so name the existing E2E specs / critical-path
flows that must still pass after the change.>
- <existing spec / flow that must stay green>

## Notes
<Relevant ADRs (read-only), glossary terms, feature-flag names, rollout caveats.>
