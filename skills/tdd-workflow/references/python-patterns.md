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

### Alembic migrations — chain, test, and constrain in both directions

Every Alembic revision MUST do all three:

1. **Chain to the current head.** Run `uv run alembic heads` before authoring the revision; the new revision's `down_revision` must equal that head. The trap to avoid: hand-editing `down_revision` (or autogenerating against a stale local DB) so the chain branches, then pushing — `alembic upgrade head` in CI applies the OTHER branch and the new table never gets created. Pin this with a migration-runner test that calls `upgrade("head")` and asserts every new table exists:
   ```python
   def test_groups_migration_applies_groups_table(alembic_engine, alembic_runner):
       alembic_runner.migrate_up_to("head")
       inspector = sa.inspect(alembic_engine)
       assert "groups" in inspector.get_table_names()
   ```

2. **Test every CHECK / UNIQUE / FK constraint in BOTH directions.** Positive-case ("a valid row inserts") is half the test; without the negative case the regex / partial index / cascade rule never actually gets exercised. PR #167's `currency_iso4217` CHECK constraint shipped a regex that accepted `"1A2"` because the only test was a positive case. The shape that catches the failure:
   ```python
   # tests/database/test_groups_migration.py
   def test_groups_currency_accepts_alphabetic_iso4217(db_session: Session) -> None:
       db_session.execute(insert(groups).values(name="x", currency="USD"))  # PASSES

   def test_groups_currency_rejects_digits(db_session: Session) -> None:
       with pytest.raises(IntegrityError):  # FAILS at the DB layer
           db_session.execute(insert(groups).values(name="x", currency="1A2"))

   def test_groups_currency_rejects_lowercase(db_session: Session) -> None:
       with pytest.raises(IntegrityError):
           db_session.execute(insert(groups).values(name="x", currency="usd"))
   ```
   Author the negative test(s) BEFORE the constraint regex / index expression — the negative test is what proves the constraint is doing work, and authoring it second makes it too easy to write a regex that happens to accept whatever the test feeds.

3. **Round-trip with `pytest-alembic`.** The runner walks every revision both up AND down against a real Postgres (use the same image tag as production). `migrate_up_one` / `migrate_down_one` per revision catches the "irreversible migration" trap (drops a column without re-adding it on downgrade) and the "data-loss migration" trap (renames via DROP+CREATE without preserving data).

The pre-push hook runs `uv run pytest`, so any migration test that's red blocks the push. The hook does NOT verify chain hygiene structurally — if no migration test exists for a new revision, the push goes out and CI catches it. Write the migration test in the same commit as the revision.

### Banned APIs — bandit will block these

- **`urllib.request.urlopen` (bandit B310 — Medium severity).** Use `http.client.HTTPSConnection` for stdlib-only callers, or `httpx` for anything that wants connection pooling / timeouts / async. B310 fires because `urlopen` historically accepted `file://` and `ftp://` URLs, which becomes an SSRF vector when the URL comes from user input.
- **`subprocess.Popen(..., shell=True)` (B602).** Pass `shell=False` (the default) with a list of args; if you genuinely need shell expansion, document the safe-input invariant and add `# nosec B602`.
- **`xml.etree.ElementTree` on untrusted XML (B314).** Use `defusedxml` for any XML you didn't author yourself.
- **`yaml.load(...)` without a `Loader` (B506).** Use `yaml.safe_load(...)` — the no-Loader form executes arbitrary Python.
- **`assert` for runtime invariants in production code (B101).** Asserts strip out under `python -O`; raise an exception instead. Asserts in test code are fine.

The pre-push hook's `backend:security` step runs `uv run bandit -r .` — anything above LOW severity blocks the push.

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
