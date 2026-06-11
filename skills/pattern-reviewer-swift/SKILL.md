---
name: pattern-reviewer-swift
description: "Swift audit (app + server): force `!`/`try!`/`as!`/IUO in prod (HIGH crash); `default` swallowing future enum cases (HIGH); retain cycles — missing `[weak self]`/strong `delegate` (HIGH); `@unchecked Sendable` without invariant + `Task.detached` (HIGH); `Double` for money (HIGH); default `Date` encoding/missing `CodingKeys`; class where struct fits; silent `try?`; new `DispatchQueue` in async code; unpinned/uncommitted `Package.*`. Cites `file:line`. Activate on `.swift`/`Package.swift`."
---

# pattern-reviewer-swift

## When to activate

- Reviewing a diff that includes `.swift` files, `Package.swift`, `Package.resolved`, or `.xcodeproj` / `.swiftlint.yml` / `.swift-format` changes.
- A user says "review the Swift code / concurrency / optionals / SwiftPM setup".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-swift.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### Force unwrap / `try!` / `as!` / IUO in production (HIGH)

Detection: grep production sources (exclude `Tests/`, `*Tests.swift`, and `#Preview` blocks) for `!` after an expression, `try!`, `as!`, and IUO declarations (`: Type!`).

```swift
// BAD — crashes on nil / type mismatch / thrown error
let url = URL(string: raw)!
let user = try! decoder.decode(User.self, from: data)
let cell = item as! ProductCell
var name: String!

// GOOD
guard let url = URL(string: raw) else { return .invalidURL }
let user = try decoder.decode(User.self, from: data)
guard let cell = item as? ProductCell else { return UITableViewCell() }
var name: String?
```

False positives: force ops in test targets and SwiftUI previews are fine. `@IBOutlet weak var x: UIView!` is the sanctioned IUO exception. `1...10` and history `!=` / boolean `!` are not force unwraps.

### Non-exhaustive `switch` on a domain enum (HIGH)

Detection: a `switch` over a project-owned enum that carries a `default:` arm — it silently absorbs cases added later, so a new state compiles but is mishandled.

```swift
// BAD — adding `.refunded` later slips through default
switch order.state {
case .pending: ...
case .shipped: ...
default: break
}

// GOOD — compiler forces you to handle every new case
switch order.state {
case .pending: ...
case .shipped: ...
case .refunded: ...
}
```

False positives: `@unknown default` on a non-frozen **system** enum (Apple framework / library-evolution) is correct, not a finding. `default` over a genuinely open set (e.g. mapping arbitrary `Int`) is fine.

### Retain cycles (HIGH)

Detection: escaping closures stored on a property (Combine sinks, `Task {}` held in a property, timer/notification handlers, completion handlers retained by an owning object) that reference `self` strongly; and `var delegate` declared without `weak`.

```swift
// BAD — closure stored on self captures self strongly → cycle
cancellable = publisher.sink { self.update($0) }
var delegate: FooDelegate?

// GOOD
cancellable = publisher.sink { [weak self] in self?.update($0) }
weak var delegate: FooDelegate?
```

False positives: closures that are called and discarded synchronously (e.g. `map`, `filter`, `forEach`) do not need `[weak self]`. `[unowned self]` is acceptable when the closure provably cannot outlive `self` (document it).

### Dishonest `Sendable` / unstructured tasks (HIGH)

Detection: `@unchecked Sendable` declarations, and `Task.detached(` call sites.

```swift
// BAD — escapes the compiler's data-race checking with no stated reason
final class Cache: @unchecked Sendable { var store: [String: Data] = [:] }
Task.detached { await self.refresh() }

// GOOD — actor gives real isolation; or document the invariant
actor Cache { var store: [String: Data] = [:] }
// @unchecked Sendable: all access guarded by `lock`; never mutated after init
Task { await refresh() }  // inherits actor context unless detachment is needed
```

`@unchecked Sendable` without an inline invariant comment → HIGH. `Task.detached` without a comment justifying the deliberately-lost context → HIGH.

### `Double` for money (HIGH)

Detection: monetary properties / parameters (`price`, `amount`, `total`, `balance`, `cost`) typed `Double` or `Float`; arithmetic on currency in floating point.

```swift
// BAD — binary float can't represent 0.1; rounding errors accumulate
let total: Double = price * Double(quantity)

// GOOD
let total: Decimal = price * Decimal(quantity)
```

False positives: non-monetary measurements (coordinates, ratios, durations) legitimately use `Double`.

### New `DispatchQueue` / GCD in an async codebase (HIGH)

Detection: `DispatchQueue.`, `.async {`, `DispatchSemaphore`, `dispatch_` introduced in a file/module that already uses async/await.

```swift
// BAD — reintroduces callback concurrency next to async/await
DispatchQueue.global().async { let r = work(); DispatchQueue.main.async { done(r) } }

// GOOD
let r = await work()
await MainActor.run { done(r) }
```

False positives: low-level interop with a C/GCD-only API, or a pre-existing all-GCD module not yet migrated — note it but downgrade.

### Default `Date` encoding / missing `CodingKeys` (MEDIUM)

Detection: a `JSONEncoder` / `JSONDecoder` used without setting `.dateEncodingStrategy` / `.dateDecodingStrategy`; a `Codable` type whose Swift property names differ from the wire contract but declares no `CodingKeys`.

```swift
// BAD — default strategy emits Date as a float since-reference-date
let data = try JSONEncoder().encode(payload)
struct User: Codable { let userId: String }  // wire sends "user_id"

// GOOD
let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
struct User: Codable {
    let userId: String
    enum CodingKeys: String, CodingKey { case userId = "user_id" }
}
```

False positives: a project-wide configured encoder passed in (don't flag each call site if the strategy is set centrally). Types whose names already match the contract need no `CodingKeys`.

### Class where a struct fits (MEDIUM)

Detection: a `class` used as a plain data carrier — no inheritance, no identity semantics, no shared-mutable-reference requirement.

```swift
// BAD — reference type for a value
class Point { var x: Double; var y: Double; init(...) {...} }

// GOOD
struct Point { var x: Double; var y: Double }
```

False positives: types needing identity (`===`), reference sharing, `deinit`, Obj-C interop, or `@MainActor` observable reference models (`@Observable` / `ObservableObject`) legitimately stay classes.

### Silent `try?` discarding a needed error (MEDIUM)

Detection: `try?` whose nil result is then used as if the operation succeeded, or branched on without distinguishing failure from a legitimate absence.

```swift
// BAD — swallows the decode error; caller can't tell why it's nil
let user = try? decoder.decode(User.self, from: data)

// GOOD — surface the error a caller needs to branch on
let user = try decoder.decode(User.self, from: data)
```

False positives: `try?` is correct when nil genuinely means "absent and handled" (e.g. optional cache lookup).

### Protocols at seams / `LocalizedError` placement (MEDIUM)

- A handler depending on a concrete service type where a protocol seam would decouple it → MEDIUM (idiom; flag only at real collaborator boundaries, not every internal call).
- `LocalizedError` conformance on a core domain error enum (rather than at the UI edge) → MEDIUM.

### SwiftPM hygiene (MEDIUM)

Detection: inspect `Package.swift` and `Package.resolved`.

- Missing or unexpectedly-old `swift-tools-version` on line one of `Package.swift` → MEDIUM.
- Dependency pinned to `branch:` / `revision:` instead of a version range, with no justifying comment → MEDIUM.
- `Package.resolved` not committed for an app/executable target → MEDIUM (libraries exempt).

### Missing access control on a library surface (LOW)

- `public` library API with members left at implicit `internal` where the intent is public, or no access modifiers on a published module surface → LOW.

### Naming / API Design Guidelines (LOW — formatter/linter territory)

- Argument labels that don't read as a phrase at the call site, non–`lowerCamelCase` members, non–`UpperCamelCase` types → LOW. SwiftLint / swift-format catch most; flag where they would.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
