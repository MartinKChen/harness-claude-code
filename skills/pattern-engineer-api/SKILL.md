---
name: pattern-engineer-api
description: "Framework-agnostic HTTP wiring (Express/Fastify/NestJS, Gin, Axum, Spring/Ktor, Flask/Django) — wire what the contract decided. One router per resource at the contracted prefix with named path constants; DI through the framework seam, no globals; request/response models separate; ONE error-envelope layer; request-id middleware first on reject; auth as a route guard; status-only no body; env-driven knobs; in-process test client + DI-override factory. Activate on routes, handlers, middleware."
---

# pattern-engineer-api

Framework-agnostic HTTP-service wiring patterns for routes, handlers, dependency injection, middleware, error mapping, and app bootstrap. The api contract (`docs/api-contract/<entity>.yaml`) decides path / verb / status / shape — this skill is HOW you wire them in your framework without contradicting the contract. It is the cross-framework generalization of `pattern-engineer-fastapi`: same wiring rules, stated framework-neutrally with per-ecosystem idiom hints.

## When to activate

Activate when editing HTTP route registrations, handler/controller functions, router/route modules, dependency-injection graphs (constructor injection, extractors, middleware-scoped locals, `fx`/wire, Spring beans), request/response models, middleware (error handlers, request-id, auth guards), app-factory / bootstrap / `main` wiring, lifecycle hooks, or generated API docs — in Express / Fastify / NestJS / Hono (Node), Gin / Echo / Chi (Go), Axum / Actix (Rust), Spring Boot / Ktor (JVM), Vapor (Swift), or Flask / Django (Python). Skip when the framework is FastAPI — `pattern-engineer-fastapi` carries these same rules in FastAPI spelling. Skip for non-HTTP-service code.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-api.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Boundary

- **Contract substance** (path / verb / status / request + response shape / error-envelope `code` values / idempotency + rate-limit policy) is owned by `docs/api-contract/<entity>.yaml`. This skill never redecides it — it wires it.
- **Language-agnostic backend mechanics** (validation mechanics, error-envelope content, idempotency / rate-limit / health-endpoint / logging wiring, atomic mutations) are owned by `pattern-engineer-backend-standard`. Point there; don't restate.
- **Security catalogue** (cookie attributes, constant-time auth, CSRF, SSRF, webhook HMAC) is owned by `pattern-engineer-security`.
- This pair owns the framework **wiring shape**: how the resource is mounted, where deps enter, where validation/error-mapping/auth live, and how the app is built for tests.

## Patterns

### Routes + routers

- One router/handler module per resource (`usersRouter` / `UsersController` / a `users` route group), mounted at the contracted prefix **verbatim, including trailing-slash spelling**.
- The path is a named constant shared by route registration AND tests — never a string literal repeated in both places (`const USERS_PATH = "/api/v1/users"` / `usersPath = "/api/v1/users"`).
- Never collapse unrelated resources into one kitchen-sink router.
- Idiom map for the mount: Express `app.use(prefix, router)` · NestJS `@Controller(prefix)` · Gin `r.Group(prefix)` · Axum `Router::nest(prefix, ...)` · Spring `@RequestMapping(prefix)` · Ktor `route(prefix){…}`.

### Dependency injection

- External deps (DB pool, settings, current-user resolver, clock, rate limiter) enter through the framework's DI seam — handlers never reach for a global / singleton / module-level connection.
- Seam by ecosystem: constructor injection (NestJS / Spring), extractors + `State`/`Extension` (Axum), `c.Get`/context values or a wired struct (Gin/Echo), `fx`/`wire` providers (Go), request-scoped locals set by middleware (Express/Fastify), `@Inject`/Koin (Ktor).
- Keep injection chains shallow (2–3 levels); deeper means the seam belongs in a service module.
- Don't construct the whole settings object just to read one boolean — expose the single knob as a standalone env read so test setup can build the app without a full env.

### Request + response models

- Validate at the boundary with the stack's schema mechanism: Zod (Node), Gin binding tags / `validator`, Axum extractors + `serde`, Bean Validation (`@Valid`), Ktor request validation. The **shape** comes from the contract; this skill is HOW you declare it.
- Convert the validated request to a domain type at the seam — don't pass the wire/DTO model deep into the domain layer.
- Keep request and response models **separate**: never reuse one model for both directions. Request-only fields (raw secrets, write toggles) and response-only fields (server-issued ids, derived values) belong to different types.
- Strip sensitive fields centrally at serialization (one response model / serializer), not at each call site.
- Bound string lengths / numeric ranges / enums per the contract at the schema.

### Error envelope mapping

- Map every project exception class to the contracted error envelope in **ONE** layer — error-handling middleware (Express/Fastify `setErrorHandler`), `@ControllerAdvice` / `@ExceptionHandler` (Spring), an `IntoResponse` impl on your error enum (Axum), a recovery middleware (Gin/Echo).
- Never inline per-route status construction (`res.status(403).json(...)` / `c.JSON(403, ...)`) for a project-wide error class — that scatters the envelope.
- A generic catch-all maps unhandled errors to the contracted 500 envelope + correlation id; the full error is logged server-side, never returned.

### Middleware / handler order

- The request-id middleware is ordered to run **first on the rejection path** so every 4xx / 5xx body — including rejections short-circuited by rate-limit, auth, or validation middleware — carries a non-null request id.
- Register it before (outermost of) the guards that can reject early; in reverse-order stacks (where last-registered runs first outbound) place it accordingly.
- Pin the order with a test that drives a rejected request and asserts the response body/header carries a request id.

### Auth guards

- Auth is a route-boundary guard / middleware (`@UseGuards` / a `RequireAdmin` middleware / an Axum extractor / a Spring `SecurityFilterChain` / a Ktor `authenticate{…}` block), applied at registration — never ad-hoc identity/role checks scattered inside handler bodies.

### Status-only responses

- A contracted status-only response (e.g. 204) sends **no invented body** — return the bare status (`res.status(204).end()` / `c.Status(204)` / `StatusCode::NO_CONTENT` / `ResponseEntity.noContent()`); never fabricate `{"ok": true}`.

### Lifecycle + background work

- Startup / shutdown (DB pool open/close, OTel bootstrap, queue connect/disconnect) goes through the framework's lifecycle hook: `OnModuleInit`/`OnModuleDestroy` (NestJS), `@PostConstruct`/`@PreDestroy` or `ApplicationRunner` (Spring), Axum graceful-shutdown future, Ktor `monitor.subscribe(ApplicationStopping)`, an Express `server.close()` SIGTERM handler.
- Fire-and-forget background work only for work that can be lost to a crash; persistent work uses a real queue.

### Operational knobs (env-driven)

- Rate limits, outbound timeouts, retry/backoff, worker tick cadences are env-driven — read from settings / env, never hard-coded. In-memory limiter/scheduler state that persists across runs is a leading cause of flaky E2E.

### API docs

- Routes are tagged / grouped so generated docs (OpenAPI, Swagger UI, Spring springdoc, NestJS Swagger) render coherent sections.
- Internal routes (`/healthz`, debug, admin-only ops) are hidden from public docs (`@ApiExcludeEndpoint` / `hidden = true` / exclude from the schema group).

### Testing

- Build the app via a per-test factory with a DI-override seam (`createApp({ deps })` / `Test.createTestingModule().overrideProvider(...)` / a `Router` built with fake `State`) — never a shared module-level singleton that leaks state across tests.
- Drive it with an in-process test client over spawning a real server: supertest (Node), `httptest.NewRequest` + the handler (Go), tower `oneshot` (Axum), `@SpringBootTest(webEnvironment = MOCK)` + MockMvc (Spring), Ktor `testApplication`.
- Override deps through the injection seam; never monkeypatch module internals when an injection seam exists.
