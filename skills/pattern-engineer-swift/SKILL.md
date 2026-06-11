---
name: pattern-engineer-swift
description: "Idiomatic Swift (app + server): SwiftPM with pinned `swift-tools-version` + committed `Package.resolved`; SwiftLint/swift-format gates; Swift Testing (`@Test`/`#expect`) for new targets. No force `!`/`try!`/`as!`/IUO in prod; `guard let` + `??`. Value types by default; exhaustive `switch`; domain `Error` enums; async/await + actors, honest `Sendable`, `[weak self]`; `Codable` `CodingKeys` + explicit date strategy; `Decimal` for money. Activate on `.swift`, `Package.swift`, `.xcodeproj`."
---

# pattern-engineer-swift

## When to activate

Activate when writing or editing any `.swift` file, editing `Package.swift` / `Package.resolved`, changing an `.xcodeproj` / `.xcworkspace`, scaffolding a SwiftPM package or executable, working with SwiftUI / UIKit / Vapor / Hummingbird / Foundation, or editing `.swiftlint.yml` / `.swift-format`. Skip for non-Swift code (Objective-C bridging headers aside).

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-swift.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Toolchain — SwiftPM + gates

- SwiftPM is the package manager: `Package.swift` pins `swift-tools-version` on line one.
- Commit `Package.resolved` for apps and executables; libraries leave it ungated.
- SwiftLint and swift-format are the lint/format gates — wire them in CI, not just locally.
- New test targets use Swift Testing (`@Test` / `#expect` / `#require`); XCTest is acceptable only in pre-existing XCTest targets.
- Pin dependency versions with `.upToNextMajor(from:)` ranges, not branch/revision, unless justified by a comment.

### Optionals — no force operators in production

- No force unwrap `!`, no `try!`, no `as!` in production code (test targets and SwiftUI `#Preview`s are fine).
- `guard let x = x else { ... }` for early-exit; return / throw / `fatalError` only with a documented invariant.
- Optional chaining `a?.b?.c` plus `??` defaults over unwrap-then-use.
- No implicitly-unwrapped-optional declarations (`var name: String!`) outside legacy `@IBOutlet`.

### Types — value-first

- `struct` / `enum` by default; reach for `class` only when you need reference semantics or identity.
- Protocols at collaborator seams; depend on the protocol, not the concrete type.
- Enums with associated values for state machines (`enum LoadState { case idle, loading, loaded(Data), failed(Error) }`).
- Exhaustive `switch` — no `default` arm on a domain enum (it silently absorbs future cases). Use `@unknown default` only on non-frozen system enums.

### Errors — typed domain enums

- Domain errors are an `enum: Error`; use typed throws (`throws(MyError)`) where the toolchain supports it.
- `LocalizedError` conformance only at the UI edge, not on the core domain error.
- Never bare `try?` that discards an error a caller needs to branch on — `try?` is fine only when nil genuinely means "absent, and that's handled".

### Concurrency — async/await + actors

- async/await with structured concurrency; `withTaskGroup` / `async let` for fan-out.
- No `Task.detached` without a comment justifying the deliberately-lost actor/priority context.
- `actor` for shared mutable state; `@MainActor` for UI-facing state and view models.
- Honest `Sendable`: `@unchecked Sendable` requires an inline comment stating the invariant that makes it safe.
- No new `DispatchQueue` / GCD code in an async/await codebase.

### Memory — break cycles

- `[weak self]` in escaping closures stored beyond the call (subscriptions, timers, completion handlers held by a property).
- `weak var delegate` for delegate references.
- No retain cycles through long-lived stored closures; capture lists are explicit.

### Boundaries — encoding & money

- `Codable` with explicit `CodingKeys` whenever the wire contract naming differs from Swift naming.
- Set an explicit date strategy on encoders/decoders (`.iso8601` or the contract-specified format) — never rely on the default `Date` encoding.
- `Decimal` for money and exact-decimal values — never `Double`.

### API design — clarity at point of use

- Argument labels and naming per the Swift API Design Guidelines (reads as a phrase at the call site).
- Explicit access control (`public` / `internal` / `private`) on every library surface; default to the narrowest that works.

### Adjacent skills (pointers, not restated here)

- Auth, secrets, input-trust, and crypto are owned by `pattern-engineer-security` — follow its catalogue; this skill does not restate it.
- Server-side route/handler/middleware mechanics (contract adherence, `/healthz`, log redaction) are owned by `pattern-engineer-backend-standard` / `pattern-engineer-api`.
- Test-coverage substance (what to test, ratios, fixtures) lives in the shared `pattern-test-coverage`; this skill only fixes the *framework* (Swift Testing for new targets).

## Tooling

```bash
swift build                 # Compile the package
swift test                  # Run Swift Testing / XCTest targets
swiftlint                   # Lint (CI gate)
swiftlint --fix             # Auto-fix the autocorrectable subset
swift-format lint -r .      # Format check (CI gate)
swift-format -i -r .        # Apply formatting in place
```

Minimal `.swiftlint.yml` baseline — the force-operator opt-ins are the load-bearing lines:

```yaml
opt_in_rules:
  - force_unwrapping        # bans `!`
  - empty_count
  - first_where
excluded:
  - .build
  - Tests                   # previews/tests may force-unwrap
analyzer_rules:
  - unused_declaration
```

`swift-tools-version` and dependency pinning live in `Package.swift`:

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MyApp",
    dependencies: [
        .package(url: "https://github.com/vapor/vapor.git", .upToNextMajor(from: "4.0.0")),
    ]
)
```
