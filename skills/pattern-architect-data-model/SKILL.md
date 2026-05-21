---
name: pattern-architect-data-model
description: "Data-model shape and naming guidance: tables, columns, indexes, constraints, views, and the SQLAlchemy `MetaData` naming convention that emits predictable names. Activate when designing or reviewing a new table, model, or schema, or when asked 'how should I name this table/column/index/constraint?'. Skip for application-level query logic that doesn't change schema, and for code-first / migration / `migrate` compose / `alembic` mechanics."
---

# pattern-architect-data-model

Standardize how we *design* data models: the *shape* of every entity — what gets named what, which columns it carries, how its constraints/indexes/views are spelled — follows a predictable convention so reviewers and tools can navigate the schema without surprises.

## When to activate

Activate this skill whenever the user:

- designs a new table, model, or schema ("add a `users` table", "model the orders domain")
- adds, renames, or drops a column, index, or constraint
- edits ORM model files (`models.py`, `models/*.py`, SQLAlchemy `Base` subclasses, Django models)
- asks "how should I name this table/column/index/constraint?"
- proposes a new entity at architecture-discovery time and is deciding its column shape and relationships

## Pattern

### Naming conventions

**Tables** — plural nouns, snake_case:

```
✅ users, orders, order_items, audit_logs
❌ user, Order, OrderItem, AuditLog
```

**Columns** — descriptive snake_case nouns. Avoid single-letter or generic names:

```
✅ email, created_at, total_amount_cents, shipping_address_id
❌ e, ts, amt, addr_id, data, info
```

**Constraints, indexes, views** — prefix with the kind, then table, then columns:

| Kind | Prefix | Example |
|------|--------|---------|
| Primary Key | `pk_` | `pk_users` |
| Foreign Key | `fk_` | `fk_orders_user_id` |
| Index | `idx_` | `idx_orders_created_at` |
| Unique Constraint | `uq_` | `uq_users_email` |
| View | `vw_` | `vw_active_users` |
