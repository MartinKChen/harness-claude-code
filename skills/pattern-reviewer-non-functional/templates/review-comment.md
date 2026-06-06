# Code Review

<!--
  Non-functional findings are folded into the same `# Code Review` / `# Slice Review` comment that
  carries the other quality dimensions. The dispatching reviewer composes the final comment — this
  template only shows the **finding rows** this skill emits.

  Severity rule (the load-bearing part):
  - HIGH (blocks) ONLY when the gap maps to a declared non-functional AC on a touched surface.
  - Every thin-floor gap with no NFR AC is MEDIUM (Deferred) or LOW (Nit) — NEVER HIGH.
  A slice with no NFR ACs therefore receives only advice from this lens; it is never blocked here.
-->

## Findings

### [HIGH] AC4 not met — search endpoint has no test proving the declared p95 budget
**File:** `services/search/api.py:48`
**Maps to:** AC4 — "search SHALL return within 200 ms p95"
**Impact:** The declared latency budget is unproven and the predicate is unindexed; a regression past 200 ms ships silently.
**Fix:** Add the `documents(tenant_id, created_at)` index the access pattern needs and a test that drives a representative dataset and asserts the p95 budget (pin the threshold in one place).

### [MEDIUM] unbounded-read — list endpoint selects with no LIMIT or pagination
**File:** `services/orders/list.py:31`
**Maps to:** thin floor (no NFR AC declares this — advisory)
**Impact:** Returns the entire table; latency and memory grow linearly with order count and degrade as the table grows.
**Fix:** Add a `LIMIT` + cursor pagination, mirroring `services/invoices/list.py`. Advisory — does not block this slice.

### [MEDIUM] missing-timeout — outbound calls share a client with no timeout
**File:** `services/notify/client.py:12` (and `services/billing/client.py:9`)
**Maps to:** thin floor (no NFR AC declares this — advisory)
**Impact:** A stalled dependency pins the calling worker indefinitely; one slow upstream can exhaust the pool.
**Fix:** Set an explicit timeout on the shared HTTP client (one finding covers both sites).

### [LOW] event-loop-block — sync `requests.get` inside an async handler
**File:** `services/webhooks/handler.py:27`
**Maps to:** thin floor (no NFR AC declares this — advisory, minor)
**Impact:** Blocks the event loop for the duration of the call, serializing otherwise-concurrent requests.
**Fix:** Use the async client (`httpx.AsyncClient`) or offload to a thread.

<!--
  Comment-shape conventions enforced by pattern-reviewer-non-functional:
  - HIGH is reserved for a declared-NFR-AC gap on a touched surface; everything else is MEDIUM/LOW.
  - Every finding cites file:line AND a maps-to handle: an `ACn` label (blocker) or a floor-rule name (advice).
  - Floor-rule handles: unbounded-read, n-plus-one, missing-timeout, event-loop-block, missing-index,
    unbounded-memory, missing-pagination, unwindowed-list, unbounded-pool.
  - Consolidate repeats — five handlers missing a timeout is one finding listing all five.
  - Never refer to a finding as `#N` (N a number) — GitHub auto-links it to an issue. Use the AC label,
    the floor-rule name, the quoted title, or `F1` / `F2`.
  - This skill never sets the verdict line — the dispatching reviewer owns APPROVE / BLOCK.
-->
