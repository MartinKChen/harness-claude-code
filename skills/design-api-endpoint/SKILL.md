---
name: design-api-endpoint
description: "Activate when designing, implementing, reviewing, or refactoring HTTP API endpoints — REST/RESTful, web APIs, JSON APIs, controllers, routes, handlers. Triggers on verbs like design, add, create, scaffold, implement, expose, refactor, review when paired with nouns like endpoint, route, API, resource, controller, handler. Triggers on phrases like 'add an endpoint for X', 'design a REST API for Y', 'how should I structure this route', 'what URL/verb should this use', 'review this controller'. Triggers on file types like routes.{ts,js,py,rb,go}, *_controller.*, handlers/*, api/* and on framework signals (Express, Fastify, NestJS, FastAPI, Flask, Django REST, Rails, Gin, Echo). Encodes resource-oriented REST conventions: URL/path naming, HTTP verb selection, request/response shape, sparse fieldsets, error format (with no internal leakage on 5xx), offset pagination, filtering with comparison operators (gte/lte/in/like), sorting, versioning, idempotency, and rate limiting."
---

# design-api-endpoint

Frame every new or changed HTTP endpoint as a resource-oriented REST operation before writing code. This skill captures the conventions to follow so endpoints across the codebase stay consistent — predictable URLs, correct verbs, uniform response/error shapes, and explicit semantics for pagination, versioning, and idempotency.

## When to activate

Activate this skill whenever the user:

- asks to design, add, create, scaffold, implement, expose, or refactor an HTTP endpoint, route, controller, or handler
- asks "what URL / verb / status code should this be?", "how should I structure this route?", or similar framing questions
- asks for a review of a controller, route file, or API design doc
- is editing files like `routes.*`, `*_controller.*`, `handlers/*`, `api/*`, or an OpenAPI / API spec
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
- **Path params are stable IDs** (`{order_id}`, not `{index}`). Snake_case inside `{…}` is fine; the URL itself stays kebab-case.
- **Verb selection:**
  - `GET` — safe + idempotent, never has a body, never mutates.
  - `POST` — create on a collection, or non-idempotent action. Returns `201` with `Location` header on create.
  - `PUT` — full replacement; idempotent. Use sparingly — `PATCH` is usually right.
  - `PATCH` — partial update; should be idempotent when possible.
  - `DELETE` — idempotent; `204` on success, `404` if already gone (not an error worth surfacing twice).
- **Nesting max one level deep.** `/orders/{id}/items` is fine; `/users/{id}/orders/{id}/items/{id}` is not — flatten by linking via query (`/items?order_id=…`) or top-level resources.

### Request & response shape

- **JSON only.** `Content-Type: application/json; charset=utf-8` on both sides.
- **Field naming: snake_case** in JSON bodies and query params. Pick one convention and never mix.
- **Timestamps are RFC 3339 / ISO 8601 UTC strings** (`"2026-05-04T12:34:56Z"`), never Unix epochs in public APIs.
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
- HTTP status codes follow semantics: `400` validation, `401` unauthenticated, `403` authenticated-but-forbidden, `404` not found, `409` conflict / state mismatch, `422` semantic validation, `429` rate limit, `5xx` server fault. Don't return `200` with `{"error": ...}` — the status code is part of the contract.

#### Never leak internals on 5xx

A `5xx` response must be **opaque to the client**. Detailed diagnostics stay on the server.

- Catch unhandled exceptions at the framework boundary and return a generic body:

  ```json
  { "error": { "code": "internal_error", "message": "An internal error occurred.", "request_id": "req_a1b2c3" } }
  ```

- **Never** include stack traces, SQL fragments, file paths, library names, env values, or upstream error text in the response.
- **Always** log the full exception (stack trace, request context, user/tenant ID) server-side, keyed by the same `request_id` returned to the client. Support uses `request_id` to correlate.
- Disable framework debug pages (`DEBUG=False`, no `whoops`, no Werkzeug debugger) in any environment a real client can reach.
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
- **Defaults are explicit**: document the default `per_page`, default sort, and default filter behavior in the OpenAPI spec.

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
- Rate-limit decisions are logged with the limit key and endpoint so abuse patterns are observable.

### Versioning

- **URL-prefix versioning**: `/v1/...`, `/v2/...`. Bump the major version only on breaking changes.
- **Additive changes (new optional fields, new endpoints, new enum values that clients can ignore) do not bump the version.** Document them in the changelog.
- **Deprecate, don't delete**: when retiring a v1 endpoint, return a `Deprecation` response header and announce a sunset date before removing it.

### Idempotency & safety

- `GET`, `PUT`, `DELETE` are idempotent by HTTP contract — preserve that.
- `POST` (create) accepts an **`Idempotency-Key` header**. Server stores `(key, response)` for ≥24h and replays the same response on retry. Required for any endpoint that takes payment, sends a message, or otherwise has visible side effects.
- **Concurrency control on PATCH/PUT**: support `If-Match: <etag>` when stale-write conflicts matter; respond `412 Precondition Failed` on mismatch.

## Workflow

When designing a new endpoint, work through these in order — most design mistakes come from skipping step 1.

1. **Name the resource.** What noun does this operate on? If you're reaching for a verb (`/sendEmail`, `/processOrder`), stop — find the underlying resource (`/messages`, `/orders/{id}:process`) and model the action as creating or transitioning it.
2. **Pick the verb from CRUD.** Map the operation to one of `GET / POST / PATCH / PUT / DELETE`. Only fall back to `POST /resource/{id}:action` when no state-change framing fits.
3. **Decide the URL.** Plural, kebab-case, ≤1 level of nesting. Stable ID in the path.
4. **Define the request body / query params.** snake_case fields. For lists: `page` / `per_page`, `sort`, simple filters, comparison filters (`field[gte]=…`), `fields` for sparse fieldsets.
5. **Define the response body.** Single object for item responses; `{data, pagination}` envelope (with `page`, `per_page`, `total`, `total_pages`) for lists. Include the resource ID and timestamps. Document the default field set returned when `fields` is omitted.
6. **Enumerate the error cases** with status code + stable `error.code`. At minimum: validation, not-found, auth, conflict, rate-limited. Confirm the 5xx path returns a generic body + `request_id` and never leaks stack traces or upstream errors.
7. **Decide idempotency.** If the endpoint has side effects on `POST`, accept `Idempotency-Key`. If `PATCH` has stale-write risk, accept `If-Match`.
8. **Set the rate-limit budget.** Pick the limit key (API key → user → IP), the budget (read vs write vs expensive), and confirm `RateLimit-*` headers + `429` `Retry-After` are wired up.
9. **Pin the version prefix.** New endpoint → current major version. Breaking change to existing endpoint → new major version + deprecation plan for the old.
10. **Write it down before coding.** A 5-line spec (verb, path, request, response, errors) catches more design problems than the implementation will.
