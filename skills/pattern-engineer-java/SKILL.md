---
name: pattern-engineer-java
description: "Modern Java 21: committed `./gradlew`/`./mvnw` wrapper; Spotless + ErrorProne/NullAway; JUnit 5 + AssertJ + Testcontainers. `record` DTOs; sealed + exhaustive `switch` (no catch-all `default`); `Optional` return-only; `List.of()` never null; `final` + `List.copyOf`; rethrow wrapping cause; no broad `catch (Exception)`; try-with-resources; `BigDecimal` money, `java.time` not `Date`; constructor injection; `Objects.equals/hash`; virtual threads. Activate on `.java`, `pom.xml`, `build.gradle`."
---

# pattern-engineer-java

## When to activate

Activate when writing or editing any `.java` file, scaffolding a Java service or library, editing a Java project's `pom.xml` / `build.gradle` / `build.gradle.kts`, tuning Spotless / ErrorProne / NullAway config, or working with JUnit 5 / AssertJ / Testcontainers / Spring / Jakarta. Skip for non-Java code; `.kt` / `.kts` files are owned by `pattern-engineer-kotlin` even inside a Gradle project.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-java.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Toolchain & build

- Java 21 LTS; pin the toolchain in the build (`languageVersion = JavaLanguageVersion.of(21)` / `maven.compiler.release=21`).
- Build through the committed wrapper — `./gradlew` / `./mvnw`, never a globally installed `gradle` / `mvn`. Commit `gradlew`, `gradle/wrapper/` (or `mvnw`, `.mvn/wrapper/`).
- Spotless with `googleJavaFormat()` is the format gate; ErrorProne with NullAway is the static-analysis gate. Wire both into `check` / `verify`; nothing merges red.
- JUnit 5 (`useJUnitPlatform()`) + AssertJ for tests; Testcontainers for DB-touching integration tests. No JUnit 4, no PowerMock.

### Types & data carriers

- `record` for DTOs, value objects, and multi-value returns — not a hand-written class with getters.
- Sealed interfaces/classes for closed hierarchies; switch over them with pattern matching kept **exhaustive** — no `default` arm that silently absorbs future variants (let the compiler flag the gap when a variant is added).
- `Optional` as a return type only — never a field, parameter, or collection element.
- Never return `null` for a collection — return `List.of()` / `Map.of()` / `Set.of()`.

### Immutability

- `final` fields by default; mutate only where state genuinely changes.
- Defensive copies at constructor/accessor boundaries via `List.copyOf` / `Map.copyOf` / `Set.copyOf`.
- No setters on domain types without a demonstrated need.

### Errors & resources

- Never swallow — rethrow wrapping the cause: `throw new DomainException(msg, e)`.
- No broad `catch (Exception e)` / `catch (Throwable t)` except at a top-level boundary handler (request filter, executor, `main`).
- try-with-resources for every `AutoCloseable` — never a manual `close()` in a `finally` block.

### Numbers & time

- `BigDecimal` with an explicit scale + `RoundingMode` for money/precise decimals — never `double` / `float`.
- `java.time` (`Instant`, `LocalDate`, `LocalDateTime`, `ZonedDateTime`, `Duration`) — never `Date` / `Calendar` / `SimpleDateFormat`.
- Store and compare instants in UTC; attach a zone only at display boundaries.

### Equality

- `record`, or `equals` + `hashCode` always overridden together (one without the other is a bug); build both via `Objects.equals` / `Objects.hash`.
- Never `==` / `!=` on boxed primitives (`Integer`, `Long`) or `String` — use `.equals`; for `String` constants use `"literal".equals(x)`.

### Dependency injection

- Constructor injection only — no field `@Autowired` / `@Inject` / `@Resource`.
- Components stateless; hold collaborators in `final` fields set by the constructor.

### Streams & collections

- Streams for transformation pipelines (map/filter/collect); plain `for` / enhanced-for loops for side-effect-heavy logic.
- No `parallelStream()` without a measured win on a CPU-bound workload over a large dataset.
- Collect to immutable results (`Stream.toList()`, `Collectors.toUnmodifiableList()`).

### Concurrency

- Virtual threads (`Executors.newVirtualThreadPerTaskExecutor()`) for blocking-I/O concurrency.
- `ExecutorService` over a raw `new Thread(...).start()`; shut executors down (try-with-resources on 21+, else `finally`).
- `ConcurrentHashMap` or an immutable map over `synchronized` blocks guarding a shared map; no hand-rolled double-checked locking — use a holder class or memoized `Supplier`.

### Tests

- `@ParameterizedTest` (+ `@MethodSource` / `@CsvSource`) for table-driven cases — not copy-pasted `@Test` methods.
- AssertJ fluent assertions (`assertThat(x).isEqualTo(...)`, `assertThatThrownBy(...)`) over bare JUnit `assertEquals`.
- Testcontainers for tests that touch a real database/broker; no shared mutable static test state.
- Test-coverage *substance* (what to cover, boundary/error cases) is owned by `pattern-test-coverage` — follow it rather than this skill restating it.

### Adjacent surfaces

- HTTP/REST endpoint shape, status codes, and pagination are owned by `pattern-engineer-api`; cross-language service wiring by `pattern-engineer-backend-standard`; injection / SQL / crypto / authz by `pattern-engineer-security`. Follow those rather than restating them here.

## Tooling

Run through the wrapper so the pinned toolchain + plugin versions apply.

```bash
./gradlew spotlessCheck        # google-java-format gate
./gradlew spotlessApply        # auto-format
./gradlew compileJava          # ErrorProne + NullAway run here
./gradlew test                 # JUnit 5
./gradlew check                # all gates
```

Maven equivalent:

```bash
./mvnw spotless:check
./mvnw spotless:apply
./mvnw verify                  # compile (ErrorProne/NullAway) + test
```

Canonical Gradle gate wiring:

```kotlin
plugins {
    id("com.diffplug.spotless") version "6.25.0"
    id("net.ltgt.errorprone") version "4.0.1"
}

java { toolchain { languageVersion = JavaLanguageVersion.of(21) } }

spotless { java { googleJavaFormat() } }

dependencies {
    errorprone("com.google.errorprone:error_prone_core:2.27.1")
    errorprone("com.uber.nullaway:nullaway:0.10.26")
}

tasks.withType<JavaCompile>().configureEach {
    options.errorprone {
        check("NullAway", net.ltgt.gradle.errorprone.CheckSeverity.ERROR)
        option("NullAway:AnnotatedPackages", "com.example")
    }
}
```
