---
name: pattern-reviewer-contract
description: "Contract-conformance audit. Every implemented API endpoint matches its api contract at `docs/api-contract/<entity>.yaml` — path (with trailing-slash spelling), HTTP verb, request body schema, response body schema, status codes per outcome, error envelope shape, Idempotency-Key policy, rate-limit budget + headers. Every implemented ORM model matches its data-model contract at `docs/data-model/<entity>.yaml` — table name, columns (name / type / nullability / default), constraint names (`pk_*`, `fk_*`, `uq_*`, `idx_*`, `ck_*`), relationships and cardinality. Cites both the implementation `file:line` and the contract `file:line`. Activate when the diff includes API routes or ORM models AND a sibling contract file exists."
---

# pattern-reviewer-contract

Contract-conformance audit. The api contract (`docs/api-contract/<entity>.yaml`) and data-model contract (`docs/data-model/<entity>.yaml`) are the source of truth for endpoint shape and model shape; this skill verifies the implementation matches the contract verbatim. Implementation best practices that aren't in the contract are out of scope here.

## When to activate

- The dispatched caller is reviewing a `type:backend` task whose touched paths include API route handlers OR ORM model files.
- The corresponding contract file(s) exist in the worktree under `docs/api-contract/` and/or `docs/data-model/`.
- A user says "review the endpoints against the contract", "did we honor the api spec", "does the model match the data contract".

Do NOT activate when:

- The diff has no API routes and no ORM model changes.
- The project has no `docs/api-contract/` or `docs/data-model/` directory (no contracts to compare against — surface the absence to the user rather than inventing a verdict).

## Resolving the contract files

The contracts are project-level, not feature-scoped. For each entity the diff touches:

- **API endpoint** at `<router-or-handler>.py` / `<router>.ts` → read `docs/api-contract/<entity>.yaml` for the path + verb + body / status / envelope decisions.
- **ORM model** at `models/<entity>.py` / `prisma/schema.prisma` → read `docs/data-model/<entity>.yaml` for the table + columns + constraint decisions.

If a touched implementation has no matching contract file, that itself is a finding — the contract is owed by the architect; flag and halt the audit for that entity.

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite both sides.** Every finding cites the implementation `file:line` AND the contract `file:line`, and quotes the exact contract clause being violated. "Contract says X; code does Y" is the finding shape.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).
- **Contract wins.** If the implementation disagrees with the contract, the contract is right — even when the implementation "makes more sense." If the contract is genuinely wrong, the engineer halts and surfaces; do not approve a deviation from the contract.

## Patterns to review

### API contract conformance

For every endpoint declared in the contract whose handler is in the diff, walk these checks:

#### Path + verb (HIGH)

- Implementation path matches the contract verbatim, **including trailing-slash spelling**.
- HTTP verb (`GET` / `POST` / `PUT` / `PATCH` / `DELETE`) matches.
- Path uses the same parameter style and parameter names as the contract (`{order_id}` not `{orderId}` if the contract is snake_case).

```python
# Contract (docs/api-contract/orders.yaml):
#   POST /v1/orders            → 201
#   GET  /v1/orders/{order_id} → 200 | 404

# BAD — wrong path; framework default redirect masks the bug locally
@router.post("/orders")
def create_order(...): ...

# GOOD — matches contract verbatim
@router.post("/v1/orders", status_code=201)
def create_order(...): ...
```

#### Status codes (HIGH)

- Every outcome the contract declares has the contracted status code in the implementation.
- Validation failure → contracted 4xx (not 5xx or a different 4xx).
- Conflict (e.g., already exists) → contracted 409 (not 422 or 400).
- Success with body → contracted 200 / 201 (not 204).
- Success without body → contracted 204 (not 200 with `{}`).
- `429` returned on rate-limit exhaustion per contract.

#### Request body schema (HIGH)

- Every required field in the contract is required in the Pydantic / Zod schema.
- Field names match (snake_case in code if the contract is snake_case).
- Field types match (`int` vs `string`, `email` vs `string`, etc.).
- Constraints match: `max_length`, `min_length`, `ge`, `le`, enum values.
- Optional fields are optional in the schema (not silently required).

#### Response body schema (HIGH)

- Field names + types match the contract response.
- Sensitive fields the contract does NOT declare are absent from the serialized response (stripped at the serializer).
- Default field set matches the contract; sparse-fieldset support (if contract declares it) is wired.
- List endpoints return the contracted pagination envelope shape (e.g., `{ data: [...], pagination: { page, per_page, total, total_pages } }`).

#### Error envelope shape (HIGH)

- Every 4xx / 5xx body matches the contracted envelope shape, e.g., `{ error: { code, message, request_id } }`.
- `code` values match the contract's enumerated `code`s for this endpoint (no inventing `code: "weird_thing"`).
- `message` is human-readable and doesn't leak internals; specifics (which field failed validation) go in `details` if the contract has that slot.

#### Idempotency-Key (HIGH)

- Contract says `Idempotency-Key: required` for the endpoint → implementation reads the header, stores `(key, response)` for the contracted TTL (typically ≥24h), replays the response on retry, returns 400 when the header is missing.
- Contract says `Idempotency-Key: supported` → implementation does the same on present-key, no-ops on missing-key.
- Contract says `Idempotency-Key: not applicable` → endpoint either ignores the header or does not declare it.

#### Rate-limit headers (MEDIUM)

- Contract declares a rate-limit budget → implementation emits the contracted headers on every response (`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`).
- 429 responses include `Retry-After`.
- Identity-key follows the contract's priority (API key → user → IP).

#### Concurrency / ETag (MEDIUM)

- Contract declares `If-Match` support → implementation accepts the header on PATCH/PUT, responds 412 on mismatch, emits `ETag` on responses.

#### Versioning + deprecation (LOW)

- Contract declares a version (`/v1/...`) → implementation mounts under the contracted version prefix.
- Contract declares a deprecation date → implementation emits the `Deprecation` response header (and a sunset note in logs).

### Data-model contract conformance

For every entity declared in the data-model contract whose ORM model / migration is in the diff, walk these checks:

#### Table name (HIGH)

- Migration creates the contracted table name (`__tablename__` / `op.create_table` arg).
- Plural-noun convention if the contract uses that (e.g., `users`, not `user`).

#### Columns (HIGH)

- Every column in the contract exists in the model + migration with:
  - Contracted name (snake_case).
  - Contracted type (`Integer`, `String(120)`, `Date`, `DateTime(tz=True)`, `Numeric(precision, scale)`, etc.).
  - Contracted nullability (`nullable=False` if the contract says required).
  - Contracted default (server-side `server_default=` if the contract specifies a DB-level default; Python-side `default=` only when contract says so).

#### Constraints (HIGH)

For every constraint in the contract:

- **Primary key** named `pk_<table>`.
- **Foreign keys** named `fk_<table>_<column>` and pointing at the contracted target column.
- **Unique constraints** named `uq_<table>_<col>` (or `uq_<table>_<col1>_<col2>` for compound).
- **Indexes** named `idx_<table>_<col>` for the contracted columns.
- **Check constraints** named `ck_<table>_<rule>` with the contracted SQL expression.

Both the ORM model (`__table_args__ = (UniqueConstraint(..., name="uq_users_email"),)`) AND the migration (`op.create_unique_constraint("uq_users_email", "users", ["email"])`) must carry the contracted name — verify parity name-by-name.

#### Relationships + cardinality (HIGH)

- The contract declares a `1:N` relationship → migration has the FK on the N-side; ORM has the matching `relationship(...)` and `back_populates=`.
- The contract declares `N:M` → migration ships the join table with the contracted name; ORM has the matching `secondary=` relationship.
- Cascade behavior (`ondelete="CASCADE"` / `RESTRICT` / `SET NULL`) matches the contract.

#### Enums + check expressions (HIGH)

- Contract declares an enum (e.g., `status ∈ {open, pending, closed}`) → migration uses a `CheckConstraint` (or the DB's native `ENUM` type) with the contracted values; flag any drift, missing value, or extra value.

## Constructing the finding

```markdown
### [SEVERITY] <one-line title — no leading `#N`>
**Implementation:** `path/to/route.py:42`
**Contract:** `docs/api-contract/<entity>.yaml:<line>`
**Contract clause:** "<quote the exact clause>"
**Implementation does:** <one or two sentences>
**Fix:** <align the implementation to the contract — quote what should change>

```<lang>
// BAD — what the implementation has now
<snippet>
```

```<lang>
// GOOD — what the contract requires
<snippet>
```
```

- `[SEVERITY]` is per the rule above (mostly HIGH for body / status / envelope; MEDIUM for rate-limit headers / concurrency; LOW for deprecation cosmetics).
- Cross-references in the same comment use the entity name (`Endpoint POST /v1/orders`, `Model orders`), the quoted finding title, or `F1` / `F2`.

Hand the collected findings back to the dispatching `reviewer` agent — it owns the comment composition, severity counts, verdict line, scope note, posting.
