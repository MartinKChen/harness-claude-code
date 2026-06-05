# Design notes — why this harness exists

> A Claude Code harness that treats **specs and contracts as the source of truth**, then drives a **team of agents** to implement against them with outside-in TDD and adversarial multi-agent review.

This document is the "why." For the per-surface catalogue (every command, agent, skill, workflow, hook) see [`README.md`](README.md); for a visual walkthrough open [`docs/workflow.html`](docs/workflow.html).

## The problem

A single agent with a good prompt can write a function. It cannot reliably ship a *feature* — over a long task it drifts: it invents an API shape that contradicts the frontend, re-decides an architectural choice three files later, marks work "done" without a test that would fail if the behavior regressed. More prompting doesn't fix drift; it just moves it.

This repo is one answer to a single question: **what scaffolding turns unreliable agents into a reliable feature-shipping pipeline?** It rests on two claims.

## Thesis 1 — Agents drift; contracts are the anti-drift anchor

The cure for drift isn't a smarter agent, it's **removing the freedom to invent.**

Before any implementation code is written, a three-phase interview (product → design → architecture) produces and *commits* a set of artifacts that become law:

- a **PRD** with acceptance criteria in EARS + Gherkin form,
- **ADRs** recording the stack and topology decisions,
- per-entity **API contracts** (`docs/api-contract/<entity>.yaml`) and **data models** (`docs/data-model/<entity>.yaml`),
- a **design system** — tokens, components, and a surface + navigation inventory.

These land in a single **lock-in PR**. From that point every downstream agent *reads* the contract and is instructed to **halt rather than guess** when the spec is missing or contradictory. The feature is then sliced into vertical, release-safe GitHub issues whose bodies inline a typed task checklist — and that issue, not a chat transcript, is the durable source of truth a fresh agent resumes from.

The bet: **spec-as-contract is what lets agents work past toy tasks.** The contract is the shared memory that no single context window has to hold, and the thing that makes two agents working a day apart produce compatible code.

## Thesis 2 — The interesting unit is the harness, not the model

The second claim is that you get reliability by **engineering disagreement and determinism around** the model, not by trusting one agent to be its own reviewer.

The implementation cycle for each slice runs inside a deterministic JavaScript **workflow** (plain orchestration code — loops, fan-out, conditionals) that dispatches non-deterministic agents at each step:

1. **Author the slice's acceptance test first, at its owning layer** — outside-in means starting at the outermost boundary of the *thing under construction*, not always a browser: the HTTP endpoint for a backend-only slice, the rendered tree for a frontend-only one, and a Playwright walk only when the slice closes a cross-surface journey worth walking. An acceptance criterion is a *specification with exactly one owning layer*, not a test — a backend invariant (ledger delta, "same tx", "no row created") is an AC discharged at the backend layer, never re-proven through the UI. E2E specs that *do* exist are gated by a coverage review. See [`docs/test-layering-and-gates.md`](docs/test-layering-and-gates.md) for the slice-segment-vs-critical-path and implementation-gate-vs-release-gate split.
2. **Outside-in TDD** — the engineer grows each module red → green → refactor, one behavior per commit, against the locked contract. The acceptance test stays red across the inner loops; the reviewer (not the engineer) ticks each AC checkbox once its clause is discharged at its owning layer — the verified gate.
3. **Fan-out review** — instead of one reviewer, each quality dimension (security, contract-conformance, test-coverage, typing, framework idioms, …) is an **independent** agent reading only its own catalogue against the diff.
4. **Adversarial verification** — every finding is then attacked by three skeptic lenses (is the defect real? did the finder miss a guard? is the severity inflated?). A finding survives only on a **majority "not refuted"** vote; uncertain findings are dropped. This is the precision backstop that keeps the review from blocking on plausible-but-wrong findings.
5. **Loops run to confidence, not to a round count.** A fix loop repeats until the review approves — there is no "give up after N rounds," because a real blocker has to be fixed however long it takes. The runaway risk is handled instead by a per-round **cost meter** and an **oscillation guard**: the loop escalates to a human only when the *same* blocker survives its own targeted fix for several consecutive rounds (genuine non-progress), never on round count alone.

The bet: **don't ask an agent to grade its own homework — orchestrate independent perspectives and make them argue.**

## Design decisions worth arguing about

These are deliberate, and I'd genuinely like to be talked out of (or into) them:

- **Per-dimension fan-out review** trades tokens for recall and independence. Is one strong reviewer with a long checklist actually better per dollar?
- **Uncapped, convergence-to-pass loops** instead of a fixed round budget. Is the oscillation guard a sufficient safety net, or is a hard cap simpler and good enough?
- **Heavyweight upfront lock-in.** Great for net-new features; possibly overkill for a one-line change. Where's the line between "lock the spec" and "just do it"?
- **Workflow scripts are self-contained** (no shared imports — a platform constraint), so the review fan-out is duplicated across the feature and bug workflows by design. Maintainability cost vs. determinism benefit — worth it?

## Honest scope & limits

- **Single-stack reference, by design (for now).** The orchestration is stack-agnostic, but the `pattern-*` skill catalogue and scaffold templates currently codify one stack (FastAPI + React/Vite + Postgres + Playwright). The engineer/reviewer skill pairing is the intended extension seam. See the README's *Scope & assumptions*.
- **Young and opinionated.** Treat this as a reference implementation to learn from and adapt, not a turnkey drop-in. The greenfield feature lifecycle is the most exercised path; the bug and enhancement lanes are newer.
- **It assumes Claude Code's agent/skill/workflow primitives** and GitHub as the system of record.

## Let's compare notes

The two theses above are claims, not settled facts — the whole point of opening this up is to pressure-test them. If you drive agents to write code, I'd love to hear how you handle the same problems:

- How do *you* stop agents from drifting off-spec — contracts, smaller tasks, tighter prompts, something else?
- Do you cap your review/fix loops, or run them to convergence?
- Is multi-agent review earning its token cost for you, or is one good reviewer enough?

Open a [Discussion](../../discussions) or file an issue. Disagreement especially welcome.
