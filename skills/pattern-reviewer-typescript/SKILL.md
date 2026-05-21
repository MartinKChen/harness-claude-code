---
name: pattern-reviewer-typescript
description: "TypeScript audit: `tsconfig.json` strictness (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`); `compilerOptions.types` includes test-matcher types; `any` usage (and `as any` laundering); `!` non-null assertions without documented invariant; `interface` vs `type` choice; together-optional fields that should be discriminated unions; biome `organizeImports` violations; `import type` consistency. Cites `file:line` with BAD/GOOD snippets."
---

# pattern-reviewer-typescript

TypeScript-specific audit catalogue. Engineer-side bullets live in `pattern-engineer-typescript`. General code quality lives in `pattern-reviewer-coding-standard`.

## When to activate

- Reviewing a diff that includes `.ts` / `.tsx` / `tsconfig.json` files.
- A user says "review the TypeScript usage / strictness / types".

## Iron rules

See `pattern-reviewer-coding-standard` for citation, severity, finding-shape, and `#N` rules.

## Patterns to review

### `tsconfig.json` strictness (HIGH)

Compare against `templates/tsconfig.json`. Required `compilerOptions`:

- `"strict": true`
- `"noUncheckedIndexedAccess": true`
- `"exactOptionalPropertyTypes": true`
- `"noImplicitReturns": true`
- `"noFallthroughCasesInSwitch": true`
- `"noImplicitOverride": true`

Missing any of these → HIGH. Flag the missing flags by name.

### `compilerOptions.types` for test matchers (HIGH)

- `compilerOptions.types` must include `@testing-library/jest-dom` (or whatever matcher package the project uses) and `vitest/globals` if globals are enabled.
- Without it, `toBeInTheDocument()` / `toHaveValue()` compile but fail `tsc --noEmit` and break the frontend Docker build — surfacing as "image build broken" instead of "missing types".
- Land the `types` entry in the same commit as the first test that uses jest-dom matchers, or one chore-scoped commit before.

### `any` usage (HIGH)

```ts
// BAD — any erases the type system
function load(payload: any): User { return payload; }

// BAD — laundering through any
const user = data as any as User;

// GOOD — unknown at the boundary, narrow before use
function load(payload: unknown): User {
  return UserSchema.parse(payload);
}
```

Flag every `: any` annotation and every `as any` cast. Exception: third-party type-only declaration shims, with an inline comment.

### `!` non-null assertion (MEDIUM)

```tsx
// BAD — no invariant explained
const user = users.find(u => u.id === id)!;

// GOOD — invariant documented OR narrowed
const user = users.find(u => u.id === id);
if (!user) throw new Error(`user ${id} missing`);

// GOOD — invariant lives in an upstream guard
useQuery({
  queryKey: ["user", id],
  queryFn: () => getUser(id!),  // enabled: !!id is the invariant
  enabled: !!id,
});
```

`!` without a documented invariant → MEDIUM.

### `interface` vs `type` (LOW)

- `type` for unions, intersections, mapped types.
- `interface` for object shapes consumers may extend.
- Empty `interface Props {}` → flag (matches everything; usually a forgotten extension).

### Discriminated unions (MEDIUM)

```ts
// BAD — fields that "go together" but aren't tagged
type Fetch<T> = { data?: T; error?: Error; loading: boolean };

// GOOD — discriminated union; exhaustive switch checking
type Fetch<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };
```

### Biome `organizeImports` (LOW)

- Hand-ordered imports that violate biome's grouping (stdlib → third-party → `@/...` alias → relative; sorted within each group) → flag and recommend `npx biome check --write .`.
- Mixed `import { type Foo } from "..."` vs `import type { Foo } from "..."` — biome rewrites consistently; flag drift.

### Banned utility types (LOW)

- `Function` (too broad) → use `(...args: never[]) => unknown` or a precise signature.
- `Object` (too broad) → use `Record<string, unknown>` or a narrower shape.

### `enum` usage (LOW)

- `enum` for fixed strings emits runtime artifacts. Prefer `const` object + `keyof typeof` or a literal union.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/tsconfig.json` | Reference strictness block; compare the project's `compilerOptions` against this. |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
