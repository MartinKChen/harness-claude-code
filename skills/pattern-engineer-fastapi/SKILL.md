---
name: pattern-engineer-fastapi
description: "FastAPI bullets — wire what the contract already decided. `APIRouter` with explicit prefix; `Depends()` injection; Pydantic at the boundary only; app-level exception handlers mapping to the contracted envelope; `RequestIdMiddleware` registered last; named path constants shared by route + tests; `Depends`-based auth guards; async-by-default; lifespan for startup/shutdown; `dependency_overrides` + per-test factory in tests. Activate on FastAPI routes, deps, middleware, handlers, wiring."
---

# pattern-engineer-fastapi

FastAPI implementation patterns for routes, dependencies, middleware, exception handlers, and app wiring. The api contract (`docs/api-contract/<entity>.yaml`) decides path / verb / status / shape — this skill is HOW you wire them in FastAPI without contradicting the contract.

## When to activate

Activate when editing FastAPI route handlers (`@router.get` / `@router.post` / …), `APIRouter` mounts, `Depends()` graphs, Pydantic request/response models, middleware (`app.add_middleware(...)`), exception handlers (`@app.exception_handler(...)`), `create_app()` / `main.py` wiring, OpenAPI customization, or `Depends`-based dependency injection. Skip for non-FastAPI Python code.

## Patterns

### Routes + routers

- Mount each router with the contracted prefix: `app.include_router(users_router, prefix="/api/v1/users", tags=["users"])`. Prefix matches the api contract verbatim.
- Path inside the router is sourced from a module-level constant when shared with tests: `USERS_PATH = "/api/v1/users"`; both `@router.post(USERS_PATH)` and the test import it. Constant value = contract path, **including trailing-slash spelling**.
- One router per resource; never collapse unrelated resources into a "kitchen-sink" router.
- Async by default; switch to sync only when a downstream dep is sync-only.

### Dependency injection

- Every external dep enters via `Depends()` — DB session, settings, current-user resolver, rate limiter, idempotency-key extractor.
- Auth guards are `Depends`-based, never inline: `@router.post(..., dependencies=[Depends(require_admin)])` or `def handler(user: User = Depends(get_current_user))`.
- `Depends` chains stay shallow (2–3 levels); deeper means the seam belongs in a service module.
- Don't reach for `Settings()` just to read one boolean — break the boolean out into a standalone `os.getenv()` helper so test fixtures can build the app without populating the full env.

### Request + response schemas

- Pydantic models at the boundary only — request body, response model, query params with constraints. The **schema shape** comes from the api contract; this skill is HOW you declare it in Pydantic.
- Don't pass Pydantic models deep into the domain layer; convert to dataclasses / domain types at the seam.
- `response_model=` on every route so OpenAPI matches what the contract declared and sensitive fields are stripped consistently.
- Use `Field(max_length=…, ge=…, le=…)` on string and numeric fields to bound input ranges per the contract.
- Status-code-only responses (e.g., a contract-declared 204) use `Response(status_code=204)` — the FastAPI idiom for "no body"; never invent `{"ok": True}` when the contract says no body.
- Keep request and response Pydantic models **separate**: never reuse one model for both. Request-only fields (write-side knobs, raw secrets) and response-only fields (computed derived values, db-issued ids) belong to different models — sharing one leaks write-only fields into the OpenAPI response or makes the response model accept fields the client can't send.

### Exception handlers

- Register app-level handlers for project exceptions: `@app.exception_handler(LoginError)`.
- Each handler maps to the contracted error envelope at one place — never inline `HTTPException(status_code=..., detail=...)` for a project-wide error class.
- Generic 500 handler returns the envelope + correlation id; logs the full exception server-side.

### Middleware order

- `app.add_middleware(...)` runs in reverse order on the response. Last-added middleware runs first on the way out.
- Therefore: `RequestIdMiddleware` is the **last** `add_middleware` call so it runs first on rejection paths (rate-limit 429, auth 401, etc.) — every body must carry a non-null `request_id`.
- Pin middleware order with a test that walks `app.user_middleware` and asserts the request-id middleware is at the top.

### Background tasks + lifespan

- Use FastAPI's `lifespan` context manager for startup / shutdown hooks (OTel bootstrap, DB pool open/close, queue connect/disconnect). Not the deprecated `@app.on_event`.
- `BackgroundTasks` parameter only for fire-and-forget work that can lose to a crash; persistent work uses a real queue.
- Lifespan is async; don't put blocking I/O there without a thread pool wrapper.

### OpenAPI + docs

- Tag every route (`tags=["users"]`) so the auto-generated docs group correctly.
- `summary=` and `description=` on routes that aren't self-evident; the auto-generated names are usually fine.
- Hide internal routes from the docs: `include_in_schema=False` on `/healthz`, debug endpoints.

### Testing FastAPI

- Test via `TestClient(app)` (synchronous) for unit/integration; `httpx.AsyncClient(app=app, base_url=...)` for async-needs.
- Override `Depends` via `app.dependency_overrides[real_dep] = fake_dep` — never monkeypatch the module.
- Build the app per-test via a factory (`create_app(settings=fake_settings)`); never share a singleton across tests.
