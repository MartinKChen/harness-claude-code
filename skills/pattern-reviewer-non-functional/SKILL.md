---
name: pattern-reviewer-non-functional
description: "Reviewer lens for the non-functional dimension of a slice's production-code review — the ISO-25010 quality characteristics (performance efficiency, reliability, scalability, resource utilization) the functional gates miss. Walks the pattern-engineer-non-functional catalogue against the diff and turns each gap into a graded, cited finding under a STRICT spec-gated severity rule: a gap is HIGH (blocks the gate) ONLY when it maps to a declared non-functional acceptance criterion on a touched surface (a latency / throughput / capacity / availability / resource clause left unbuilt or unproven). Every thin-floor gap that no NFR AC names — an unbounded query, an N+1, a missing timeout, an event-loop-blocking sync call, a missing index — is at MOST Deferred (MEDIUM) or Nit (LOW), NEVER HIGH, so an early-stage project with no NFR ACs is never blocked by this lens. Cite file:line + the AC label (or the floor rule), read surrounding code first, use a non-numeric handle. Security is out of scope (pattern-reviewer-security). Activate on every production-code slice review touching backend or frontend."
---

# pattern-reviewer-non-functional

The reviewer's lens for the non-functional pillar of the code gate — performance efficiency, reliability, scalability, and resource utilization (ISO 25010 / ISTQB non-functional quality characteristics). The substance — *what bound should exist* — lives in **`pattern-engineer-non-functional`** and is shared verbatim with the engineer who writes the code. This skill governs only the reviewer's verb: **detect a gap against that catalogue, grade it under the spec-gated rule, cite it, and report it** so the fix flow can act on it.

> **Load `pattern-engineer-non-functional` first.** Walk its *thin floor* and its *spec-gated targets* against the scoped diff to find gaps; everything below is how you turn each gap into a posted finding — and, above all, how you grade it so this lens never blocks a slice that didn't ask for the work.

## When to activate

- The dispatched caller is reviewing the **production-code gate** on a slice whose diff touches `type:backend` or `type:frontend` surfaces. Run on every such dispatch.
- A user says "review performance", "are there N+1s / unbounded queries", "will this scale", "did we meet the latency / capacity requirement".
- Do NOT activate on the security gate (`pattern-reviewer-security`) or the pre-implementation `test-coverage` gate (there is no production code to audit yet). Test files are out of scope.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-non-functional.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently.

> Scope note: this overlay is for **reviewer-reporting** adjustments only (finding shapes that over-flag in this project, severity carve-outs, citation conventions). Non-functional *substance* (a class of bound the project keeps missing) belongs in the shared **`pattern-engineer-non-functional`** overlay, because that one reaches the engineer's authoring side too. See `memory-convention` for the precedence contract.

## References

| Reference | When to read |
|-----------|--------------|
| `pattern-engineer-non-functional` | Always — the catalogue of bounds (thin floor + spec-gated targets) you are detecting gaps against. |
| `templates/review-comment.md` | Always read before composing the comment body (single-context `reviewer` fallback path). The fan-out maps your findings into its own schema; the template fixes the finding-row shape. |

## The severity rule — this is the whole point of the skill

The consuming project is usually **early-stage** and declares **no non-functional acceptance criteria**. This lens must not punish that. Severity is therefore split hard:

- **HIGH (blocks the gate) — and ONLY this case:** the gap maps to a **declared non-functional AC on a surface the diff touched**. That means an `ACn` id in the Scope Manifest whose clause is a latency / throughput / concurrency / capacity / availability / recovery / resource-ceiling requirement, and the diff either did not build the bound it requires or shipped no test that proves it. These are the holes that mean *the slice did not build what was asked* — block on them, and enumerate every one.
- **MEDIUM (Deferred) / LOW (Nit) — everything else, NEVER HIGH:** every **thin-floor** gap that no declared NFR AC names — an unbounded list query, an N+1, a missing outbound timeout, a blocking sync call in an async path, a missing hot-predicate index, an unwindowed large UI list — is surfaced as **advice**, not a blocker. It is real and worth fixing, but it must never hold the gate open and must never expand the slice. Use MEDIUM when the risk is material (an unbounded query on a table that clearly grows), LOW when it is minor or speculative.
- **Never synthesize a non-functional AC.** If you cannot point at an `ACn` id in the manifest whose clause is non-functional, you do **not** have a blocker — at most you have floor advice. Do not invent "this should be fast" / "this should scale" from prose, a heading, or your own sense of good engineering. The manifest is the closed authority.
- **Pre-existing gaps are not this slice's debt.** A missing bound on a surface this slice did not change is at most a Nit, and only if trivially adjacent — prefer to stay silent on untouched code.

Net effect: a slice with **no NFR ACs can never be blocked by this lens** — it can only receive floor advice. A slice that *does* declare an NFR AC is held to it. That is exactly the spec-gated behavior the bound is for.

## Iron rules for every finding

- **The slice body is the spec.** A blocking finding is judged against the manifest's `## Acceptance criteria` (the non-functional clauses among them) on a touched surface. Advisory floor findings are judged against `pattern-engineer-non-functional`'s thin-floor list.
- **Cite the gap by location AND by what it maps to.** A blocker cites `file:line` + the `ACn` label whose non-functional clause is unmet ("AC4 — p95 < 200ms — no test measures the endpoint"). A floor finding cites `file:line` + the floor rule ("unbounded read — `services/orders/list.py:31` selects with no LIMIT"). "This might be slow" is not a finding.
- **Read surrounding code, not just the diff.** Confirm the bound is actually absent — follow the call into the repository/service, check for a `LIMIT` applied downstream, an existing index in a sibling migration, a timeout set on the shared client. A bound that already exists out of the hunk is not a gap.
- **Distinguish "missing bound" from "below a declared target".** Without a declared AC, you can only flag a *missing* bound (advisory). You may only flag *below-target* (blocking) when the AC states the number — never assert a latency/throughput number the issue didn't write.
- **Don't double-report security.** A missing rate limit framed as *abuse control* is `pattern-reviewer-security`'s; flag it here only when an AC declares it as a *capacity/back-pressure* requirement. When both lenses see it, the dedup step collapses it.
- **Effort is your honest cost-to-fix-now.** L = localized (add a `LIMIT`, set a timeout); M = multi-file or needs a new test (add an index migration + test; add a perf test); H = design rework (introduce pagination across an API + clients; add a circuit breaker).
- **Never refer to a finding as `#N` (N a number).** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: the AC label (`AC4`), the floor-rule name (`unbounded-read`, `n-plus-one`, `missing-timeout`, `event-loop-block`), the quoted title, or `F1` / `F2`.
- **Acknowledge a clean axis.** If the diff holds the floor and meets every declared NFR AC, **zero findings is the correct result** — never manufacture a finding to look thorough.

## Grading a gap

Walk `pattern-engineer-non-functional` (floor + spec-gated targets) against the scoped diff. For each gap collect a record:

```
{title, severity, effort, location (file:line), maps-to ("ACn — <clause>" for a blocker, or "<floor-rule>" for advice),
 impact (what breaks/degrades if this ships), fix (concrete corrective action)}
```

Severity is **HIGH only for a declared-NFR-AC gap on a touched surface**; every floor gap with no NFR AC is **MEDIUM (Deferred) or LOW (Nit)**. Consolidate repeats — if five handlers all miss a timeout, file one finding listing all five.

## Constructing the finding

Every finding matches the fan-out's structured shape (`title`, `severity`, `effort`, `file`, `impactStatement`, `effortStatement`, `fix`, `lang`, `bad`, `good`, `dimension="non-functional"`). For the single-context `reviewer` fallback, the comment-row shape is in `templates/review-comment.md`. Worked examples:

```markdown
### [HIGH] AC4 not met — endpoint has no test proving p95 < 200 ms
**File:** `services/search/api.py:48`
**Maps to:** AC4 (the slice declares "search SHALL return within 200 ms p95")
**Impact:** The declared latency budget is unproven and the query is unindexed — a regression past 200 ms ships silently.
**Fix:** Add the index on `documents(tenant_id, created_at)` the access pattern needs, and a test that drives a representative dataset and asserts the p95 budget.
```

```markdown
### [MEDIUM] unbounded-read — list endpoint selects with no LIMIT or pagination
**File:** `services/orders/list.py:31`
**Maps to:** thin floor (no NFR AC declares this — advisory)
**Impact:** Returns the full table; latency and memory grow linearly with order count and will degrade as the table grows.
**Fix:** Add a `LIMIT` + cursor pagination (mirror `services/invoices/list.py`). Advisory — does not block this slice.
```

- Cross-references use the AC/floor-rule label, the quoted title, or `F1`/`F2`.
- BAD/GOOD snippets help when the fix shape is non-obvious (the atomic/streaming rewrite); the maps-to + fix sentence is enough for a plain missing-bound.

Hand the collected findings back to the dispatching `axis-reviewer` (fan-out) or `reviewer` (fallback) — it owns comment composition, the severity-count summary, the verdict line, and posting. This skill never sets the verdict.
