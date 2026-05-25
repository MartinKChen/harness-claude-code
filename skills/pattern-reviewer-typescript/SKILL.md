---
name: pattern-reviewer-typescript
description: "TypeScript audit: `tsconfig.json` strictness (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride`); `compilerOptions.types` includes test-matcher types; `any` usage (and `as any` laundering); `!` non-null assertions without documented invariant; `interface` vs `type` choice; together-optional fields that should be discriminated unions; biome `organizeImports` violations; `import type` consistency; `eval` / `new Function` / `child_process` on user input (CRITICAL); prototype pollution; `JSON.parse` without try/catch; throwing non-Error values; `==` vs `===`; `forEach(async)`; sync fs in handlers; explicit return types on public exports. Cites `file:line` with BAD/GOOD snippets."
---

# pattern-reviewer-typescript

## When to activate

- Reviewing a diff that includes `.ts` / `.tsx` / `tsconfig.json` files.
- A user says "review the TypeScript usage / strictness / types".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-typescript.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

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

### `eval` / `new Function` on user input (CRITICAL)

```ts
// BAD — user-controlled code executes in the server / browser
const result = eval(req.body.expression);
const fn = new Function("payload", req.body.handler);

// GOOD — never feed untrusted strings to dynamic execution
// If you genuinely need a sandbox, use a vetted sandbox library
// and document the threat model inline.
```

Any `eval(...)` or `new Function(...)` whose argument can be traced to user input → CRITICAL.

### `child_process` with user input (CRITICAL)

```ts
// BAD — shell injection vector
import { exec } from "node:child_process";
exec(`tar -czf ${req.body.archiveName}.tar.gz ./uploads`);

// GOOD — array form, no shell, allowlist the inputs
import { execFile } from "node:child_process";
if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error("bad name");
execFile("tar", ["-czf", `${name}.tar.gz`, "./uploads"]);
```

`exec` / `execSync` with template-string user input → CRITICAL. `execFile` / `spawn` with a list of args and validated input is the fix.

### Prototype pollution (HIGH)

```ts
// BAD — merging untrusted JSON straight into a host object
Object.assign(config, JSON.parse(req.body));
_.merge(target, untrustedSource); // older lodash versions are pollution-prone

// GOOD — schema-validate first; merge only known keys
const Body = z.object({ theme: z.enum(["light", "dark"]) });
const safe = Body.parse(JSON.parse(req.body));
Object.assign(config, safe);
```

Untrusted object merged into a target without a schema → HIGH.

### `JSON.parse` without try/catch (HIGH)

```ts
// BAD — throws SyntaxError on invalid input; un-handled in route handlers
const body = JSON.parse(req.body);

// GOOD — parse + validate at the boundary
let body: unknown;
try { body = JSON.parse(req.body); }
catch { return res.status(400).json({ error: "invalid JSON" }); }
const parsed = BodySchema.parse(body);
```

`JSON.parse` on any value that can come from outside (`req.body`, `localStorage`, websocket frame, file read) without a `try/catch` → HIGH.

### Throwing non-Error values (MEDIUM)

```ts
// BAD — string thrown; catchers lose `.stack` and `.message` typing
throw "user not found";
throw { code: "NOT_FOUND" };

// GOOD
throw new Error("user not found");
class NotFoundError extends Error {}
throw new NotFoundError();
```

Any `throw` whose argument is not an `Error` (string, plain object, number) → MEDIUM.

### `==` instead of `===` (MEDIUM)

```ts
// BAD — implicit coercion: `0 == ""`, `null == undefined`, `"1" == 1`
if (count == 0) { ... }
if (value != null) { ... } // the one historically-acceptable use, but `value !== null && value !== undefined` is clearer

// GOOD
if (count === 0) { ... }
if (value !== null && value !== undefined) { ... }
```

`==` / `!=` outside the deliberate `value != null` idiom → MEDIUM.

### `array.forEach(async fn)` (HIGH)

```ts
// BAD — forEach throws the returned promise away; no awaiting happens
items.forEach(async (item) => { await save(item); });
console.log("done"); // logs before any save resolves

// GOOD — sequential
for (const item of items) { await save(item); }

// GOOD — parallel
await Promise.all(items.map((item) => save(item)));
```

`Array.prototype.forEach` with an `async` callback → HIGH (the callee's promise is dropped on the floor).

### Sync I/O in request handlers (HIGH)

```ts
// BAD — blocks the event loop; one slow disk read stalls every concurrent request
app.get("/config", (req, res) => {
  const data = fs.readFileSync("./config.json", "utf-8");
  res.json(JSON.parse(data));
});

// GOOD — async I/O
import { readFile } from "node:fs/promises";
app.get("/config", async (req, res) => {
  const data = await readFile("./config.json", "utf-8");
  res.json(JSON.parse(data));
});
```

`fs.readFileSync` / `fs.writeFileSync` / `execSync` inside an HTTP handler or any hot async path → HIGH.

### Explicit return types on public exports (MEDIUM)

- Exported functions, hooks, and class methods that cross a module boundary without an explicit return type → MEDIUM (inference drift silently changes the public contract).
- Internal helpers can rely on inference.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/tsconfig.json` | Reference strictness block; compare the project's `compilerOptions` against this. |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
