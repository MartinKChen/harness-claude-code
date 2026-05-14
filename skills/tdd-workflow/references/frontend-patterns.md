# frontend-patterns

Enforce idiomatic, modern React + TypeScript practices on every frontend implementation task. Encodes the conventions this project considers non-negotiable: React + TypeScript as the baseline, Next.js when the app needs SSR/SSG/edge, Vite when it's pure CSR, composition-first component design, custom hooks for reusable logic, Context + Reducer for shared state, deliberate performance optimization, controlled forms with validation, error boundaries at app seams, Framer Motion for animation, accessible keyboard/focus behavior, responsive design, i18n, strict TypeScript, and a standard lint/typecheck/test command set.

## When to activate

Activate this skill whenever the user:

- writes, edits, or refactors any `.tsx` / `.ts` / `.jsx` / `.js` file in a frontend project
- adds or modifies React components, hooks, contexts, reducers, pages, routes, or layouts
- scaffolds a new React app, Next.js app, or Vite app
- works with React, Next.js, Vite, React Router, TanStack Query, Framer Motion, Zod, Testing Library
- builds forms, modals, lists, tables, navigation, or animations
- fixes accessibility, responsiveness, internationalization, or performance issues
- runs or configures `tsc`, `biome`, `jest`, `vitest`, `npm audit`

Do NOT activate when the user is editing pure backend code, infrastructure/IaC, or asking general (non-implementation) framework questions unrelated to this project's code.

## Pattern

### Stack selection: Next vs. Vite

Default to **React + TypeScript**. Pick the bundler/framework based on rendering needs:

- **Next.js** — when the app needs any of: SSR, SSG, ISR, edge runtime, file-based routing, server components, SEO-critical pages, image optimization, or first-class API routes.
- **Vite** — when the app is pure CSR: internal tools, dashboards behind auth, embedded widgets, prototypes, SPAs where SEO doesn't matter. Faster dev server, simpler config, no server runtime.

Don't reach for Next.js "just in case." If today's requirements are CSR-only, ship Vite; migrating to Next later is straightforward.

### Component patterns

#### a. Composition over inheritance

React has no `extends` story for components. Compose with children and props instead of building class hierarchies.

```tsx
// Bad — trying to inherit
class FancyButton extends Button { ... }

// Good — compose via children/props
function Button({ children, variant = "primary", ...rest }: ButtonProps) {
  return <button className={variants[variant]} {...rest}>{children}</button>;
}

function IconButton({ icon, children, ...rest }: IconButtonProps) {
  return <Button {...rest}><Icon name={icon} />{children}</Button>;
}
```

- Pass behavior as props, structure as children.
- Lift shared logic into a hook, not a base component.

#### b. Compound components

Group related components under a single namespace when they only make sense together (Tabs/Tab, Menu/MenuItem, Accordion/Item). Share state via Context internal to the parent.

```tsx
const TabsContext = createContext<TabsCtx | null>(null);

export function Tabs({ defaultValue, children }: TabsProps) {
  const [value, setValue] = useState(defaultValue);
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div role="tablist">{children}</div>
    </TabsContext.Provider>
  );
}

Tabs.Tab = function Tab({ value, children }: TabProps) {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs.Tab must be used inside Tabs");
  const isActive = ctx.value === value;
  return (
    <button role="tab" aria-selected={isActive} onClick={() => ctx.setValue(value)}>
      {children}
    </button>
  );
};
```

- Throw a clear error when a child is used outside its parent.
- Keep the Context internal (don't export it) so consumers must use the compound API.

#### c. Render props

Use a render prop (or `children` as a function) when a component owns logic but the consumer owns the markup.

```tsx
type MouseProps = { children: (pos: { x: number; y: number }) => ReactNode };

function MousePosition({ children }: MouseProps) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return <>{children(pos)}</>;
}

// Usage
<MousePosition>{({ x, y }) => <div>{x}, {y}</div>}</MousePosition>
```

- Reach for a custom hook first; use render props when consumers also need to control where the output renders.

### Custom hooks

Extract any reusable stateful logic into a `useX` hook. Hooks must follow the Rules of Hooks (top-level only, in components or other hooks). Always type the return value explicitly.

#### a. State management hook

Wrap a self-contained piece of state behavior — toggles, counters, multi-step flows — in a hook with a stable, named API.

```ts
export function useToggle(initial = false): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle, setValue];
}
```

- Return a tuple for 2–3 values; return an object once it grows past that.
- Wrap callbacks in `useCallback` so consumers can pass them to memoized children.

#### b. Async data fetching hook

Prefer **TanStack Query** (or Next.js server components / Route loaders) for production fetching. Hand-rolled hooks are fine for tiny apps or one-off cases — they must handle loading, error, and cancellation.

```ts
type FetchState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "error"; error: Error };

export function useFetch<T>(url: string): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({ status: "idle" });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<T>;
      })
      .then(data => setState({ status: "success", data }))
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ status: "error", error });
      });
    return () => controller.abort();
  }, [url]);

  return state;
}
```

- Model state as a discriminated union, not three independent booleans.
- Always provide an `AbortController` and clean up in the effect's return.
- For anything beyond trivial: use TanStack Query for cache, retries, dedup, and background refresh.

#### c. Debounce hook

```ts
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
```

- Use for search inputs, resize handlers, and any high-frequency state that drives expensive work.

### API access: route everything through `src/lib/api`

**Never** call `fetch` or `axios` directly inside component files. All backend calls — including those made from custom hooks, route loaders, and server components — go through the project's `src/lib/api` module.

```ts
// src/lib/api/users.ts — the only place fetch/axios live
import { apiClient } from "./client";

export async function getUser(id: string): Promise<User> {
  return apiClient.get<User>(`/users/${id}`);
}
```

```tsx
// Bad — fetch inside a component
function UserCard({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch(`/api/users/${id}`).then(r => r.json()).then(setUser); }, [id]);
  // ...
}

// Good — call goes through src/lib/api
import { getUser } from "@/lib/api/users";

function UserCard({ id }: { id: string }) {
  const { data: user } = useQuery({ queryKey: ["user", id], queryFn: () => getUser(id) });
  // ...
}
```

- `src/lib/api` owns base URL, auth headers, error normalization, retry/timeout policy, response parsing, and request cancellation. Centralizing these means a single place to change them.
- Components and hooks call typed functions from `src/lib/api` — they never know about `fetch`, `axios`, URL strings, or HTTP status codes.
- Pair with TanStack Query for cache/loading/error state; the `queryFn` calls into `src/lib/api`.
- Tests mock `src/lib/api` functions, not `fetch` — keeps tests decoupled from transport details.

### State management: Context + Reducer

For shared state that crosses more than 2–3 levels, pair `useReducer` with a `Context`. Keep state and dispatch in **separate** contexts so consumers that only dispatch don't re-render on state changes.

```tsx
type State = { count: number };
type Action = { type: "inc" } | { type: "dec" } | { type: "set"; value: number };

const StateCtx = createContext<State | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "inc": return { count: state.count + 1 };
    case "dec": return { count: state.count - 1 };
    case "set": return { count: action.value };
  }
}

export function CounterProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { count: 0 });
  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useCounter() {
  const state = useContext(StateCtx);
  if (!state) throw new Error("useCounter must be used inside CounterProvider");
  return state;
}

export function useCounterDispatch() {
  const dispatch = useContext(DispatchCtx);
  if (!dispatch) throw new Error("useCounterDispatch must be used inside CounterProvider");
  return dispatch;
}
```

- Discriminated `Action` unions give you exhaustive switch-checking.
- Don't put server data in Context — that's TanStack Query's job. Context is for client state.
- Reach for Zustand/Redux Toolkit only when reducer + context starts duplicating ceremony across many slices.

### Performance optimization

Optimize after measuring. Don't sprinkle `useMemo`/`memo` preemptively — they have their own cost.

#### a. Memoization

```tsx
const ExpensiveList = memo(function ExpensiveList({ items, onSelect }: Props) {
  return <>{items.map(item => <Row key={item.id} item={item} onSelect={onSelect} />)}</>;
});

function Parent({ items }: { items: Item[] }) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(
    () => items.filter(i => i.name.includes(filter)),
    [items, filter],
  );
  const handleSelect = useCallback((id: string) => { /* ... */ }, []);
  return <ExpensiveList items={filtered} onSelect={handleSelect} />;
}
```

- `useMemo` for expensive derivations, `useCallback` for callbacks passed to memoized children, `memo` for components that re-render often with the same props.
- A `memo` is useless if you pass a fresh object/array/function on every render — wrap those too.

#### b. Code splitting & lazy loading

Split at route boundaries and around heavy, conditional UI (modals, editors, charts).

```tsx
// React + Vite
const Settings = lazy(() => import("./pages/Settings"));

<Suspense fallback={<PageSkeleton />}>
  <Settings />
</Suspense>
```

```tsx
// Next.js (App Router) — components lazy load via next/dynamic
const Chart = dynamic(() => import("./Chart"), { ssr: false, loading: () => <Skeleton /> });
```

- Always pair `lazy` with a meaningful `Suspense` fallback.
- `ssr: false` in Next when the component touches `window`/`document`.

#### c. Virtualization for long lists

Render only what's visible when a list exceeds ~100 items. Use **TanStack Virtual** (or `react-window`).

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function BigList({ items }: { items: Item[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 8,
  });
  return (
    <div ref={parentRef} style={{ height: 600, overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map(v => (
          <div
            key={v.key}
            style={{ position: "absolute", top: 0, transform: `translateY(${v.start}px)`, height: v.size, width: "100%" }}
          >
            <Row item={items[v.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- Provide a stable `key` per row.
- Tune `overscan` for smoothness vs. work.

### Form handling: controlled forms with validation

Use **React Hook Form + Zod** for any non-trivial form. The schema is the single source of truth for both runtime validation and TypeScript types.

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});
type SignupValues = z.infer<typeof SignupSchema>;

export function SignupForm({ onSubmit }: { onSubmit: (v: SignupValues) => Promise<void> }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<SignupValues>({ resolver: zodResolver(SignupSchema) });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" aria-invalid={!!errors.email} {...register("email")} />
      {errors.email && <p role="alert">{errors.email.message}</p>}

      <label htmlFor="password">Password</label>
      <input id="password" type="password" aria-invalid={!!errors.password} {...register("password")} />
      {errors.password && <p role="alert">{errors.password.message}</p>}

      <button type="submit" disabled={isSubmitting}>Sign up</button>
    </form>
  );
}
```

- Always derive types with `z.infer<typeof Schema>`.
- Wire `aria-invalid` and `role="alert"` so errors reach assistive tech.
- Disable the submit while in flight to prevent double submits.

### Error boundary pattern

Wrap each route (and any seam where a render error must not crash the whole app) in an error boundary. Error boundaries must be class components — that is the only place React supports them.

```tsx
type State = { error: Error | null };

export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info); // send to Sentry / your logger
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

// Usage
<ErrorBoundary fallback={<ErrorFallback />}>
  <Route />
</ErrorBoundary>
```

- One boundary per route, plus extra boundaries around risky islands (dashboard widgets, third-party embeds).
- In Next App Router use `error.tsx` files — same idea, framework-managed.

### Animation: Framer Motion

Use **Framer Motion** for any non-trivial animation. CSS transitions are still fine for simple hover/focus states.

```tsx
import { motion, AnimatePresence } from "framer-motion";

export function Modal({ open, onClose, children }: ModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={onClose}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- `AnimatePresence` is mandatory for exit animations.
- Respect `prefers-reduced-motion` — Framer Motion exposes `useReducedMotion()`.
- Keep durations short (120–250ms for UI; longer only for hero/onboarding).

### Accessibility

#### a. Keyboard navigation

Every interactive element must be reachable and operable from the keyboard.

- Use real `<button>`, `<a>`, `<input>`, `<select>` — only fall back to a `div`+`role` when the semantic element won't fit, and then add `tabIndex={0}` plus `onKeyDown` for Enter/Space.
- Visible focus styles are required (`:focus-visible`, never `outline: none` without a replacement).
- For lists/menus/tabs/grids, implement arrow-key navigation and Home/End where applicable, following the WAI-ARIA Authoring Practices for that pattern.
- Trap focus inside modals; restore focus to the opener on close.

```tsx
function MenuItem({ onSelect, children }: MenuItemProps) {
  return (
    <li
      role="menuitem"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
    >
      {children}
    </li>
  );
}
```

#### b. Focus management

After navigation or major UI changes, send focus where it belongs.

```tsx
function Dialog({ open, onClose, children }: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      dialogRef.current?.focus();
    } else {
      openerRef.current?.focus();
    }
  }, [open]);

  return open ? (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
      {children}
    </div>
  ) : null;
}
```

- On route change, move focus to the page's `<h1>` (or a skip-link target) so screen-reader users don't lose context.
- Inside dialogs, drawers, and command palettes: trap focus, close on Escape, restore focus on close.

## Key principles

### Styling: Tailwind + design tokens only

Style exclusively with Tailwind CSS classes that map to design tokens. **No** hard-coded color values, **no** hard-coded pixel sizes, **no** ad-hoc inline styles for visual properties.

```tsx
// Bad — hard-coded color and pixel sizes
<button style={{ backgroundColor: "#3b82f6", padding: "12px 16px", fontSize: "14px" }}>
  Save
</button>
<div className="text-[#1f2937] mt-[18px] w-[420px]">...</div>

// Good — token-mapped Tailwind classes
<button className="bg-primary px-4 py-3 text-sm text-primary-foreground">
  Save
</button>
<div className="text-foreground mt-5 w-md">...</div>
```

- Colors come from semantic tokens (`bg-primary`, `text-foreground`, `border-muted`) defined in `tailwind.config` — never raw hex, rgb, or hsl in JSX/CSS.
- Sizing uses Tailwind's spacing scale (`p-4`, `gap-6`, `w-md`) — never `[12px]`, `[420px]`, or arbitrary pixel values in `[]` brackets.
- Need a value the scale doesn't have? Extend the token in `tailwind.config` so it's reusable, don't reach for an arbitrary class.
- Dynamic values that genuinely can't be tokens (e.g. a chart bar's computed height) go through `style={{ height: \`${pct}%\` }}` — but this is an exception, not a pattern.
- Dark mode and theming work because tokens swap; hard-coded values defeat them.

### Responsive web design (RWD)

- Mobile-first. Author the small-screen layout first, then layer breakpoints upward (`min-width` queries).
- Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) or CSS Container Queries for component-driven responsiveness.
- Prefer fluid units (`rem`, `clamp()`, `%`, `fr`) over fixed pixel sizes for layout dimensions.
- Test at 320px (small phone), 768px (tablet), 1024px (laptop), and 1440px (desktop) at minimum.
- Images: use `srcset`/`sizes` (or Next.js `<Image>`) so phones don't download desktop assets.

### Internationalization (i18n)

- No hardcoded user-facing strings. Every string runs through the i18n layer (`next-intl` for Next.js, `react-i18next` for Vite).
- Use ICU MessageFormat for plurals, gender, and interpolation — don't concatenate translated fragments.
- Keys are namespaced and stable: `auth.signup.submitButton`, not `button1`.
- Format dates, numbers, and currency via `Intl.DateTimeFormat` / `Intl.NumberFormat` with the active locale.
- Set `<html lang>` and (when needed) `dir="rtl"`. Test at least one RTL locale if RTL languages are in scope.

### TypeScript strictness

`tsconfig.json` must enable strict mode. These flags are non-negotiable:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true
  }
}
```

- No `any`. Use `unknown` at boundaries and narrow before use.
- No non-null assertions (`!`) except in the rarest cases with a comment explaining the invariant.
- Prefer `type` for unions/intersections, `interface` for object shapes you intend others to extend.
- Use discriminated unions (`{ status: "success"; data: T } | { status: "error"; error: Error }`) instead of optional fields that "go together."
- Type props explicitly — `function Component(props: Props)` — don't rely on inference for the public API.

## Command

Run all tooling from the project root. The first set is read-only checks; the second mutates files.

### Checks

```bash
tsc --noEmit     # Type checking
biome check .    # Lint
biome check .    # Format check (same command — biome covers both)
npm audit        # Security scan
jest             # Tests
```

- Run all five before declaring a task complete.
- Replace `jest` with `vitest` on Vite projects.
- A clean `tsc` and `biome` run is required; coverage thresholds (if any) are configured in `package.json` / `jest.config` (`coverageThreshold`) and enforced by `jest` automatically — don't pass `--coverage` on the CLI.

### Auto-fix

```bash
biome check --write .   # Auto-fix lint issues and format
```

- Run auto-fix before re-running checks; don't hand-fix what the formatter will fix.
- Review the diff after auto-fix — formatters occasionally reflow JSX in ways that hurt readability, in which case rewrite the underlying line.
