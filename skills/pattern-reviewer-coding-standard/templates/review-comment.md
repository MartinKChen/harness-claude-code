# Code Review

## Review Summary

Every finding is scored on **Impact** (what breaks if it ships) × **Effort/Risk** (cost of fixing in this cycle). The matrix below counts findings by cell; the disposition line below it summarises how those cells project onto the engineer's pickup classes.

| Impact \ Effort | E:L (Low) | E:M (Medium) | E:H (High) |
|-----------------|-----------|--------------|------------|
| **I:H** (High)  | 0         | 0            | 0          |
| **I:M** (Medium)| 0         | 0            | 0          |
| **I:L** (Low)   | 0         | 1            | 0          |

**Fix now:** 0  •  **Deferred:** 1  •  **Nits:** 0

**Verdict:** <APPROVE or BLOCK — set by the dispatching `reviewer` agent. APPROVE if no `I:H` survives; BLOCK if any `I:H` is reported.>

<!--
  Optional — include only when the scope had to fall back:
  **Note:** No `Refs #<task-#>` trailers found on the slice branch — review scoped to the full diff vs. `origin/main`.
-->

## Findings

<!--
  Header convention per finding:
    ### [<Class> · I:<x>/E:<y>] <one-line title — no leading `#N`>
  Where:
    <Class> ∈ {Fix now, Defer, Nit}
    I:<x>   ∈ {I:H, I:M, I:L}    impact — derived mechanically from pattern severity
    E:<y>   ∈ {E:L, E:M, E:H}    effort/risk — reviewer judgement on cost-to-fix-now
-->

### [Fix now · I:H/E:L] <one-line title>
**File:** `path/to/file.ext:42`
**Impact (H):** <what breaks if this ships, in one sentence>
**Effort/Risk (L):** <what fixing it involves — files, tests, blast radius>
**Fix:** <concrete corrective action>

```<lang>
// BAD
<offending snippet>
```

```<lang>
// GOOD
<corrected snippet>
```

### [Fix now · I:H/E:M] <one-line title>
**File:** `path/to/file.ext:120`
**Impact (H):** <…>
**Effort/Risk (M):** <…>
**Fix:** <…>

```<lang>
// BAD
<snippet>
```

```<lang>
// GOOD
<snippet>
```

### [Defer · I:M/E:M] <one-line title>
**File:** `path/to/file.ext:88`
**Impact (M):** <…>
**Effort/Risk (M):** <…>
**Fix:** <concrete corrective action — applied later, not in this cycle>

```<lang>
// BAD
<snippet>
```

```<lang>
// GOOD
<snippet>
```

### [Nit · I:L/E:L] <one-line title>
**File:** `path/to/file.ext:12`
**Impact (L):** <…>
**Effort/Risk (L):** <…>
**Fix:** <…>

<!--
  Comment-shape conventions enforced by `pattern-reviewer-coding-standard`:

  - Body MUST begin with the literal header `# Code Review` (downstream skills grep for it).

  - Never refer to a finding as `#N` (N a number) — GitHub auto-links `#1`, `#2`, … to issues.
    Use a non-numeric handle: quoted title, or `F1` / `F2` / `Finding 1` / `Finding 2`.

  - Impact (I:H / I:M / I:L) is derived mechanically from the pattern's per-rule severity:
      CRITICAL, HIGH → I:H        correctness, security, data loss, contract violation
      MEDIUM         → I:M        degraded UX/perf, missing test for a real path
      LOW            → I:L        style, naming, redundancy, nit

  - Effort/Risk (E:L / E:M / E:H) is the reviewer's judgement on cost-to-fix in *this* cycle:
      E:L  single-file, localized; existing tests cover it; ≲ 30 min
      E:M  multi-file or new tests needed; non-trivial but contained
      E:H  design rework, schema/contract change, broad refactor, unknown blast radius

  - Fix-class is the deterministic projection of (Impact, Effort):
                          Effort →
                          E:L     E:M     E:H
      Impact ↓
        I:H              Fix     Fix     Fix
        I:M              Fix    Defer   Defer
        I:L              Nit    Drop    Drop

    `Drop` findings are suppressed entirely — they never reach the comment. They are the
    finding the reviewer *would* have written under a one-axis severity model and is
    choosing to suppress because the cost-of-fix dwarfs the impact.

  - The verdict line is the dispatching `reviewer` agent's responsibility — APPROVE if no
    `I:H` survives, BLOCK if any `I:H` is reported. Effort/Risk never blocks; it only
    drives the per-finding engineer pickup class.

  - Engineer pickup: `workflow-engineer-fix-*` picks up `Fix now` findings only. `Defer`
    is advisory; `Nit` is optional. See those skills for the contract.
-->
