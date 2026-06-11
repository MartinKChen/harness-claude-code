---
name: pattern-reviewer-kotlin
description: "Kotlin audit (JVM/server): `!!` in production (HIGH); swallowed `CancellationException` / `runCatching` around suspend (HIGH); `GlobalScope` (HIGH); blocking call in `suspend` without `withContext(Dispatchers.IO)` (HIGH); leaked Java platform type (HIGH); `else` on a domain sealed `when` (HIGH); `MutableList` in public signatures (MEDIUM); plain class as DTO (MEDIUM); bare id vs `value class` (MEDIUM); `var`, nested scope functions (LOW). Cites `file:line`. Activate on `.kt`/`.kts` diffs."
---

# pattern-reviewer-kotlin

## When to activate

- Reviewing a diff that includes `.kt` or `.kts` files (incl. Gradle Kotlin DSL build scripts).
- A user says "review the Kotlin code / coroutines / null safety / detekt findings".

Skip pure-Java files — those are owned by `pattern-reviewer-java`. Security-grade rules are owned by `pattern-reviewer-security`, test-coverage substance by `pattern-test-coverage`, and language-agnostic service wiring by `pattern-reviewer-backend-standard` — defer to them rather than restating.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-kotlin.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### `!!` in production code (HIGH)

Detection: grep `!!` across `src/main`; each hit is a candidate. Each is a runtime `NullPointerException` waiting to happen — the null contract has been asserted away rather than handled.

```kotlin
// BAD
val name = user.profile!!.displayName!!

// GOOD — handle the null
val name = user.profile?.displayName ?: "anonymous"

// GOOD — assert an invariant with a message (narrows the type, fails loudly)
val profile = requireNotNull(user.profile) { "profile must be loaded for $user" }
val name = profile.displayName
```

False-positive guard: `!!` in test code (`src/test`) is fine — tests want to fail loudly on a violated setup assumption. Only flag `src/main`.

### Swallowed `CancellationException` (HIGH)

Detection: in suspending code, look for `catch (e: Exception)` / `catch (e: Throwable)` and any `runCatching { ... }` wrapping a `suspend` call. `CancellationException` is how structured concurrency unwinds — swallowing it makes coroutines uncancellable and leaks work.

```kotlin
// BAD — cancellation is caught and discarded
suspend fun load() = try {
    fetch()
} catch (e: Exception) {
    logger.warn("failed", e); null
}

// BAD — runCatching catches CancellationException too
suspend fun load() = runCatching { fetch() }.getOrNull()

// GOOD — rethrow cancellation, handle the rest
suspend fun load() = try {
    fetch()
} catch (e: CancellationException) {
    throw e
} catch (e: IOException) {
    logger.warn("failed", e); null
}
```

False-positive guard: a `catch (e: CancellationException) { throw e }` already present, or a narrow catch (`catch (e: IOException)`) that cannot match `CancellationException`, is fine.

### `GlobalScope` usage (HIGH)

Detection: grep `GlobalScope`. It launches work detached from any lifecycle — it never gets cancelled and leaks past the owner's death.

```kotlin
// BAD
GlobalScope.launch { syncInBackground() }

// GOOD — launched in a scope the lifecycle owner cancels
class Syncer(private val scope: CoroutineScope) {
    fun start() = scope.launch { syncInBackground() }
}
```

### Blocking call inside `suspend` (HIGH)

Detection: in a `suspend fun` (or `Flow` builder), look for blocking JDBC / `InputStream.read` / `Thread.sleep` / `File.readText` / blocking HTTP clients not wrapped in `withContext(Dispatchers.IO)`. Blocking a dispatcher thread starves the pool.

```kotlin
// BAD — blocks a coroutine dispatcher thread
suspend fun read(path: Path): String = Files.readString(path)

// GOOD
suspend fun read(path: Path): String =
    withContext(Dispatchers.IO) { Files.readString(path) }
```

False-positive guard: a genuinely non-blocking suspending API (e.g. an async DB driver's `suspend` call) needs no wrapping — don't flag it.

### Leaked platform type at Java boundary (HIGH)

Detection: a `val`/`val`-less binding or function return taking a value straight from Java interop without an explicit type — the platform type (`String!`) flows inward and defers the NPE to a distant call site.

```kotlin
// BAD — platform type String! propagates; NPE surfaces far away
val name = legacyJavaApi.getName()

// GOOD — pin the contract at the boundary
val name: String = requireNotNull(legacyJavaApi.getName()) { "name required" }
// or, if nullable is legitimate:
val name: String? = legacyJavaApi.getName()
```

### `else` arm on a domain sealed `when` (HIGH)

Detection: a `when (x)` over a sealed type / enum that carries an `else` branch. The `else` silently absorbs any future variant, so adding a case won't trip the compiler — a real branch is missed at runtime.

```kotlin
// BAD — else swallows the next PaymentMethod added
when (method) {
    is Card -> charge(method)
    is BankTransfer -> transfer(method)
    else -> error("unsupported")
}

// GOOD — exhaustive; compiler flags a new variant
when (method) {
    is Card -> charge(method)
    is BankTransfer -> transfer(method)
    is Wallet -> debit(method)
}
```

False-positive guard: `else` is acceptable on a `when` over an open/unbounded value (an `Int`, an external/library enum you don't own) where exhaustiveness is impossible.

### Mutable collection in public signature (MEDIUM)

Detection: `MutableList` / `MutableMap` / `MutableSet` / `ArrayList` / `HashMap` in a public function parameter or return type.

```kotlin
// BAD — caller can mutate internal state
fun activeUsers(): MutableList<User>

// GOOD
fun activeUsers(): List<User>
```

False-positive guard: a builder API that deliberately hands back a mutable accumulator, or a `private`/`internal` helper, is fine.

### Plain class as DTO (MEDIUM)

Detection: a class that is only fields/properties (no real behavior) declared as a regular `class` instead of a `data class` — loses `equals`/`hashCode`/`copy`/`toString`.

```kotlin
// BAD
class UserDto(val id: Long, val email: String)

// GOOD
data class UserDto(val id: Long, val email: String)
```

False-positive guard: classes with identity semantics (entities whose equality is by id, not value) or with real behavior should not be forced to `data class`.

### Bare-typed domain id vs `value class` (MEDIUM)

Detection: domain ids passed as raw `Long` / `String` / `UUID` across signatures — easy to transpose (`transfer(fromId, toId)`).

```kotlin
// BAD
fun transfer(from: Long, to: Long, amount: Long)

// GOOD
@JvmInline value class AccountId(val value: Long)
fun transfer(from: AccountId, to: AccountId, amount: Money)
```

False-positive guard: don't push this on throwaway local helpers or DTO fields that mirror an external schema — it's a seam-level rule.

### Mutable result/no sealed result at a failure seam (MEDIUM)

Detection: a module-seam function whose callers must branch on failure but that signals it via thrown exceptions or a nullable return rather than a sealed result type / `Result<T>`.

```kotlin
// BAD — caller can't tell why null came back
fun parse(raw: String): Config?

// GOOD — sealed result, caller branches exhaustively
sealed interface ParseResult {
    data class Ok(val config: Config) : ParseResult
    data class Invalid(val reason: String) : ParseResult
}
fun parse(raw: String): ParseResult
```

### `var` where `val` suffices (LOW)

Detection: a `var` that is assigned once and never reassigned. Prefer `val`.

```kotlin
// BAD
var total = items.sumOf { it.price }

// GOOD
val total = items.sumOf { it.price }
```

### Nested scope functions (LOW)

Detection: `let` / `apply` / `also` / `run` chained or nested more than one level — `it` / `this` rebinding becomes ambiguous.

```kotlin
// BAD
user?.let { u -> u.profile?.let { p -> render(u, p) } }

// GOOD — name the intermediates
val u = user ?: return
val p = u.profile ?: return
render(u, p)
```

### String concatenation over templates (LOW)

Detection: `"..." + value + "..."` where a template reads cleaner.

```kotlin
// BAD
val msg = "user " + id + " not found"

// GOOD
val msg = "user $id not found"
```

### ktlint / detekt style (LOW — gate should fix)

- Findings ktlint would auto-format (import order, indentation, wildcard imports) → flag only where the gate would catch them.
- `GlobalScope` / unsafe-cast detekt rules duplicated here are the substance; cite the detekt rule id when one exists.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
