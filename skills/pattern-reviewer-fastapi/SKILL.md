---
name: pattern-reviewer-fastapi
description: "FastAPI audit: `APIRouter` prefix discipline, `Depends()` injection (no inline auth), Pydantic at boundary only (not deep in domain), app-level exception handlers + project error envelope, middleware registration order (`RequestIDMiddleware` last so it runs first), trailing-slash conformance, named path constants shared by route + tests, `Response(status_code=204)` on accepted-no-body, `Settings()` instantiation in `create_app()` (footgun for tests), `dependency_overrides` in tests not monkeypatch."
---

# pattern-reviewer-fastapi

## When to activate

- Reviewing a diff that includes FastAPI routes, dependencies, middleware, exception handlers, or `create_app()` / `main.py`.
- A user says "review the FastAPI wiring / dependencies / middleware order".

## Iron rules

## Patterns to review

### Router mounting (MEDIUM)

- Each `APIRouter` mounts with an explicit prefix: `app.include_router(users_router, prefix="/api/v1/users", tags=["users"])`.
- Routes from multiple resources collapsed into a single "kitchen-sink" router → flag.
- Missing `tags=` → LOW (OpenAPI groups won't render right).

### `Depends()` discipline (HIGH)

- Every external dep enters via `Depends()` — DB session, settings, current-user resolver, rate limiter, idempotency-key extractor.
- Auth guards inline in the handler body → flag; move to `Depends(require_admin)` or `Depends(get_current_user)`.
- `Depends` chains deeper than 2–3 levels → MEDIUM (the seam belongs in a service module).

```python
# BAD — inline auth
@router.post("/admin/users/{user_id}")
def delete_user(user_id: int, request: Request, db: Session = Depends(get_db)):
    token = request.headers.get("Authorization")
    user = decode_jwt(token)
    if user.role != "admin": raise HTTPException(403)
    db.execute("DELETE FROM users WHERE id = :id", {"id": user_id})

# GOOD — Depends-based guard
@router.post("/admin/users/{user_id}", dependencies=[Depends(require_admin)])
def delete_user(user_id: int, db: Session = Depends(get_db)):
    db.execute("DELETE FROM users WHERE id = :id", {"id": user_id})
```

### `Settings()` footgun in `create_app()` (HIGH)

```python
# BAD — crashes any test fixture that builds the app without a full env
def create_app() -> FastAPI:
    settings = Settings()  # ValidationError if DATABASE_URL / APP_ORIGIN missing
    app = FastAPI()
    app.add_middleware(SessionMiddleware, https_only=settings.secure_cookies)
    return app

# GOOD — cookie knob readable independently of Settings
def _secure_cookies() -> bool:
    return os.getenv("SECURE_COOKIES", "true").lower() != "false"

def create_app(*, settings: Settings | None = None) -> FastAPI:
    app = FastAPI()
    app.add_middleware(SessionMiddleware, https_only=_secure_cookies())
    return app
```

- `Settings()` instantiated unconditionally in `create_app()` purely to read one boolean → flag.

### Pydantic at boundary only (MEDIUM)

- Pydantic models on request bodies, response models, query params — yes.
- Pydantic models passed deep into the domain layer / DB / business logic → flag; convert to dataclass at the seam.

### Exception handlers + error envelope (HIGH)

- App-level handlers register for project exceptions: `@app.exception_handler(LoginError)`.
- Each handler maps to the project's error envelope shape (from the ADR).
- Inline `HTTPException(status_code=..., detail=...)` for a project-wide error class → flag (move to a handler).
- Generic 500 handler returns the standard envelope + correlation id; logs the full exception server-side.

### Middleware registration order (HIGH)

- `app.add_middleware(...)` runs in reverse order on the response.
- `RequestIdMiddleware` is the **last** `add_middleware` call so it runs first on rejection paths.
- Every 4xx / 5xx body must carry a non-null `request_id` — pin with a test that walks `app.user_middleware` and asserts the request-id middleware is at the top.

### Trailing-slash conformance (HIGH)

- `/me` and `/me/` are different URLs; framework default redirect-to-trailing-slash returns 307 that breaks `Set-Cookie` on cross-site responses.
- Path must match the contract's spelling exactly.
- Add a test that asserts the contracted URL returns 200 (not 307).

### Path constants (MEDIUM)

- Paths used in BOTH the route decorator AND tests must be defined once as a module-level constant.
- `@router.post("/api/v1/users")` + `client.post("/api/v1/users")` in a test → flag; both should import `USERS_PATH`.

### `Response(status_code=204)` on accepted-no-body (LOW)

- Endpoints that accept input but return no body return `Response(status_code=204)`, not `{"ok": True}`.

### Lifespan + background tasks (MEDIUM)

- Startup / shutdown hooks in `lifespan` (not deprecated `@app.on_event`).
- `BackgroundTasks` parameter only for fire-and-forget work that can lose to a crash; persistent work uses a real queue.

### `dependency_overrides` in tests (MEDIUM)

- Tests override deps via `app.dependency_overrides[real_dep] = fake_dep`.
- `monkeypatch` / `unittest.mock.patch` on the module-level dep function → flag; use `dependency_overrides`.

### Test app factory (MEDIUM)

- Tests build the app per-test via `create_app(settings=fake_settings)`; never share a singleton across tests.
- Module-level `app = create_app()` imported by tests → flag; that shape leaks state across tests.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
