---
name: pattern-engineer-frontend-standard
description: "React frontend bullets: composition-first components, custom hooks, route registration + entry-source reachability (a real inbound path, not just a passing URL-render test) in one slice, route-param queries gated by `enabled: !!param`, `onSuccess` cache invalidation, idempotency-key rotation on 4xx, API via `src/lib/api`, Context+Reducer state, RHF+Zod forms, per-route error boundaries, native a11y elements, Tailwind ↔ `docs/design-system/tokens.md`. Activate on frontend `.tsx`/`.ts`."
---

# pattern-engineer-frontend-standard

## When to activate

Activate when writing or editing React components, hooks, pages, routes, layouts, forms, modals, lists, tables, or navigation in any React-based app (Next.js or Vite). Skip for pure backend code or non-React frontends.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-frontend-standard.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Component design

- Composition over inheritance: pass behavior as props, structure as children.
- Compound components for related parts (`Tabs` / `Tabs.Tab`) sharing state via internal Context — keep the Context unexported.
- Render props / `children` as a function when consumers own the markup but you own the logic.
- Throw a clear error when a compound child is used outside its parent.

### Custom hooks

- Extract any reusable stateful logic into a `useX` hook.
- Return a tuple for 2–3 values; an object once it grows past that.
- Wrap callbacks in `useCallback` so consumers can pass them to memoized children.
- Async data fetching: use TanStack Query (or Next route loaders / server components). Hand-rolled `useFetch` only for tiny one-offs, and it MUST handle loading, error, and cancellation.

### Routes + reachability

- A new page lands with BOTH the route registration in `App.tsx` AND a matching `App.test.tsx` test in the same slice.
- `App.test.tsx` asserts the page is reachable at its declared URL (`render <App />` inside `<MemoryRouter initialEntries={[url]}>`, expect heading).
- When editing `App.test.tsx`, never overwrite the file wholesale — accumulate tests; `git diff` it before commit.
- **A registered route is not a reachable page.** The URL-render test above passes even when nothing in the running app links to the page — that's exactly the orphan-page trap (a top-level surface with no global nav to reach it). The invariant is **reachability, not menu-membership**: the task's declared **Entry source** (carried from `docs/design-system/surfaces.md` onto the task body) must exist as a real inbound path in code, and a test must exercise it:
  - **`top-level`** page → an entry in the global-nav container (or an explicit redirect target). Test: render the shell, click the nav item, assert the page renders. A top-level page whose only "entry" is the route registration is an orphan — wire it into the nav (the nav lives in the foundation/shell slice, which ships first).
  - **`detail-child`** / **`contextual`** page → a link/row/control on its **parent** surface (e.g. a list row → `/entities/:id`, a "New" button → `/entities/new`). The linking control ships in the **same slice** as the page. Test: render the parent, activate the control, assert navigation.
  - **`external-entry`** page (login, magic-link) → entered via typed URL / email link; exempt from in-app linking. The URL-render test alone suffices.
  - **`redirect-system`** (`/` → home, `*` → 404) → assert the redirect/fallback resolves.
- Cross-page navigation links (e.g. "Forgot password?" on `/login` + "Back to login" on `/forgot`) ship in the same slice as the page they reference.

### TanStack Query

- Route-param queries guard with `enabled: !!param` — without it the query fires `GET /api/v1/groups/` (or `/groups/undefined`) on first render.
- Pair the guard with an `isLoading: true` initial-state test so the gate is locked by a regression test.
- Every mutation that changes server state visible through another query calls `queryClient.invalidateQueries({ queryKey: <KEY> })` in `onSuccess`.
- Common miss: `useLogout` resolves before `useMe` refetches, leaving stale `currentUser` visible.

### Mutation return shape

- Return `mutation.mutate` directly. Do NOT re-wrap in an arrow function — a fresh ref every render breaks consumer `useEffect` / `useCallback` deps.
- If transforming args before `mutate`, wrap with `useCallback` and a stable dep list. Never a bare arrow per render.

### Idempotency-key rotation

- Forms that submit with `Idempotency-Key`: rotate the key on 4xx so the user can correct and resubmit.
- 2xx = key is spent (next submit gets a fresh `useRef` value on remount).
- 5xx = never rotate (retry was designed for it).
- 4xx = rotate before the next attempt.

### Sticky UI state

- "Submitted" / "success" UI that holds forever after first submit must be decided up front:
  - **Intentional** (e.g. `/forgot` shows the generic confirmation by design): mark the state as `useState<"idle" | "submitted">` with no transition back; comment why; pin with a test.
  - **Unintentional**: expose a reset path ("Send another" button, `onSuccess`-driven prop, key change → unmount).

### API access

- ALL backend calls route through `src/lib/api/<resource>.ts`. Never `fetch` / `axios` inside a component or hook.
- `src/lib/api` owns: base URL, auth headers, error normalization, retry/timeout policy, response parsing, cancellation.
- Tests mock `src/lib/api` functions, not `fetch`.

### State management

- Server data → TanStack Query.
- Client state crossing 2–3 levels → `useReducer` + Context. Keep state and dispatch in **separate** Contexts so dispatch-only consumers don't re-render on state changes.
- Discriminated `Action` unions for exhaustive switch checking.
- Reach for Zustand / Redux Toolkit only when reducer+context starts duplicating ceremony across many slices.

### Performance

- Measure first. Don't sprinkle `useMemo` / `memo` preemptively.
- `useMemo` for expensive derivations. `useCallback` for callbacks passed to memoized children. `memo` for components that re-render often with the same props.
- A `memo` is useless if you pass a fresh object / array / function every render — wrap those too.
- Code-split at route boundaries via `lazy(() => import(...))` paired with a meaningful `<Suspense fallback>`.
- Virtualize long lists (TanStack Virtual / `react-window`) once items exceed ~100.

### Forms

- React Hook Form + Zod. Schema is the single source of truth for runtime validation AND types (`z.infer<typeof Schema>`).
- `aria-invalid={!!errors.x}` and `role="alert"` on each error message.
- Disable the submit while in flight to prevent double submits.

### Error boundaries

- One per route + extra boundaries around risky islands (dashboard widgets, third-party embeds).
- Class component (the only place React supports them). In Next App Router use `error.tsx` files.

### Animation

- Framer Motion for non-trivial animation. CSS transitions for simple hover/focus.
- `AnimatePresence` is mandatory for exit animations.
- Respect `prefers-reduced-motion` via `useReducedMotion()`.
- Durations: 120–250ms for UI; longer only for hero / onboarding.

### Accessibility

- Native semantic elements (`<button>`, `<a>`, `<input>`, `<select>`, `<dialog>`, `<nav>`, `<h1>`–`<h6>`) over `role` on a generic tag.
- Biome's `lint/a11y/useSemanticElements` blocks `<div role="dialog">`, `<form role="dialog">`, `<div role="button">`, etc.
- Visible focus styles required (`:focus-visible`); never `outline: none` without a replacement.
- Trap focus inside modals; restore to the opener on close.
- Empty-state copy, loading skeletons, "no results" panels render inside the same semantic landmark (`<main>`) the loaded state would — so Playwright's `getByRole('main').getByRole(...)` queries work.
- Match the slice's already-authored E2E specs as your **affordance contract**: read them read-only (see the implement-task workflow's context step) and expose the exact accessible names, ARIA roles, and navigation path they query — don't guess the conventions blind. This is interface-matching only (selectors, labels, the click path), not behavior: the Gherkin AC stays the source of *what the UI must do*, and a spec asserting behavior the AC never specified is a divergence to surface at the pass-E2E gate, not something to bake into the UI.

### Responsive

- Mobile-first. Author the small-screen layout; layer breakpoints upward (`sm:`, `md:`, `lg:`, `xl:`).
- Fluid units (`rem`, `clamp()`, `%`, `fr`) over fixed pixels for layout.
- Test at 320 / 768 / 1024 / 1440 minimum.
- Images: `srcset` / `sizes` (or Next `<Image>`).

### i18n

- No hardcoded user-facing strings; route through `next-intl` (Next) / `react-i18next` (Vite).
- ICU MessageFormat for plurals / gender / interpolation; never concatenate translated fragments.
- Stable namespaced keys (`auth.signup.submitButton`).
- Dates / numbers / currency via `Intl.DateTimeFormat` / `Intl.NumberFormat` with the active locale.
- `<html lang>` set; `dir="rtl"` when needed.

### Styling — Tailwind + design tokens

- Source of truth is `docs/design-system/` when present (`tokens.md`, `components.md`, `accessibility.md`, `overview.md`, `sample/*.html`).
- Tailwind class names map 1:1 to design tokens (`color/brand/500` → `bg-brand-500`).
- No hard-coded color values; no hard-coded pixel sizes (`[420px]`, `[#3b82f6]`); no ad-hoc inline `style={{ color, padding }}` for visual properties.
- Need a value the scale doesn't have? Extend the token in `tailwind.config` (mirrored in `tokens.md`) — don't reach for arbitrary `[...]` classes.
- Dynamic values that genuinely can't be tokens (e.g. chart bar's computed height) go through `style={{ height: \`${pct}%\` }}` — the exception, not a pattern.
