---
name: pattern-reviewer-vite
description: "Vite audit: stack choice (Vite for CSR, Next for SSR/SSG/SEO); `VITE_` prefix on every client-exposed `import.meta.env` read; `VITE_` is NOT a security boundary (secret-shaped `VITE_*` is HIGH); `loadEnv(..., '')` leaks server secrets; `.env.example` mirrors every `VITE_*`; type-check gap (no `tsc --noEmit`); prod sourcemap without Sentry; route-boundary lazy-load. Activate when the diff touches `vite.config.*`, `vitest.config.*`, or `import.meta.env` reads."
---

# pattern-reviewer-vite

## When to activate

- Reviewing a diff that touches `vite.config.*`, `vitest.config.*`, `import.meta.env` reads, or Vite-served static assets.
- A user says "review the Vite config / dev-server proxy / bundle setup".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-vite.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Where to look

Run these sweeps before walking the patterns — each feeds the matching check below:

```bash
rg "import\.meta\.env\." src/            # every env read → prefix, secret-shape, .env.example row
rg "loadEnv\(" vite.config.*             # prefix discipline on the third argument
rg "sourcemap" vite.config.*             # prod source-map exposure
rg "vite preview" Dockerfile* *compose*  # preview serving production
rg "server\.|host|port" vite.config.*    # host binding (when a dev Dockerfile exists) + committed port overrides
rg "lazy\(" src/ && rg "Suspense" src/   # split points vs fallbacks
```

Also open: `.env.example` (diff against the `VITE_*` reads found above), the CI workflow + `package.json` scripts (look for `tsc --noEmit` / `vite-plugin-checker` — its absence is the type-check gap), and any `index.ts` barrel re-exports imported from hot-path modules.

## Patterns to review

### Stack choice (HIGH)

- Vite picked for an app that needs SSR / SSG / ISR / SEO / file-based routing / server components → flag and recommend Next.js.
- Next picked for a pure-CSR internal tool / dashboard / embedded widget → flag (overkill).

### `VITE_` prefix (HIGH)

- `import.meta.env.SOMETHING` without the `VITE_` prefix → flag: Vite won't inline the value, so the read returns `undefined` in production.
- Same env var read in multiple components / hooks instead of through a single typed accessor module → MEDIUM (centralize).

```ts
// BAD — no prefix; undefined in prod
const apiUrl = import.meta.env.API_URL;

// GOOD — VITE_ prefix + centralized accessor
// src/env.ts
export const API_URL = import.meta.env.VITE_API_URL ?? "/api";

// somewhere.ts
import { API_URL } from "@/env";
```

### `.env.example` lockstep (MEDIUM)

- Every `import.meta.env.VITE_*` the code reads has a placeholder row in `.env.example`.
- Renamed / removed `VITE_*` not reflected in `.env.example` → flag.
- Server-only secrets without the `VITE_` prefix accidentally exposed via a client-side import → HIGH.

### `vite.config.ts` scope (MEDIUM)

- Build `target`, `resolve.alias`, dev-server `proxy`, `plugins`, `server.port` overrides → yes, here.
- Route-specific logic / app behavior in `vite.config.ts` → flag (belongs in the app).
- Dev-server `proxy` missing for the backend prefix → flag (the SPA can't hit same-origin and cookies / CSRF break in dev).

### Dev-server port (LOW)

- `server.port` overridden in `vite.config.ts` (committed) for slice-isolation reasons → flag; that's a shell-env override (per engineer-pre-push hook rule), not a permanent config change.

### Vitest setup (MEDIUM)

- `test.globals: true` in `vitest.config` without `"vitest/globals"` in `compilerOptions.types` → flag.
- `test.environment: 'jsdom'` missing for component tests that use DOM matchers → flag.
- `vitest.setup.ts` missing the `@testing-library/jest-dom` import that the matchers need → flag.

### Code splitting (MEDIUM)

- A heavy route (`Settings`, dashboard, editor) imported eagerly → flag; lazy via `lazy(() => import(...))`.
- `lazy` without a meaningful `<Suspense fallback={...}>` → flag (default is empty; users see a blank screen).
- Critical-path landing route lazy-loaded → flag (pays cost on the path you most want fast).

```tsx
// BAD — heavy route eager; lazy route with empty fallback
import { Settings } from "./pages/Settings";
const Editor = lazy(() => import("./pages/Editor"));
<Suspense><Editor /></Suspense>

// GOOD — heavy routes split, landing route eager, real fallback
import { Home } from "./pages/Home";
const Settings = lazy(() => import("./pages/Settings"));
<Suspense fallback={<PageSkeleton />}><Settings /></Suspense>
```

### Static assets (LOW)

- Image / font imported as a string URL instead of `import logoUrl from './logo.svg'` → flag (no hashing → cache-busting breaks).
- Asset in `src/` that needs a stable URL (used in `<img src="/assets/...">`) belongs in `public/` → flag.

### Build target (MEDIUM)

- Default `target` (`modules`) shipping to a project that explicitly supports legacy browsers (per project's browserslist / requirements) → flag; bump `target` or add `@vitejs/plugin-legacy`.

### `vite preview` in production (HIGH)

- Production Dockerfile / compose using `vite preview` → flag; serve `dist/` via nginx / static host.

### `loadEnv` prefix discipline (HIGH)

```ts
// BAD — empty prefix loads ALL env vars (server secrets included)
const env = loadEnv(mode, process.cwd(), '');
return { define: { __API_URL__: JSON.stringify(env.API_URL) } };

// GOOD — explicit prefix list
const env = loadEnv(mode, process.cwd(), ['VITE_']);
```

`loadEnv(mode, root, '')` → HIGH security. A later `define: {...}` mistake can inline a server secret into the client bundle.

### Production source maps (HIGH)

- `build.sourcemap: true` (or `'inline'`) in a production config without evidence of upload to an error tracker (Sentry / Bugsnag) → HIGH; ships the original source code publicly.
- Acceptable: `'hidden'` + upload-and-delete pipeline.

```ts
// BAD — original sources served to every visitor
export default defineConfig({ build: { sourcemap: true } });

// GOOD — maps generated for the tracker, never referenced from the bundle
export default defineConfig({ build: { sourcemap: "hidden" } });
// CI: sentry-cli sourcemaps upload dist/ && rm dist/**/*.map
```

### Type-check gap (HIGH)

- TypeScript project, `vite build` step, no `tsc --noEmit` in CI AND no `vite-plugin-checker` in `vite.config.ts` → HIGH. Type errors silently ship.

### Containerized dev without `server.host: true` (HIGH)

- Project ships a dev Dockerfile / dev compose service but `vite.config.ts` leaves `server.host` unset (defaults to `localhost`) → HIGH. The container binds 127.0.0.1; the host can't reach the dev server.

### Barrel files in the hot path (MEDIUM)

- `index.ts` files that re-export an entire directory's exports, imported by hot-path modules → MEDIUM. Each import loads every re-export; this is the #1 dev-server slowdown flagged by Vite docs.

### Hand-rolled `resolve.alias` duplicating `tsconfig.paths` (LOW)

- `vite.config.ts` lists `resolve.alias` entries that already exist in `tsconfig.json` `compilerOptions.paths` → LOW. Recommend `vite-tsconfig-paths`; eliminates the two-place edit.

### `VITE_` prefix as a security boundary (HIGH)

- A secret-shaped value (token, API key, signing secret, DB URL) stored in a `VITE_*` env var and read from `import.meta.env` → HIGH. `VITE_*` values are statically inlined into the shipped JS and extractable by anyone with a DevTools console; secrets must live server-side.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
