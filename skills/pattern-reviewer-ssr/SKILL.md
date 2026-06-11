---
name: pattern-reviewer-ssr
description: "SSR/hybrid audit (Next.js App Router, SvelteKit/Remix/Nuxt): server secret in the client bundle (CRITICAL); secret behind `NEXT_PUBLIC_` (prefix is not a security boundary, HIGH); `use client` at the page root / non-serializable props; `useEffect` first-render fetch, waterfalls; server action missing validation/re-auth/revalidate; undeclared render mode; hydration hazards; module-level request state (CRITICAL); `try/catch` around `redirect()`. Activate on diffs in `app/`, loaders/actions."
---

# pattern-reviewer-ssr

## When to activate

- Reviewing a diff touching `app/` router files, `pages/` with `getServerSideProps`/`getStaticProps`, `.server.ts` modules, `+page.server.ts` / `+page.ts` / `+layout.server.ts`, Remix / React Router 7 `loader`/`action`/`route` modules, Nuxt server data composables, `"use client"` / `"use server"` directives, server/form actions, `generateMetadata`, or any `process.env` / `$env/*` / `runtimeConfig` read in a frontend framework project.
- A user says "review the server components / data loading / hydration / server actions".

Skip pure-CSR Vite SPAs — `pattern-reviewer-vite` owns those. Adjacent, not owned here: TS → `pattern-reviewer-typescript`; generic UI/a11y → `pattern-reviewer-frontend-standard`; auth/crypto/sanitization → `pattern-reviewer-security`. This pair owns server/client-boundary, rendering, and data-flow concerns unique to SSR frameworks.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-ssr.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below. A server secret reaching the client bundle is CRITICAL.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Where to look

Run these sweeps before walking the patterns — each feeds the matching check below:

```bash
rg "process\.env\.(?!NEXT_PUBLIC_)" app/ src/ components/   # unprefixed env reads → must be server-only
rg "NEXT_PUBLIC_|PUBLIC_|runtimeConfig\.public"             # public-prefixed values → secret-shape check
rg '"use client"' app/ src/                                 # placement (root vs leaf)
rg "use(Effect|SWR)\(|fetch\(" app/ src/                    # client first-render fetches + waterfalls
rg '"use server"|export async function action|actions =' .  # mutations → validation + re-auth + revalidate
rg "revalidatePath|revalidateTag|invalidateAll|refreshNuxtData"  # post-mutation revalidation
rg "export const (dynamic|revalidate|prerender|ssr)" app/   # declared render mode
rg "Date\.now\(|Math\.random\(|new Date\(|toLocaleString|window\.|document\.|localStorage" app/ src/  # hydration hazards
rg "redirect\(|notFound\(|error\(" app/ src/                # then check for enclosing try/catch
```

Also open: server-only modules (DB client, secret accessor) and grep their importers for any `"use client"` file; module top level of route/server files for mutable `let`/`Map`/array holding request data; `<Suspense>` / `defer` / `{#await}` coverage around the slow fetches found above.

## Patterns to review

### Server secret reaching the client bundle (CRITICAL)

Detection: a secret-shaped value (API key, DB URL, signing secret, private token) read from an unprefixed env or a server-only module, then referenced inside a `"use client"` component (or a module one imports). Trace the import chain from the client boundary down.

```tsx
// BAD — secret read inside a client component; inlined into the JS bundle
"use client";
const key = process.env.STRIPE_SECRET_KEY; // shipped to every browser

// GOOD — secret stays server-side; client gets only the result via props/action
// charge.server.ts
import "server-only";
export async function charge(amt: number) {
  const key = process.env.STRIPE_SECRET_KEY; // server-only
  /* ... */
}
```

CRITICAL when the value is secret-shaped and demonstrably reachable from the client bundle. False-positive guard: an unprefixed env read inside a server-only file (`import "server-only"`, `.server.ts`, `$lib/server/*`, a `loader`/`action`/`+page.server.ts`) that no client component imports is correct — do not flag.

### Public prefix as a security boundary (HIGH)

Detection: a secret-shaped value stored in a `NEXT_PUBLIC_*` / SvelteKit `PUBLIC_` / Nuxt `runtimeConfig.public` field.

```ts
// BAD — secret behind the public prefix; statically inlined, extractable from DevTools
const key = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;

// GOOD — only genuinely public values carry the prefix
const url = process.env.NEXT_PUBLIC_API_URL;
```

HIGH — the public prefix exposes the value in shipped JS; it is not a boundary. False-positive guard: public URLs, publishable keys, feature flags, analytics IDs are legitimately prefixed — only flag secret-shaped values.

### `"use client"` placement & serializable props (MEDIUM)

Detection: `"use client"` on a `page.tsx` / `layout.tsx` root; or non-serializable values (functions other than server actions, class instances, raw `Date`/`Map`) passed as props from a server component to a client component.

```tsx
// BAD — whole page is client; loses server rendering, ships everything as JS
"use client";
export default function Page() { /* fetch + interactive UI together */ }

// GOOD — server page fetches; client island handles interaction
export default async function Page() {
  const data = await getData();
  return <Chart data={data} />; // Chart.tsx has "use client"
}
```

MEDIUM. False-positive guard: a genuinely leaf-level interactive route legitimately marks its small component client; server actions are serializable references and may cross the boundary. Remix/RR7/SvelteKit have no `"use client"` — do not flag its absence; check the loader/component split instead.

### Client first-render fetch & waterfalls (HIGH)

Detection: `useEffect`/`useSWR`/`useQuery` fetching data the first paint needs, in a route that has a server-side data seam available; or sequential `await`s on independent fetches at the route boundary.

```tsx
// BAD — first-render data fetched on the client; blank until effect runs; no SSR/SEO
"use client";
useEffect(() => { fetch("/api/user").then(/* setState */); }, []);

// GOOD — fetched at the route boundary, parallelized
const [user, orders] = await Promise.all([getUser(), getOrders()]);
```

HIGH when it defeats SSR for first-render data; MEDIUM for an avoidable waterfall. False-positive guard: client fetching for post-load interactions (infinite scroll, polling, search-as-you-type) is correct — only flag first-render data.

### Server-action validation, re-auth & revalidation (HIGH)

Detection: a `"use server"` action / form `action` / Remix `action` that uses its input without server-side validation, or acts without re-checking authorization, or mutates without a following revalidate.

```ts
// BAD — trusts client-supplied id + role; no revalidation
"use server";
export async function deletePost(formData: FormData) {
  await db.post.delete({ where: { id: formData.get("id") } });
}

// GOOD — validate input, re-check auth server-side, revalidate
"use server";
export async function deletePost(formData: FormData) {
  const id = z.string().uuid().parse(formData.get("id"));
  const user = await requireUser();              // server-side auth re-check
  await db.post.delete({ where: { id, authorId: user.id } });
  revalidatePath("/posts");
}
```

HIGH (missing input validation or re-auth) — client state is untrusted. MEDIUM for a missing `revalidatePath`/`revalidateTag`/`invalidateAll`/`refreshNuxtData` after a mutation. False-positive guard: validation/auth performed in a shared wrapper the action calls counts; don't double-flag. Auth-scheme depth belongs to `pattern-reviewer-security`.

### Render mode declared & not silently flipped (MEDIUM)

Detection: a route that depends on per-request data (`cookies()`, `headers()`, `cache: "no-store"`) without an explicit `export const dynamic`/`revalidate` (Next) / `prerender`/`ssr` (SvelteKit) / `routeRules` (Nuxt); or a route intended static that an incidental dynamic API quietly flipped.

```ts
// BAD — incidental cookies() flips the whole route dynamic, unintentionally
export default async function Page() { const c = cookies(); /* ... */ }

// GOOD — render mode declared, matching intent
export const dynamic = "force-dynamic"; // reads the session cookie
```

MEDIUM. False-positive guard: a route that is correctly dynamic and reads cookies needs no `export const` if the default already matches intent — only flag a mismatch between the data dependency and the declared/implied mode.

### Hydration hazards (HIGH)

Detection: `Date.now()`, `Math.random()`, `new Date()` formatting, `toLocaleString`/`toLocaleDateString` (locale/timezone-dependent), or `window`/`document`/`localStorage`/`navigator` used in the render body of an isomorphic component.

```tsx
// BAD — server and client compute different values → hydration mismatch
return <span>{new Date().toLocaleTimeString()}</span>;

// GOOD — stable server value; client-only formatting in an effect
const [time, setTime] = useState<string | null>(null);
useEffect(() => setTime(new Date().toLocaleTimeString()), []);
return <span suppressHydrationWarning>{time ?? createdAt}</span>;
```

HIGH — hydration mismatches cause re-renders, flicker, and lost state. False-positive guard: these calls inside `useEffect`/`onMount`/event handlers (client-only) are fine; a passed-in stable timestamp formatted with an explicit timezone is fine; `suppressHydrationWarning` with a comment explaining a deliberate mismatch is acceptable.

### Module-level request state (CRITICAL)

Detection: a top-level mutable binding (`let`, a `Map`/`Set`/array/object reassigned or mutated) in a server module that stores user- or request-specific data — the server runtime is shared, so it leaks across requests.

```ts
// BAD — module global holds the current request's user → leaks to other requests
let currentUser: User | null = null;
export function setUser(u: User) { currentUser = u; }

// GOOD — request context via the framework API, never a global
import { cookies } from "next/headers";
export function getUser() { return resolveUser(cookies().get("session")); }
```

CRITICAL when the global holds per-request/per-user data. False-positive guard: module-level *immutable* constants, config loaded once, and genuinely process-wide singletons (a DB connection pool, a compiled regex) are fine — only flag mutable state carrying request identity.

### Streaming / Suspense boundaries (MEDIUM)

Detection: a route that serially `await`s a slow fetch at the top before rendering anything, with no `<Suspense>` (Next) / `defer`+`Await` (RR7) / `{#await}` (SvelteKit) around the slow part.

```tsx
// BAD — whole page blocks on the slow call
const recs = await getSlowRecommendations();
return <Page recs={recs} />;

// GOOD — shell streams immediately; slow part suspends with a skeleton
return <><Header /><Suspense fallback={<Skeleton />}><Recs /></Suspense></>;
```

MEDIUM. False-positive guard: a small/fast fetch needs no Suspense boundary; only flag a slow, independent fetch blocking the shell.

### `try/catch` swallowing control-flow throws (HIGH)

Detection: a `redirect()` / `notFound()` (Next), SvelteKit `error()`/`redirect()`, or returned/thrown framework signal inside a `try` block whose `catch` swallows it (logs and continues, or returns a fallback). These helpers work by throwing; catching them breaks the redirect/404.

```ts
// BAD — catch swallows the redirect; user never navigates
try {
  if (!user) redirect("/login");
  await loadData();
} catch (e) { logger.error(e); return <Error />; }

// GOOD — control-flow helper outside the try (or rethrow the framework signal)
if (!user) redirect("/login");
try { await loadData(); } catch (e) { logger.error(e); return <Error />; }
```

HIGH. Detection note: look for `redirect(`/`notFound(`/`error(` textually inside a `try` whose `catch` does not rethrow (Next exposes `isRedirectError`/`isNotFoundError`; SvelteKit lets its signals propagate). False-positive guard: a `catch` that rethrows the framework error (or only catches a narrower typed error) is correct — don't flag.

### Auth cookies not httpOnly (HIGH)

Detection: a session/auth cookie set without `httpOnly`, or auth state stored in client-readable storage (`localStorage`, a non-httpOnly cookie) for the session token.

```ts
// BAD — session token readable by any script (XSS-exfiltratable)
cookies().set("session", token); // httpOnly defaults off in some setters
localStorage.setItem("token", token);

// GOOD
cookies().set("session", token, { httpOnly: true, secure: true, sameSite: "lax" });
```

HIGH. False-positive guard: a deliberately client-readable non-secret cookie (theme, locale) is fine. Token rotation / scheme depth → `pattern-reviewer-security`.

### SEO metadata via the framework API (MEDIUM)

Detection: a server-rendered, SEO-relevant page setting `document.title`/meta tags in a client effect instead of `generateMetadata`/static `metadata` (Next), `<svelte:head>` (SvelteKit), or `useSeoMeta`/`useHead` (Nuxt).

MEDIUM. False-positive guard: a purely client-side, non-indexed view (an authed dashboard) updating the tab title in an effect is fine — only flag pages that need crawlable server-rendered metadata.

### Loader/action/handler testability (LOW)

Detection: route handlers / `loader` / `action` / server actions written so business logic is inseparable from the framework request object, with no unit test exercising them as plain functions.

LOW. False-positive guard: thin handlers that only delegate to a tested service need no separate test. Coverage substance → `pattern-test-coverage`; hydration path → E2E.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
