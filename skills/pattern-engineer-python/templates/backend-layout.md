# Backend layout

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
