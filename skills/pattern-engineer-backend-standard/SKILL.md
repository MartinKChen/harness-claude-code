---
name: pattern-engineer-backend-standard
description: "Backend implementation bullets — what the contract doesn't say. Follow the contract verbatim (paths, verbs, status codes, body, envelope, idempotency, rate-limit policy). Covers input-validation mechanics, atomic mutations, RequestId middleware position, `/healthz` + `/readyz` shape, log redaction, SSRF safety, webhook HMAC verify, `.env.example` lockstep, locked deps, SIGTERM, migrations as compose service. Activate on backend code."
---

# pattern-engineer-backend-standard

## When to activate

Activate whenever you write or edit backend code: HTTP routes/handlers, service modules, middleware, database queries, background workers, queue consumers, auth flows, webhook receivers, container entrypoints, env-var loading, logging bootstrap.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-backend-standard.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Follow the contract — don't redecide

Before implementing any endpoint, open the api contract at `docs/api-contract/<entity>.yaml`. Take from the contract — never invent — the **path** (including trailing-slash spelling), **HTTP verb**, **request body schema**, **response body schema**, **status codes per outcome**, **error envelope shape + `code` values**, **Idempotency-Key policy**, **rate-limit budget**, and **versioning notes**. If the contract is missing or ambiguous for an endpoint the task touches, halt and surface "no api contract for `<endpoint>`".

Same rule for the data model: `docs/data-model/<entity>.yaml` is the source of truth for table names, column types, constraints, indexes. The migration / ORM model implements the contract verbatim.

## Implementation patterns (not in the contract)

### Input validation mechanics

- Validate every external input with a schema at the boundary (Pydantic / Zod / equivalent) — the **shape** comes from the contract; the **mechanism** is yours.
- Bound string lengths, numeric ranges, enum values exactly as the contract declares.
- File uploads: size + MIME + extension whitelist; magic-byte check for high-trust uploads.
- Validation errors return field-level messages; no internal types, table names, or stack traces.

### Output mechanics

- Serialize to the contract's response schema; strip sensitive fields (`passwordHash`, `resetToken`, `mfaSecret`, …) at the serializer, not at every call site.
- Map every internal exception class to the contracted error envelope at a single layer (e.g., a project-level exception handler), not inline in each route.
- 5xx response body carries the generic message + correlation id only. No stack traces, no internal exception messages, no schema / table / column names — those go to the server log keyed by the same `request_id`.

### AuthN + AuthZ implementation

- Every state-changing handler checks identity AND ownership/role server-side; multi-tenant tables get RLS where the DB supports it.
- Cookie attributes, constant-time auth paths, reset-flow rules, and the rest of the auth surface are owned by `pattern-engineer-security` — it loads on any auth/endpoint work; follow its catalogue rather than this skill restating it.

### Atomic mutations

- Balance / quota / inventory / token-redemption mutations are atomic — either `UPDATE … WHERE balance >= :a` (check rowcount) or `SELECT … FOR UPDATE` inside a transaction.
- Token redemption (reset, MFA, OTP, magic-link) marks-then-checks atomically; second attempt returns rowcount=0.

### Idempotency wiring

- When the contract declares `Idempotency-Key` for an endpoint, implement the store: persist `(key, response)` for the contracted TTL, replay the response on retry, treat missing-key on a required endpoint as 400.

### Rate-limit wiring

- When the contract declares a per-route rate-limit budget, wire the limiter (e.g., `slowapi` / Express middleware / token-bucket lib) at the route boundary. The budget + identity key come from the contract; the implementation choice (`slowapi`, custom Redis token bucket, gateway-level) is yours.
- Emit the contracted rate-limit headers (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`) on both success AND 429 responses.

### CSRF wiring

- Cookie-authenticated state-changing requests carry a CSRF token; pair with `SameSite` cookies as defense-in-depth.

### Logging mechanics

- One structured logger per service. Bridge into OTel logs.
- Log identifiers (user_id, request_id), never secrets.
- Log a sensitive value at exactly one layer — never the same value at service AND router.
- Redaction allow-list key names match the keys the code emits **exactly** (case-sensitive).
- Request-id middleware runs first on the rejection path so every 4xx / 5xx body carries a non-null `request_id` (FastAPI ordering mechanics: `pattern-engineer-fastapi`).

### Health endpoint mechanics

- `/healthz`: 200 on normal boot; no auth; no DB or external-dep call; <100ms.
- `/readyz` (separate path) may check DB and dependencies; used by readiness probes.
- Path names (`/healthz`, `/readyz`) follow the contract or the project's ADR — don't pick a third spelling.

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

### Layering — repository / service / route

- Routes parse input, call a service, format the response. **No DB calls, no business logic inside a route handler.**
- Services own business logic and orchestrate repositories; repositories own the SQL / ORM.
- A handler that opens a DB session and writes queries inline = bypassed layer; extract into a service module before merging.

### Retries on transient failures

- Outbound calls to flaky dependencies (third-party HTTP, queue publish, email send) retry with **exponential backoff + jitter** on connection errors and 5xx — never on 4xx (the client is the problem).
- Cap total retries (≤3) and total elapsed time (≤a few seconds for synchronous request paths; longer for background workers).
- Idempotency: retry only when the operation is idempotent (or carries an `Idempotency-Key` honored by the callee).

### External-integration discipline

For any external service integrated (email/message delivery, payment gateways, object storage, brokers, webhook senders, IdPs). Service-specific quirks belong in the project's `.claude/memory/patterns/` overlay, never inline here.

- **Emitted artifacts conform to the *consuming* contract, not the emitter's intent** — a link/callback URL, webhook payload, signed URL, or queue message matches what the consumer requires; fix and test all emitters of one artifact together (test substance: `pattern-test-coverage` §6).
- **Async delivery through an external sink is an inherent race.** Provide a synchronous, delivery-confirmed path, or document that observers must poll the sink — never tune `sleep` values in production code to win the race.
- **External-client connection strings match the runtime's required scheme/protocol at every entrypoint that builds the client** (a driver-prefix rewrite present in the worker but missing in the web server only fails once a real connection opens).
- **Knobs that gate external calls are env-configurable** — rate limits, retry/backoff, poll/tick intervals, timeouts. Never hard-code.
- **Verify the artifact survives the external service's encoding round-trip** (line-folding, charset, JSON escaping) — assert the consumer receives exactly what was emitted.

### Caching — cache-aside

- Read path: check cache → miss → fetch from source → populate cache with TTL → return. Single helper per cache key family.
- Every write that changes a cached value invalidates the cache for that key in the same transaction (or immediately after commit). Write-through-only is a stale-read trap.
- TTL is the safety net, not the strategy.
- Cache layer is shared (Redis / Memcached / platform cache), never a per-process map.

### Authorization — table-driven RBAC

- Permission checks resolve through one helper (`has_permission(user, action, resource)`), backed by a permission table — not scattered inline `if user.role == "admin"` branches.
- Adding a new action means adding a row to the permission table, not editing every route.
