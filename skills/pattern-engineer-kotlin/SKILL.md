---
name: pattern-engineer-kotlin
description: "Modern idiomatic Kotlin (JVM/server): Gradle Kotlin DSL + wrapper; ktlint/detekt gates; JUnit 5 + MockK; no `!!` in prod (`?.`/`?:`/`requireNotNull`); pin Java platform types at boundaries; `data class` DTOs; sealed types + exhaustive `when` (no domain `else`); `value class` ids; `val` + read-only `List`; structured concurrency (no `GlobalScope`); `suspend` never blocks (`withContext(Dispatchers.IO)`); never swallow `CancellationException`; `Flow` streams; named args. Activate on `.kt`/`.kts`."
---

# pattern-engineer-kotlin

## When to activate

Activate when writing or editing any `.kt` or `.kts` file, scaffolding a Kotlin service or shared module, editing Gradle Kotlin DSL build scripts (`build.gradle.kts` / `settings.gradle.kts`), tuning `.editorconfig` / ktlint / detekt config, or working with coroutines / `Flow` / kotlinx.serialization / JUnit 5 / MockK / Kotest. Skip for non-Kotlin code; pure-Java files are owned by `pattern-engineer-java`.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-kotlin.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Toolchain & build

- Gradle with the Kotlin DSL (`build.gradle.kts`); commit the wrapper (`gradlew`, `gradle/wrapper/`) and pin the distribution.
- ktlint and detekt are the gates; nothing merges red. Wire both into the `check` task.
- JUnit 5 (`useJUnitPlatform()`) + MockK for tests; Kotest acceptable. Don't pull in legacy JUnit 4 or PowerMock.
- Pin the JVM toolchain (`kotlin { jvmToolchain(21) }`) so the build is reproducible across machines.
- kotlinx.serialization or Jackson lives at the boundary only — keep (de)serialization annotations off core domain types.

### Null safety

- No `!!` in production code — `?.` / `?:` chains, smart casts, or early return instead. (`!!` in tests is fine.)
- `requireNotNull(x) { "..." }` / `checkNotNull(x) { "..." }` with a message to assert an invariant and narrow the type.
- Pin platform types from Java interop with an explicit nullable/non-null type at the boundary (`val name: String = javaApi.getName()`), never let `String!` leak inward.
- `lateinit` only for genuinely deferred non-null init (DI / lifecycle); never as a `!!` workaround for nullable data.

### Types

- `data class` for DTOs / value carriers — no behavior beyond trivial derived properties.
- Sealed interface / sealed class + exhaustive `when` for closed domain hierarchies; **no `else` arm** on a domain `when` (it silently absorbs a future variant — let the compiler flag the gap).
- `value class` (inline) for domain ids (`@JvmInline value class UserId(val value: Long)`) — no bare `Long` / `String` ids.
- `val` over `var`; reassignable state is the exception, not the default.
- Read-only collection types in public signatures (`List`, `Map`, `Set` — never `MutableList` / `ArrayList`); mutate locally, expose read-only.

### Coroutines

- Structured concurrency only — never `GlobalScope`. Scope is owned by the lifecycle owner; child work is launched in that scope.
- `suspend` functions never block a thread — wrap blocking I/O in `withContext(Dispatchers.IO) { ... }`.
- `Flow` for streams of values; cold by default, collected in the consumer's scope.
- Cancellation stays cooperative — never swallow `CancellationException`. If you `catch (e: Exception)` around suspending code, rethrow `CancellationException` first.
- `runCatching` around suspending code catches `CancellationException` — avoid it there, or rethrow it explicitly inside the failure branch.

### Errors

- Wrap with cause when rethrowing (`throw DomainException("...", e)`); catch the narrowest type that applies.
- No exception-as-control-flow — branch on a value, not on a thrown-and-caught exception.
- Sealed result types (or `Result<T>`) at module seams where callers must branch on failure; exceptions for truly exceptional, non-branched failures.

### Idiom

- Expression bodies for one-liners (`fun area() = w * h`); block body only when there's real statement logic.
- Named arguments for boolean params and runs of adjacent same-type params (`move(x = 1, y = 2, animate = true)`).
- Scope functions (`let` / `apply` / `also` / `run`) at most one level deep — nested scope-function chains are a smell; name an intermediate `val` instead.
- Extension functions for utilities, not core domain behavior — domain behavior belongs as methods on the type.
- String templates (`"id=$id"`) over `+` concatenation.

> Security-grade rules (secret handling, crypto choice, input validation) are owned by `pattern-engineer-security`; test-coverage substance by `pattern-test-coverage`; language-agnostic service wiring by `pattern-engineer-backend-standard` / `pattern-engineer-api`. This skill does not restate them.

## Tooling

```bash
./gradlew ktlintCheck        # Style / formatting gate
./gradlew detekt             # Static analysis gate
./gradlew test               # JUnit 5 (+ MockK / Kotest)
./gradlew check              # Aggregate gate (ktlint + detekt + test)
```

Auto-fix style before re-running:

```bash
./gradlew ktlintFormat
```

A minimal detekt baseline worth pinning (fail on the null-safety and coroutine smells this skill enforces):

```yaml
# detekt.yml
potential-bugs:
  active: true
  UnsafeCast: { active: true }
style:
  active: true
  ForbiddenMethodCall:
    active: true
    methods: ['kotlinx.coroutines.GlobalScope']
  MaxLineLength: { maxLineLength: 120 }
coroutines:
  active: true
  GlobalCoroutineUsage: { active: true }
  SuspendFunWithFlowReturnType: { active: true }
```
