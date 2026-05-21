---
name: pattern-engineer-backend-standard
description: "Language-agnostic backend bullets: REST shape, schema-validated input at the boundary, authorize-before-act + ownership check, structured error envelope, Idempotency-Key on POST, atomic mutations on balance/quota/token, per-route rate limits, CSRF on cookie-auth state changes, generic 5xx + correlation id, structured logs, fast `/healthz` + with-dep `/readyz`, graceful SIGTERM, migrations as compose service, `.env.example` lockstep, locked deps. Activate when implementing backend code."
---

# pattern-engineer-backend-standard

## When to activate

Activate whenever you write or edit backend code: HTTP routes/handlers, service modules, middleware, database queries, background workers, queue consumers, auth flows, webhook receivers, container entrypoints, env-var loading, logging bootstrap.

## Patterns

### HTTP contract

- Resource-oriented paths (`/users/{id}/orders`, not `/getUsersOrders`).
- HTTP verbs map to intent: `GET` read, `POST` create, `PUT` replace, `PATCH` partial update, `DELETE` remove.
- Status codes match contract: 200/201/202/204 success; 400 client error; 401 unauth; 403 forbidden; 404 not found; 409 conflict; 422 unprocessable; 429 rate-limited; 5xx server. Match the `api-contract/<entity>.yaml` doc when it disagrees with intuition.
- Trailing-slash spelling matches the contract — don't rely on framework redirects.
- Define paths once as named constants shared by route + tests.

### Input validation

- Validate every external input with a schema at the boundary (Pydantic / Zod / equivalent).
- Bound string lengths, numeric ranges, enum values. Allowlist formats, not denylist.
- Trust internal callers; never trust the network.
- File uploads: size + MIME + extension whitelist. Magic-byte check for high-trust uploads.
- Validation errors return field-level messages; no internal types, table names, or stack traces.

### Output shape

- Success responses match the api-contract's response schema.
- Error responses use the project's standard envelope (typically `{error: {code, message, request_id}}`) — read the ADR for the project's exact shape.
- Strip sensitive fields (`passwordHash`, `resetToken`, `mfaSecret`, …) at the serializer, not at every call site.
- Generic 5xx message + correlation id. No stack traces in the body.
- 4xx says what the client did wrong without revealing schema / table / column names.

### AuthN + AuthZ

- Authentication answers "who is this?"; authorization answers "are they allowed to do this *to this resource*?"
- Every state-changing handler checks identity AND ownership/role server-side.
- Multi-tenant tables get RLS where the DB supports it.
- Session tokens in `HttpOnly; Secure; SameSite` cookies; never in `localStorage`.
- `Secure` / `SameSite` driven by `SECURE_COOKIES` env var read at the call site (default `true`) — not from a fully-validated Settings object that test fixtures can't satisfy.
- Constant-time auth paths: run password verify against a sentinel hash on the missing-user branch so timing doesn't leak existence.
- Password-reset completion does NOT issue a session and does NOT auto-navigate to authed routes.

### Idempotency + atomicity

- POST that can be retried by the user carries an `Idempotency-Key` header; key lifecycle is stable across user-initiated retries.
- Balance / quota / inventory / token-redemption mutations are atomic — either `UPDATE … WHERE balance >= :a` (check rowcount) or `SELECT … FOR UPDATE` inside a transaction.
- Token redemption (reset, MFA, OTP, magic-link) marks-then-checks atomically; second attempt returns rowcount=0.

### Rate limits + CSRF

- Every public endpoint has a rate limit — per-IP at minimum, per-user on authenticated routes.
- Stricter limits on auth-adjacent routes (login, signup, forgot-password, token-refresh).
- 429 responses include `Retry-After`.
- Cookie-authenticated state-changing requests carry a CSRF token; pair with `SameSite` cookies as defense-in-depth.

### Logging + errors

- One structured logger per service.
- Log identifiers (user_id, request_id), never secrets (passwords, tokens, full PANs, CVVs, session ids, raw user-supplied emails on failure paths).
- Log a sensitive value at exactly one layer — never the same value at service AND router.
- Redaction allow-list key names match the keys the code emits **exactly** (case-sensitive).
- `RequestIdMiddleware` is registered last so it runs first on the rejection path; every 4xx / 5xx body carries a non-null `request_id`.

### Health endpoints

- `/healthz`: 200 on normal boot; no auth; no DB or external-dep call; <100ms.
- `/readyz` (separate path) may check DB and dependencies; used by readiness probes.

### Migrations

- Models are the source of truth; generate migrations from the model, never hand-write DDL first.
- Migrations run in a dedicated `migrate` compose service before the backend starts — not inside the backend image's entrypoint.

### Deployment + ops

- Graceful shutdown on SIGTERM: drain in-flight requests, close DB pools, flush log buffers before exit.
- Read secrets from env vars (or a typed settings object that does). `.env*` in `.gitignore`; only `.env.example` (placeholders) committed.
- Keep `.env.example` in lockstep with the code: every `os.environ` / `process.env` / `getenv` / `Settings(...)` read has a row in `.env.example`.
- Lock dependencies; commit lock files; CI uses reproducible install (`uv sync --locked`, `npm ci`, `poetry install --no-update`).
- Container builds vetted via `docker scout` / Trivy: zero CRITICAL/HIGH CVEs before ship.

### Outbound calls (SSRF)

- Server-side `fetch(userProvidedUrl)` goes through a host allowlist + scheme allowlist (`https:`) + private-range block (resolve hostname; don't trust the literal).
- `redirect: "manual"` (or follow with re-validation) + timeouts on every outbound call.

### Webhooks + OAuth

- Webhook receivers verify HMAC signature **before** parsing the body; constant-time compare; dedupe by event-id or timestamp window.
- OAuth callbacks validate `state`; public clients use PKCE.
