---
name: pattern-engineer-non-functional
description: "Engineer-facing non-functional guardrails to follow while writing or editing production code — the quality characteristics behind the happy path: performance efficiency (bounded queries, no N+1, paginated lists, indexed hot predicates), resource bounds (request-body + upload caps, no whole-table-into-memory, connection-pool limits, no event-loop-blocking sync calls in async paths), scalability (stateless handlers, idempotent at-least-once consumers), and reliability (timeouts on every outbound call, retry-with-backoff on transient faults, graceful SIGTERM drain, /healthz + /readyz). Encodes a thin ALWAYS-build-in floor (the bounds that are really latent correctness bugs) plus the heavier targets that only a declared non-functional acceptance criterion (a p95 latency, a throughput, a capacity, an availability/recovery clause) pulls into scope. Security is OUT of scope (see pattern-engineer-security); query/timeout mechanics are shared with pattern-engineer-backend-standard. Activate when writing code."
---

# pattern-engineer-non-functional

Non-functional guardrails for production-code authoring — the ISO-25010 / ISTQB quality characteristics (performance efficiency, reliability, scalability, resource utilization) that the functional happy path never exercises. Like the other engineer pattern skills, this is a quiet reference catalogue: the agent reads it to know which bounds to build in, *not* a checklist to walk through with the user. Reviewer feedback (`pattern-reviewer-non-functional`) is the user-facing channel; this skill exists so most findings never happen.

> **This skill is spec-gated by design.** Most projects that install the plugin are early-stage and declare *no* non-functional acceptance criteria — and that is fine. You always build in the **thin floor** below (the bounds that are latent correctness bugs the moment real data arrives), but you do NOT speculatively add load tests, caching layers, or capacity engineering for a requirement the slice never stated. The heavier targets are pulled into scope only when the slice body declares a non-functional AC (a latency / throughput / capacity / availability clause). Build to the spec — no more, no less.

## When to activate

- Writing or editing production code that: issues a DB query, serves a list/collection endpoint, accepts a request body or file upload, makes an outbound HTTP/DB call, runs inside an async handler, processes a queue/worker message, renders a large collection in the UI, or implements a behavior whose slice declares a performance / capacity / availability acceptance criterion.
- Do NOT activate for purely cosmetic changes, internal renames, comment edits, or conceptual questions that don't touch code.
- **Not the security catalogue** — secrets, authz, input validation, SSRF, rate-limit-as-abuse-control live in `pattern-engineer-security`. (A rate limit declared as a *capacity* control belongs here; the same limit declared as an *abuse* control belongs there — they often coincide.)

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-engineer-non-functional.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## The thin floor — always build these in (no declared AC required)

These are not "performance polish"; they are bounds whose absence is a latent correctness/availability bug that surfaces the instant the table grows past your seed data or a dependency stalls. Build them in on every applicable surface, even on a day-one prototype. (Several overlap `pattern-engineer-backend-standard` — that is deliberate; this skill frames them as the resource/reliability floor and is the catalogue the non-functional review gates the *advisory* tier against.)

- **Bound every user-facing read.** A list/collection query has a `LIMIT` (and a stable `ORDER BY` for pagination). Never `SELECT *` an unbounded table into memory and slice in Python/JS.
- **No N+1.** A loop that issues one query per row is a single `JOIN` / `IN (...)` / `selectinload`. Fetch the set, not the elements.
- **Index the hot predicate.** A column you filter or order by on a user-facing path gets an index in the same migration that introduces the access pattern — don't ship a sequential scan on a growing table.
- **Cap the inputs.** Set a max request-body size and a max upload size at the edge. Bound array/string lengths in the boundary schema (this is also a validation concern — do it once, at the boundary).
- **Timeout every outbound call.** Every server-side `fetch` / HTTP client / DB statement carries an explicit timeout. A dependency that hangs must fail your request, not pin a worker forever.
- **Never block the event loop.** In an async handler, no synchronous CPU-bound or blocking-IO call (sync `requests`, `time.sleep`, a heavy sync hash, blocking file IO) — use the async client or offload to a thread/worker.
- **Bound the pools.** Connection pools (DB, HTTP) have explicit max sizes; a request that can't get a connection fails fast rather than queueing unboundedly.
- **Don't accumulate unboundedly in memory.** Stream / paginate / batch when processing a set whose size scales with usage; no per-request cache that grows without eviction.
- **Virtualize or paginate large UI lists.** A rendered collection that can grow with data is paginated or windowed, not a single map over thousands of nodes.

## Spec-gated targets — build these only when the slice declares the matching AC

When (and only when) the slice body's `## Acceptance criteria` declares a non-functional clause, implement and prove it. Match the build to the clause; do not infer a target the issue never wrote.

| Declared AC shape | What to build in | How it's proven (engineer authors the test) |
| --- | --- | --- |
| **Latency** ("p95 < 200 ms", "responds within Xs") | the efficient path that meets it (bounded query + index + no N+1); avoid per-request recomputation | a test that measures the operation and asserts the budget, pinned in one place (no docstring/assertion drift) |
| **Throughput / capacity** ("N req/s", "handles M concurrent", "N rows") | statelessness so it scales horizontally; back-pressure (429 + `Retry-After`) at the declared ceiling | a load/concurrency test that drives the stated level and asserts it holds (no errors, no lost updates) |
| **Availability / recovery** ("degrades gracefully", "retries transient failures", "drains on shutdown") | retry-with-backoff + jitter on transient faults; circuit-breaker/fallback where named; graceful SIGTERM that drains in-flight work; `/healthz` + `/readyz` | a test that injects the fault (dependency 5xx/timeout) and asserts the retry/fallback/drain behavior |
| **Resource ceiling** ("≤ X MB", "payload ≤ Y") | the enforced bound at the boundary; reject past it with the declared status | a test asserting the bound rejects past the ceiling and accepts at it (off-by-one) |
| **Frontend budget** ("LCP < Xs", "bundle ≤ Y KB") | code-split / lazy-load route boundaries; avoid shipping heavy deps eagerly | the budget assertion in the build/CI (bundle-size check) or a Lighthouse/web-vitals gate |

## Never do

- Ship a user-facing list endpoint with no `LIMIT` / pagination because "there's not much data yet" — the bound is cheapest to add now.
- Issue queries inside a row loop (N+1) where a set-based query is available.
- Make a server-side outbound call (HTTP or DB) with no timeout.
- Call blocking/sync IO or CPU-bound work directly inside an async request handler.
- Add a speculative cache, queue, read-replica, or load-shedding layer for a scale the slice never declared — that is the YAGNI trap this skill explicitly warns against. Build the floor; defer the rest until an AC asks.
- Re-target a number the issue didn't state (inventing "p95 < 100 ms" because it "feels right"). If there is no non-functional AC, there is no non-functional target beyond the floor.
- Disable a declared timeout / pool bound / back-pressure to make a slow path "work" — fix the slow path.

## Guardrails — internal warning signs while authoring

If one of these is forming under the keyboard, re-shape against the floor above before committing — don't surface to the user, just fix it:

- A `for`/`map` body that issues a query or an HTTP call.
- A list/collection handler whose query has no `LIMIT` and no pagination cursor.
- A `fetch(...)` / `httpx`/`requests` / DB `execute` with no `timeout=` / `AbortSignal.timeout(...)`.
- `requests.get(...)`, `time.sleep(...)`, a sync file read, or a heavy sync compute inside an `async def` handler.
- Loading an entire table/collection into a list before filtering or counting.
- A new filter/sort column on a growing table with no accompanying index.
- A React component mapping over a prop array that can scale with data, with no windowing/pagination.
- A worker/consumer that is not idempotent on redelivery (at-least-once delivery will double-apply).

## Common rationalizations to push past

| Rationalization | Reality |
| --- | --- |
| "It's fast enough with our test data" | Test data is 10 rows; production is 10 million. The bound is invisible until it isn't, and retrofitting pagination touches every caller. |
| "We'll add the index later" | "Later" is a 3am page when the sequential scan finally tips over. Indexing the hot predicate in the introducing migration is free. |
| "The dependency never hangs" | Until it does — and without a timeout one stalled dependency takes every worker with it. |
| "We don't have scale requirements yet" | You don't need *capacity engineering* yet — but the floor (bounds, timeouts, no N+1) is correctness, not capacity. Build it regardless. |
| "Async makes it non-blocking automatically" | Only if every call inside it is actually async. One sync call in an async handler blocks the whole event loop. |
