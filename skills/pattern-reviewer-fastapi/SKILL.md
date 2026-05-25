---
name: pattern-reviewer-fastapi
description: "FastAPI best-practice audit — router-mount prefix discipline, `Depends()` injection (no inline auth in handlers), Pydantic at boundary only (not deep in domain), app-level exception handlers (every project exception class registered), middleware registration order (`RequestIdMiddleware` last so it runs first), named path constants shared by route + tests, `Settings()` instantiation footgun in `create_app()`, `dependency_overrides` in tests (not `monkeypatch`), per-test app factory."
---

# pattern-reviewer-fastapi

FastAPI implementation best-practice audit. This skill focuses on FastAPI-specific mechanics — contract-conformance checks (path / verb / status code / response shape / error envelope shape / idempotency policy / rate-limit policy) are out of scope here.

## When to activate

- Reviewing a diff that includes FastAPI routes, dependencies, middleware, exception handlers, or `create_app()` / `main.py`.
- A user says "review the FastAPI wiring / dependencies / middleware order".

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-fastapi.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### Router mounting (MEDIUM)

- Each `APIRouter` mounts with an explicit prefix: `app.include_router(users_router, prefix="/api/v1/users", tags=["users"])`. This rule is "prefix explicit, not implicit" — contract-prefix conformance is out of scope here.
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

### Request vs response model separation (MEDIUM)

```python
# BAD — same model used for both directions
class User(BaseModel):
    id: int | None = None             # only set on response
    email: str
    password: str                     # only set on request — and now in OpenAPI response schema

@router.post("", response_model=User)
def create_user(body: User) -> User: ...

# GOOD — distinct shapes
class UserCreate(BaseModel):
    email: str
    password: str

class UserRead(BaseModel):
    id: int
    email: str

@router.post("", response_model=UserRead)
def create_user(body: UserCreate) -> UserRead: ...
```

A single Pydantic model used as BOTH the route's request body and its `response_model` → MEDIUM. Write-side fields (passwords, raw tokens, internal write toggles) leak into the OpenAPI response schema; response-side fields (server-issued ids, derived values) silently become optional on the request side.

### Exception handlers register at app level (HIGH)

- App-level handlers register for project exceptions: `@app.exception_handler(LoginError)`.
- Inline `HTTPException(status_code=..., detail=...)` for a project-wide error class → flag (move to a handler).
- Generic 500 handler exists; logs the full exception server-side.

(This rule is "handler exists at app level, not inline" — error-envelope-shape conformance is out of scope here.)

### Middleware registration order (HIGH)

- `app.add_middleware(...)` runs in reverse order on the response.
- `RequestIdMiddleware` is the **last** `add_middleware` call so it runs first on rejection paths.
- Every 4xx / 5xx body must carry a non-null `request_id` — pin with a test that walks `app.user_middleware` and asserts the request-id middleware is at the top.

### Path constants (MEDIUM)

- Paths used in BOTH the route decorator AND tests must be defined once as a module-level constant.
- `@router.post("/api/v1/users")` + `client.post("/api/v1/users")` in a test → flag; both should import `USERS_PATH`.

(This rule is "constant exists; route + tests share it" — whether the constant's **value** matches the api contract is out of scope here.)

### Lifespan + background tasks (MEDIUM)

- Startup / shutdown hooks in `lifespan` context manager, not deprecated `@app.on_event`.
- `BackgroundTasks` parameter only for fire-and-forget work that can lose to a crash; persistent work uses a real queue.

### `dependency_overrides` in tests (MEDIUM)

- Tests override deps via `app.dependency_overrides[real_dep] = fake_dep`.
- `monkeypatch` / `unittest.mock.patch` on the module-level dep function → flag; use `dependency_overrides`.

### Test app factory (MEDIUM)

- Tests build the app per-test via `create_app(settings=fake_settings)`; never share a singleton across tests.
- Module-level `app = create_app()` imported by tests → flag; that shape leaks state across tests.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
