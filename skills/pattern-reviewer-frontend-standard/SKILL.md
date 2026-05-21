---
name: pattern-reviewer-frontend-standard
description: "React-specific code-quality audit for a frontend diff: component design, hook correctness, route registration + reachability, TanStack Query route-param guards, mutation `onSuccess` invalidation + return stability, idempotency-key rotation on 4xx, sticky one-shot UI state, API-access through `src/lib/api`, error boundaries per route, native semantic a11y elements, Tailwind ↔ tokens, App.test.tsx wholesale-replacement trap, empty-state inside `<main>` landmark. Each finding cites `file:line` with BAD/GOOD snippets. Activate on frontend diffs."
---

# pattern-reviewer-frontend-standard

## When to activate

- The dispatched caller is reviewing a `type:frontend` task's production-code diff (React).
- A user says "review the React components / hooks / forms / routing".

## Iron rules

## Patterns to review

### React / Next.js (HIGH)

- **Missing dependency arrays** — `useEffect` / `useMemo` / `useCallback` with incomplete deps; stale closures.
- **State updates in render** — `setState` during render causes infinite loops.
- **Missing keys in lists** — array index as key when items can reorder.
- **Prop drilling** — props passed through 3+ levels (use Context or composition).
- **Unnecessary re-renders** — missing memoization for expensive computations on hot paths.
- **Client/server boundary** — `useState` / `useEffect` in Server Components.
- **Missing loading/error states** — data fetching without fallback UI.

```tsx
// BAD: missing dependency, stale closure
useEffect(() => {
  fetchData(userId);
}, []); // userId missing from deps

// GOOD: complete dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

```tsx
// BAD: index as key with reorderable list
{items.map((item, i) => <ListItem key={i} item={item} />)}

// GOOD: stable unique key
{items.map(item => <ListItem key={item.id} item={item} />)}
```

### Route registration + reachability (HIGH)

A new page lands with BOTH the `App.tsx` route entry AND an `App.test.tsx` reachability test in the same slice. Flag:

- **Page shipped without route entry** — every component test passes, but the URL returns 404.
- **Page shipped without `App.test.tsx` assertion** — the next slice can break the route silently.
- **`App.test.tsx` wholesale-replaced** — pre-existing route tests silently deleted. Verify with `git diff HEAD~1 HEAD -- App.test.tsx` that every prior test is still present.
- **Cross-page link not shipped with the page** — `/login` shows "Forgot password?" but `/forgot` has no "Back to login".

### TanStack Query — route-param guards (HIGH)

```tsx
// BAD — fires GET /api/v1/groups/ (or /groups/undefined) on first render
export function useGroup(groupId: string) {
  return useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId),
  });
}

// GOOD — gated by a truthy param
export function useGroup(groupId: string | undefined) {
  return useQuery({
    queryKey: ["group", groupId],
    queryFn: () => getGroup(groupId!),
    enabled: !!groupId,
  });
}
```

The `!` non-null assertion is acceptable here because `enabled` is the invariant. Pair with an `isLoading: true` initial-state test.

### Mutations — `onSuccess` invalidation + return stability (HIGH)

```tsx
// BAD — useLogout resolves before useMe refetches; stale currentUser visible
export function useLogout() {
  return useMutation({ mutationFn: () => logoutRequest() });
}

// GOOD — invalidate affected queries in onSuccess
export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => logoutRequest(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: GROUPS_QUERY_KEY });
    },
  });
}
```

```ts
// BAD — fresh function every render breaks consumer useEffect deps
return {
  login: (...args) => loginMutation.mutate(...args),
  logout: () => logoutMutation.mutate(),
};

// GOOD — stable references
return {
  login: loginMutation.mutate,
  logout: logoutMutation.mutate,
};
```

### Idempotency-key rotation on 4xx (HIGH)

```tsx
// BAD — useRef key minted once; server caches 422 against it; user can't recover
const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

// GOOD — rotate on 4xx, leave 5xx alone
const onSubmit = async (values: FormValues) => {
  try {
    await createGroup(values, { idempotencyKey: idempotencyKeyRef.current });
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    throw err;
  }
};
```

### Sticky one-shot UI state (MEDIUM)

A "submitted" / "success" state that holds forever after first submit must be a deliberate decision. Flag when:

- The component holds `submitted=true` permanently with no documented rationale AND no reset path.
- A reset path is needed (user should be able to send another) but none exists.
- The "intentional sticky" branch isn't pinned by a test.

### API access (HIGH)

Components / hooks MUST route through `src/lib/api/<resource>.ts`. Flag any:

- `fetch(...)` / `axios.*(...)` inside a component file.
- Bare `fetch` in a hook outside `src/lib/api/`.

```tsx
// BAD — fetch in component
function UserCard({ id }: { id: string }) {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch(`/api/users/${id}`).then(r => r.json()).then(setUser); }, [id]);
}

// GOOD — call goes through src/lib/api
import { getUser } from "@/lib/api/users";

function UserCard({ id }: { id: string }) {
  const { data: user } = useQuery({ queryKey: ["user", id], queryFn: () => getUser(id) });
}
```

### Error boundaries (MEDIUM)

- Every route is wrapped in an error boundary; risky islands (third-party embeds, chart widgets) get their own.
- Class component (the only place React supports them) — or Next App Router `error.tsx`.

### Accessibility (HIGH)

- **Native semantic elements required.** Biome's `lint/a11y/useSemanticElements` blocks `<div role="dialog">`, `<form role="dialog">`, `<div role="button">`, `<div role="navigation">`, `<span role="heading">`, `<a role="button">`. Flag any of these — use `<dialog>`, `<button>`, `<nav>`, `<h1>`–`<h6>`, `<a>` instead.
- Interactive non-native elements need `tabIndex={0}` + `onKeyDown` for Enter/Space.
- Visible focus styles required (`:focus-visible`); `outline: none` without a replacement is a finding.
- **Empty-state copy inside `<main>` landmark.** Empty states / error states / loading skeletons render inside the same semantic landmark the loaded state would — Playwright's `getByRole('main').getByRole(...)` queries depend on this.

### Tailwind ↔ tokens (HIGH)

- No hard-coded color values (`#3b82f6`, `text-[#1f2937]`, inline `style={{ color: ... }}` for visual properties).
- No hard-coded pixel sizes in `[]` brackets (`mt-[18px]`, `w-[420px]`).
- Every Tailwind class maps to a token in `docs/DESIGNs/tokens.md` (when present) via `tailwind.config`.
- `tailwind.config` ↔ `tokens.md` drift is a HIGH finding — either add the missing row or remove the unsanctioned alias.

### Forms (MEDIUM)

- React Hook Form + Zod required for non-trivial forms.
- `aria-invalid={!!errors.x}` and `role="alert"` on each error message.
- Submit disabled while in flight (`disabled={isSubmitting}`).

## Constructing the finding

Use the shape in `templates/review-comment.md`. Hand findings back to the dispatching `reviewer` agent.
