---
name: pattern-engineer-rust
description: "Idiomatic Rust: edition pinned, `Cargo.lock` committed; `cargo fmt`/`clippy -D warnings`/`test`/`audit`; no `.unwrap()`/`.expect()` in prod (`?` to propagate; `thiserror` for libs, `anyhow` at edges; no `Box<dyn Error>` in lib API); no `.clone()` to dodge the borrow checker; `&str`/`&[T]` params; newtypes for ids; exhaustive `match`; serde at the boundary; no blocking in async tokio; `#![forbid(unsafe_code)]`; checked arithmetic; `try_from` over `as`. Activate on `.rs`, `Cargo.toml`."
---

# pattern-engineer-rust

## When to activate

Activate when writing or editing any `.rs` file, scaffolding a Rust crate, modifying `Cargo.toml` / `Cargo.lock` / `rustfmt.toml` / `clippy.toml` / `.clippy.toml`, working with tokio / serde / thiserror / anyhow / clap / axum / sqlx, or running `cargo fmt` / `cargo clippy` / `cargo test` / `cargo audit` / `cargo deny`. Skip for non-Rust code.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-rust.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Toolchain & gate

- Pin `edition` in `Cargo.toml` (`edition = "2021"` or newer); pin `rust-version` (MSRV) when you depend on it.
- `cargo fmt --check` clean — no hand-formatting against rustfmt.
- `cargo clippy --all-targets --all-features -- -D warnings` clean — warnings are errors.
- `cargo test` passes (unit + integration under `tests/`).
- Commit `Cargo.lock` for binaries and services; libraries leave it ungitignored but it is advisory.
- `cargo audit` (or `cargo deny check`) is the dependency/advisory gate — wire it into CI.

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo audit            # or: cargo deny check
```

### Error handling

- No `.unwrap()` / `.expect()` on `Result` / `Option` in production paths. Tests, build scripts, examples, and benches are fine.
- A startup-time `.expect("invariant message")` on config/env is acceptable when the process should die on a violated invariant — the message states the invariant.
- Propagate with `?`; don't hand-roll `match` that just returns the `Err`.
- `thiserror` for typed library errors; `anyhow` only at application edges (`main`, request handlers, CLI commands).
- Never `Box<dyn Error>` in a library's public API — return a concrete `thiserror` enum.

### Ownership & borrowing

- Never `.clone()` solely to silence the borrow checker — restructure, borrow, or split the borrow instead.
- Read-only params take `&str` / `&[T]` / `&T`, not `String` / `Vec<T>` / owned `T`.
- `Cow<'_, str>` (or `Cow<'_, [T]>`) when a value is sometimes borrowed, sometimes owned.

### Types & matching

- Newtype wrappers (`struct UserId(u64);`) for domain ids and units — not bare `u64` / `String`.
- Exhaustive `match` on domain enums — no catch-all `_` arm that silently absorbs future variants. List variants; let new ones fail to compile.
- `Option` / `Result` combinators (`map`, `and_then`, `unwrap_or_else`, `ok_or`, `?`) over nested `match` where clearer.

### Boundaries (serde)

- serde derives live at the boundary only; convert into domain types at the seam — don't thread serde structs through the core.
- `#[serde(deny_unknown_fields)]` when the contract is closed.
- `#[serde(rename_all = "camelCase")]` (or the contract's spelling) over hand-renaming each field.

### Async (tokio)

- Never block in an async fn: no `std::thread::sleep`, sync file/DB I/O, or heavy CPU on the runtime — offload to `tokio::task::spawn_blocking`.
- Join spawned tasks (`JoinHandle`), or detach deliberately with a `// detached:` comment saying why.
- Timeout every outbound call (`tokio::time::timeout`).
- Holding a `std::sync::Mutex` guard across `.await` is a deadlock smell — use `tokio::sync::Mutex`, or scope the guard so it drops before the await.

### Unsafe

- `#![forbid(unsafe_code)]` at the crate root of application crates.
- Any `unsafe` block elsewhere carries a `// SAFETY:` comment proving the invariant it upholds.

### Arithmetic

- Checked / saturating arithmetic (`checked_add`, `saturating_sub`, …) on money and counters — release-mode overflow wraps silently.
- No truncating `as` casts on untrusted/runtime values — `u32::try_from(x)?`. `as` is fine for compile-time-known widening.

### Idiom

- Iterator chains (`.iter().filter().map().collect()`) over manual index loops.
- Implement `From` / `TryFrom` for conversions instead of ad-hoc `to_x()` / `as_x()` methods.
- `#[derive(Debug)]` on public types.
- Keep the public surface minimal — `pub(crate)` by default; promote to `pub` only when crossing the crate boundary.

### Pointers to adjacent skills

- Secrets handling, SSRF, injection, auth, crypto choice → owned by `pattern-engineer-security`; follow its catalogue rather than restating here.
- Test layout / coverage substance → `pattern-test-coverage`.
- HTTP route/contract wiring, healthz/readyz, env lockstep → `pattern-engineer-backend-standard` / `pattern-engineer-api`.
