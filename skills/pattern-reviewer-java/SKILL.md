---
name: pattern-reviewer-java
description: "Java audit: `double`/`float` money vs `BigDecimal` (CRITICAL); `Date`/`SimpleDateFormat` vs `java.time`; swallowed/cause-less exception, broad `catch (Exception)`; missing try-with-resources; non-exhaustive `switch` with catch-all `default`; `Optional` field/param; null collection return; field `@Autowired`/`@Inject`; `==` on boxed/String; `equals` without `hashCode`; `List.copyOf`; virtual threads; `./gradlew` wrapper. Cites `file:line`. Activate on `.java`, `pom.xml`, `build.gradle` diffs."
---

# pattern-reviewer-java

## When to activate

- Reviewing a diff that includes `.java` files, or a Java project's `pom.xml` / `build.gradle` / `build.gradle.kts`.
- A user says "review the Java code / exception handling / concurrency / build setup".

Skip `.kt` / `.kts` files — they are owned by `pattern-reviewer-kotlin` even inside a Gradle project.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-java.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).
- Injection / SQL / crypto / authz live in `pattern-reviewer-security`; test-coverage substance in `pattern-test-coverage`; endpoint shape in `pattern-reviewer-contract` / `pattern-reviewer-api`. Defer to those rather than double-reporting.

## Patterns to review

### `double`/`float` for money (CRITICAL)

Detection: grep monetary fields/params for `double` / `float` / `Double` / `Float`; look at `price`, `amount`, `total`, `balance`, `rate` names and any arithmetic feeding currency.

```java
// BAD — binary floating point can't represent 0.10; 0.1 + 0.2 != 0.3
double total = price * quantity;

// GOOD — BigDecimal with explicit scale + RoundingMode
BigDecimal total = price.multiply(BigDecimal.valueOf(quantity))
    .setScale(2, RoundingMode.HALF_EVEN);
```

- Any money/precise-decimal value carried or computed as `double` / `float` → CRITICAL (silent rounding = data corruption).
- `new BigDecimal(0.1)` (double constructor) → CRITICAL; use `BigDecimal.valueOf(0.1)` or the `String` constructor.
- False-positive guard: ratios, percentages used only for display, ML/statistics, or physical quantities where float is intended — not money.

### `Date`/`Calendar`/`SimpleDateFormat` (HIGH)

Detection: grep imports for `java.util.Date`, `java.util.Calendar`, `java.text.SimpleDateFormat`, `java.sql.Timestamp` in domain code.

```java
// BAD — mutable, not thread-safe, no zone clarity
Date now = new Date();
SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd");

// GOOD — java.time, UTC instant
Instant now = Instant.now();
String day = LocalDate.now(ZoneOffset.UTC).format(DateTimeFormatter.ISO_LOCAL_DATE);
```

- `Date` / `Calendar` / `SimpleDateFormat` in new code → HIGH (`SimpleDateFormat` is also not thread-safe — a shared static instance is a latent bug).
- Comparing/storing instants in local time instead of UTC → HIGH.
- False-positive guard: a third-party/JDBC API that hands back `java.sql.Timestamp` — convert at the boundary, don't flag the unavoidable call.

### Swallowed exceptions / lost cause / broad catch (HIGH)

Detection: grep for `catch (Exception`, `catch (Throwable`, empty `catch` blocks, and `new SomeException(` calls inside a catch that omit the caught variable.

```java
// BAD — swallowed
try { parse(s); } catch (ParseException e) { /* ignored */ }

// BAD — cause lost
try { parse(s); } catch (ParseException e) { throw new DomainException("bad input"); }

// BAD — broad catch deep in the code
try { parse(s); } catch (Exception e) { ... }

// GOOD — narrow catch, cause preserved
try { parse(s); }
catch (ParseException e) { throw new DomainException("bad input: " + s, e); }
```

- Empty / comment-only catch → HIGH.
- `throw new X(msg)` in a catch that drops the caught `e` (no cause) → HIGH.
- `catch (Exception)` / `catch (Throwable)` anywhere except a top-level boundary handler (request filter, `@ExceptionHandler`, executor task wrapper, `main`) → HIGH.
- False-positive guard: a documented boundary handler that logs-and-translates is correct; a catch that genuinely recovers (retry, fallback value) with a comment is fine.

### Missing try-with-resources (HIGH)

Detection: look for `AutoCloseable` types (`InputStream`, `Reader`, `Connection`, `Statement`, `ResultSet`, `Closeable` clients) created outside a `try (...)` header, and any `.close()` in a `finally`.

```java
// BAD — manual close in finally; leaks if close() throws or on early return
Connection c = ds.getConnection();
try { run(c); } finally { c.close(); }

// GOOD — try-with-resources
try (Connection c = ds.getConnection()) { run(c); }
```

- Any `AutoCloseable` closed manually in `finally` when try-with-resources would do → HIGH.
- `AutoCloseable` created and never closed on every path → HIGH (resource leak).
- False-positive guard: a resource deliberately owned/closed by a longer-lived component (e.g. an injected pool/client closed in `@PreDestroy`) is not a leak.

### Non-exhaustive `switch` with catch-all `default` (HIGH)

Detection: grep `switch` expressions/statements over a `sealed` type or `enum` for a `default ->` / `default:` arm.

```java
// BAD — default silently absorbs a future variant; new Shape -> no compile error
String describe(Shape s) {
    return switch (s) {
        case Circle c -> "circle";
        default -> "other";          // hides the gap
    };
}

// GOOD — exhaustive; adding a Shape variant breaks the build until handled
String describe(Shape s) {
    return switch (s) {
        case Circle c -> "circle";
        case Square q -> "square";
    };
}
```

- A `switch` over a sealed hierarchy or enum that uses `default` to absorb the remaining variants → HIGH (defeats exhaustiveness checking).
- False-positive guard: `default` is fine when the input is genuinely open (an `int`, a `String`, an enum from an external/unstable source) — flag only closed domain types you own.

### `Optional` as field or parameter (HIGH)

Detection: grep for `Optional<` in field declarations, method parameters, and generic type arguments (`List<Optional<...>>`, `Map<..., Optional<...>>`).

```java
// BAD — Optional field / parameter / collection element
private Optional<String> nickname;
void update(Optional<String> nickname) { ... }

// GOOD — Optional return only; nullable field, overloads/null-check at the param
private String nickname;                 // may be null internally
Optional<String> nickname() { return Optional.ofNullable(nickname); }
```

- `Optional` typed field → HIGH (not `Serializable`, extra allocation, signals a design smell).
- `Optional` parameter or `Optional` as a collection element → HIGH.
- False-positive guard: `Optional` as a **return type** is the intended idiom — never flag that.

### Returning `null` for a collection (HIGH)

Detection: look for methods returning `List` / `Set` / `Map` / arrays with a `return null;` path.

```java
// BAD — forces every caller to null-check
List<Order> orders() { return found ? list : null; }

// GOOD
List<Order> orders() { return found ? list : List.of(); }
```

- `return null` from a collection/array-returning method → HIGH (NPE magnet).
- False-positive guard: a method whose contract explicitly distinguishes "absent" from "empty" and returns `Optional<List<T>>` is acceptable.

### Field-injected dependencies (HIGH)

Detection: grep for `@Autowired` / `@Inject` / `@Resource` on a field (annotation directly above a field declaration, not a constructor).

```java
// BAD — field injection: untestable without reflection, hides required deps, allows nulls
@Service class OrderService {
    @Autowired private OrderRepository repo;
}

// GOOD — constructor injection, final field
@Service class OrderService {
    private final OrderRepository repo;
    OrderService(OrderRepository repo) { this.repo = repo; }
}
```

- Field/setter `@Autowired` / `@Inject` / `@Resource` → HIGH.
- Mutable instance state on a singleton-scoped component (shared across requests) → HIGH.
- False-positive guard: framework-mandated field injection in test fixtures (`@MockBean` on a `@SpringBootTest` field) is acceptable.

### `==` on boxed primitives or String (HIGH)

Detection: grep for `==` / `!=` where either operand is a `String`, `Integer`, `Long`, `Double`, `Boolean`, or other boxed type.

```java
// BAD — reference equality; works for cached small Integers, fails at 128+
if (count == Integer.valueOf(1000)) ...
if (name == "admin") ...

// GOOD
if (count.intValue() == 1000) ...
if ("admin".equals(name)) ...
```

- `==` / `!=` on boxed numerics or `String` → HIGH (intermittent, value-dependent bug).
- False-positive guard: `== null` is correct; `==` on enum constants and unboxed primitives is correct; interned-by-contract comparisons documented as intentional identity checks.

### `equals` without `hashCode` (HIGH)

Detection: in any class, check that `equals(Object)` and `hashCode()` are both present or both absent; flag one without the other.

```java
// BAD — breaks HashMap/HashSet membership
@Override public boolean equals(Object o) { ... }   // no hashCode()

// GOOD — both, via Objects
@Override public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof User u)) return false;
    return Objects.equals(id, u.id);
}
@Override public int hashCode() { return Objects.hash(id); }
```

- One overridden without the other → HIGH (collection contract violation).
- Hand-rolled value class that should be a `record` → MEDIUM (records get both for free).
- False-positive guard: identity-based entities that intentionally use the inherited `Object` equality (and never both-override) are fine.

### Immutability & defensive copies (MEDIUM)

Detection: look for non-`final` fields that are never reassigned; constructors/getters that store/expose a mutable collection or array reference directly.

```java
// BAD — caller can mutate internal state through the shared reference
this.tags = tags;
List<String> tags() { return tags; }

// GOOD — defensive copy in, unmodifiable out
this.tags = List.copyOf(tags);
List<String> tags() { return tags; }   // already immutable
```

- Mutable collection/array stored or returned without `List.copyOf` / `Map.copyOf` / `Collections.unmodifiable*` → MEDIUM (HIGH if it crosses a trust/concurrency boundary).
- Fields never reassigned but not `final` → LOW.

### Concurrency (HIGH)

Detection: grep for `new Thread(`, `synchronized`, double-checked-locking idioms (`if (x == null) { synchronized ... if (x == null) ... }`), and non-thread-safe maps shared across threads.

```java
// BAD — raw thread, hand-rolled DCL
new Thread(this::poll).start();

// GOOD — executor; virtual threads for blocking I/O
try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
    exec.submit(this::poll);
}
```

- Raw `new Thread(...).start()` instead of an `ExecutorService` → MEDIUM.
- Hand-rolled double-checked locking → HIGH (subtly wrong without `volatile`; use a holder class or memoized `Supplier`).
- Shared `HashMap` read+written from multiple threads without `ConcurrentHashMap` / external synchronization → HIGH.
- Blocking I/O fanned out on a fixed platform-thread pool where virtual threads fit → MEDIUM.
- False-positive guard: single-threaded code, confined-per-request maps, and `@Async` methods on a managed executor are fine.

### Build & toolchain (HIGH)

Detection: scan CI config / Dockerfiles / docs and the build files.

- Invoking a global `gradle` / `mvn` instead of `./gradlew` / `./mvnw` → HIGH (non-reproducible build).
- Missing/uncommitted wrapper (`gradle/wrapper/gradle-wrapper.properties`, `.mvn/wrapper/`) → HIGH.
- Spotless or ErrorProne/NullAway absent from `check` / `verify`, or the toolchain not pinned to 21 → MEDIUM.

### Streams & idioms (LOW)

```java
// BAD — stream used purely for a side effect
list.stream().forEach(repo::save);

// GOOD — plain loop for side effects
for (var item : list) repo.save(item);
```

- `forEach` on a stream used only for side effects → LOW (a loop is clearer).
- `parallelStream()` with no measured justification → MEDIUM (often slower, shares the common ForkJoinPool).
- Spotless-fixable formatting (import order, line length, braces) → LOW; flag only where the formatter clearly wasn't run.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
