---
name: pattern-engineer-vite
description: "Vite implementation bullets: pick Vite for pure CSR (no SSR/SSG/SEO needs); env vars via `import.meta.env` with `VITE_` prefix; Vitest for unit tests; route-boundary code splitting via `lazy(() => import())` + `<Suspense>`; static-asset imports for hashed URLs; `vite.config.ts` for build target, dev-server proxy, plugins, alias. Activate when editing `vite.config.*`, `vitest.config.*`, or scaffolding a Vite-based React app."
---

# pattern-engineer-vite

Vite-specific bullets layered on top of `pattern-engineer-frontend-standard` and `pattern-engineer-typescript`. Detailed audit criteria live in `pattern-reviewer-vite`.

## When to activate

Activate when editing `vite.config.ts` / `vite.config.js`, `vitest.config.ts`, scaffolding a Vite-based React app, switching between Vite and Next.js, configuring dev-server proxy / plugins / aliases, or touching `import.meta.env`. Skip for Next.js apps (use Next-specific patterns instead) or non-frontend code.

## Patterns

### Stack choice

- Pick Vite when the app is pure CSR: internal tools, dashboards behind auth, embedded widgets, prototypes, SPAs where SEO doesn't matter.
- Pick Next.js when the app needs SSR / SSG / ISR, edge runtime, file-based routing, server components, SEO-critical pages, image optimization, or first-class API routes.
- Don't reach for Next.js "just in case." If today's requirements are CSR-only, ship Vite; migrating later is straightforward.

### Env vars

- `import.meta.env.VITE_<NAME>` for env vars exposed to the client. The `VITE_` prefix is mandatory — without it Vite won't inline the value.
- Server-only secrets never get the `VITE_` prefix (Vite refuses to expose them); they live in the backend.
- Read each `import.meta.env.VITE_*` through a single typed accessor module so the call site doesn't repeat the prefix.
- `.env`, `.env.local`, `.env.<mode>.local` are in `.gitignore`; only `.env.example` (placeholders) committed; mirror every `import.meta.env.VITE_*` key.

### Vite config

- `vite.config.ts` owns: build `target` (browser baseline), `resolve.alias` for `@/...`, dev-server `proxy` to the backend, `plugins` (React, Tailwind, etc.), `server.port` if non-default needed.
- Don't put route-specific logic in `vite.config` — that belongs in the app code.
- Proxy backend calls in dev: `server.proxy = { "/api": "http://localhost:8000" }` so the SPA sees same-origin and cookies / CSRF work.

### Vitest

- Use Vitest for unit tests; configure via `vitest.config.ts` (or merge into `vite.config.ts` with `defineConfig`).
- `test.globals: true` if the project uses globals; matching `compilerOptions.types` entry for TS — see `pattern-engineer-typescript`.
- `test.environment: 'jsdom'` for component tests; `'node'` for pure-logic tests.
- Setup file (`vitest.setup.ts`) registers `@testing-library/jest-dom` matchers, MSW handlers, etc.
- `vi.mock(...)` only when there is no seam to inject a fake; prefer dependency injection.

### Code splitting

- Split at route boundaries via `lazy(() => import('./pages/Settings'))` paired with a meaningful `<Suspense fallback={<PageSkeleton />}>`.
- Heavy conditional UI (modals, editors, charts) lazy-loads too; tiny components don't.
- Don't lazy-load the landing route — it pays cost on the critical path.

### Static assets

- Import images / fonts as ES modules to get hashed URLs: `import logoUrl from './logo.svg'`.
- Public assets that need a stable URL go in `public/` (served as-is, no hashing).
- `?url` / `?raw` / `?worker` query-suffix imports for explicit handling.

### Dev server

- `server.port` defaults to 5173; override in `vite.config.ts` (committed) only if the standard collides with another local service.
- Don't override the port via shell env to dodge a one-time conflict — that's the slice-isolation rule from the engineer-pre-push hook, not a permanent config change.
- HMR works out of the box; don't disable it.

### Building for production

- `npm run build` produces hashed assets in `dist/`.
- The container image's `final` stage copies `dist/` into nginx (see `pattern-engineer-container`).
- `vite preview` is for sanity-checking the built bundle locally; never serve `preview` in production.

## Related skills

| Skill | Purpose |
|-------|---------|
| `pattern-engineer-frontend-standard` | Always — React patterns apply. |
| `pattern-engineer-typescript` | Always — TS strictness applies. |
| `pattern-engineer-coding-standard` | Always — language-agnostic standards. |
| `pattern-engineer-container` | When packaging the built `dist/` into an image. |
| `pattern-reviewer-vite` | Detailed audit criteria (reviewer lens). |
