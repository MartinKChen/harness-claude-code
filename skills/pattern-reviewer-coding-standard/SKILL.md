---
name: pattern-reviewer-coding-standard
description: "Language-agnostic code-quality review patterns: Pre-Report Gate (cite line, name failure mode, read context, defend severity); HIGH/CRITICAL require proof; zero findings is valid; common-false-positives list; code-quality bars (large functions/files, deep nesting, missing error handling, mutation, dead code); plus performance, best-practices, and AI-code checks. Each finding is confidence-filtered, severity-graded, cited as `file:line`. Activate when reviewing source code; skip `type:e2e`."
---

# pattern-reviewer-coding-standard

## When to activate

- The dispatched caller is reviewing a `type:backend` / `type:frontend` task's production-code diff.
- A user says "review this diff for quality", "look for bugs", "audit the change".
- Do NOT activate for `type:e2e`.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-coding-standard.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## References

| Reference | When to read |
|-----------|--------------|
| `templates/review-comment.md` | Always read before composing the comment body. The finding rows must match this shape verbatim so downstream fix passes can parse them. |

## Iron rules for every finding

- **>80% confidence filter.** Report only when you are >80% confident. Skip stylistic preferences unless they violate a documented convention. Skip issues in unchanged code unless they are CRITICAL security. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block (or a one-sentence fix when a snippet is overkill).
- **Read surrounding code.** Open the full file; follow imports; check call sites. If you cannot understand the change without more context, say so.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are reported but informational. Use the per-pattern severity assigned below. Never inflate to draw attention; never deflate to avoid friction.
- **Never refer to a finding as `#N`.** GitHub auto-links `#1`, `#2`, … to issues. Use a non-numeric handle: quoted title, `F1` / `F2`, or `Finding 1` / `Finding 2`.
- **Match project conventions.** Read `CLAUDE.md` and every ADR in `docs/ADRs/`. A diff that contradicts an active ADR is a finding, not a stylistic call.
- **Never suggest destructive actions.** If a fix would require `git reset --hard`, `--no-verify`, or rewriting published history, surface the underlying problem.

## Pre-Report Gate

Before you write a finding, answer all four questions. If any answer is **no** or **unsure**, downgrade the severity or drop the finding.

1. **Can I cite the exact line?** Name the file and line. Vague findings like "somewhere in the auth layer" are not actionable and must be dropped.
2. **Can I describe the concrete failure mode?** Name the input, state, and bad outcome. If you cannot name the trigger, you are pattern-matching, not reviewing.
3. **Have I read the surrounding context?** Check callers, imports, and tests. Many apparent issues are already handled one frame up or guarded by a type.
4. **Is the severity defensible?** A missing JSDoc is never HIGH. A single `any` in a test fixture is never CRITICAL. Severity inflation erodes trust faster than missed findings.

### HIGH / CRITICAL require proof

For any finding tagged HIGH or CRITICAL, the body must include:

- The exact snippet and line number.
- The specific failure scenario: input, state, and bad outcome.
- Why existing guards (types, validation, framework defaults, upstream caller) do not catch it.

If you cannot produce all three, demote to MEDIUM or drop.

### Zero findings is a valid review

A clean review is a valid review. Do not manufacture findings to justify the invocation. If the diff is small, well-typed, tested, and follows the project's patterns, the correct output is a summary with zero rows and a clean verdict. Manufactured findings, filler nits, speculative "consider using X", and hypothetical edge cases without a trigger directly undermine this skill's usefulness.

## Common false positives — skip these

Patterns LLM reviewers commonly mis-flag. Skip unless you have evidence specific to this codebase.

- **"Consider adding error handling"** on a call whose error path is handled by the caller or framework (Express error middleware, React error boundaries, top-level `try/catch`, Promise chains with upstream `.catch`).
- **"Missing input validation"** when the function is internal and its callers already validate. Trace at least one caller before flagging.
- **"Magic number"** for well-known constants: `200`, `404`, `1000` ms, `60`, `24`, `1024`, array index `0` or `-1`, HTTP status codes, single-use local constants whose meaning is obvious from the variable name.
- **"Function too long"** for exhaustive `switch` statements, configuration objects, test tables, or generated code. Length is not complexity.
- **"Missing JSDoc / docstring"** on single-purpose internal helpers whose name and signature are self-describing.
- **"Prefer `const` over `let`"** when the variable is reassigned. Read the whole function before flagging.
- **"Possible null dereference"** when the preceding line narrows the type or an `if` guard is in scope. Trace type flow instead of pattern-matching on `?.`.
- **"N+1 query"** on fixed-cardinality loops (iterating a four-element enum) or on paths already using `DataLoader` / batching.
- **"Missing await"** on fire-and-forget calls that are intentionally detached (logging, metrics, background queue pushes). Check for a comment or `void` prefix before flagging.
- **"Should use TypeScript / Should have types"** in a JavaScript-only file. Match the project's existing language; do not suggest a stack change.
- **"Hardcoded value"** for values in test fixtures, example code, or documentation snippets. Tests should have hardcoded expectations.
- **Security theater:** flagging `Math.random()` in a non-cryptographic context (animation, jitter, sampling), or flagging `eval` / `Function` in a plugin system that is explicitly a code-loading surface.

When tempted to flag one of the above, ask: "Would a senior engineer on this team actually change this in review?" If no, skip.

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
