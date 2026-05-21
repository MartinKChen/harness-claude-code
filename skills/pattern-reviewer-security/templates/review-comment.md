# Security Review

## Review Summary

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 0     | pass   |
| HIGH     | 0     | pass   |
| MEDIUM   | 0     | pass   |
| LOW      | 1     | note   |

<!--
  Optional — include only when the scope had to fall back:
  **Note:** No `Refs #<task-#>` trailers found on the slice branch — review scoped to the full diff vs. `origin/main`.
-->

**Verdict:** <APPROVE or BLOCK — set by the dispatching `reviewer` agent, not by this skill>

## Findings

### [CRITICAL] <pattern-name> — <one-line title — no leading `#N`>
**Location:** `path/to/file.ext:42` (or `image: <repo>:<slug>`)
**Required end state:** <quote the `security-patterns` bar verbatim — e.g., "session cookie must be `HttpOnly; Secure; SameSite=Strict`">
**Evidence:**

```<lang>
<offending snippet, or scanner output for image findings>
```

**Fix:**

```<lang>
<corrected snippet, or remediation step — e.g., "bump base image alpine:3.18 → 3.20">
```

### [HIGH] <pattern-name> — <one-line title>
**Location:** `path/to/file.ext:120`
**Required end state:** <quoted bar from `security-patterns`>
**Evidence:**

```<lang>
<snippet>
```

**Fix:** <…>

### [MEDIUM] <pattern-name> — <one-line title>
**Location:** `path/to/file.ext:88`
**Required end state:** <quoted bar from `security-patterns`>
**Evidence:** <…>
**Fix:** <…>

## Image scan

| Image | CRITICAL | HIGH | MEDIUM | LOW |
|-------|----------|------|--------|-----|
| `<repo>:<slug>` | 0 | 0 | 7 | 14 |

Left unfixed (LOW only): <reason — e.g., "no clean upstream fix; will revisit on next base-image bump">.

<!--
  Comment-shape conventions enforced by `pattern-reviewer-security`:
  - Body MUST begin with the literal header `# Security Review` (downstream skills grep for it).
  - Never refer to a finding as `#N` (N a number) — GitHub auto-links `#1`, `#2`, … to issues.
    Use a non-numeric handle: pattern name (`secrets-handling`, `image-cve`),
    quoted finding title, or `F1` / `F2` / `Finding 1` / `Finding 2`.
  - Severity is per the `security-patterns` CVE / pattern bar. The skill never sets the
    verdict line — the dispatching `reviewer` agent owns APPROVE / BLOCK based on the
    aggregated findings (blocks on any CRITICAL or HIGH; MEDIUM and LOW are reported
    but informational).
  - `Required end state` on every finding MUST quote the `security-patterns` bar verbatim —
    paraphrasing breaks the engineer's fix flow.
  - Test files (test_*.py, *.test.*, *.spec.*, conftest.py, backend/tests/**, e2e/**,
    **/__tests__/**) are out of scope — never appear in this report.
-->
