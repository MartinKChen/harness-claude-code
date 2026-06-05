<!--
A critical path spans several slices, so no single slice closes it. This doc
holds TWO things and only two: the rationale that makes it critical (Summary)
and the FROZEN golden-path journey spec (Journey).

The `## Journey (Gherkin)` block is the milestone's acceptance criterion. It is
authored upfront at milestone planning and is FROZEN — it decides where the
slice seams go and is the release-gate spec the milestone-close walk is composed
against. It is NOT the per-slice executable: the executable full walk is
authored late (milestone close) by stitching slice-owned segment-E2Es, when the
real selectors/routes exist. Do NOT also keep `## Entry point` / `## Steps` /
`## Exit` — that is the same journey expressed less precisely, the AC-vs-test
duplication one level up. ONE golden happy path only; failure scenarios are
slice-owned non-happy-path ACs, not part of this journey.
-->
# <Critical Path Name>

## Summary
<1–3 sentences. Why is this a critical path? Name the user, the core value at
stake, and what specifically breaks for them if this flow fails — including
what's at stake if it breaks. This is the why-critical rationale Gherkin can't
express, and it informs where the slice seams go. Be concrete.>

## Journey (Gherkin)
<!-- The frozen golden happy path. One scenario, end to end, across slices. This
     is the release-gate spec AND the seam-decider — it cannot drift. -->
```gherkin
Scenario: <the one golden path, named for the flow>
  Given <the user's starting state / where they begin>
  When <user action> 
  Then <system response / visible state change>
  When <next user action>
  Then <next visible state change>
  # … continue through the full cross-surface journey to the success state …
```

## History
<Append a one-line entry per change. Reasons only — never the diff or implementation detail. Newest at the bottom.>

- <YYYY-MM-DD> — Created. Reason: <one-line reason, e.g. "initial PRD for <feature-name>">
- <YYYY-MM-DD> — Updated. Reason: <one-line reason, e.g. "extended to cover <new sub-flow>" or "superseded <old-path-name> after pivot">
