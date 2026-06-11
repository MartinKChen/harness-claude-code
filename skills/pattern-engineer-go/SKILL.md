---
name: pattern-engineer-go
description: "Modern idiomatic Go: pinned `go.mod`/`toolchain`; gofmt-clean; `go vet` + `golangci-lint run` + `go test -race ./...`; every error checked + wrapped via `%w`; `errors.Is`/`As`; no panic across API boundaries; `ctx` first param, never stored; small consumer-side interfaces, accept-interfaces/return-structs; every goroutine has an exit path (`errgroup`/`WaitGroup`); sender-closes-channel; zero-value structs; `defer` cleanup; MixedCaps; table-driven `t.Run` tests. Activate on `.go`, `go.mod`."
---

# pattern-engineer-go

## When to activate

Activate when writing or editing any `.go` file, scaffolding a Go service or CLI, modifying `go.mod` / `go.sum`, tuning `.golangci.yml`, or running `gofmt` / `goimports` / `go vet` / `golangci-lint` / `go test`. Skip for non-Go code.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-go.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Toolchain & modules

- `go.mod` pins the language version (`go 1.x`) and an explicit `toolchain go1.x.y` directive.
- Keep code gofmt/goimports-clean; CI fails on a non-empty `gofmt -l .`.
- Lint gate is `go vet ./...` + `golangci-lint run`; nothing merges red.
- Always `go test -race ./...` — the race detector is non-negotiable, not opt-in.
- Run `go mod tidy` and commit both `go.mod` and `go.sum`; never hand-edit `go.sum`.

### Errors

- Check every returned error; never `_`-discard one without an inline comment justifying it.
- Wrap with context at each hop: `fmt.Errorf("loading user %d: %w", id, err)` — `%w`, not `%v`, to keep the chain unwrappable.
- Compare with `errors.Is` / extract with `errors.As` — never `err.Error()` string matching.
- Declare sentinels as package-level `var ErrNotFound = errors.New("not found")`.
- No `panic` across a package/API boundary — return an error. `panic` only for unreachable programmer-error invariants.
- `recover` only at a goroutine's top frame in a long-running server; never as flow control.

### Context

- `ctx context.Context` is the first parameter of anything doing I/O (DB, HTTP, RPC, file).
- Propagate the caller's `ctx`; never store one in a struct field.
- Honor cancellation inside loops (`select { case <-ctx.Done(): ... }`); check `ctx.Err()` before long work.
- Wrap outbound calls in `context.WithTimeout`/`WithDeadline` and `defer cancel()`.

### Interfaces

- Define interfaces at the consumer, not alongside the implementation.
- Keep them small — 1–3 methods (`io.Reader`-sized).
- Accept interfaces, return concrete structs.
- No preemptive exported "for mocking" interfaces; introduce one when a second caller or a real seam appears.

### Goroutines & concurrency

- Every goroutine has a defined exit path — no fire-and-forget.
- Use `errgroup.Group` or `sync.WaitGroup` to track lifetime and surface errors; never spawn an untracked goroutine in a request handler.
- A channel is closed by its sender only, never a receiver.
- Mutex (`sync.Mutex`/`RWMutex`) guards shared mutable state; channels pass ownership/handoff.

### Idiom

- Make the zero value useful — a freshly declared struct should be usable without a constructor where feasible.
- `defer` the cleanup immediately after acquiring the resource (`f, err := os.Open(...); ...; defer f.Close()`).
- MixedCaps naming; no `Get` prefix on getters; no package-name stutter (`user.User`, not `user.UserStruct`).
- `any`/`interface{}` only where generics or a concrete type genuinely can't fit; reach for type parameters first.
- Slice-aliasing trap: `append` may mutate a shared backing array — copy or full-slice (`s[a:b:b]`) before handing a sub-slice to another owner.
- `time.Duration` for durations — never a bare `int` of seconds/millis.

### Tests

- Table-driven with `t.Run(tc.name, ...)` subtests; one struct slice of cases.
- Mark helpers with `t.Helper()` so failures point at the caller.
- `t.Parallel()` where cases are independent and don't share mutable state.
- `net/http/httptest` for handler tests — real `*http.Request`/`ResponseRecorder`, not hand-rolled fakes.
- Coverage substance (what to test, the happy/edge/failure matrix) is owned by `pattern-test-coverage` — follow it rather than restating here.

### Layout

- `cmd/<app>/main.go` is thin — flag/env parsing, wiring, then call into a package.
- Application packages live under `internal/` so they can't be imported externally.
- No cargo-culted `pkg/` — add it only when you deliberately export a library surface.

### Adjacent skills

- Input validation, auth, error-envelope shaping, and HTTP wiring are language-agnostic — owned by `pattern-engineer-backend-standard` / `pattern-engineer-api`.
- Crypto, SSRF, injection, and secret handling are owned by `pattern-engineer-security`; follow its catalogue rather than restating it here.

## Tooling

```bash
gofmt -l .                 # List unformatted files (empty = clean)
goimports -l .             # List files with bad/missing imports
go vet ./...               # Built-in static analysis
golangci-lint run          # Aggregated linters (lint gate)
go test -race ./...        # Tests with the race detector
go mod tidy                # Reconcile go.mod / go.sum
```

Auto-fix before re-running checks:

```bash
gofmt -w .                 # Format in place
goimports -w .             # Fix + group imports in place
golangci-lint run --fix    # Apply auto-fixable lint findings
```

### Baseline `.golangci.yml`

The scaffold ships this enabled set; treat it as the floor:

```yaml
linters:
  enable:
    - errcheck      # unchecked errors
    - govet         # go vet
    - staticcheck   # the SA/ST/QF analyzer suite
    - ineffassign   # ineffectual assignments
    - unused        # dead code
    - errorlint     # %w wrapping + errors.Is/As misuse
    - bodyclose     # unclosed http.Response.Body
    - contextcheck  # context propagation
    - gosec         # security analyzer (defers to pattern-engineer-security)
```

`go test -race ./...` runs alongside the linters in the pre-push gate; a non-empty `gofmt -l .` also blocks the push.
