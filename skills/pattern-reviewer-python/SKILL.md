---
name: pattern-reviewer-python
description: "Python audit: bandit-banned APIs (B310 urlopen, B602 shell=True, B314 xml.etree, B506 yaml.load, B101 assert), full type annotations on every signature, EAFP discipline (narrow except, `raise ... from e`), modern type hints (built-in generics, PEP 604, PEP 695), `Protocol` for seams (not ABCs), `@dataclass(frozen=True, slots=True)` as DTOs at boundaries, `with` for every acquired resource. Cites `file:line` with BAD/GOOD snippets."
---

# pattern-reviewer-python

## When to activate

- Reviewing a diff that includes `.py` files.
- A user says "review the Python code / type hints / bandit findings".

## Iron rules

## Patterns to review

### Bandit-banned APIs (HIGH — pre-push hook blocks them)

| Code | API | What to flag | Fix |
|------|-----|--------------|-----|
| B310 | `urllib.request.urlopen` | Any usage on untrusted input — historically accepted `file://` / `ftp://`. | `http.client.HTTPSConnection` (stdlib) or `httpx` (preferred). |
| B602 | `subprocess.Popen(..., shell=True)` (or `subprocess.run(..., shell=True)`) | Any `shell=True` without an inline `# nosec B602` justifying the safe-input invariant. | `shell=False` with a list of args. |
| B314 | `xml.etree.ElementTree` on untrusted input | XXE / billion-laughs vector. | `defusedxml`. |
| B506 | `yaml.load(...)` without a `Loader=` | Arbitrary Python execution. | `yaml.safe_load(...)`. |
| B101 | `assert` for runtime invariants in production code | Asserts strip out under `python -O`. (Asserts in test code are fine.) | Raise an exception. |

The pre-push hook runs `uv run bandit -r .`. Anything above LOW severity blocks the push — if the diff bypassed the hook, that itself is a finding.

### Type annotations on every signature (HIGH)

```python
# BAD
def fetch(user_id, retries=3):
    ...

# GOOD
def fetch(user_id: int, retries: int = 3) -> User:
    ...
```

- Parameters AND return type, including `-> None` for procedures.
- Private helpers + tests included.

### EAFP discipline (MEDIUM)

```python
# BAD — LBYL
if "name" in payload and isinstance(payload["name"], str):
    name = payload["name"]
else:
    raise ValueError("missing name")

# BAD — overly broad except
try:
    name = payload["name"]
except Exception:
    raise ValueError("missing name")

# GOOD — narrow except + cause preserved
try:
    name: str = payload["name"]
except KeyError as e:
    raise ValueError("missing name") from e
```

- Broad `except Exception:` / `except:` → flag.
- Missing `from e` → flag.
- Silent except (logging then continuing without a documented reason) → flag.

### Modern type hints (MEDIUM)

```python
# BAD — typing imports for built-ins
from typing import Dict, List, Optional, Union

def load(ids: List[int]) -> Optional[Dict[str, Union[int, str]]]: ...

# GOOD — built-in generics, PEP 604 unions
def load(ids: list[int]) -> dict[str, int | str] | None: ...
```

- `List` / `Dict` / `Tuple` / `Set` imports from `typing` → flag.
- `Optional[X]` / `Union[X, Y]` → flag; use `X | None` / `X | Y`.
- PEP 695 aliases (`type UserId = int`) on 3.12+ — informational.

### `Protocol` over ABC (MEDIUM)

```python
# BAD — ABC inheritance for a shape
from abc import ABC, abstractmethod

class TaskStore(ABC):
    @abstractmethod
    def save(self, task: Task) -> None: ...

# GOOD — Protocol (structural)
from typing import Protocol

class TaskStore(Protocol):
    def save(self, task: Task) -> None: ...
```

- ABC used purely to declare a shape (no shared implementation) → flag.

### Dataclasses as DTOs (MEDIUM)

```python
# BAD — plain class with attributes for a data carrier
class UserDTO:
    def __init__(self, id: int, email: str, is_active: bool = True):
        self.id = id
        self.email = email
        self.is_active = is_active

# GOOD — frozen dataclass with slots
@dataclass(frozen=True, slots=True)
class UserDTO:
    id: int
    email: str
    is_active: bool = True
```

- Plain class for a data carrier → flag (use `@dataclass`).
- Mutable dataclass when it shouldn't be → flag (add `frozen=True`).
- Pydantic model used deep in the domain layer (not at a boundary) → flag.

### Context managers (HIGH)

- Any acquired resource (file, socket, lock, DB session, temp dir, subprocess handle) released via `with`.
- Manual `.close()` after a `try` block when `with` would do → flag.
- `contextlib.ExitStack` for dynamic composition; missed opportunities → MEDIUM.

```python
# BAD — manual close
session = SessionLocal()
try:
    session.add(user); session.commit()
finally:
    session.close()

# GOOD — context manager
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

### `uv`-only environment (HIGH)

- `pip install`, `poetry install`, `pipenv install`, `conda install` references in Dockerfile / CI / docs → flag.
- `requirements.txt` shipping deps instead of `pyproject.toml` + `uv.lock` → flag.
- `uv.lock` not committed → HIGH.

### PEP 8 / ruff (LOW — formatter should fix)

- Lines > 88 chars → flag (formatter handles most; flag where ruff would catch it).
- Mixed casing on functions / classes / constants → flag.
- Star imports → flag.

## Constructing the finding

Use the shape in `templates/review-comment.md`.
