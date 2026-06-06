---
name: pattern-exploratory-testing
description: "Role-neutral catalogue for chartered, time-boxed exploratory testing of a built, running system — the unscripted, human-style investigation that scripted AC/Gherkin coverage structurally cannot reach: simultaneous learning, test design, and execution against a live build, steered by risk. Owns the session shape (a charter — mission + areas + risks, time-boxed, logged with a ship/no-ship readout), the tours/heuristics for deciding where to poke (feature, data, interruption, error-handling, boundary, configuration, money/CRUD tours), the consistency oracles for recognizing a bug with no spec line to cite (history, image, comparable product, claims, user expectations, purpose, statutes), and the bug-report shape (repro steps + expected/actual + severity). Built for a pre-release gate agent that drives the running app and decides whether the release is fit to land — NOT wired into the implement-slice review fan-out and NOT a substitute for the test-coverage gate. Complements pattern-test-coverage (scripted completeness); never blocks on a missing AC. Activate when running an exploratory or release-readiness session against a live build."
---

# pattern-exploratory-testing

The catalogue for **exploratory testing** — simultaneous learning, test design, and test execution against a *running* build, steered by risk rather than a pre-written script. This is the investigation that scripted coverage cannot do: `pattern-test-coverage` proves the system does what the ACs *said*; exploration finds what the ACs *didn't say* — the surprising input, the half-finished error path, the two features that collide, the thing that's technically-correct-but-wrong. The two are complements: scripted tests are the safety net, exploration is the search for the holes the net doesn't cover.

> **This skill is not part of the `implement-slice` review fan-out.** It does not gate a PR, flip a label, or block a slice. It is a role-neutral capability for an agent that drives a live application — most usefully a **pre-release readiness gate**: poke the assembled release candidate the way a skeptical human would, before it actually lands, and return a ship / no-ship readout with the evidence. It never blocks on a "missing AC" — finding *unknown unknowns* is the job, and a finding here is grounded in a broken **oracle**, not a spec clause.

## When to activate

- An agent (or a user) is running a **chartered exploratory session** or a **release-readiness check** against a built, running system — "poke around before we ship", "is this release fit to land", "explore the new feature for surprises", "session-based testing of X".
- A bug is suspected but there is no failing scripted test and no obvious AC — you need to *investigate* to characterize it.
- Do NOT use this to author the scripted suite (that's `pattern-test-coverage` + `principle-engineer-tdd`), to review a diff (that's the `pattern-reviewer-*` lenses), or as a security audit (`pattern-reviewer-security`). Exploration *surfaces* a suspicious area; the durable fix is then a scripted regression test for it.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-exploratory-testing.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** (project-specific risk areas, known fragile features, prior escape-defects worth re-touring); if absent, skip silently. See `memory-convention` for the contract.

## The session is chartered and time-boxed

Exploration without a charter is aimless clicking; a charter without a time-box never ends. Every session has both.

A **charter** is one or two sentences: *explore <areas> with <resources / techniques> to discover <information about risks>*. It names a mission, not a script. Example: "Explore the checkout flow with adversarial inputs and interruptions to discover ways an order can be submitted in an inconsistent state." Derive charters from where the **risk** is, not from the AC list:

- what changed most recently / is least mature (new features, hot-fixed areas, the overlay's known-fragile list);
- where a defect would hurt most (money, auth, data integrity, anything irreversible);
- the seams between features that no single AC owns (two flows sharing state, a background job racing a user action).

**Time-box** each session (e.g. 30–60 min of effort, or a bounded number of actions for an agent). Within the box: log what you do as you go — areas covered, what you noticed, bugs found, and **open questions / areas not reached**. At the end, produce a **readout**: a ship / no-ship recommendation, the bugs found with severity, the coverage you actually achieved, and the risks you did *not* get to. The not-reached list is as important as the findings — it tells the human what remains unknown.

## Where to poke — tours (heuristics for steering)

A *tour* is a lens that biases where you go next, so coverage is deliberate rather than random. Run the tours the charter's risk implies; you needn't run all of them:

| Tour | The lens — poke at… |
| --- | --- |
| **Feature tour** | every feature and control once, breadth-first — build the map before going deep. |
| **Money / CRUD tour** | the create/read/update/delete lifecycle of each core entity; can you create then break an invariant via update/delete? |
| **Data tour** | inputs at their extremes — empty, huge, zero, negative, Unicode/emoji/RTL, the maximum field length, a value just over a boundary, a malformed paste. |
| **Interruption tour** | start an action, then interrupt — refresh mid-submit, hit back, double-click, lose the network, time out the session, kill and reopen the tab. Does state stay consistent? |
| **Error-handling tour** | force every error path — wrong password, missing permission, a dependency down, an expired token — and judge the *message and recovery*, not just the status code. |
| **Boundary / configuration tour** | the edges of supported config — smallest/largest viewport, an empty account vs a maxed-out one, the first run vs the millionth. |
| **Landmark / sequence tour** | hop between unrelated features in an order no script would, looking for state leaking from one into another. |

## How to recognize a bug with no spec line — consistency oracles

The hard part of exploration is knowing something is wrong when no AC says so. Use **consistency oracles** — a thing is suspect when it is *inconsistent with* one of these (the classic "HICCUPPS" set). Any violation is a candidate finding even though no Gherkin covers it:

- **History** — inconsistent with the system's own past behavior (a regression).
- **Image** — inconsistent with the product's brand / quality bar (a typo on the checkout button, a janky animation on a premium product).
- **Comparable products** — behaves worse than an obvious peer or competitor where users expect parity.
- **Claims** — contradicts what the docs, marketing, tooltip, or release notes promise.
- **User expectations** — violates what a reasonable user would predict (a destructive action with no confirm; data lost on back-nav).
- **Product (internal consistency)** — one part contradicts another (the list count disagrees with the detail page; two screens format the same date differently).
- **Purpose** — technically works but defeats what the feature is *for* (a search that returns results too slowly to be usable; an export that's correct but unopenable).
- **Statutes / standards** — violates a law, regulation, or standard the product is bound by (accessibility, data-handling, locale rules).

Calibrate severity by impact, not by how easy it was to find: a data-loss or money bug is high even if rare; a cosmetic image inconsistency is low even if glaring.

## Reporting a finding

Each finding is a reproducible report — the consumer (a human, or a fix flow) acts on it, so vagueness wastes a cycle:

```
Title: <one line — the symptom, not "X is broken">
Severity: <critical | high | medium | low — by impact (data/money/auth/irreversibility), not by ease of discovery>
Oracle: <which consistency oracle it violates — history / image / claims / user-expectations / product / purpose / statutes>
Environment: <build / release candidate, browser/OS, account state>
Steps to reproduce: <numbered, from a known starting state; include the exact input>
Expected: <what a reasonable oracle says should happen>
Actual: <what happened, with evidence — screenshot / response / log line>
Notes: <intermittent? data-dependent? a guess at the area, not a root-cause claim>
```

Two discipline rules:

- **A finding points at observed behavior, never an invented requirement.** "This should also do X" with no oracle behind it is a feature idea, not a bug — log it separately as a suggestion. Recall is the goal, but a finding must cite a real, reproducible inconsistency.
- **Exploration finds; scripts hold.** When a session surfaces a real defect, the durable outcome is a *scripted* regression test (handed to the engineer / `pattern-test-coverage`) so the hole the net missed is now covered. The exploratory session's value is the discovery, not a permanent test artifact.

## The release-gate readout

When the session is a pre-release gate, end with an explicit, evidence-backed recommendation — that readout *is* the deliverable:

- **Recommendation:** SHIP / SHIP-WITH-CAVEATS / NO-SHIP.
- **Blocking findings:** the critical/high bugs that justify a NO-SHIP (each with its report).
- **Non-blocking findings:** medium/low bugs and suggestions to file for later.
- **Coverage achieved:** which charters/tours ran, against which build.
- **Residual risk:** the areas the time-box did not reach — the explicit list of what remains unknown, so the human owns that risk consciously rather than by omission.

Never report SHIP because nothing was found in an area you did not actually reach — "not tested" is residual risk, not a pass.
