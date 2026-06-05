---
name: pattern-engineer-typescript
description: "TypeScript bullets: `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + the no-implicit/no-fallthrough flags; no `any` (use `unknown` at boundaries, narrow); no `!` without a documented invariant; `type` for unions, `interface` for extendable shapes; discriminated unions; wrap `JSON.parse`; never `forEach(async)`; schema-validate untrusted objects before merge; explicit return types on public exports. Activate when editing TypeScript or `tsconfig.json`."
---

# pattern-engineer-typescript

## When to activate

Activate when editing any `.ts` / `.tsx` file, `tsconfig.json`, type-only declarations, generics, or TypeScript-specific tooling (tsc, biome's TS rules). Applies to both frontend and Node/TS backend code. Skip for `.js` / `.jsx` files in JS-only projects.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-typescript.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### tsconfig — non-negotiable flags

Copy the block in `templates/tsconfig.json` into the project's `tsconfig.json`. The required `compilerOptions`:

- `"strict": true` — enables `strictNullChecks`, `noImplicitAny`, and friends in one knob.
- `"noUncheckedIndexedAccess": true` — `arr[i]` is `T | undefined`, not `T`. Forces an explicit narrow before use.
- `"exactOptionalPropertyTypes": true` — `{ x?: string }` is `string | undefined`, not `string | undefined | unset`. No silent `undefined` in places that should be missing-key.
- `"noImplicitReturns": true` — every branch in a function returns.
- `"noFallthroughCasesInSwitch": true` — `switch` cases must `break` / `return` / `throw`.
- `"noImplicitOverride": true` — method overrides require the `override` keyword.
- `"types": [...]` — include the test-matcher types your tests use (`@testing-library/jest-dom`, `vitest/globals`). Land the `types` entry alongside (or one chore-scoped commit before) the first test that uses those matchers — without it, `tsc --noEmit` fails the Docker build.

### Type discipline

- **No `any`.** Use `unknown` at boundaries (external input, JSON parsing, dynamic imports); narrow with a type guard before use.
- **No `!` non-null assertion** unless paired with an inline comment explaining the invariant that guarantees non-null at that point (e.g., `enabled: !!groupId` upstream).
- **`type` for unions / intersections / mapped types.** `interface` for object shapes that consumers may extend.
- **Discriminated unions over "together" optional fields.** `{ status: "success"; data: T } | { status: "error"; error: Error }` over `{ data?: T; error?: Error }`. Exhaustive `switch` checking comes for free.
- **Brand primitive types when the value carries an invariant.** `type UserId = number & { readonly __brand: 'UserId' }` beats raw `number` once a value crosses module boundaries.
- **Type props explicitly.** `function Component(props: Props)` over relying on inference for the public API.

### Imports + module shape

- **Don't hand-order imports.** Biome's `organizeImports` owns the order — stdlib → third-party → `@/...` alias → relative; sorted within each group.
- Run `npx biome check --write .` after non-trivial edits so the import block matches what `assist/source/organizeImports` expects (biome v2 moved import-organizing from a lint rule to an assist action; the command is unchanged).
- Use path aliases (`@/components/Foo`) from `tsconfig.paths`; mirror in `vite.config.ts` / `vitest.config.ts` so test runs resolve them.
- Re-export sparingly. Barrel files (`index.ts` that re-exports) are fine for a public API surface; gratuitous re-exports leak into the bundle.

### `unknown` and narrowing

- Parsed JSON, `localStorage` reads, `fetch().json()` results all start as `unknown`. Validate with a Zod schema (or a hand-rolled type guard) at the boundary.
- Type guards return `value is T`: `function isUser(x: unknown): x is User { return … }`.
- Prefer narrowing via discriminant property (`if (msg.kind === "error")`) over `instanceof` for tagged unions.

### Generics

- Constrain generic parameters when the function relies on a property: `function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>`.
- Don't add generics "for flexibility" if no caller benefits — the unused generic parameter becomes `unknown` and dilutes type safety.

### Errors

- Native `Error` is fine for ad-hoc throws; subclass `Error` when callers need to discriminate (`AuthError`, `ValidationError`).
- Don't `throw` non-Error values; `unknown` thrown is a productivity tax for every catcher.
- Type the catch parameter: `try { … } catch (err) { if (err instanceof AuthError) … }`.
- Wrap `JSON.parse` in try/catch — invalid input throws and bubbles past most call sites silently.

### Runtime correctness traps

- Use `===` / `!==`; `==` does implicit coercion (`0 == ''`, `null == undefined`) and is almost never what you want.
- No `array.forEach(async fn)` — `forEach` ignores the returned promise. Use `for...of` for sequential or `await Promise.all(array.map(...))` for parallel.
- No `fs.readFileSync` / sync I/O inside a request handler or any hot async path — blocks the event loop.
- Never merge an untrusted object into a target without schema validation (prototype pollution). `Object.assign(target, JSON.parse(req.body))` is a vector; parse with Zod first.
- Public exports get explicit return types — inference is fine for internal callers but a public seam without a stated return type drifts silently.

### Common traps

- **`any` in `as` casts.** `value as any as T` round-trips through `any` to launder the type. If you need it, the validation belongs upstream.
- **Empty interfaces.** `interface Props {}` matches everything — usually a forgotten extension; either delete or fill in.
- **`Function` and `Object`.** Avoid; use `(...args: never[]) => unknown` and `Record<string, unknown>` (or a narrower shape).
- **`enum` for fixed strings.** Modern TS prefers `const` object + `keyof typeof` or a literal union — fewer runtime artifacts.
- **Mixing `import type` with runtime imports.** Use `import type { Foo }` for type-only; biome will rewrite `import { type Foo }` consistently.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/tsconfig.json` | Drop-in `compilerOptions` with the project's required strictness flags + `types` entries; copy into the project's `tsconfig.json` and layer project-specific options on top. |
