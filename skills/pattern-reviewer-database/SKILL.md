---
name: pattern-reviewer-database
description: "Migration audit: code-first (models drive migration, not the reverse); autogenerate review (server defaults / check constraints / type changes / data migrations the autogenerate missed); `pytest-alembic` round-trip; post-state assertions by **name** (`pk_<table>`, `fk_<table>_<col>`, `uq_<table>_<col>`, `idx_<table>_<col>`, `ck_<table>_<rule>`); extensions installed by the upgrade are dropped by the downgrade; ORM `__table_args__` carries `name=` matching the migration; no pre-create of extensions in `conftest.py`; migration runs in a `migrate` compose service, not the backend entrypoint. Runtime DB audit: column types (`bigint`/`text`/`timestamptz`/`numeric`); FK indexing; RLS policy indexes + `(SELECT auth.uid())`; `OFFSET` on large tables; `SKIP LOCKED` for worker queues; lock-acquisition order; transactions holding external I/O; `EXPLAIN ANALYZE` evidence on hot queries."
---

# pattern-reviewer-database

## When to activate

- Reviewing a diff that touches `alembic/versions/*.py`, ORM models with new tables / columns / constraints, `compose.yaml` `migrate` service, or `pytest-alembic` test files.
- Reviewing a diff that adds or substantially changes SQL queries, RLS policies, indexes, pagination, or worker-queue locking logic.

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

### Column types (HIGH)

- `int` / `integer` for surrogate IDs in a new table → flag (use `bigint`); `int` overflows at ~2.1B rows.
- `varchar(255)` (or any arbitrary `varchar(N)`) without a real reason (e.g. ISO 4217 currency = 3) → flag; use `text`.
- `timestamp` (without timezone) → flag; use `timestamptz`. `timestamp` silently stores client-local time and corrupts cross-region reads.
- `float` / `real` for money → flag; use `numeric(precision, scale)`.
- Random UUIDv4 PK on a high-write table → MEDIUM (prefer UUIDv7 or `IDENTITY` for B-tree locality).
- Quoted mixed-case identifiers (`"UserId"`) → flag; use `lowercase_snake_case`.

### Foreign-key indexing (HIGH)

```sql
-- BAD — FK declared, but no index → every parent delete / join scans the child table
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  user_id bigint REFERENCES users(id)
);

-- GOOD — explicit index named per convention
CREATE TABLE orders (
  id bigint PRIMARY KEY,
  user_id bigint REFERENCES users(id)
);
CREATE INDEX idx_orders_user_id ON orders (user_id);
```

Any FK column without an index → HIGH. PostgreSQL does **not** auto-index FKs.

### RLS policy indexes (HIGH)

- RLS enabled on a multi-tenant table with policies referencing `user_id` / `tenant_id` / `organization_id` / etc., but no index on those columns → HIGH (every authorization check serializes a sequential scan).
- Policy uses bare `auth.uid()` instead of `(SELECT auth.uid())` → HIGH; per-row function call kills planner caching.
- `GRANT ALL` to the application role → HIGH; default-deny + explicit `GRANT SELECT, INSERT, UPDATE, DELETE` per table.

### Pagination on large tables (HIGH)

```sql
-- BAD — OFFSET 100000 re-scans 100k rows before discarding them
SELECT * FROM events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50 OFFSET $2;

-- GOOD — cursor pagination uses an index seek
SELECT * FROM events
WHERE user_id = $1 AND created_at < $last_cursor
ORDER BY created_at DESC LIMIT 50;
```

`OFFSET` on a table that will exceed ~10k rows → HIGH. Acceptable on small lookup tables (countries, currencies).

### Worker queues without SKIP LOCKED (HIGH)

```sql
-- BAD — two workers serialize on the same row
SELECT id FROM jobs WHERE status = 'pending' FOR UPDATE LIMIT 1;

-- GOOD — each worker picks a different row
SELECT id FROM jobs WHERE status = 'pending'
FOR UPDATE SKIP LOCKED LIMIT 1;
```

Any `FOR UPDATE` in a worker-style claim loop without `SKIP LOCKED` → HIGH.

### Lock-acquisition order (HIGH)

- Multi-row update loops that lock rows in user-supplied order (e.g. iterating an unordered list and `SELECT … FOR UPDATE` per id) → HIGH (deadlock between two concurrent callers that send the ids in different orders).
- Fix: `ORDER BY id FOR UPDATE` so every caller takes locks in the same order.

### Transactions holding external I/O (HIGH)

```python
# BAD — transaction stays open while we hit an external API; row locks held for the round trip
with db.begin():
    db.execute("UPDATE orders SET status = 'paying' WHERE id = :id", {"id": order_id})
    response = stripe.PaymentIntent.create(...)        # network call inside the txn
    db.execute("UPDATE orders SET status = 'paid'   WHERE id = :id", {"id": order_id})

# GOOD — split: short txn → external call → short txn
with db.begin():
    db.execute("UPDATE orders SET status = 'paying' WHERE id = :id", {"id": order_id})

response = stripe.PaymentIntent.create(...)            # outside the txn

with db.begin():
    db.execute("UPDATE orders SET status = 'paid' WHERE id = :id", {"id": order_id})
```

External HTTP / queue / email call inside an open transaction → HIGH.

### `EXPLAIN ANALYZE` evidence (MEDIUM)

- New or substantially-changed query that hits a large table, joins ≥2 tables, or appears in a user-facing list endpoint, with no `EXPLAIN ANALYZE` evidence in the PR description or a comment → MEDIUM. Request the plan.
- `Seq Scan` on a >10k-row table in the planner output → HIGH (missing index or bad predicate).

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
