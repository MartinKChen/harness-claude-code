---
name: pattern-engineer-coding-standard
description: "Language-agnostic coding standards. Priority: Readability → KISS → DRY → YAGNI. Verb-noun names with boolean predicates; immutable data by default (prefer `map`/`filter`/`reduce`); narrow error handling at boundaries; parallel-by-default async (`Promise.all` / `asyncio.gather` / `errgroup`); strongest types (no `any`); AAA tests with behavior-stating names; flag long functions, deep nesting, magic numbers. Activate when writing or reviewing source code."
---

# pattern-engineer-coding-standard

Engineer-side bullet reminders for every implementation task, in every language. Detailed audit criteria + BAD/GOOD examples live in `pattern-reviewer-coding-standard`.

## When to activate

Activate when writing, editing, refactoring, or reviewing any source file or test in any language. Skip for pure formatting, comment-only edits, or conceptual questions.

## Patterns

### Priority

Apply in this order when principles conflict: **Readability → KISS → DRY → YAGNI**.

- **Readability first.** Code is read more than written.
- **KISS.** Simplest solution that works. No clever code when straightforward works.
- **DRY.** Extract on the third occurrence, not the first.
- **YAGNI.** No hypothetical-future complexity. Three similar lines beat a premature abstraction.

### Naming

- Variables: descriptive, no abbreviations (`createdAt`, not `d`).
- Functions: verb-noun (`getUserById`, `validateEmail`).
- Booleans: predicates (`isActive`, `hasPermission`, `canEdit`, `shouldRetry`).

### Immutability

- Default to immutable data; mutation is opt-in.
- Prefer `const` / `final` / `readonly` over reassignable bindings.
- Prefer `map` / `filter` / `reduce` over loops that mutate accumulators.
- Treat function parameters as read-only.
- Mutate only when measurably necessary (hot path, large data) and document why.

### Error handling

- Validate at system boundaries (user input, external APIs). Trust internal callers.
- Catch the narrowest exception that applies.
- Re-raise with cause (`raise ... from e`); don't swallow.
- Don't add fallbacks for scenarios that can't happen.

### Async

- Run independent async work in parallel: `Promise.all`, `asyncio.gather`, `errgroup`, `tokio::join!`.
- Sequential `await` only when each step depends on the previous.

### Types

- Strongest types the language offers. No `any`, no untyped dicts where a struct fits.
- Make illegal states unrepresentable (union types, enums, branded types).
- Prefer compile-time guarantees over runtime checks.

### Tests

- AAA structure: Arrange, Act, Assert — three clear sections.
- Descriptive names that state the behavior, not the function (`returns null when user does not exist`, not `getUser`).
- One behavior per test.

### Code smells (flag and fix as they appear)

- Long functions (>30–50 lines or >1 responsibility) → extract sub-functions.
- Deep nesting (>2–3 levels of `if` / `for`) → early returns / guard clauses.
- Magic numbers / strings → named constants whose name explains the meaning.
- `console.log` / `print` left behind → remove before commit.
- Dead code (commented-out, unused imports, unreachable branches) → delete.

## Related skills

| Skill | Purpose |
|-------|---------|
| `pattern-engineer-backend-standard` | When writing server code. |
| `pattern-engineer-frontend-standard` | When writing React components / hooks. |
| `pattern-engineer-typescript` | When writing TypeScript. |
| `pattern-engineer-python` | When writing Python. |
| `pattern-reviewer-coding-standard` | Detailed audit criteria + BAD/GOOD examples (reviewer lens). |
