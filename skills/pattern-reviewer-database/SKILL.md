---
name: pattern-reviewer-database
description: "Migration audit: code-first (models drive migration, not the reverse); autogenerate review (server defaults / check constraints / type changes / data migrations the autogenerate missed); `pytest-alembic` round-trip; post-state assertions by **name** (`pk_<table>`, `fk_<table>_<col>`, `uq_<table>_<col>`, `idx_<table>_<col>`, `ck_<table>_<rule>`); extensions installed by the upgrade are dropped by the downgrade; ORM `__table_args__` carries `name=` matching the migration; no pre-create of extensions in `conftest.py`; migration runs in a `migrate` compose service, not the backend entrypoint."
---

# pattern-reviewer-database

## When to activate

- Reviewing a diff that touches `alembic/versions/*.py`, ORM models with new tables / columns / constraints, `compose.yaml` `migrate` service, or `pytest-alembic` test files.

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Patterns to review

### Code-first (HIGH)

- Hand-written migration with no matching ORM model change → flag.
- Schema edited directly in the DB (no migration) → CRITICAL.
- Model changed without a corresponding migration in the same commit → flag.

### Autogenerate review (MEDIUM)

Autogenerate misses these — verify the revision body covers each that applies:

- Server defaults (`server_default=...`) not picked up automatically.
- Check constraints (`CheckConstraint(...)`) — autogenerate often emits anonymous constraints; verify explicit names.
- Type changes (`String(100)` → `String(255)`) — autogenerate skips silently in some configs.
- Data migrations (`op.execute("UPDATE …")` to backfill NOT NULL columns).

### `pytest-alembic` round-trip (HIGH)

- No migration test file (`tests/test_migrations.py` or equivalent) for a revision that touches schema → flag.
- `migrate_up_to("head")` only, no `migrate_down_one()` / `migrate_up_one()` → flag (round-trip not exercised).
- Test exists but only asserts "did not crash" — no schema introspection → flag.

### Post-state assertions by name (HIGH)

After `migrate_up_to("head")`, query `information_schema` (or `inspect()`) and assert every artifact lands with the explicit name. Naming convention:

| Kind | Prefix | Example |
|------|--------|---------|
| Primary key | `pk_<table>` | `pk_users` |
| Foreign key | `fk_<table>_<col>` | `fk_orders_user_id` |
| Unique constraint | `uq_<table>_<col>` | `uq_users_email` |
| Index | `idx_<table>_<col>` | `idx_orders_created_at` |
| Check constraint | `ck_<table>_<rule>` | `ck_groups_currency_iso4217` |
| View | `vw_<name>` | `vw_active_users` |

Missing name assertion (only existence checked) → flag.

```python
# BAD — only existence checked
def test_groups_migration(alembic_runner, alembic_engine):
    alembic_runner.migrate_up_to("head")
    inspector = sa.inspect(alembic_engine)
    assert "groups" in inspector.get_table_names()

# GOOD — name-by-name assertion
def test_groups_migration(alembic_runner, alembic_engine):
    alembic_runner.migrate_up_to("head")
    inspector = sa.inspect(alembic_engine)
    assert "groups" in inspector.get_table_names()
    uqs = {uq["name"] for uq in inspector.get_unique_constraints("groups")}
    assert "uq_groups_name_owner_id" in uqs
    cks = {ck["name"] for ck in inspector.get_check_constraints("groups")}
    assert "ck_groups_currency_iso4217" in cks
```

### Extension cleanup on downgrade (HIGH)

- Upgrade installs an extension (`CREATE EXTENSION IF NOT EXISTS citext` / `uuid-ossp` / `pgcrypto`) but downgrade doesn't `DROP EXTENSION IF EXISTS` → flag.
- Downgrade test doesn't assert the extension is gone → flag.

### ORM ↔ migration name parity (HIGH)

```python
# BAD — anonymous constraint on model; migration creates `uq_users_email`; reflection sees both
__table_args__ = (UniqueConstraint("email"),)

# GOOD — explicit name matching the migration
__table_args__ = (UniqueConstraint("email", name="uq_users_email"),)
```

### Both-direction constraint tests (HIGH)

For every CHECK / UNIQUE / FK / regex constraint, test BOTH directions:

```python
# BAD — only positive case (PR #167 shipped a wrong regex this way)
def test_currency_accepts_alphabetic(db_session):
    db_session.execute(insert(groups).values(name="x", currency="USD"))  # PASSES

# GOOD — positive + negative cases
def test_currency_accepts_alphabetic_iso4217(db_session):
    db_session.execute(insert(groups).values(name="x", currency="USD"))

def test_currency_rejects_digits(db_session):
    with pytest.raises(IntegrityError):
        db_session.execute(insert(groups).values(name="x", currency="1A2"))

def test_currency_rejects_lowercase(db_session):
    with pytest.raises(IntegrityError):
        db_session.execute(insert(groups).values(name="x", currency="usd"))
```

Author the negative test(s) BEFORE the constraint regex / index expression — that's what proves the constraint is doing work.

### `conftest.py` pre-warming (HIGH)

- `tests/conftest.py` issues `CREATE EXTENSION IF NOT EXISTS <name>` on the shared test DB → flag.
- The migration's upgrade must own the extension lifecycle; conftest pre-warming masks a forgotten extension install.
- Exception: a non-migration test that needs an extension before the migration runs installs it in its own fixture scope and tears it down — never session-scope.

### Test isolation (MEDIUM)

- `migrate_up_to("head")` without matching `migrate_down_to("base")` or transactional fixture → flag (DB stays dirty for next test).
- Shared session-scope DB without rollback → flag.

### `migrate` compose service (HIGH)

- Migration runs inside the backend image's entrypoint (`alembic upgrade head` chained into `uvicorn ...`) → flag; the app accepts traffic against a stale schema and N replicas race.
- Migration runs in a FastAPI `startup` hook → flag (same problem).
- Correct shape: `migrate` is a dedicated compose service running once before `backend` starts, same image with a different `command:`.

### Irreversible migrations (MEDIUM)

- Migration drops a column with data and has no documentation in the revision body → flag.
- `downgrade()` of an irreversible migration silently passes instead of raising → flag.
- Recommended shape: `raise NotImplementedError("irreversible: data loss")` + `@pytest.mark.skip(reason="irreversible — see <revision>")`.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/compose-migrate.yaml` | `migrate` service shape (one-shot container, depends-on edits for backend). |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
