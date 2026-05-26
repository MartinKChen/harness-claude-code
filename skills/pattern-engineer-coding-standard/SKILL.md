---
name: pattern-engineer-coding-standard
description: "Language-agnostic coding standards. Contract is iron: implement the task's `Done criteria`, `docs/api-contract/*`, `docs/data-model/*`, and binding ADRs verbatim — halt on ambiguity, never invent. Priority: Readability → KISS → DRY → YAGNI. Verb-noun names with boolean predicates; immutable data by default (prefer `map`/`filter`/`reduce`); narrow error handling at boundaries; parallel-by-default async (`Promise.all` / `asyncio.gather` / `errgroup`); strongest types (no `any`); AAA tests with behavior-stating names; files 200–400 lines (800 cap); refactor and feature stay in separate commits; flag long functions, deep nesting, magic numbers. Activate when writing or reviewing source code."
---

# pattern-engineer-coding-standard

## When to activate

Activate when writing, editing, refactoring, or reviewing any source file or test in any language. Skip for pure formatting, comment-only edits, or conceptual questions.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-coding-standard.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Contract is iron (non-negotiable)

Published contracts decide shape; this skill (and language-specific patterns) decide how to express it. Code conforms to the contract, never the reverse.

The **contract** = whichever of these apply to the change:

- The task issue's `Done criteria` (acceptance) and `Scenarios` (behavior) — the unit-of-work spec.
- `docs/api-contract/<entity>.yaml` for any API resource touched — path (including trailing-slash spelling), HTTP verb, request body schema, response body schema, status codes per outcome, error envelope shape + `code` values, `Idempotency-Key` policy, rate-limit budget, versioning notes.
- `docs/data-model/<entity>.yaml` for any persistence entity touched — table / collection names, column types, constraints, indexes.
- `docs/architecture-decision-record/<adr>.md` for any decision that constrains the change (referenced from the ADR index).

Rules:

- **Implement the contract verbatim.** Match names, shapes, status codes, types, and constraints exactly — including spelling, casing, and trailing-slash conventions.
- **Halt and surface on ambiguity.** If the contract is missing for a touched endpoint / entity, or is internally contradictory, or contradicts the task body — stop and ask. Do not invent shape to keep moving.
- **Disagreement is a question, not a code change.** If the contract looks wrong, open a question on the task. Never silently ship code that contradicts a published contract.
- **Code may be stricter than the contract, never looser.** A contract-declared `max_length: 100` may be enforced more tightly only if the task asks for it; it may not be relaxed.
- **No invented endpoints, fields, error codes, or columns.** If the contract doesn't declare it, it doesn't exist in this change.

This rule overrides the priority hierarchy below. Readability / KISS / DRY / YAGNI choose between conforming implementations — they never license a deviation from the contract.

### Priority

Apply in this order when principles conflict (and only within contract-conforming options): **Readability → KISS → DRY → YAGNI**.

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

- Validate at system boundaries (user input, external APIs). Never trust external data — schema-check before use. Trust internal callers.
- Catch the narrowest exception that applies.
- Re-raise with cause (`raise ... from e`); don't swallow.
- Don't add fallbacks for scenarios that can't happen.

### File + change sizing

- Many small files > few large files: high cohesion, low coupling. Target 200–400 lines per file; treat 800 as the hard cap.
- Don't bundle a refactor with a feature change — submit them as separate commits / PRs. Tiny cleanups (rename, dead-import delete) inside a feature change are fine.

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
