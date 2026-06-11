---
name: pattern-reviewer-rust
description: "Rust audit: `unsafe` without `// SAFETY:` (CRITICAL); `.unwrap()`/`.expect()` in prod (HIGH); `Box<dyn Error>` in lib API (HIGH); blocking in async fns / `std::sync::Mutex` held across `.await` (HIGH deadlock); truncating `as` casts + unchecked money/counter arithmetic (HIGH); `.clone()` to dodge borrow checker; catch-all `_` on domain enums; owned params over `&str`/`&[T]`; serde leaking into domain; uncommitted `Cargo.lock`. Cites `file:line`. Activate on `.rs` or `Cargo.toml` diffs."
---

# pattern-reviewer-rust

## When to activate

- Reviewing a diff that includes `.rs` files or `Cargo.toml` / `Cargo.lock` / `rustfmt.toml` / `clippy.toml`.
- A user says "review the Rust code / clippy findings / async / unsafe / error handling".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-rust.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### `unsafe` without a `// SAFETY:` comment (CRITICAL)

Grep `\bunsafe\b` in non-test code. Every `unsafe` block/fn must be preceded by a `// SAFETY:` comment proving the invariant. Application crates should carry `#![forbid(unsafe_code)]` at the crate root — its absence on an app crate that has no FFI need is itself a finding.

```rust
// BAD — no justification; could be UB
let s = unsafe { std::str::from_utf8_unchecked(bytes) };

// GOOD
// SAFETY: `bytes` came from `String::into_bytes` above, so it is valid UTF-8.
let s = unsafe { std::str::from_utf8_unchecked(bytes) };
```

False-positive guard: `unsafe impl Send`/`Sync` and FFI blocks still need the comment, but a crate that legitimately needs FFI cannot use `forbid(unsafe_code)` — don't flag the missing lint there.

### `.unwrap()` / `.expect()` in production paths (HIGH)

Grep `\.unwrap\(\)` / `\.expect\(` in `src/` excluding `#[cfg(test)]` modules, `tests/`, `examples/`, `benches/`, `build.rs`.

```rust
// BAD — panics on the first malformed row
let id: u64 = row.get("id").unwrap();

// GOOD — propagate
let id: u64 = row.try_get("id")?;
```

- False-positive guard: a startup-time `.expect("DATABASE_URL must be set")` on config/env at process boot is acceptable — the process *should* die. Flag only if the message states no invariant, or the call is on a per-request/hot path.
- `unwrap()` inside `#[test]` / `assert!`-style test setup is fine — do not flag.

### `Box<dyn Error>` in a library's public API (HIGH)

Look at `pub fn` / `pub` trait method signatures in a library crate (`[lib]` or `src/lib.rs`).

```rust
// BAD — opaque error in a library's public surface
pub fn parse(input: &str) -> Result<Config, Box<dyn std::error::Error>> { ... }

// GOOD — concrete thiserror enum
#[derive(thiserror::Error, Debug)]
pub enum ParseError { #[error("bad key: {0}")] BadKey(String) }
pub fn parse(input: &str) -> Result<Config, ParseError> { ... }
```

- `anyhow::Result` in a library's public API → HIGH (same problem; `anyhow` belongs at application edges — `main`, handlers, CLI commands).
- False-positive guard: `Box<dyn Error>` / `anyhow` inside a binary crate's `main` or handler is fine.

### Blocking call inside an async fn (HIGH)

In `async fn` / `async move` bodies (tokio), grep for `std::thread::sleep`, `std::fs::`, blocking `reqwest::blocking`, sync DB drivers, or obvious heavy CPU loops.

```rust
// BAD — blocks the runtime thread
async fn handle() { std::thread::sleep(Duration::from_secs(1)); }

// GOOD
async fn handle() {
    tokio::time::sleep(Duration::from_secs(1)).await;
    let rows = tokio::task::spawn_blocking(|| heavy_sync_query()).await?;
}
```

False-positive guard: `spawn_blocking` closures and code outside any async fn are fine.

### `std::sync::Mutex` guard held across `.await` (HIGH — deadlock)

Look for a `.lock().unwrap()` (or `.read()`/`.write()` on `std::sync::RwLock`) whose guard binding is still live at a later `.await` in the same scope.

```rust
// BAD — guard lives across the await; can deadlock the executor
let mut g = state.lock().unwrap();
g.count += fetch_remote().await?;   // guard held across .await

// GOOD — use tokio's async Mutex...
let mut g = state.lock().await;
g.count += fetch_remote().await?;

// GOOD — ...or drop the std guard before awaiting
let delta = { let g = state.lock().unwrap(); g.base };
let total = delta + fetch_remote().await?;
```

clippy's `await_holding_lock` catches the common case — flag it even if clippy was skipped.

### Truncating `as` cast on untrusted values (HIGH)

Grep `as (u|i)(8|16|32|64|size)` near runtime/external inputs (request fields, parsed input, lengths from untrusted sources).

```rust
// BAD — silently truncates / wraps
let port = parsed_u32 as u16;

// GOOD
let port = u16::try_from(parsed_u32)?;
```

False-positive guard: `as` on compile-time-known constants, or widening casts (`u8 as u32`), are fine. `usize`↔pointer casts belong to the unsafe rule.

### Unchecked arithmetic on money / counters (HIGH)

Plain `+`/`-`/`*` on balances, prices, quotas, or accumulating counters. Release builds wrap on overflow silently.

```rust
// BAD
let new_balance = balance + amount;

// GOOD
let new_balance = balance.checked_add(amount).ok_or(Error::Overflow)?;
```

False-positive guard: loop indices and small bounded counters where overflow is impossible don't need this — focus on financial/quota/security-relevant values.

### `.clone()` to dodge the borrow checker (MEDIUM)

A `.clone()` whose only purpose is to end a borrow (often on a large `String` / `Vec` / struct, immediately followed by a move).

```rust
// BAD — clones just to satisfy the borrow checker
let name = user.name.clone();
process(&user);
println!("{name}");

// GOOD — borrow; reorder so the borrow ends first
process(&user);
println!("{}", user.name);
```

False-positive guard: a clone genuinely needed for ownership (sending into a spawned task, storing beyond the borrow's lifetime, cheap `Arc::clone`/`Copy`) is correct — don't flag.

### Owned params for read-only inputs (MEDIUM)

Function params typed `String` / `Vec<T>` / owned `T` that are only read.

```rust
// BAD
fn greet(name: String) -> String { format!("hi {name}") }

// GOOD
fn greet(name: &str) -> String { format!("hi {name}") }
```

- `&str` over `String`, `&[T]` over `Vec<T>`, `&T` over `T` for read-only params.
- `Cow<'_, str>` when the value is sometimes owned. False-positive guard: a constructor/builder that *stores* the value legitimately takes ownership.

### Non-exhaustive `match` on a domain enum (MEDIUM)

A `match` on a project-owned enum with a catch-all `_ => ...` arm that silently absorbs future variants.

```rust
// BAD — a new Status variant compiles but is silently mishandled
match status {
    Status::Active => go(),
    _ => {}
}

// GOOD — list variants; a new one fails to compile until handled
match status {
    Status::Active => go(),
    Status::Pending | Status::Closed => wait(),
}
```

False-positive guard: catch-all on `#[non_exhaustive]` upstream enums, or on a huge enum where only a couple variants matter and the rest truly share one behavior, is acceptable.

### serde leaking into the domain (MEDIUM)

`#[derive(Serialize, Deserialize)]` on core domain types instead of dedicated boundary DTOs; or a missing `#[serde(deny_unknown_fields)]` on a closed contract; or hand-renamed fields where `rename_all` fits.

```rust
// BAD — serde derive threaded through the domain entity
#[derive(Deserialize)]
struct Order { /* domain logic lives here too */ }

// GOOD — boundary DTO, converted at the seam
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OrderDto { ... }
impl TryFrom<OrderDto> for Order { ... }
```

### Newtypes for domain ids (MEDIUM)

Bare `u64` / `String` / `Uuid` carried around as a domain id or unit where a transposition bug is possible (`fn transfer(from: u64, to: u64)`).

```rust
// BAD
fn transfer(from: u64, to: u64, cents: u64) { ... }

// GOOD
struct AccountId(u64); struct Cents(u64);
fn transfer(from: AccountId, to: AccountId, amount: Cents) { ... }
```

False-positive guard: don't demand newtypes for throwaway locals or obvious one-arg cases — flag where two same-typed ids/units are adjacent and swappable.

### Conversions & combinators (LOW)

- Ad-hoc `to_x()` / `as_x()` conversion methods where `From` / `TryFrom` is idiomatic → LOW.
- Nested `match` on `Option` / `Result` that an `?` / `map` / `ok_or` / `unwrap_or_else` would flatten → LOW.

### Iterators over index loops (LOW)

```rust
// BAD
let mut out = Vec::new();
for i in 0..items.len() { if items[i].active { out.push(items[i].name.clone()); } }

// GOOD
let out: Vec<_> = items.iter().filter(|i| i.active).map(|i| i.name.clone()).collect();
```

Only flag when the body is a single filter/transform; index loops with cross-element logic stay imperative.

### Missing `Debug` / over-broad visibility (LOW)

- Public type without `#[derive(Debug)]` → LOW.
- `pub` on items that never cross the crate boundary → LOW; prefer `pub(crate)`.

### Toolchain & gate hygiene (LOW/HIGH)

- `edition` not pinned in `Cargo.toml` → LOW.
- `Cargo.lock` not committed for a binary/service crate → HIGH (reproducible builds).
- `cargo clippy ... -D warnings` / `cargo fmt --check` not wired into CI, or a diff that introduces `#[allow(...)]` blanket suppressions without justification → MEDIUM.
- No `cargo audit` / `cargo deny` dependency gate in CI → MEDIUM.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
