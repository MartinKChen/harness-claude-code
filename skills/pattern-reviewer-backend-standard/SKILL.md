---
name: pattern-reviewer-backend-standard
description: "Language-agnostic backend best-practice audit — input-validation mechanics, unbounded queries (`SELECT *` / no `LIMIT`), N+1, missing outbound timeouts, error-message leakage on 5xx, atomic-mutation discipline, `/healthz` no-DB shape, `RequestIdMiddleware` registration order, log redaction key match, sensitive-value single-layer logging, `.env.example` ↔ code lockstep, locked lock files, CORS lock-down. Each finding cites `file:line` with BAD/GOOD snippets."
---

# pattern-reviewer-backend-standard

Backend implementation best-practice audit. This skill focuses on implementation patterns that aren't in the api / data-model contract — contract-conformance checks (paths, verbs, status codes, response/error shape, idempotency, rate-limit policy) are out of scope here.

## When to activate

- The dispatched caller is reviewing a `type:backend` task's production-code diff.
- A user says "review the queries / auth flow / error handling / log redaction / health endpoint".

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Skip stylistic preferences unless they violate a documented convention. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).
- **Match project conventions.** Read `CLAUDE.md` and every ADR in `docs/ADRs/`.

## Patterns to review

### Input validation at the boundary (HIGH)

- Every external input (HTTP body, query param, webhook payload, file upload) goes through a schema. Flag when the **mechanism is missing** — schema-shape disagreement with the api contract is out of scope here.
- Bounded string lengths, numeric ranges, enum values applied via the schema library (Pydantic `Field`, Zod `.min` / `.max` / `.enum`).
- File uploads enforce size + MIME + extension whitelist; magic-byte check for high-trust uploads.
- Validation errors return field-level messages; no internal types / table names / stack traces in the body.

### Unvalidated input (HIGH)

```ts
// BAD — request body used directly without validation
app.post("/users", (req, res) => {
  db.users.create(req.body);
  res.json({ ok: true });
});

// GOOD — Zod schema at the boundary
const CreateUser = z.object({ email: z.string().email(), name: z.string().min(1).max(120) });
app.post("/users", (req, res) => {
  const body = CreateUser.parse(req.body);
  db.users.create(body);
  res.json({ ok: true });
});
```

### Unbounded queries (HIGH)

```sql
-- BAD — no LIMIT on a user-facing list endpoint
SELECT * FROM events WHERE user_id = $1;

-- GOOD — bounded + paginated
SELECT * FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50 OFFSET $2;
```

- `SELECT *` on user-facing reads → flag (project the specific columns).
- `LIMIT` missing → flag.

### N+1 queries (HIGH)

```ts
// BAD — N+1: one query per user
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  user.posts = await db.query('SELECT * FROM posts WHERE user_id = $1', [user.id]);
}

// GOOD — single query with JOIN/aggregation
const usersWithPosts = await db.query(`
  SELECT u.*, json_agg(p.*) as posts
  FROM users u
  LEFT JOIN posts p ON p.user_id = u.id
  GROUP BY u.id
`);
```

### Outbound timeouts (HIGH)

- Every outbound HTTP call has a timeout (`AbortSignal.timeout(...)`, `httpx.Timeout(...)`, `axios timeout: ...`).
- No timeout → flag.

### Error-message leakage on 5xx (HIGH)

- 5xx response body is generic + correlation id only. Stack traces, internal exception messages, schema / table / column names → flag.
- 4xx says what the client did wrong without revealing schema / "user exists" / etc.

```ts
// BAD — stack trace + internal message to the client
catch (error) {
  return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
}

// GOOD — log server-side, generic to client
catch (error) {
  logger.error("internal error", { error, request_id });
  return NextResponse.json({ error: "An error occurred. Please try again.", request_id }, { status: 500 });
}
```

(This rule is the leakage check only — not an envelope-shape check.)

### Atomic mutations (HIGH)

```python
# BAD — race: two concurrent calls both pass the check, then both decrement
def withdraw(user_id: int, amount: int) -> None:
    bal = db.execute("SELECT balance FROM accounts WHERE id = :id", {"id": user_id}).scalar()
    if bal < amount: raise InsufficientFunds()
    db.execute("UPDATE accounts SET balance = balance - :a WHERE id = :id", {"a": amount, "id": user_id})

# GOOD — atomic update conditional on sufficient balance
def withdraw(user_id: int, amount: int) -> None:
    with db.begin():
        result = db.execute(
            "UPDATE accounts SET balance = balance - :a "
            "WHERE id = :id AND balance >= :a",
            {"a": amount, "id": user_id},
        )
        if result.rowcount == 0:
            raise InsufficientFunds()
```

### `/healthz` shape (HIGH)

- `/healthz`: 200 on normal boot, no auth, no DB / external-dep call, <100ms.
- Touching DB inside `/healthz` → flag; move to `/readyz`.
- Both paths exist and are reachable from the platform's probe IP.

### `RequestIdMiddleware` registration order (MEDIUM)

- Middleware that runs first on the rejection path (rate-limit 429, auth 401) must carry `request_id`.
- In FastAPI, that means `RequestIdMiddleware` is the **last** `app.add_middleware(...)` call (reverse-registration order on response).
- Pin with a test that walks `app.user_middleware` and asserts the request-id middleware is at the top.

### Log redaction (HIGH)

- No passwords / tokens / full PANs / CVVs / full SSNs / session IDs / raw user-supplied emails on failure paths.
- A sensitive value is logged at exactly one layer — never service AND router.
- Redaction allow-list key names match the keys the code emits **exactly** (case-sensitive).

### `.env.example` ↔ code lockstep (MEDIUM)

- Every env var the app reads (`os.environ`, `process.env`, `getenv`, `Settings(... env=...)`, container `ARG` / `ENV`, compose `environment:` / `env_file:`) has a placeholder row in `.env.example`.
- Renamed vars: both the new name and the old removed.
- Deleted vars: row removed.
- New PII-related vars: placeholder or `changeme`, never a real secret.

### Locked dependencies (HIGH)

- `package-lock.json` / `uv.lock` / `poetry.lock` committed.
- CI uses reproducible install (`npm ci`, `uv sync --locked`, `poetry install --no-update`), not `npm install` / `pip install`.

### CORS (HIGH)

- `origin` is an explicit env-driven list. Never `*` in production.
- `*` + `credentials: true` → CRITICAL.
- `methods` + `allowedHeaders` are explicit, not `*`.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
