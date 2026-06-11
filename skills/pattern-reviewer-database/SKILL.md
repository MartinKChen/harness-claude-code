---
name: pattern-reviewer-database
description: "Migration audit across stacks: code-first, chain-to-head, round-trip (up→down→up reverts), post-state by **name** (`pk_*`/`fk_*`/`uq_*`/`idx_*`/`ck_*`), model↔migration parity, both-direction constraint tests, `migrate` before app. Per-tool: Alembic/pytest-alembic (deep), Prisma/Drizzle, Flyway/Liquibase, golang-migrate/Atlas, sqlx/SeaORM. Runtime: types, FK/RLS indexes, `OFFSET`, `SKIP LOCKED`. Activate on `alembic/versions/`, `prisma/schema.prisma`, `*.sql` migration dirs, `migrate` service."
---

# pattern-reviewer-database

## When to activate

- Reviewing a diff that touches a database migration in any tool — Alembic (`alembic/versions/*.py`), Prisma (`prisma/schema.prisma`, `prisma/migrations/`), Drizzle (`drizzle/`), Flyway/Liquibase (`db/migration/*.sql`, `changelog.xml`), golang-migrate/Atlas (`migrations/*.sql`, `atlas.hcl`), sqlx (`migrations/*.sql`)/SeaORM (`migration/`) — ORM/schema models with new tables / columns / constraints, the `compose.yaml` `migrate` service, or migration test files (`pytest-alembic` et al.).
- Reviewing a diff that adds or substantially changes SQL queries, RLS policies, indexes, pagination, or worker-queue locking logic.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-database.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Contract source

The schema contract is `docs/data-model/<entity>.yaml` — entities, columns, types, constraints, indexes. The naming target every migration is audited against (`pk_*`, `fk_*`, `uq_*`, `idx_*`, `ck_*`, `vw_*`) is below under post-state assertions.

## Migration core (tool-neutral)

These rules apply whichever migration tool the diff uses; the **per-tool idiom map** translates each into the tool's spelling, and the **Alembic** section carries the fully-worked detection apparatus.

### Code-first (HIGH)

- Hand-written migration with no matching model/schema change → flag.
- Schema edited directly in the DB (no migration) → CRITICAL.
- Model changed without a corresponding migration in the same commit → flag.
- **Migration-first tools (Flyway/Liquibase):** there is no model to generate from, so map this rule to **schema source of truth + drift check** — a checked-in schema baseline plus a drift check (Flyway `validate`, Liquibase `diff`, Atlas against entities). A migration with no drift gate → flag.

### Chain to head (HIGH)

- New migration that branches off a non-head revision, creating a forked / parallel head → flag (`alembic heads` shows >1; golang-migrate gap; Liquibase merge conflict in the changelog). Two engineers branching from the same head independently is the common cause; resolve to a single head before merge.

### Round-trip reverts (HIGH)

- A migration whose `downgrade`/`down` doesn't actually revert the `upgrade`/`up` — leftover tables/columns/constraints, un-dropped extensions → flag.
- `upgrade → downgrade → upgrade` not exercised in a test (apply-only) → flag.

### Post-state assertions by name (HIGH)

After applying to head, introspect (`information_schema` / `inspect()` / `prisma db pull` / JDBC metadata) and assert every artifact lands with the explicit name. Naming convention:

| Kind | Prefix | Example |
|------|--------|---------|
| Primary key | `pk_<table>` | `pk_users` |
| Foreign key | `fk_<table>_<col>` | `fk_orders_user_id` |
| Unique constraint | `uq_<table>_<col>` | `uq_users_email` |
| Index | `idx_<table>_<col>` | `idx_orders_created_at` |
| Check constraint | `ck_<table>_<rule>` | `ck_groups_currency_iso4217` |
| View | `vw_<name>` | `vw_active_users` |

A test that only asserts the migration ran (no schema introspection) or only checks existence without the name → flag. See the Alembic section for a worked BAD/GOOD.

### Model ↔ migration name parity (HIGH)

- The migration must create exactly what the model declares, by the same name. An anonymous constraint on the model side that the migration names explicitly → reflection sees both → flag. Pass explicit names on the model side. (Alembic BAD/GOOD below; the same applies to SeaORM entity vs. migration, Drizzle schema vs. generated SQL.)

### Both-direction constraint tests (HIGH)

For every CHECK / UNIQUE / FK / regex constraint, test BOTH directions — a violating insert is rejected AND a valid insert is accepted. Positive-only → flag.

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

Author the negative test(s) BEFORE the constraint regex / index expression — that's what proves the constraint is doing work. **False-positive guard:** a NOT NULL or type constraint enforced by the column definition itself doesn't need a hand-written negative test; reserve this for CHECK / UNIQUE / FK / regex semantics.

### Data ≠ schema migrations (MEDIUM)

- A single migration mixing a schema change (`ALTER TABLE`) and a large data backfill (`UPDATE …`) → flag; split so the schema change can be applied/reverted independently of the slow backfill.
- A data backfill that isn't idempotent (re-running it double-applies or errors) → flag. Backfills must be re-runnable (`WHERE col IS NULL`, `INSERT … ON CONFLICT DO NOTHING`). **False-positive guard:** a small in-revision backfill of a freshly-added NOT NULL column, guarded by the column not yet existing, is fine.

### `migrate` runs before the app (HIGH)

- Migration runs inside the backend image's entrypoint (`alembic upgrade head` / `prisma migrate deploy` chained into the app start) → flag; the app accepts traffic against a stale schema and N replicas race.
- Migration runs in a framework `startup` hook (FastAPI `startup`, Spring `ApplicationRunner` doing `flyway.migrate()` in-process) → flag (same problem).
- Correct shape: `migrate` is a dedicated compose service running once before the app starts, same image with a different `command:` (the tool's apply step). See `templates/compose-migrate.yaml`.

### Irreversible migrations (MEDIUM)

- Migration drops a column with data and has no documentation in the revision body → flag.
- `downgrade`/`down` of an irreversible migration silently passes instead of failing loudly → flag.
- Recommended shape: fail loudly (`raise NotImplementedError("irreversible: data loss")`) + skip the round-trip test with a reason.

## Per-tool idiom map

| Tool (stack) | Generate | Round-trip / test | Audit notes |
|---|---|---|---|
| **Alembic + pytest-alembic** (Python) | `alembic revision --autogenerate` | `migrate_up_one`/`migrate_down_one` + `inspect()` | Deep apparatus below. |
| **Prisma / Drizzle** (Node/TS) | `prisma migrate dev` / `drizzle-kit generate` | introspect after apply; `drizzle-kit check` for drift | Edited generated SQL without regenerating from schema → flag. |
| **Flyway / Liquibase** (JVM) | *migration-first* | `migrate`/`update` + `rollback`; JDBC metadata | No model to generate from → require schema baseline + drift check (see Code-first). |
| **golang-migrate / Atlas** (Go) | golang-migrate paired `*.up.sql`/`*.down.sql`; Atlas `migrate diff` | `up`/`down`; Atlas `migrate lint` | Missing/empty `*.down.sql` → round-trip fail. Plain golang-migrate is migration-first → drift check. |
| **sqlx / SeaORM** (Rust) | sqlx hand-authored; SeaORM `migrate generate` | `sqlx migrate run/revert`; `Migrator::up/down` | SeaORM `up`/`down` must mirror; assert artifacts via introspection. |

## Alembic (deep default — Python)

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

### Post-state assertions by name — worked example

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

### ORM ↔ migration name parity — worked example

```python
# BAD — anonymous constraint on model; migration creates `uq_users_email`; reflection sees both
__table_args__ = (UniqueConstraint("email"),)

# GOOD — explicit name matching the migration
__table_args__ = (UniqueConstraint("email", name="uq_users_email"),)
```

### `conftest.py` pre-warming (HIGH)

- `tests/conftest.py` issues `CREATE EXTENSION IF NOT EXISTS <name>` on the shared test DB → flag.
- The migration's upgrade must own the extension lifecycle; conftest pre-warming masks a forgotten extension install.
- Exception: a non-migration test that needs an extension before the migration runs installs it in its own fixture scope and tears it down — never session-scope.

### Test isolation (MEDIUM)

- `migrate_up_to("head")` without matching `migrate_down_to("base")` or transactional fixture → flag (DB stays dirty for next test).
- Shared session-scope DB without rollback → flag.

## Runtime DB audit

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

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/compose-migrate.yaml` | `migrate` service shape (one-shot container, depends-on edits for backend). |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
