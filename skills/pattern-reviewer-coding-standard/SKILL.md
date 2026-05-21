---
name: pattern-reviewer-coding-standard
description: "Language-agnostic code-quality review patterns: code-quality bars (large functions / files / deep nesting / missing error handling / mutation / dead code), performance (algorithmic, repeated work), best practices (TODO without ticket, single-letter vars, magic numbers, inconsistent formatting), AI-generated-code addendum. Each finding is >80% confidence-filtered, severity-graded, cited as `file:line` with BAD/GOOD snippets, named with a non-numeric handle. Comment shape under `# Code Review` in `templates/review-comment.md`. Skip for `type:e2e`."
---

# pattern-reviewer-coding-standard

Language-agnostic code-quality audit catalogue for a scoped diff. Tech-specific audit (React, Node/backend, Python, TypeScript, FastAPI, Vite, container, database, observability) lives in the per-tech `pattern-reviewer-*` skills. Security lives in `pattern-reviewer-security`. Test coverage lives in `pattern-reviewer-test-coverage`.

## When to activate

- The dispatched caller is reviewing a `type:backend` / `type:frontend` task's production-code diff.
- A user says "review this diff for quality", "look for bugs", "audit the change".
- Do NOT activate for `type:e2e` (use `pattern-reviewer-test-coverage`).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows must match this shape verbatim so downstream skills (`workflow-engineer-fix-task`) can parse them. |

## Iron rules for every finding

- **>80% confidence filter.** Report only when you are >80% confident. Skip stylistic preferences unless they violate a documented convention. Skip issues in unchanged code unless they are CRITICAL security. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block (or a one-sentence fix when a snippet is overkill).
- **Read surrounding code.** Open the full file; follow imports; check call sites. If you cannot understand the change without more context, say so.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are reported but informational. Use the per-pattern severity assigned below. Never inflate to draw attention; never deflate to avoid friction.
- **Never refer to a finding as `#N`.** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: quoted title, `F1` / `F2`, or `Finding 1` / `Finding 2`.
- **Match project conventions.** Read `CLAUDE.md` and every ADR in `docs/ADRs/`. A diff that contradicts an active ADR is a finding, not a stylistic call.
- **Never suggest destructive actions.** If a fix would require `git reset --hard`, `--no-verify`, or rewriting published history, surface the underlying problem.

## Patterns to review

Walk the patterns in order. Apply the >80% confidence filter. Consolidate duplicates.

### Code quality (HIGH)

- **Large functions** (>50 lines) — split into smaller, focused units.
- **Large files** (>800 lines) — extract modules by responsibility.
- **Deep nesting** (>4 levels) — early returns, extract helpers.
- **Missing error handling** — unhandled rejections, empty catch blocks.
- **Mutation patterns** — prefer immutable ops (spread, `map` / `filter`, `reduce`).
- **`console.log` / `print` left behind** — remove debug logging before merge.
- **Dead code** — commented-out code, unused imports, unreachable branches.

```typescript
// BAD: deep nesting + mutation
function processUsers(users) {
  if (users) {
    for (const user of users) {
      if (user.active) {
        if (user.email) {
          user.verified = true;
          results.push(user);
        }
      }
    }
  }
  return results;
}

// GOOD: early returns + immutability + flat
function processUsers(users) {
  if (!users) return [];
  return users
    .filter(user => user.active && user.email)
    .map(user => ({ ...user, verified: true }));
}
```

### Performance (MEDIUM)

- **Inefficient algorithms** — O(n²) when O(n log n) or O(n) is available.
- **Repeated expensive computations** without memoization on hot paths.
- **Large bundle imports** — importing entire libraries when tree-shakeable alternatives exist.
- **Synchronous I/O** in async contexts.

Framework-specific performance (React re-renders, N+1 queries, virtualization) lives in the per-tech skills.

### Best practices (LOW)

- **TODO / FIXME without tickets** — reference an issue number.
- **Missing JSDoc / docstrings on public APIs** — exported functions undocumented when non-obvious.
- **Single-letter / generic variable names** (`x`, `tmp`, `data`) in non-trivial contexts.
- **Magic numbers / strings** without a named constant.
- **Inconsistent formatting** — mixed semicolons, quote styles, indentation. (Most should be auto-fixed by formatter; flag only when formatter wasn't run.)

### AI-generated-code addendum

When reviewing AI-authored changes, prioritize:

1. Behavioral regressions and edge-case handling.
2. Security assumptions and trust boundaries.
3. Hidden coupling or accidental architecture drift.
4. Unnecessary model-cost-inducing complexity.

Cost-awareness:

- Flag workflows that escalate to higher-cost models without a clear reasoning need.
- Recommend defaulting to lower-cost tiers for deterministic refactors.

## Constructing the finding

```markdown
### [SEVERITY] <one-line title — no leading `#N`>
**File:** `path/to/file.ext:42`
**Issue:** <what is wrong and why it matters, one or two sentences>
**Fix:** <concrete corrective action>

```<lang>
// BAD
<offending snippet>
```

```<lang>
// GOOD
<corrected snippet>
```
```

- `[SEVERITY]` is exactly one of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, per the pattern's bar above.
- LOW findings can collapse the BAD/GOOD block when a one-line `**Fix:**` suffices.

Hand the collected findings back to the dispatching `reviewer` agent — it owns comment composition, severity counts, verdict, scope note, posting.

## Related skills

| Skill | Purpose |
|-------|---------|
| `pattern-reviewer-frontend-standard` | React-specific audit (HIGH). |
| `pattern-reviewer-backend-standard` | Node/Backend-agnostic audit (HIGH). |
| `pattern-reviewer-typescript` | TypeScript-specific audit. |
| `pattern-reviewer-python` | Python-specific audit. |
| `pattern-reviewer-fastapi` | FastAPI-specific audit. |
| `pattern-reviewer-vite` | Vite-specific audit. |
| `pattern-reviewer-container` | Docker / compose audit. |
| `pattern-reviewer-database` | Migration audit. |
| `pattern-reviewer-observability` | OTel instrumentation audit. |
| `pattern-reviewer-security` | Detailed security catalogue. |
| `pattern-reviewer-test-coverage` | Test-coverage audit. |
