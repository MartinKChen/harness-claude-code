---
name: pattern-engineer-database
description: "Ship migrations safely across stacks. Models/schema are the source of truth; migrations are generated, chain to head, round-trip (up→down→up), assert post-state by name, run in a `migrate` step before the app. Per-tool: Alembic + pytest-alembic (deep), Prisma/Drizzle, Flyway/Liquibase, golang-migrate/Atlas, sqlx/SeaORM. Plus runtime DB: FK + RLS indexing, cursor pagination, `SKIP LOCKED`. Activate on `alembic/versions/`, `prisma/schema.prisma`, `*.sql` migration dirs, the `migrate` service."
---

# pattern-engineer-database

## When to activate

Activate when writing or running a database migration in any tool — Alembic revisions (`alembic/versions/*.py`), Prisma (`prisma/schema.prisma`, `prisma/migrations/`), Drizzle (`drizzle/`, `drizzle.config.ts`), Flyway/Liquibase (`db/migration/*.sql`, `changelog.xml`), golang-migrate/Atlas (`migrations/*.sql`, `atlas.hcl`), sqlx (`migrations/*.sql`)/SeaORM (`migration/`) — setting up migration tests (`pytest-alembic` et al.), adding the `migrate` service to `compose.yaml`, or designing schema/indexes/queries (column types, FK indexes, RLS, pagination, locking). Skip for migration-unrelated app logic.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-database.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Contract source

The schema contract lives at `docs/data-model/<entity>.yaml` — it decides entities, columns, types, constraints, and indexes. This skill never redecides it; it is HOW you turn that contract into migrations + schema in your tool. The naming convention below (`pk_*`, `fk_*`, `uq_*`, `idx_*`, `ck_*`, `vw_*`) is the cross-tool target every migration asserts against.

## Migration core (tool-neutral)

Same rules whichever migration tool you use; the per-tool idioms below give the spelling.

- **Code-first.** Models / schema definitions are the source of truth; migrations are *generated* from a model diff, never hand-written DDL-first. Edit the model, generate the migration, review it, commit model + migration together. (Migration-first tools — Flyway/Liquibase — map this to "schema source of truth + drift check"; see the idiom map.)
- **Chain to head.** Every new migration links to the current head; never create a forked / parallel head. Resolve divergence before committing.
- **Round-trip tested.** `upgrade → downgrade → upgrade` passes; downgrade *actually reverts* — named artifacts dropped, extensions cleaned up, no leftover tables/columns.
- **Post-state by name.** Assert the migration created exactly the named artifacts (table / column / constraint / index names), not merely "the migration ran without error."
- **Model ↔ migration name parity.** The migration creates exactly what the model declares — same names. Pass explicit names on the model side so reflection sees one artifact, not two.
- **Constraints tested both directions.** Every CHECK / UNIQUE / FK / regex: a violating insert is rejected AND a valid insert is accepted. Author the negative test before the constraint.
- **`migrate` runs before the app.** Migrations run as a dedicated migrate step/service (the compose `migrate` service) that completes before the app starts — never inside the app image's entrypoint or a framework `startup` hook.
- **Data ≠ schema.** Keep data migrations separate from schema migrations; any data backfill is idempotent and re-runnable (safe to apply twice).
- **Irreversible migrations** (e.g. dropping a column with data): document it in the revision body, make `downgrade` fail loudly rather than silently pass, and mark the round-trip test skipped with a reason.

## Per-tool idiom map

| Tool (stack) | Generate from models | Round-trip / test | Notes |
|---|---|---|---|
| **Alembic + pytest-alembic** (Python) | `alembic revision --autogenerate -m "<msg>"` | `pytest-alembic` (`migrate_up_one`/`migrate_down_one`) + `inspect()` name assertions | The deep default — see the Alembic section below for full mechanics. |
| **Prisma Migrate / Drizzle Kit** (Node/TS) | `prisma migrate dev` from `schema.prisma`; `drizzle-kit generate` from the schema | apply to a throwaway DB, assert via `prisma db pull` / introspection; Drizzle `drizzle-kit check` for drift | `schema.prisma` / Drizzle schema *is* the model; never edit generated SQL by hand without regenerating. |
| **Flyway / Liquibase** (JVM) | *Migration-first*: SQL/changelog is hand-authored | Flyway `migrate` then `info`; Liquibase `update`/`rollback`; assert via JDBC metadata | "Generated from models" maps to **schema source of truth + drift check** — keep a checked-in schema baseline and run a drift check (Flyway `validate`, Liquibase `diff`, or Atlas against the JPA/entity schema). |
| **golang-migrate / Atlas** (Go) | golang-migrate: paired `*.up.sql`/`*.down.sql`; Atlas `migrate diff` from the desired schema/HCL | golang-migrate `up`/`down` round-trip in a test DB; Atlas `migrate lint` + apply | Atlas can generate from a declared schema (code-first); plain golang-migrate is migration-first — add a drift check. |
| **sqlx migrate / SeaORM** (Rust) | sqlx: hand-authored `migrations/*.sql`; SeaORM: `sea-orm-cli migrate generate` + entity gen | `sqlx migrate run`/`revert` round-trip; SeaORM `Migrator::up`/`down` in a test | SeaORM migrations carry explicit `up`/`down`; assert artifacts via the connection's schema introspection. |

## Alembic (deep default — Python)

### Code-first

- ORM model is the single source of truth. Migrations are derived artifacts.
- Edit the model first; run `alembic revision --autogenerate -m "<short imperative>"`.
- Always review the autogenerated migration. It misses server defaults, check constraints, type changes, and data migrations.
- Never edit the DB schema directly (no `psql ALTER TABLE`) and backfill the model after — that produces drift.
- Commit model + migration in the same commit.

### Migration testing — `pytest-alembic`, non-negotiable

What a *complete* migration test asserts (both directions, artifacts by exact name, negative-direction CHECKs, extension removal) is owned by `pattern-test-coverage` §3 — write to that bar. The authoring mechanics on top of it:

- **ORM model ↔ migration name parity.** `__table_args__ = (UniqueConstraint("email", name="uq_users_email"),)` — pass `name=` explicitly on the model side, matching the migration (`pk_<table>`, `fk_<table>_<col>`, `uq_<table>_<col>`, `idx_<table>_<col>`, `ck_<table>_<rule>`).
- **Don't pre-create extensions in `conftest.py` that the migration is supposed to install.** Migration owns extension lifecycle (`CREATE EXTENSION` in upgrade, `DROP EXTENSION IF EXISTS` in downgrade).
- **Every migration test owns its teardown.** Use `pytest-alembic`'s transactional fixture or an explicit `migrate_down_to("base")` so each test starts from a known baseline.
- **Irreversible migrations** (e.g. dropping a column with data): document in the revision body, `raise NotImplementedError("irreversible: data loss")` in `downgrade()`, mark the roundtrip test `@pytest.mark.skip(reason="irreversible — see <revision>")`.

### Alembic CLI

| Command | When |
|---------|------|
| `alembic revision --autogenerate -m "<msg>"` | Schema change driven by a model edit. |
| `alembic revision -m "<msg>"` | Manual migration (data migration, custom DDL). |
| `alembic upgrade head` | Apply all pending migrations. |
| `alembic current` | Print the DB's current revision (use to confirm state). |
| `alembic downgrade -1` | Undo the most recent migration. |
| `alembic downgrade <revision>` | Go to a specific revision. |
| `alembic downgrade base` | Undo every migration — DESTRUCTIVE; confirm first. |

## Schema design (PostgreSQL)

- `bigint` for surrogate IDs (not `int`); `text` for strings (not `varchar(255)` without a real reason); `timestamptz` for timestamps (never `timestamp` without TZ); `numeric` for money; `boolean` for flags.
- Identifiers in `lowercase_snake_case` — no quoted mixed-case names.
- Every FK declared with `ON DELETE` (`CASCADE` / `SET NULL` / `RESTRICT`) and `ON UPDATE` policy chosen explicitly.
- UUIDs as PKs: prefer UUIDv7 (time-ordered) over random v4 to keep B-tree inserts clustered; or use `IDENTITY` / `bigserial`.

## Indexing

- Always index foreign-key columns — the parent-side cascade and joins scan otherwise.
- Index every column referenced in an RLS policy's `USING` / `WITH CHECK` clause; an un-indexed `auth.uid()` lookup serializes the table.
- Composite indexes: equality columns first, then range columns (`(user_id, created_at)` for `WHERE user_id = … AND created_at > …`).
- Partial indexes for soft-deletes: `CREATE INDEX … WHERE deleted_at IS NULL` keeps the live-row index small and fast.
- Covering indexes (`INCLUDE (col, col)`) when a hot lookup wants to skip the table heap entirely.

## Row-Level Security (multi-tenant tables)

- Enable RLS on every table that holds tenant-scoped or user-scoped rows.
- Policies use `(SELECT auth.uid())` — the subquery form runs once per statement; bare `auth.uid()` runs once per row.
- Default deny: explicit `USING` for SELECT, explicit `WITH CHECK` for INSERT/UPDATE.
- Application service-role bypass is opt-in via a separate role; never `GRANT ALL` to the app user.

## Query patterns

- Project specific columns; never `SELECT *` on user-facing reads. `SELECT *` is fine in ad-hoc REPL / migration scripts.
- Cursor pagination (`WHERE id > $last_seen ORDER BY id LIMIT 50`) over `OFFSET` on tables that will exceed ~10k rows — `OFFSET` re-scans every prior row.
- Worker queues use `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` so concurrent workers don't block each other.
- Lock acquisition order is fixed (e.g. `ORDER BY id FOR UPDATE`) to avoid deadlocks on concurrent multi-row updates.
- Batch inserts use multi-row `INSERT` or `COPY`; one INSERT per loop iteration is an N-trips antipattern.
- Verify a new join / non-PK-filter / list-endpoint query with `EXPLAIN (ANALYZE, BUFFERS)` — a `Seq Scan` on a growing table means a missing index.

## Transaction discipline

- Transactions stay short: do the DB work and commit. No external HTTP / queue / email calls while a transaction is open — those hold row locks for whatever the network does.
- Avoid `SERIALIZABLE` unless you've measured the contention cost; `READ COMMITTED` + an atomic conditional update (`UPDATE … WHERE balance >= :a`) is usually enough.

## `migrate` compose service

- Migrations run in a **dedicated `migrate` sibling container** before the backend starts. Never in the backend image's entrypoint or a framework `startup` hook.
- The first migration in a project adds the `migrate` service to `compose.yaml` (commit: `chore(docker): add migrate service to compose`).
- Properties: loud failures (`migrate` exits non-zero → `backend` never starts), one-shot concurrency (no N-replica race), same image (different `command:`), backend stays a worker.
- The migrate `command:` is the tool's apply step (`alembic upgrade head` · `prisma migrate deploy` · `flyway migrate` · `migrate -path … up` · `sqlx migrate run`).
- See `templates/compose-migrate.yaml`.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/compose-migrate.yaml` | The `migrate` service + `depends_on` edits for `backend`. Copy verbatim and resolve `${PRODUCT}` / `<DB_NAME>` / `<DB_USER>` to the worktree's values. |
