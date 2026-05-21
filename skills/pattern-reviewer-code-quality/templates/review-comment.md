# Code Review

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 0     | pass   |
| MEDIUM   | 0     | pass   |
| LOW      | 1     | note   |

**Verdict:** <APPROVE or BLOCK — set by the dispatching `reviewer` agent, not by this skill>

<!--
  Optional — include only when the scope had to fall back:
  **Note:** No `Refs #<task-#>` trailers found on the slice branch — review scoped to the full diff vs. `origin/main`.
-->

## Findings

### [CRITICAL] <one-line title — no leading `#N`>
**File:** `path/to/file.ext:42`
**Issue:** <what is wrong and why it matters in one or two sentences>
**Fix:** <concrete corrective action>

```<lang>
// BAD
<offending snippet>
```

```<lang>
// GOOD
<corrected snippet>
```

### [HIGH] <one-line title>
**File:** `path/to/file.ext:120`
**Issue:** <…>
**Fix:** <…>

```<lang>
// BAD
<snippet>
```

```<lang>
// GOOD
<snippet>
```

### [MEDIUM] <one-line title>
**File:** `path/to/file.ext:88`
**Issue:** <…>
**Fix:** <…>

```<lang>
// BAD
<snippet>
```

```<lang>
// GOOD
<snippet>
```

### [LOW] <one-line title>
**File:** `path/to/file.ext:12`
**Issue:** <…>
**Fix:** <…>

<!--
  Comment-shape conventions enforced by `pattern-reviewer-code-quality`:
  - Body MUST begin with the literal header `# Code Review` (downstream skills grep for it).
  - Never refer to a finding as `#N` (N a number) — GitHub auto-links `#1`, `#2`, … to issues.
    Use a non-numeric handle: quoted title, or `F1` / `F2` / `Finding 1` / `Finding 2`.
  - Severity is per-pattern (defined in the skill body). The skill never sets the verdict
    line — the dispatching `reviewer` agent owns APPROVE / BLOCK based on the aggregated
    findings from this skill plus `pattern-reviewer-test-coverage` (and, on the security
    gate, `pattern-reviewer-security`). The agent blocks on any CRITICAL or HIGH;
    MEDIUM and LOW are reported but informational.
-->
