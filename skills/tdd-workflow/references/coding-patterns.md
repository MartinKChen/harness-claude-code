# coding-patterns

Language-agnostic coding standards that apply to every implementation task. The goal is consistent, readable, simple code: clear names, small functions, immutable data by default, parallel async where independent, strong types, and tests structured for clarity.

## When to activate

Activate this skill whenever the user:

- writes new code (a function, class, module, component, endpoint, handler, test)
- edits or refactors existing code
- fixes a bug or adds a feature
- asks to "clean up", "simplify", "extract", "rename", or "improve" code
- writes or modifies tests

Do NOT activate when the user is only asking conceptual questions, reading docs, exploring the repo without changing code, or running commands that don't touch source files.

## Pattern

### 1. Core principles

Apply in this priority order when they conflict: **Readability → KISS → DRY → YAGNI**.

- **Readability first.** Code is read more than written. Use clear names and consistent formatting. Prefer self-documenting code over comments.
- **KISS.** Pick the simplest solution that works. No premature optimization. No clever code when straightforward code works.
- **DRY.** Extract repeated logic into a function or utility once it appears a third time. Don't pre-extract on the first occurrence.
- **YAGNI.** Don't build for hypothetical future needs. Add complexity only when a real requirement forces it. Three similar lines beat a premature abstraction.

### 2. Naming

**Variables — descriptive, not abbreviated.**

```ts
// Bad
const d = new Date();
const u = users.filter(x => x.a);

// Good
const createdAt = new Date();
const activeUsers = users.filter(user => user.isActive);
```

**Functions — verb-noun.** The name states the action and its target.

```ts
// Bad
function user(id) { ... }
function data() { ... }

// Good
function getUserById(id) { ... }
function fetchActiveOrders() { ... }
function validateEmail(email) { ... }
```

Booleans read as predicates: `isActive`, `hasPermission`, `canEdit`, `shouldRetry`.

### 3. Immutability (CRITICAL)

Default to immutable data. Mutation is opt-in, not opt-out.

```ts
// Bad — mutates input
function addItem(cart, item) {
  cart.items.push(item);
  return cart;
}

// Good — returns new value
function addItem(cart, item) {
  return { ...cart, items: [...cart.items, item] };
}
```

- Prefer `const` / `final` / `readonly` over reassignable bindings.
- Prefer `map` / `filter` / `reduce` over loops that mutate accumulators.
- Treat function parameters as read-only.
- Mutate only when measurably necessary (hot path, large data) and document why.

### 4. Error handling

Handle errors at the boundary they matter at. Don't swallow them; don't over-catch.

```ts
// Bad — swallows the error
try { doWork(); } catch (e) {}

// Bad — catches too broadly
try { doWork(); } catch (e) { return null; }

// Good — catch what you can act on, let the rest propagate
try {
  await fetchUser(id);
} catch (err) {
  if (err instanceof NotFoundError) return null;
  throw err;
}
```

- Validate at system boundaries (user input, external APIs). Trust internal callers.
- Don't add fallbacks for scenarios that can't happen.
- Throw / return errors with enough context for the caller to act.

### 5. Async / parallel execution

Run independent async work in parallel. Sequential `await` is the most common avoidable slowdown.

```ts
// Bad — sequential when independent
const user = await fetchUser(id);
const orders = await fetchOrders(id);
const prefs = await fetchPrefs(id);

// Good — parallel
const [user, orders, prefs] = await Promise.all([
  fetchUser(id),
  fetchOrders(id),
  fetchPrefs(id),
]);
```

- Use `Promise.all` (or language equivalent: `asyncio.gather`, `errgroup`, `tokio::join!`) for independent calls.
- Keep sequential `await` only when each step depends on the previous result.

### 6. Type safety

- Use the strongest types the language offers. No `any`, no untyped dicts where a struct/interface fits.
- Make illegal states unrepresentable: union types, enums, branded types over loose strings.
- Prefer compile-time guarantees over runtime checks.

### 7. Testing standards

**AAA pattern — Arrange, Act, Assert.** Each test has three clear sections.

```ts
test('returns active users sorted by name', () => {
  // Arrange
  const users = [
    { name: 'Bob', isActive: true },
    { name: 'Alice', isActive: true },
    { name: 'Carol', isActive: false },
  ];

  // Act
  const result = getActiveUsersSorted(users);

  // Assert
  expect(result).toEqual([
    { name: 'Alice', isActive: true },
    { name: 'Bob', isActive: true },
  ]);
});
```

**Descriptive test names** — state the behavior, not the function.

```ts
// Bad
test('getUser', () => { ... });
test('test 1', () => { ... });

// Good
test('returns null when user does not exist', () => { ... });
test('throws ValidationError for empty email', () => { ... });
```

### 8. Code-smell detection

Flag and fix these as they appear:

- **Long functions.** If a function exceeds ~30–50 lines or does more than one thing, extract sub-functions named for what they do.
- **Deep nesting.** More than 2–3 levels of `if` / `for` is a signal. Use early returns / guard clauses to flatten.

  ```ts
  // Bad
  function process(user) {
    if (user) {
      if (user.isActive) {
        if (user.email) {
          return send(user.email);
        }
      }
    }
  }

  // Good
  function process(user) {
    if (!user) return;
    if (!user.isActive) return;
    if (!user.email) return;
    return send(user.email);
  }
  ```

- **Magic numbers / strings.** Replace with named constants whose name explains the meaning.

  ```ts
  // Bad
  if (retries > 3) throw new Error('failed');
  setTimeout(fn, 86400000);

  // Good
  const MAX_RETRIES = 3;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  if (retries > MAX_RETRIES) throw new Error('failed');
  setTimeout(fn, ONE_DAY_MS);
  ```

**Remember**: Code quality is not negotiable. Clear, maintainable code enables rapid development and confident refactoring.

**Remember**: prioritize clarity over cleverness. When in doubt, write the boring version.
