---
name: pattern-reviewer-vite
description: "Vite audit: stack choice (Vite for CSR, Next for SSR/SSG/SEO — pick wrong is HIGH); `VITE_` prefix on every `import.meta.env` reading client-exposed value (no prefix means Vite won't inline; a non-VITE var read in client code is dead); `.env.example` mirrors every `VITE_*`; `vite.config.ts` owns build target + dev proxy + plugins + alias (not route logic); vitest config aligned with tsconfig types; lazy-load at route boundaries with meaningful Suspense; static-asset imports for hashed URLs."
---

# pattern-reviewer-vite

Vite-specific audit catalogue. Engineer-side bullets live in `pattern-engineer-vite`. React patterns live in `pattern-reviewer-frontend-standard`; TypeScript in `pattern-reviewer-typescript`.

## When to activate

- Reviewing a diff that touches `vite.config.*`, `vitest.config.*`, `import.meta.env` reads, or Vite-served static assets.
- A user says "review the Vite config / dev-server proxy / bundle setup".

## Iron rules

See `pattern-reviewer-coding-standard` for citation, severity, finding-shape, and `#N` rules.

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

- `test.globals: true` in `vitest.config` without `"vitest/globals"` in `compilerOptions.types` → flag (cross-references `pattern-reviewer-typescript`).
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

- Production Dockerfile / compose using `vite preview` → flag; serve `dist/` via nginx / static host (see `pattern-engineer-container` frontend block).

## Constructing the finding

Use the shape in `templates/review-comment.md`.
