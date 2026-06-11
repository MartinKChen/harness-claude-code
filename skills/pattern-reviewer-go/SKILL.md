---
name: pattern-reviewer-go
description: "Go audit: unchecked/`_`-discarded errors (HIGH); `%v` not `%w` losing the chain; string error matching over `errors.Is`/`As`; panic across API boundary (HIGH); leaked/untracked goroutine (HIGH); receiver closing a channel (HIGH); ctx stored in struct or missing first-param; unclosed `resp.Body` (HIGH); slice-aliasing append bug (HIGH); producer-side interfaces; `time.Duration` vs bare int; gofmt/vet/`-race` gate. Cites `file:line`. Activate when the diff includes `.go`, `go.mod`, `go.sum`."
---

# pattern-reviewer-go

## When to activate

- Reviewing a diff that includes `.go` files, `go.mod`, `go.sum`, or `.golangci.yml`.
- A user says "review the Go code / error handling / goroutines / context usage".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-go.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### Unchecked / discarded errors (HIGH)

Detection: grep for `_ =`, `_, _ :=`, and trailing-call statements that return an error but assign nothing. `errcheck`/`staticcheck` catch most; flag any `_`-discard without an adjacent comment justifying it.

```go
// BAD — error silently dropped
data, _ := os.ReadFile(path)
json.Unmarshal(data, &cfg)        // also unchecked

// GOOD
data, err := os.ReadFile(path)
if err != nil {
    return fmt.Errorf("reading %s: %w", path, err)
}
if err := json.Unmarshal(data, &cfg); err != nil {
    return fmt.Errorf("parsing config: %w", err)
}
```

False-positive guard: `defer f.Close()` on a read-only file and `_ = w.Write(...)` in a best-effort log path are acceptable *with* a comment. Don't flag a documented discard.

### Error wrapping with `%w` (MEDIUM)

Detection: search `fmt.Errorf(` calls whose format ends in `%v`/`%s` with an `err` argument — those flatten the chain so `errors.Is`/`As` upstream fail.

```go
// BAD — chain lost, callers can't errors.Is
return fmt.Errorf("loading user: %v", err)

// GOOD
return fmt.Errorf("loading user %d: %w", id, err)
```

`errorlint` flags this. Guard: bare `errors.New("...")` at the origin (no wrapped cause) is correct, not a finding.

### String error matching over `errors.Is`/`As` (MEDIUM)

Detection: grep `err.Error() ==`, `strings.Contains(err.Error()`, and type assertions `err.(*T)` instead of `errors.As`.

```go
// BAD — brittle string match
if err.Error() == "not found" { ... }

// GOOD
if errors.Is(err, ErrNotFound) { ... }
var perr *fs.PathError
if errors.As(err, &perr) { ... }
```

### Panic across an API boundary (HIGH)

Detection: grep `panic(` in non-`main`, non-`init` exported-package code. Acceptable only for unreachable programmer-error invariants (with a comment) or inside a `_test.go` helper.

```go
// BAD — library panics on bad input instead of returning an error
func Parse(s string) Config {
    if s == "" { panic("empty config") }
}

// GOOD
func Parse(s string) (Config, error) {
    if s == "" { return Config{}, errors.New("empty config") }
}
```

Guard: `panic` for a genuinely-unreachable default branch / invariant violation is fine; don't flag those.

### Leaked / untracked goroutines (HIGH)

Detection: grep `go func(` and `go <call>(` inside request handlers or constructors; flag any without a `WaitGroup`, `errgroup`, or a `ctx`-driven exit. A goroutine that blocks on a channel send/receive with no cancellation path is a leak.

```go
// BAD — no exit path, no error surfaced, leaks on handler return
go func() {
    process(req)
}()

// GOOD — tracked + cancellable
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { return process(ctx, req) })
if err := g.Wait(); err != nil { ... }
```

Guard: a goroutine in `main` that runs for the process lifetime and exits on `ctx.Done()` is fine.

### Channel closed by a receiver (HIGH)

Detection: look for `close(ch)` in code that only reads from `ch`. Closing from the receive side causes a send-on-closed-channel panic in the producer.

```go
// BAD — consumer closes
for v := range ch { use(v) }
close(ch)

// GOOD — the sender closes when done producing
go func() {
    defer close(ch)
    for _, v := range items { ch <- v }
}()
```

### Context misuse (MEDIUM)

Detection: grep struct definitions for a `context.Context` field; check that I/O functions take `ctx` as the *first* parameter; flag loops doing long work without a `<-ctx.Done()` check, and outbound calls with no `WithTimeout`.

```go
// BAD — ctx stored in a field, never propagated
type Service struct { ctx context.Context }

// GOOD — ctx threaded as the first arg
func (s *Service) Fetch(ctx context.Context, id int) (*User, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    ...
}
```

Guard: `contextcheck` catches dropped propagation. Don't flag a stored `ctx` in narrow cases the std lib itself blesses (e.g. it's rare — be conservative).

### Unclosed response / resource bodies (HIGH)

Detection: every `http.Client.Do` / `http.Get` whose `resp` is used without a `defer resp.Body.Close()`; also `sql.Rows`, files, and `io.Closer`s acquired without a deferred close. `bodyclose` catches the HTTP case.

```go
// BAD — body leaks the connection
resp, err := client.Do(req)
if err != nil { return err }
body, _ := io.ReadAll(resp.Body)

// GOOD
resp, err := client.Do(req)
if err != nil { return err }
defer resp.Body.Close()
```

### Slice-aliasing / append-sharing (HIGH)

Detection: a sub-slice (`s[a:b]`) handed to another owner that later `append`s to it, or `append` onto a parameter slice whose backing array the caller still holds — silently mutates shared data.

```go
// BAD — append may overwrite the caller's backing array
func addAdmin(perms []string) []string {
    return append(perms, "admin")
}

// GOOD — full-slice expression caps capacity, forcing a copy on append
func addAdmin(perms []string) []string {
    return append(perms[:len(perms):len(perms)], "admin")
}
```

Guard: append to a slice the function fully owns (locally constructed) is fine.

### Interface defined at the producer (MEDIUM)

Detection: an exported interface declared in the same package as its sole implementation, especially one named `XInterface`/`IX` or commented "for mocking", with no second caller.

```go
// BAD — producer-side interface with one impl, no consumer needs it
type UserRepository interface { Get(id int) (*User, error) }
type pgUserRepo struct{}

// GOOD — return the concrete type; let the consumer declare the 1–3 method
// interface it actually needs.
func NewUserRepo(db *sql.DB) *PGUserRepo { ... }
```

Guard: an interface with two or more real implementations, or one defined in the consumer package, is correct — don't flag.

### `time.Duration` over bare ints (MEDIUM)

Detection: grep function params / struct fields named `*Timeout`, `*Interval`, `*Delay`, `*TTL` typed `int`/`int64`, and `time.Sleep(n)` / `time.After(n)` with an untyped literal lacking a unit.

```go
// BAD — unit ambiguous, easy to pass millis where seconds expected
func Retry(attempts, delay int) { time.Sleep(time.Duration(delay) * time.Second) }

// GOOD
func Retry(attempts int, delay time.Duration) { time.Sleep(delay) }
```

### Idiom & naming (LOW)

Detection: `Get`-prefixed getters, package-name stutter (`http.HTTPClient`, `user.UserStruct`), `any`/`interface{}` where a concrete type or generic fits, and constructors that exist only because the zero value was needlessly broken.

```go
// BAD
func (u *User) GetName() string { return u.name }   // Get prefix
type user.UserService struct{}                       // stutter

// GOOD
func (u *User) Name() string { return u.name }
type user.Service struct{}
```

### Test structure (MEDIUM)

Detection: repeated near-identical test functions that should be one table-driven test; helpers that assert without `t.Helper()`; handler tests that fake `http.Request` instead of using `httptest`.

```go
// BAD — copy-pasted cases, helper without t.Helper()
func TestAddOne(t *testing.T) { ... }
func TestAddTwo(t *testing.T) { ... }

// GOOD — table-driven subtests
func TestAdd(t *testing.T) {
    for _, tc := range []struct{ name string; a, b, want int }{
        {"zero", 0, 0, 0}, {"mixed", 1, 2, 3},
    } {
        t.Run(tc.name, func(t *testing.T) {
            t.Parallel()
            if got := Add(tc.a, tc.b); got != tc.want {
                t.Errorf("Add(%d,%d)=%d want %d", tc.a, tc.b, got, tc.want)
            }
        })
    }
}
```

Coverage *substance* (which scenarios must exist) is owned by `pattern-test-coverage`; this rule is about structure only. Guard: `t.Parallel()` is wrong, not missing, when subtests share mutable state — don't push it there.

### Toolchain & module hygiene (HIGH)

Detection: check the diff/repo for these gate violations.

- `go.mod` missing an explicit `go 1.x` (and ideally `toolchain`) directive → HIGH.
- `go.sum` not committed, or modified without a matching `go.mod` change (stale `go mod tidy`) → HIGH.
- Unformatted code (`gofmt -l .` would list a changed file) → MEDIUM (formatter fixes it, but the gate blocks).
- A new dependency added to `go.mod` with no corresponding `go.sum` entry → HIGH.
- Evidence the `-race` flag was stripped from the test command in CI → HIGH.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
