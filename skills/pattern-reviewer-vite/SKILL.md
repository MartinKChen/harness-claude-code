---
name: pattern-reviewer-vite
description: "Vite audit: stack choice (Vite for CSR, Next for SSR/SSG/SEO — pick wrong is HIGH); `VITE_` prefix on every `import.meta.env` reading client-exposed value (no prefix means Vite won't inline; a non-VITE var read in client code is dead); `VITE_` prefix is NOT a security boundary (secret-shaped value in `VITE_*` is HIGH); `loadEnv(..., '')` empty-prefix exposes server secrets (HIGH); `.env.example` mirrors every `VITE_*`; `vite.config.ts` owns build target + dev proxy + plugins + alias (not route logic); type-check gap (no `tsc --noEmit` / `vite-plugin-checker`) → HIGH; production `build.sourcemap: true` without Sentry upload (HIGH); containerized dev without `server.host: true` (HIGH); barrel-file dev slowdown; vitest config aligned with tsconfig types; lazy-load at route boundaries with meaningful Suspense; static-asset imports for hashed URLs."
---

# pattern-reviewer-vite

## When to activate

- Reviewing a diff that touches `vite.config.*`, `vitest.config.*`, `import.meta.env` reads, or Vite-served static assets.
- A user says "review the Vite config / dev-server proxy / bundle setup".

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

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
