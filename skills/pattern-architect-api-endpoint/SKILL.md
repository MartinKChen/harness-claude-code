---
name: pattern-architect-api-endpoint
description: "Resource-oriented REST design — the single authority for API endpoint shape decisions (paths, verbs, request / response body, status codes, error envelope, pagination, sorting, filtering, versioning, idempotency policy, rate-limit policy, trailing-slash spelling). Activate when designing, adding, or refactoring an HTTP endpoint, controller, or handler. Every decision lands in the api contract at `docs/api-contract/<entity>.yaml` and downstream engineer / reviewer skills follow the contract verbatim — they do NOT redecide what this skill owns."
---

# pattern-architect-api-endpoint

The authority for HTTP endpoint shape. Every new or changed endpoint flows through this skill first; the decisions made here are recorded in the api contract and downstream engineer / reviewer skills follow the contract verbatim. Engineer skills (`pattern-engineer-backend-standard`, `pattern-engineer-fastapi`) implement; reviewer skills (`pattern-reviewer-contract`) verify conformance to the contract. None of those skills re-decide what lives here.

## When to activate

Activate this skill whenever the user:

- asks to design, add, scaffold, expose, or refactor an HTTP endpoint, route, controller, or handler
- asks "what URL / verb / status code should this be?", "how should I structure this route?", or similar framing questions
- asks for a review of a controller, route file, or API design doc
- is wiring a new endpoint in Express, Fastify, NestJS, FastAPI, Flask, Django REST, Rails, Gin, Echo, or similar HTTP frameworks

Do NOT activate for: internal function/method design that is not exposed over HTTP, GraphQL/gRPC schema work (those have their own conventions), pure client-side fetch refactors that don't change the contract, or generic "fix this bug" requests where the endpoint shape is incidental.

## Pattern

The canonical shape is resource-oriented REST. Frame the endpoint as **`<verb> <resource path>`**, then fill in request/response, errors, list-query params, version, and idempotency.

```http
# Collection
GET    /v1/orders                 → 200 list (paginated)
POST   /v1/orders                 → 201 created (Idempotency-Key supported)

# Item
GET    /v1/orders/{order_id}      → 200 | 404
PATCH  /v1/orders/{order_id}      → 200 | 404 | 409
DELETE /v1/orders/{order_id}      → 204 | 404

# Sub-resource (one level of nesting max)
GET    /v1/orders/{order_id}/items
POST   /v1/orders/{order_id}/items

# Action that doesn't fit CRUD — last resort
POST   /v1/orders/{order_id}:cancel
```

### URL & verb rules

- **Resources are plural nouns, kebab-case**: `/order-items`, not `/orderItem` or `/order_item` or `/getOrders`.
- **No verbs in paths.** The HTTP method is the verb. If an action genuinely doesn't fit CRUD, use a `:action` suffix (`/orders/{id}:cancel`) — and only after trying to model it as a state change via PATCH first.
- **Verb selection:**
  - `POST` — create on a collection, or non-idempotent action. Returns `201` with `Location` header on create.
  - `PUT` — full replacement. Use sparingly — `PATCH` is usually right.
  - `PATCH` — partial update; should be idempotent when possible.
  - `DELETE` — `204` on success, `404` if already gone (not an error worth surfacing twice).
- **Nesting max one level deep.** `/orders/{id}/items` is fine; `/users/{id}/orders/{id}/items/{id}` is not — flatten by linking via query (`/items?order_id=…`) or top-level resources.

### Request & response shape

- **Field naming: snake_case** in JSON bodies and query params. Pick one convention and never mix.
- **IDs are opaque strings**, not integers, even if the DB uses integers. Future-proofs against migration.
- **Single-item response is the bare object** — no `{"data": {...}}` envelope for single resources.
- **List response uses a uniform envelope** with pagination metadata:

```json
{
  "data": [ {...}, {...} ],
  "pagination": {
    "page": 2,
    "per_page": 50,
    "total": 1234,
    "total_pages": 25
  }
}
```

### Sparse fieldsets

Let clients ask for only the fields they need via a `fields` query param — saves bandwidth and lets one endpoint serve list-card and detail views.

```
GET /v1/orders?fields=id,status,total_amount
GET /v1/orders/{id}?fields=id,customer,items.sku,items.quantity
```

- Comma-separated field names; dot-notation for nested fields.
- Server validates against an allow-list — unknown fields → `400` with `code: "unknown_field"`.
- `id` is always returned even if omitted. Pagination metadata is unaffected.
- When `fields` is absent, return the documented default field set (not necessarily everything — e.g., heavy nested objects can require explicit opt-in).

### Error format

Every non-2xx response uses a single canonical shape:

```json
{
  "error": {
    "code": "order_not_found",
    "message": "No order with id 'ord_abc123'",
    "details": { "order_id": "ord_abc123" }
  }
}
```

- `code` is a stable, snake_case, machine-readable string. Clients branch on this, never on `message`.
- `message` is human-readable; can change without a breaking-change bump.
- HTTP status codes carry meaning — the status code is part of the contract.

#### Never leak internals on 5xx

A `5xx` response must be **opaque to the client**. Detailed diagnostics stay on the server.

- Catch unhandled exceptions at the framework boundary and return a generic body:

  ```json
  { "error": { "code": "internal_error", "message": "An internal error occurred.", "request_id": "req_a1b2c3" } }
  ```

- **Never** include stack traces, SQL fragments, file paths, library names, env values, or upstream error text in the response.
- **Always** log the full exception (stack trace, request context, user/tenant ID) server-side, keyed by the same `request_id` returned to the client. Support uses `request_id` to correlate.
- Validation/expected errors are `4xx` with specific `code` values. Reserve `5xx` for genuinely unexpected server faults.

### Pagination, filtering, sorting

- **Pagination is offset/page-based by default.** Query params: `?page=2&per_page=50`. Cap `per_page` server-side (e.g., 100). Return `total` and `total_pages` so clients can render page controls.
  - Use cursor-based pagination only when offset is known to break: very large datasets, append-heavy feeds, or strict ordering under concurrent writes. Document the choice on those endpoints explicitly.
- **Filtering — simple equality** uses flat query params matching response field names: `?status=open&customer_id=cus_123`. Multiple values via repeated keys (`?status=open&status=pending`) or comma-separated — pick one and document it.
- **Filtering — comparison operators** use a `field[op]=value` suffix syntax for ranges and inequalities:

  ```
  ?created_at[gte]=2026-01-01&created_at[lt]=2026-02-01
  ?total_amount[gt]=100&total_amount[lte]=500
  ?status[in]=open,pending
  ?name[like]=acme
  ```

  Supported ops: `eq` (default, no suffix), `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `like`. Server validates allow-listed (field, op) pairs — reject unknown combinations with `400` `code: "unsupported_filter"`.
- **Sorting**: `?sort=created_at` ascending, `?sort=-created_at` descending. Multiple keys via comma: `?sort=-created_at,id`. Allow-list sortable fields server-side.

### Rate limiting

Every public endpoint is rate-limited. Defaults live at the gateway/middleware layer; expensive endpoints can declare tighter limits.

- **Identity for the limit key**, in priority order: API key → authenticated user/tenant ID → IP address. Anonymous endpoints fall back to IP but should be rare.
- **Default budgets** (tune per endpoint): read endpoints 600 req/min per user, write endpoints 60 req/min per user, auth/login 10 req/min per IP. Bulk/expensive endpoints (exports, search) get their own bucket.
- **Always emit these response headers**, on success and on `429`:

  ```
  RateLimit-Limit: 600
  RateLimit-Remaining: 412
  RateLimit-Reset: 37
  ```

- **On exhaustion → `429 Too Many Requests`** with a `Retry-After: <seconds>` header and the standard error body (`code: "rate_limited"`).
- Token-bucket or sliding-window — not fixed-window — so a burst at the boundary doesn't double the budget.

### Versioning

- **URL-prefix versioning**: `/v1/...`, `/v2/...`. Bump the major version only on breaking changes.
- **Additive changes (new optional fields, new endpoints, new enum values that clients can ignore) do not bump the version.** Document them in the changelog.
- **Deprecate, don't delete**: when retiring a v1 endpoint, return a `Deprecation` response header and announce a sunset date before removing it.

### Idempotency & safety

- `POST` (create) accepts an **`Idempotency-Key` header**. Server stores `(key, response)` for ≥24h and replays the same response on retry. Required for any endpoint that takes payment, sends a message, or otherwise has visible side effects.
- **Concurrency control on PATCH/PUT**: support `If-Match: <etag>` when stale-write conflicts matter; respond `412 Precondition Failed` on mismatch.

### Trailing-slash spelling

- Pick one spelling per path and pin it in the contract. `/me` and `/me/` are different URLs; framework default redirect-to-trailing-slash returns a 307 that drops `Set-Cookie` on cross-site responses.
- Default to no trailing slash on resource and item paths (`/users`, `/users/{id}`); document the exception when a path genuinely needs one.

## Recording the decision in the api contract

Every decision this skill produces lands in **`docs/api-contract/<entity>.yaml`** — one file per API resource. The contract is the single source of truth that engineers implement against and reviewers verify; do NOT decide endpoint shape in code, in commit messages, or in PR descriptions.

What the contract file declares, per endpoint:

- **Path** (with trailing-slash spelling pinned) + **HTTP verb**.
- **Request body schema** (field names, types, constraints, required vs optional).
- **Query / path params** with constraints + allow-listed filter operators and sortable fields.
- **Response body schema** (default field set; sparse-fieldset rules; pagination shape on list endpoints).
- **Status codes** for each outcome (success, validation failure, not found, conflict, unprocessable, rate-limited, server error).
- **Error envelope shape** + the `code` values this endpoint can emit.
- **Idempotency-Key** policy (required / supported / not applicable).
- **Rate-limit budget** + the identity key (API key / user / IP).
- **Concurrency / ETag** policy when stale writes matter.
- **Versioning + deprecation** notes when relevant.

Cross-references:

- Data model decisions (table names, column types, constraints, indexes) live in the **sibling** `docs/data-model/<entity>.yaml` written by `pattern-architect-data-model`.
- Project-wide axes that span every endpoint (error-envelope spelling, rate-limit defaults, idempotency-key TTL) live in the relevant **ADR** under `docs/ADRs/`; this contract inherits them rather than redefining.

If the contract is missing for an endpoint the engineer is about to touch, this skill — not the engineer — owns adding it. The engineer halts and surfaces "no api contract for `<endpoint>`" rather than guessing.
