---
name: pattern-reviewer-api
description: "Framework-agnostic HTTP wiring audit (Express/Fastify/NestJS, Gin, Axum, Spring/Ktor, Flask/Django) — one router per resource at the contracted prefix, path constants shared by route + tests, DI through the framework seam (no handler globals), request/response models separate, ONE error-envelope layer, request-id first on reject, auth as a route guard, status-only no body, env-driven knobs, in-process test client + DI-override factory. Activate on route, handler, middleware, or DI diffs."
---

# pattern-reviewer-api

Framework-agnostic HTTP-service wiring best-practice audit — the cross-framework generalization of `pattern-reviewer-fastapi`. This skill focuses on framework wiring mechanics. Contract-conformance checks (path / verb / status code / response shape / error-envelope shape / idempotency policy / rate-limit policy) and language-agnostic backend mechanics (validation mechanics, envelope content, health/logging wiring) are out of scope — they belong to the api contract, `pattern-reviewer-backend-standard`, and `pattern-reviewer-security` respectively.

## When to activate

- Reviewing a diff that includes HTTP routes, handlers/controllers, dependency injection, middleware, error handlers, lifecycle hooks, or app-factory / `main` wiring in Express / Fastify / NestJS / Hono, Gin / Echo / Chi, Axum / Actix, Spring Boot / Ktor, Vapor, or Flask / Django.
- A user says "review the API / route / middleware / DI wiring".
- Skip when the framework is FastAPI — `pattern-reviewer-fastapi` carries these same rules in FastAPI spelling.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-api.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).
- **Stay in the wiring lane.** Whether a value matches the api contract is out of scope; this audit is about the *shape* of the wiring.

## Patterns to review

### Router mounting (MEDIUM)

- **Where to look:** the mount/registration site (`app.use(...)`, `@Controller(...)`, `r.Group(...)`, `Router::nest(...)`, `@RequestMapping`, Ktor `route(...)`). Grep for multiple unrelated resource paths registered through one router/controller.
- One router/handler module per resource, mounted with an explicit prefix. Multiple resources collapsed into one kitchen-sink router → flag.
- Prefix-explicit-vs-implicit is in scope; whether the prefix string equals the contract is not.
- **False-positive guard:** a deliberate aggregator that only `.use()`s sub-routers (no handlers of its own) is fine.

### Path constants shared by route + tests (MEDIUM)

- **Where to look:** route registration and the test that hits it. Grep for the same literal path string in both a handler/route file and a test file.

```go
// BAD (Gin) — literal repeated in route and test, drift waiting to happen
r.POST("/api/v1/users", createUser)        // handler
req := httptest.NewRequest("POST", "/api/v1/users", body) // test

// GOOD — one named constant imported by both
const UsersPath = "/api/v1/users"
r.POST(UsersPath, createUser)
req := httptest.NewRequest("POST", UsersPath, body)
```

A path used in BOTH the route and a test, defined as a literal in each → flag. Whether the constant's value matches the contract is out of scope.

### DI through the framework seam (HIGH)

- **Where to look:** handler bodies. Grep for module-level/global singletons referenced inside handlers — `db.`, `pool`, `getDb()`, a package-level `var client`, `GlobalSettings`.

```ts
// BAD (Express) — handler reaches for a module global
import { pool } from "../db";            // module singleton
export async function getUser(req, res) {
  const u = await pool.query("...", [req.params.id]);
  res.json(u.rows[0]);
}

// GOOD — dep arrives through a request-scoped local / injected service
export const getUser = (deps: Deps) => async (req, res) => {
  const u = await deps.users.byId(req.params.id);
  res.json(u);
};
```

Handler reaching for a global/singleton DB pool, settings, or current-user instead of the framework's DI seam (constructor injection, extractor, request local, `fx`/wire, Spring bean) → HIGH. Injection chains deeper than 2–3 levels → MEDIUM (the seam belongs in a service). **False-positive guard:** a genuinely process-wide immutable (logger, metrics registry) imported directly is acceptable.

### Boundary validation + request/response separation (MEDIUM)

- **Where to look:** the model/DTO definitions and the handler signatures. Grep for one model type used as both the request body type and the response type.

```rust
// BAD (Axum) — one struct for request and response leaks write fields
#[derive(Deserialize, Serialize)]
struct User { id: Option<i64>, email: String, password: String }

// GOOD — distinct request/response shapes
#[derive(Deserialize)]
struct CreateUser { email: String, password: String }
#[derive(Serialize)]
struct UserView { id: i64, email: String }
```

A single model used as BOTH request body AND response → MEDIUM (write-only fields leak into the response schema; response-only fields become optional on the request side). Wire/DTO model passed deep into the domain layer instead of converted at the seam → MEDIUM. No boundary schema validation at all (hand-rolled `if`-checks where the stack has Zod / binding tags / `serde` / Bean Validation) → MEDIUM.

### ONE error-envelope mapping layer (HIGH)

- **Where to look:** handler bodies vs. the central error handler. Grep for inline status construction (`res.status(4xx|5xx)`, `c.JSON(4xx, ...)`, `c.AbortWithStatus`, `ResponseEntity.status(...)`) on a project-wide error class.

```ts
// BAD (Fastify) — each route hand-builds the envelope for a shared error class
fastify.post("/login", async (req, reply) => {
  try { return await login(req.body); }
  catch (e) { if (e instanceof AuthError) return reply.code(401).send({ error: "bad creds" }); throw e; }
});

// GOOD — one mapping layer; handlers just throw the domain error
fastify.setErrorHandler((err, _req, reply) => {
  if (err instanceof AuthError) return reply.code(401).send(toEnvelope(err));
  reply.code(500).send(toEnvelope(err)); // logged server-side
});
fastify.post("/login", async (req) => login(req.body));
```

Per-route status/envelope construction for a project-wide error class → HIGH (move to the single mapping layer: error middleware / `@ControllerAdvice` / `IntoResponse` / `setErrorHandler`). No generic catch-all for unhandled errors → HIGH. **False-positive guard:** a one-off route-local 4xx for a condition that is genuinely local (not a shared domain error class) is acceptable.

### Request-id middleware ordered first on the reject path (HIGH)

- **Where to look:** the middleware/filter registration order and any rejection paths (rate-limit, auth, validation). Confirm a test pins it.
- The request-id middleware must run first on the rejection path so every 4xx/5xx body carries a non-null request id — including responses short-circuited by guards registered after it. Request-id registered *after* the auth/rate-limit guard (so early rejections get no id) → HIGH. Missing the order-pinning test → MEDIUM.
- **False-positive guard:** account for reverse-order stacks (Express/FastAPI-style where last-added runs first outbound vs. first-registered-runs-first frameworks) before flagging — verify actual execution order, not registration line number.

### Auth as a route guard, not inline (HIGH)

- **Where to look:** handler bodies. Grep for `req.headers.authorization` / `decodeJwt` / `if user.role` / `getRole(` inside handler functions rather than at the route boundary.

```kotlin
// BAD (Ktor) — auth decoded and checked inside the handler
post("/admin/users/{id}") {
  val token = call.request.header("Authorization")
  val user = decodeJwt(token)
  if (user.role != "admin") return@post call.respond(HttpStatusCode.Forbidden)
  deleteUser(call.parameters["id"]!!)
}

// GOOD — guard at the route boundary
authenticate("admin") {
  post("/admin/users/{id}") { deleteUser(call.parameters["id"]!!) }
}
```

Identity/role decode-and-check scattered inside handler bodies → HIGH (move to a guard/middleware/extractor/`SecurityFilterChain` at the boundary). **False-positive guard:** *resource-ownership* checks that need the loaded entity (e.g. "is this row owned by the caller") legitimately live in the handler/service — only route-level authN/role authZ belongs in the guard.

### Status-only responses send no body (LOW)

- **Where to look:** handlers returning a contracted 204/304/205. Grep for a JSON body emitted alongside a no-content status.

```go
// BAD (Echo) — invented body on a 204
return c.JSON(http.StatusNoContent, map[string]bool{"ok": true})

// GOOD — bare status, no body
return c.NoContent(http.StatusNoContent)
```

A fabricated `{"ok": true}` / `{}` body on a status-only response → LOW.

### Lifecycle hooks for startup/shutdown (MEDIUM)

- **Where to look:** bootstrap/`main` and module init. Grep for DB pool open / queue connect / OTel bootstrap done at import time or in a handler instead of a lifecycle hook; and for fire-and-forget of non-loseable work.
- Startup/shutdown done outside the framework's lifecycle hook (`OnModuleInit`/`OnModuleDestroy`, `@PostConstruct`/`@PreDestroy`, Axum graceful-shutdown future, Ktor `ApplicationStopping`, an Express SIGTERM `server.close`) → MEDIUM. Fire-and-forget background work for persistent (non-loseable) work that should use a real queue → MEDIUM.

### Env-driven operational knobs (MEDIUM)

- **Where to look:** rate limiters, timeouts, retry/backoff, worker tick cadences. Grep for hard-coded numeric literals in these spots.
- Hard-coded rate limit / timeout / tick cadence that gates external integrations or scheduling → MEDIUM (read from settings/env). In-memory limiter/scheduler state persisting across runs is a leading flaky-E2E cause. **False-positive guard:** a true constant of the algorithm (not an operational knob) is fine.

### In-process test client + DI-override factory (MEDIUM)

- **Where to look:** test setup. Grep for tests spawning a real server / binding a port, for module-level shared app singletons imported by tests, and for monkeypatching module internals where an injection seam exists.

```ts
// BAD (Jest/supertest) — shared singleton app + monkeypatched internal
import { app } from "../app";                 // module-level singleton, leaks state
jest.spyOn(require("../db"), "getUser").mockResolvedValue(fakeUser);

// GOOD — per-test factory with a DI override, in-process client
const app = createApp({ users: { byId: async () => fakeUser } });
await request(app).get("/api/v1/users/1").expect(200);
```

Tests spawning a real server when an in-process client exists (supertest / `httptest` / tower `oneshot` / `@SpringBootTest(MOCK)` + MockMvc / Ktor `testApplication`) → MEDIUM. Module-level shared `app` singleton imported by tests → MEDIUM (leaks state). Monkeypatching module internals when a DI-override seam exists → MEDIUM.

### Truthful docs (LOW)

- **Where to look:** route metadata. Grep for missing tags/groups and for internal routes exposed in public docs.
- Routes not tagged/grouped so generated docs render coherently → LOW. Internal routes (`/healthz`, debug, admin ops) exposed in public docs instead of hidden (`@ApiExcludeEndpoint` / `hidden = true` / excluded from the schema group) → LOW.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
