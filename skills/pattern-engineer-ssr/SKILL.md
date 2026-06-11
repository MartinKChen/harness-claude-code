---
name: pattern-engineer-ssr
description: "SSR/hybrid framework bullets (Next.js App Router, SvelteKit/Remix/Nuxt): only `NEXT_PUBLIC_` env reaches the client (not a security boundary), guard `.server.ts` modules; `use client` at the leaf; fetch at the route boundary not `useEffect`; validate+re-auth+revalidate in server actions; declare render mode; hydration-safe (no `Date.now()`/`window`); no module-level request state; Suspense; never `try/catch` a `redirect()`. Activate on `app/` files, server components, loaders/actions."
---

# pattern-engineer-ssr

Server-rendered and hybrid frontend frameworks have a hard server/client boundary that pure-CSR apps don't. These bullets own that boundary, the rendering modes, and the request-scoped data flow — the concerns unique to SSR. Next.js App Router is the primary exemplar; SvelteKit, Remix / React Router 7, and Nuxt idioms are noted parenthetically where the spelling differs.

## When to activate

Activate when editing files under `app/` (Next.js App Router), `pages/` API/data files, React Server Components or `"use client"` modules, Remix / React Router 7 `loader`/`action` exports, SvelteKit `+page.server.ts` / `+page.ts` / `+layout.server.ts`, Nuxt `useAsyncData`/`useFetch`/`server/` routes, anything reading `NEXT_PUBLIC_*` / `$env/*` / `runtimeConfig`, or configuring rendering mode (`export const dynamic`/`revalidate`). Skip for pure-CSR Vite apps — `pattern-engineer-vite` owns those (no SSR/SSG/SEO/server components). TS rules → `pattern-engineer-typescript`; generic UI → `pattern-engineer-frontend-standard`; auth/secrets depth → `pattern-engineer-security`.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-ssr.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Server/client env + module boundary

- Only public-prefixed env vars reach the client bundle: `NEXT_PUBLIC_*` (Next), `$env/static/public` + `PUBLIC_` (SvelteKit), `runtimeConfig.public` (Nuxt). Everything unprefixed stays server-side.
- The public prefix is **NOT a security boundary** — every prefixed value is statically inlined into the shipped JS and trivially extractable. Only public values (API URLs, feature flags, publishable keys) get it; secrets never.
- Read server-only secrets from process env in server code only (`process.env.X`, SvelteKit `$env/static/private` / `$env/dynamic/private`, Nuxt `runtimeConfig.x`) — never imported into a client component.
- Guard server-only modules so they can't be bundled to the client: `import "server-only"` at the top, the `.server.ts` filename convention (Remix / SvelteKit), or keep them under `server/`. A client import then fails the build instead of leaking.

### The "use client" boundary

- Push `"use client"` to the **leaf** interaction component (the button, the form, the chart), not the page/layout root — everything above stays a server component.
- Server components fetch and compose; client components handle state, effects, and event handlers.
- Only serializable props cross the boundary — no functions, class instances, Dates-as-objects, or Symbols passed from server to client. (Remix/SvelteKit: same — `loader`/`load` return must serialize.)

### Data fetching at the route boundary

- Fetch first-render data at the route boundary: the server component body, Remix/RR7 `loader`, SvelteKit `load`, Nuxt `useAsyncData`/`useFetch`. Never a client `useEffect` fetch for data needed on first paint.
- Parallelize independent fetches (`Promise.all`, parallel `await`s) — don't serially chain unrelated requests.
- Use the framework's request-level dedupe/cache (Next `fetch` cache + `cache()`, Nuxt payload, SvelteKit `load` dedupe) instead of a hand-rolled module-level cache.

### Mutations

- Mutate through the framework's server primitive: Next server actions / route handlers, Remix/RR7 `action`, SvelteKit form actions, Nuxt `server/api` routes.
- Validate input AND re-check authn/authz **server-side on every mutation** — client state is untrusted, a hidden field or disabled button proves nothing.
- Revalidate after a successful mutation so cached reads reflect the write: `revalidatePath`/`revalidateTag` (Next), `invalidateAll` (SvelteKit), `refreshNuxtData` (Nuxt), or return fresh data from the Remix `action`.

### Rendering mode

- Choose static / ISR / dynamic per route deliberately and declare it explicitly — `export const dynamic`, `export const revalidate`, `fetch(..., { next: { revalidate } })` (Next); SvelteKit `prerender`/`ssr`/`csr` page options; Nuxt `routeRules`.
- Don't let an incidental `cookies()`/`headers()` call or a `cache: "no-store"` fetch silently flip a page to dynamic — if it must be dynamic, say so; if it shouldn't be, remove the trigger.

### Hydration safety

- Server and client must render identically. No `Date.now()`, `Math.random()`, `new Date()` formatting, or locale-/timezone-dependent output during render without a stable passed-in input.
- Browser-only APIs (`window`, `document`, `localStorage`, `navigator`) only inside effects (`useEffect`/`onMount`) or behind a mounted guard — never in the render path.
- `suppressHydrationWarning` is a last resort (e.g. an intentional timestamp) and needs a comment explaining why the mismatch is expected.

### Per-request isolation

- No module-level mutable state holding user/request data — the server runtime is shared across all requests; a module-scoped variable leaks one user's data to the next.
- Read request context through framework APIs (`cookies()`, `headers()`, `draftMode()` in Next; `event.locals`/`cookies` in SvelteKit; `event` in Nuxt) — never via globals or singletons.

### Streaming

- Wrap slow data in a Suspense / `defer` (Remix `defer`, SvelteKit streamed promises) boundary with a meaningful fallback skeleton — fast content paints immediately.
- Don't serially `await` every fetch at the top of the page; that blocks the whole response on the slowest call.

### Control-flow helpers throw

- `redirect()`, `notFound()` (Next), SvelteKit `error()`/`redirect()`, Remix `redirect()` **throw** — never wrap them in a `try/catch` that swallows the thrown value, or the navigation silently dies. Re-throw or call them outside the `try`.

### Auth cookies

- Set auth/session cookies via the framework's response cookie API as `httpOnly` (Next `cookies().set`, SvelteKit `cookies.set`, Nuxt `setCookie`) — never store the session token in client-readable state or non-`httpOnly` cookies. (Deeper auth substance → `pattern-engineer-security`.)

### SEO metadata

- Emit metadata via the framework metadata API on server-rendered pages: `generateMetadata`/`metadata` export (Next), `<svelte:head>` (SvelteKit), `useSeoMeta`/`useHead` (Nuxt) — not a client-side `document.title` mutation.

### Testing

- Unit-test `loader`/`action`/route handlers as plain functions (call them with a fake request, assert the returned data/response).
- Test client components with React Testing Library (or the framework's component harness).
- The hydration path (server render → client takeover) belongs to E2E, not unit tests.
