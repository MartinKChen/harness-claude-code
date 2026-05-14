# python-patterns

Enforce idiomatic, modern Python practices on every Python implementation task. Encodes the conventions this project considers non-negotiable: `uv` for environments, PEP 8 style, type annotations on every signature, EAFP over LBYL, modern type hints, `Protocol` for duck typing, dataclasses as DTOs, context managers for resource handling, a fixed backend layout, and a standard lint/test command set.

## When to activate

Activate this skill whenever the user:

- writes, edits, or refactors any `.py` file
- adds or modifies functions, classes, dataclasses, protocols, generators, decorators, or context managers in Python
- scaffolds a new Python module, package, or backend service
- sets up or modifies `pyproject.toml`, `conftest.py`, `requirements*.txt`, or virtual environments
- works with Python frameworks (FastAPI, Flask, Django, SQLAlchemy, Pydantic, pytest)
- runs or configures `mypy`, `ruff`, `black`, `isort`, `bandit`, `pytest`, or `uv`
- asks how to structure a Python project, type a function, model a DTO, or handle a resource

Do NOT activate when the user is editing non-Python code, working purely on infrastructure/IaC without Python content, or asking general (non-implementation) Python language questions unrelated to this project's code.

## Pattern

### Environment with `uv`

`uv` is the only supported environment and dependency manager. Do not introduce `pip`, `poetry`, `pipenv`, `conda`, or `virtualenv` workflows.

```bash
uv venv                       # create .venv
uv sync                       # install from pyproject.toml + uv.lock
uv add <pkg>                  # add a runtime dep
uv add --dev <pkg>            # add a dev dep
uv run <cmd>                  # run inside the project env
uv run python -m mypackage    # run the package
```

- Pin Python version in `pyproject.toml` via `requires-python`.
- Commit `uv.lock`. Never edit it by hand.
- Prefer `uv run <tool>` over activating the venv in scripts.

### PEP 8 conventions

- 4-space indentation, no tabs.
- Lines ≤ 88 chars (ruff default).
- `snake_case` for functions, methods, variables, modules.
- `PascalCase` for classes.
- `SCREAMING_SNAKE_CASE` for module-level constants.
- Two blank lines between top-level defs; one between methods.
- Imports grouped: stdlib → third-party → local; sorted by `ruff` (the `I` rules).
- One statement per line; no semicolons.

### Type annotations on all signatures

Every function and method signature — including `__init__`, private helpers, and tests — must be fully annotated. Annotate parameters and the return type. Use `-> None` explicitly for procedures.

```python
# Bad
def fetch(user_id, retries=3):
    ...

# Good
def fetch(user_id: int, retries: int = 3) -> User:
    ...
```

### Readability counts

Code should be obvious on first read. If a reviewer would have to re-read a line to understand it, rewrite the line.

- Name things for what they mean, not how they're computed.
- Prefer early returns over nested branching.
- Prefer comprehensions over `map`/`filter` chains.
- Prefer named args at call sites when there is more than one argument or any boolean.
- Don't write a comment that restates the code; write a clearer line of code instead.

### EAFP over LBYL

Easier to Ask Forgiveness Than Permission. Prefer `try/except` over pre-condition checks for things that are usually fine.

```python
# Bad — LBYL
if "name" in payload and isinstance(payload["name"], str):
    name = payload["name"]
else:
    raise ValueError("missing name")

# Good — EAFP
try:
    name: str = payload["name"]
except KeyError as e:
    raise ValueError("missing name") from e
```

- Catch the **narrowest** exception that applies.
- Always `raise ... from e` to preserve the cause.
- Don't swallow exceptions silently; if you catch, either handle meaningfully or re-raise.

### Modern type hints, type aliases, and `TypeVar`

Target Python ≥ 3.10. Use built-in generics and PEP 604 unions; do not import from `typing` what the language now provides natively.

```python
# Bad
from typing import Dict, List, Optional, Union

def load(ids: List[int]) -> Optional[Dict[str, Union[int, str]]]:
    ...

# Good
def load(ids: list[int]) -> dict[str, int | str] | None:
    ...
```

For aliases and generics, use PEP 695 syntax when on 3.12+:

```python
type UserId = int
type JSON = dict[str, "JSON"] | list["JSON"] | str | int | float | bool | None

def first[T](items: list[T]) -> T | None:
    return items[0] if items else None
```

On older interpreters, fall back to `TypeAlias` and `TypeVar` from `typing`.

### `Protocol` (duck typing)

Use `typing.Protocol` to type duck-typed interfaces instead of forcing inheritance from an ABC. Protocols are structural — anything with the right shape satisfies them.

```python
from typing import Protocol

class SupportsClose(Protocol):
    def close(self) -> None: ...

def shutdown(resource: SupportsClose) -> None:
    resource.close()
```

- Use `Protocol` for collaborator types crossing module boundaries.
- Use ABCs only when you need shared implementation, not just a shape.

### Dataclasses as DTOs

Use `@dataclass` (or `@dataclass(frozen=True, slots=True)`) for plain data carriers — request/response payloads, config bundles, value objects. Reach for Pydantic only when you need parsing/validation at a system boundary.

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class UserDTO:
    id: int
    email: str
    is_active: bool = True
```

- Prefer `frozen=True` for immutability; `slots=True` for memory + attribute safety.
- Don't put behavior on DTOs beyond trivial derived properties.
- Keep DTOs at boundaries; don't pass them deep into the domain layer if a richer type fits.

### Context managers

Any acquired resource — files, sockets, locks, DB sessions, temp dirs, subprocess handles — must be released via `with`. Author your own context managers with `contextlib.contextmanager` or `__enter__`/`__exit__` when wrapping a resource.

```python
from contextlib import contextmanager
from collections.abc import Iterator

@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
```

- Never leave a `try` with manual `.close()` when `with` would do.
- Use `contextlib.ExitStack` to compose a dynamic set of context managers.

## Template

### Backend layout

Use this layout for any new Python backend service in this project. Source under `src/<package>/`, tests at the top level, single `pyproject.toml`.

```
backend/
├── src/mypackage/
│   ├── __init__.py
│   ├── api/
│   ├── models/
│   └── utils/
├── tests/
│   ├── conftest.py
│   └── database/       # test for model and migration plan
│   │   └── test_*.py
│   └── unit/           # unit test for single module
│   │   └── test_*.py
│   └── integration/    # integration test with mocked seam
│       └── test_*.py
├── pyproject.toml
└── README.md
```

- `src/` layout is required (avoids accidental imports from CWD).
- `api/` holds route/handler modules; `models/` holds dataclasses, ORM models, and DTOs; `utils/` holds cross-cutting helpers.
- Tests mirror the package tree under `tests/`. Shared fixtures live in `tests/conftest.py`.
- One `pyproject.toml` per service — declare deps, tool configs (`[tool.ruff]`, `[tool.ruff.format]`, `[tool.mypy]`, `[tool.pytest.ini_options]`) here.

## Command

Run all tooling via `uv run` so it picks up the project environment. The first set is read-only checks; the second set mutates files.

### Checks

```bash
uv run mypy .                  # Type checking
uv run ruff check .            # Fast linting
uv run ruff format --check .   # Format check
uv run bandit -r .             # Static security analysis
uv run pytest                  # Tests
```

- Run all five before declaring a task complete.
- A clean `mypy` and `ruff` run is required; coverage thresholds (if any) are configured in `pyproject.toml` (`[tool.pytest.ini_options]` / `[tool.coverage.*]`) and enforced by `pytest` automatically — don't pass `--cov` flags on the CLI.

### Auto-fix

```bash
uv run ruff format .       # Auto-format
uv run ruff check --fix .  # Auto-fix lint issues (includes import sorting)
```

- Run auto-fix before re-running checks; don't hand-fix what the formatters will fix.
- Review the diff after auto-fix — formatters occasionally reflow code in ways that hurt readability, in which case rewrite the underlying line.
