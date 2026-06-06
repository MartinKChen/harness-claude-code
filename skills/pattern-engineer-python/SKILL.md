---
name: pattern-engineer-python
description: "Modern idiomatic Python: `uv` only for env/deps; PEP 8 + 88-char lines; full type annotations on every signature; EAFP with narrow `except` + `raise ... from e`; modern type hints (PEP 604/695); `Protocol` for duck-typed seams; frozen-slots `@dataclass` DTOs (Pydantic only at boundaries); `with` for resources; no mutable default args; comprehensions over C-style loops; no `import *`; no MD5/SHA1 for security; Alembic chained to head + `pytest-alembic` round-trip. Activate on `.py` files."
---

# pattern-engineer-python

## When to activate

Activate when writing or editing any `.py` file, scaffolding a Python service, modifying `pyproject.toml`, working with FastAPI / Flask / Django / SQLAlchemy / Pydantic / pytest, or running `mypy` / `ruff` / `bandit` / `pytest` / `uv`. Skip for non-Python code.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-python.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Patterns

### Environment — `uv` only

- `uv` is the only supported environment / dependency manager.
- No `pip`, `poetry`, `pipenv`, `conda`, `virtualenv` workflows.
- Pin Python version in `pyproject.toml` via `requires-python`.
- Commit `uv.lock`; never edit by hand.
- Prefer `uv run <cmd>` over activating the venv in scripts.

| Command | Purpose |
|---------|---------|
| `uv venv` | Create `.venv` |
| `uv sync` | Install from `pyproject.toml` + `uv.lock` |
| `uv add <pkg>` | Add a runtime dep |
| `uv add --dev <pkg>` | Add a dev dep |
| `uv run <cmd>` | Run inside the project env |

### PEP 8

- 4-space indentation, no tabs.
- Lines ≤ 88 chars (ruff default).
- `snake_case` for functions / methods / variables / modules.
- `PascalCase` for classes.
- `SCREAMING_SNAKE_CASE` for module-level constants.
- Two blank lines between top-level defs; one between methods.
- Imports: stdlib → third-party → local; sorted by `ruff` (`I` rules).

### Type annotations on every signature

- Every function and method — including `__init__`, private helpers, and tests — fully annotated.
- Annotate parameters AND the return type. `-> None` explicitly for procedures.

### EAFP over LBYL

- Try the operation; catch the narrowest exception that applies.
- Always `raise ... from e` to preserve the cause.
- Don't swallow silently; either handle meaningfully or re-raise.

### Modern type hints

- Target Python ≥ 3.10.
- Built-in generics: `list[int]`, `dict[str, X]` — not `List` / `Dict` from `typing`.
- PEP 604 unions: `int | None` — not `Optional[int]`.
- PEP 695 aliases + generics on 3.12+: `type UserId = int`; `def first[T](items: list[T]) -> T | None: ...`.

### `Protocol` (duck typing)

- `typing.Protocol` for collaborator types crossing module boundaries (structural — anything with the right shape satisfies).
- ABCs only when you need shared implementation, not just a shape.

### Dataclasses as DTOs

- `@dataclass(frozen=True, slots=True)` for plain data carriers — request/response payloads, config bundles, value objects.
- `frozen=True` for immutability; `slots=True` for memory + attribute safety.
- No behavior beyond trivial derived properties.
- Pydantic only when parsing/validation is needed at a system boundary (FastAPI request bodies, config from env).

### Context managers

- Every acquired resource (files, sockets, locks, DB sessions, temp dirs, subprocess handles) released via `with`.
- Author your own with `contextlib.contextmanager` or `__enter__` / `__exit__`.
- `contextlib.ExitStack` to compose a dynamic set of context managers.
- Never `try` with manual `.close()` when `with` would do.

### Pythonic idioms

- Mutable default arguments: NEVER `def f(x=[])` / `def f(x={})` — the default is shared across calls. Use `def f(x: list[T] | None = None)` and convert to `[]` inside.
- List comprehensions / generator expressions over C-style accumulating loops (`result = []; for ...: result.append(...)` → `result = [... for ... if ...]`).
- `isinstance(x, T)` over `type(x) == T` — `isinstance` respects subclassing; `type==` doesn't.
- `x is None` / `x is not None` — never `== None` (None is a singleton; identity comparison is both faster and the canonical idiom).
- `"".join(parts)` over `+=` in a loop — `str` is immutable; `+=` is quadratic.
- Don't shadow builtins (`list`, `dict`, `str`, `id`, `type`, `input`) — pick a different name.
- No `from module import *` — namespace pollution and breaks tooling that tracks symbol origins.
- Weak crypto banned for security purposes: no `md5` / `sha1` for signatures / fingerprints / passwords. Use `hashlib.sha256` (or stronger), `bcrypt` / `argon2` for passwords, `hmac.compare_digest` for HMAC.

### Banned APIs (bandit blocks these)

| API | Why | Use |
|-----|-----|-----|
| `urllib.request.urlopen` | B310 — historically accepted `file://` / `ftp://` (SSRF vector). | `http.client.HTTPSConnection` for stdlib-only; `httpx` otherwise. |
| `subprocess.Popen(..., shell=True)` | B602 — shell injection. | `shell=False` (the default) with a list of args; if you genuinely need shell expansion, document the safe-input invariant and add `# nosec B602`. |
| `xml.etree.ElementTree` on untrusted XML | B314 — XXE / billion-laughs. | `defusedxml`. |
| `yaml.load(...)` without `Loader` | B506 — arbitrary Python execution. | `yaml.safe_load(...)`. |
| `assert` for runtime invariants in production code | B101 — strips under `python -O`. | Raise an exception. Asserts in test code are fine. |

The pre-push hook runs `uv run bandit -r .` — anything above LOW severity blocks the push.

### Backend layout (`src/`)

See `templates/backend-layout.md`. Source under `src/<package>/`, tests at the top level under `tests/{database,unit,integration}/`, single `pyproject.toml`.

- `src/` layout avoids accidental imports from CWD.
- `api/` holds route/handler modules; `models/` holds dataclasses / ORM / DTOs; `utils/` holds cross-cutting helpers.
- Shared fixtures live in `tests/conftest.py`.
- Tool configs (`[tool.ruff]`, `[tool.ruff.format]`, `[tool.mypy]`, `[tool.pytest.ini_options]`) live in `pyproject.toml`.

## Tooling

Run via `uv run` so it picks up the project env.

```bash
uv run mypy .                  # Type checking
uv run ruff check .            # Fast linting
uv run ruff format --check .   # Format check
uv run bandit -r .             # Static security analysis
uv run pytest                  # Tests
```

Auto-fix before re-running checks:

```bash
uv run ruff format .       # Auto-format
uv run ruff check --fix .  # Auto-fix lint (includes import sorting)
```

### Enforced ruff rule set

`[tool.ruff.lint] select` in `pyproject.toml` pins the rule groups the pre-push hook and `ci-checks.sh` fail on. The scaffold ships this set; treat it as the baseline:

| Group | Covers |
|-------|--------|
| `E` / `W` | pycodestyle errors / warnings |
| `F` | pyflakes — undefined names, unused imports/vars |
| `I` | isort — deterministic import ordering |
| `N` | pep8-naming |
| `UP` | pyupgrade — modern syntax + PEP 604/695 type hints |
| `B` | flake8-bugbear — likely bugs (mutable defaults, etc.) |
| `C4` | flake8-comprehensions — comprehensions over C-style loops |
| `SIM` | flake8-simplify |
| `ASYNC` | flake8-async — blocking calls / un-awaited work in async defs |
| `RUF` | ruff-specific — incl. `RUF006` dangling `asyncio.create_task` |

- **Security (`S`) is intentionally NOT in `select`** — `bandit -r .` owns that gate (see [Banned APIs](#banned-apis-bandit-blocks-these)); selecting `S` too would double-report the same findings.
- **FastAPI projects must whitelist the DI idiom** so `B008` (function-call-in-default) doesn't fire on every `Depends()`/`Query()`/… route:

  ```toml
  [tool.ruff.lint.flake8-bugbear]
  extend-immutable-calls = ["fastapi.Depends", "fastapi.Query", "fastapi.Path",
    "fastapi.Header", "fastapi.Cookie", "fastapi.Body", "fastapi.Form",
    "fastapi.File", "fastapi.Security"]
  ```

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/backend-layout.md` | Canonical `src/`-layout backend tree — package under `src/<package>/{api,models,utils}/`, tests mirrored under `tests/{database,unit,integration}/`, single `pyproject.toml` with tool configs. |
