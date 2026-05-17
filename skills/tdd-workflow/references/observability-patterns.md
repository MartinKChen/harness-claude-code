# observability-patterns

Enforce a single, stack-agnostic observability stance: **OpenTelemetry is the only instrumentation API**, and every running service emits the three signals — **metrics, logs, traces** — through it. Vendor SDKs (Datadog, New Relic, Sentry, Honeycomb, Splunk, Elastic) MAY only appear as **OTLP backends** behind the OTel Collector — never as app-level libraries in the code path. The point: one instrumentation surface in the source, swappable backends behind it.

## When to activate

Activate this skill whenever the user:

- adds, edits, or removes a log statement, span, metric, or trace-context propagation in any service
- scaffolds observability for a new service (SDK bootstrap, resource attributes, OTLP exporter, Collector config)
- builds or modifies a dashboard, alert, SLO, or runbook that consumes traces / metrics / logs
- writes or reviews a test that asserts on emitted spans, metric points, or structured log records
- wires (or removes) auto-instrumentation for an HTTP framework, DB driver, queue client, or external HTTP client
- debugs latency, error rates, saturation, or correlation between request traces and logs
- touches `OTEL_*` environment variables, an `OpenTelemetryCollector` config, sampler config, or batch-processor tuning
- reaches for `print` / `console.log` / `logger.info` to "see what's happening" in a service path

Do NOT activate when the user is only doing local one-off `print` debugging in a throwaway script, editing CLI tool output, or asking about pure log-aggregation tooling without touching the app code path.

## Iron rule — OpenTelemetry only

There is exactly one instrumentation API in this project: **OpenTelemetry**, accessed through the standard SDK for each language (`opentelemetry-sdk` in Python, `@opentelemetry/sdk-node` / `@opentelemetry/api` in TypeScript/Node, `go.opentelemetry.io/otel` in Go, `opentelemetry-java` in Java/Kotlin). All three signals — **traces, metrics, logs** — are produced through the OTel API and exported via **OTLP** (gRPC preferred, HTTP/protobuf as a fallback) to an **OpenTelemetry Collector** that owns batching, retries, sampling tail decisions, redaction processors, and the actual backend fan-out.

Concretely, this rule means:

- **No vendor SDKs in application code.** No `dd-trace`, `newrelic`, `@sentry/node`, `elastic-apm-node`, `splunk-otel`, etc. as direct imports. If a backend needs vendor-specific enrichment, do it in the Collector via a processor — not in `src/`.
- **No printf debugging in committed code.** `print` / `println!` / `console.log` / `fmt.Println` / `System.out.println` never lands in production paths. Use the OTel-emitting logger. `console.error` is the same rule.
- **No parallel logging stacks.** Pick one structured logger per language (`structlog` for Python, `pino` for Node, `slog` for Go, `Logback` for Java) and bridge it into the OTel logs SDK. Multiple loggers writing in parallel to multiple sinks is a smell — one logger, one sink (the OTel SDK), the Collector decides where it goes.
- **Auto-instrumentation is preferred for boilerplate.** HTTP servers (FastAPI / Express / Gin / Spring), DB drivers (SQLAlchemy / pg / database/sql / JDBC), queue clients (Kafka / Rabbit / Redis), and outbound HTTP clients (`requests` / `httpx` / `axios` / `node-fetch`) get their spans via the OTel **auto-instrumentation** package, not hand-rolled spans. Hand-roll only the spans your business logic owns.
- **All three signals share resource attributes.** `service.name`, `service.version`, `service.namespace`, `deployment.environment` are set **once** on the SDK resource at startup and inherited by every emitted span, metric, and log record. Setting `service.name` per signal is a bug.
- **Context propagation is W3C `traceparent` / `tracestate`.** Across HTTP, gRPC, and message queues. No vendor headers (`x-datadog-trace-id`, `x-b3-traceid`) in new code; if you must integrate with a legacy hop, add the propagator at the boundary, not throughout the codebase.

If a backend can't ingest OTLP, that's a Collector exporter problem, not an SDK problem. The application code does not change.

## Pattern

### 1. The three signals — when to reach for which

Every running service emits **all three**, but they answer different questions:

| Signal | Answers | Typical primitive | Stored as | Cardinality budget |
|--------|---------|--------------------|-----------|--------------------|
| **Traces** | "What happened in this request, end-to-end?" | Span | A tree of spans per trace | Per-trace; sample at ingest |
| **Metrics** | "What's the rate / latency / saturation right now, across all requests?" | Counter / Histogram / UpDownCounter / Gauge | Time series, one per label-set | Strictly bounded label-set cardinality |
| **Logs** | "What did the service say at this exact moment, with full context?" | LogRecord | Append-only stream, correlated by `trace_id`/`span_id` | Per-event; cheap to drop, expensive to keep all of |

Pick the cheapest signal that answers the question. A counter beats a log line for "did this happen?" A span beats a log line for "what was in flight when this happened?" A log line beats a span attribute when the payload is a long, human-targeted string.

**Emit-vs-gate model per signal — internalize this before touching instrumentation.** The instinct to "log everything at DEBUG and let downstream filter" is wrong *for logs*, right *for traces*, and N/A *for metrics*. The cost the Collector can drop is network + storage. The cost it can't drop is **serialization in the app** — every record gets formatted, attributes resolved, OTel objects allocated. On a hot path that work is real CPU you spent for records that get thrown away. So:

| Signal | App-side strategy | Collector-side strategy | Reason |
|--------|-------------------|--------------------------|--------|
| **Traces** | **Emit all** at 100% (`ParentBased(AlwaysOn)`) — no head-sampling in app code | **Tail-sample**: keep 100% of error / slow traces, sample successful traces at 1–10% | The Collector sees the whole trace before deciding, so it never drops the trace that contained the bug |
| **Metrics** | **Emit all** — no gating | No drop; metrics are already aggregates | A counter / histogram is pre-aggregated server-side; there's nothing to sample |
| **Logs** | **Gate at the source** with a configurable level (default `INFO` in prod) | Backstop redaction / drop only | Per-record serialization is the cost the Collector cannot offload; gating at source is the only way to avoid it |

The detailed rules for each signal live in sections 2, 3, and 4.

### 2. Traces — spans, attributes, errors

**a. Span naming.** Use the low-cardinality OTel semantic-convention name, never the URL with path parameters or the raw query string. The route template is the name; the actual values are attributes.

```python
# Bad — high cardinality, one time series per user id
with tracer.start_as_current_span(f"GET /users/{user_id}"):
    ...

# Good — span name is the route template; the id is an attribute
with tracer.start_as_current_span("GET /users/{user_id}") as span:
    span.set_attribute("user.id", user_id)
    span.set_attribute("http.route", "/users/{user_id}")
    span.set_attribute("http.method", "GET")
```

```ts
// Same rule in TypeScript
const span = tracer.startSpan("GET /users/:userId", {
  attributes: {
    "user.id": userId,
    "http.route": "/users/:userId",
    "http.method": "GET",
  },
});
```

**b. Use OTel semantic conventions for attribute names.** `http.method`, `http.route`, `http.status_code`, `db.system`, `db.statement`, `messaging.system`, `messaging.destination.name`, `rpc.service`, `rpc.method`, `exception.type`, `exception.message`, `exception.stacktrace`. Don't invent `httpMethod`, `dbSystem`, or `errorMsg` — the spec exists so dashboards and SLOs can be portable.

**c. Errors go on the span via `record_exception` + `set_status`.** Don't shove the stack trace into a free-text attribute; the SDK has a structured slot for it.

```python
from opentelemetry.trace import Status, StatusCode

with tracer.start_as_current_span("charge_card") as span:
    try:
        charge(card, amount)
    except PaymentError as exc:
        span.record_exception(exc)
        span.set_status(Status(StatusCode.ERROR, str(exc)))
        raise
```

```ts
import { SpanStatusCode } from "@opentelemetry/api";

try {
  await chargeCard(card, amount);
} catch (err) {
  span.recordException(err as Error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
  throw err;
}
```

**d. Sampling lives in the Collector, not the app.** Configure parent-based sampling at the SDK so child spans inherit the parent's sample decision; do real (tail-based) sampling decisions in the Collector's `tail_sampling` processor where the full trace is visible. App-level `TraceIdRatioBased(0.1)` is a fine *floor* for runaway load — not the actual sampling strategy.

**e. Propagation.** Use the W3C `tracecontext` propagator (the OTel SDK default in current versions). Across HTTP, gRPC, and messaging:

- HTTP server frameworks: handled by auto-instrumentation.
- HTTP clients: handled by auto-instrumentation when you use the standard client (`httpx`, `fetch`, `requests`, `axios`).
- Messaging (Kafka, SQS, RabbitMQ): the message producer injects context into headers via the OTel context API; the consumer extracts it on receipt. Auto-instrumentation handles common drivers; for in-house wrappers, do this by hand at exactly two points (produce, consume), not throughout the code.

### 3. Metrics — instrument types, naming, cardinality

**a. Pick the right instrument.**

| Instrument | When | Example |
|------------|------|---------|
| **Counter** | Monotonically increasing count (only goes up, resets on restart) | `http.server.requests` |
| **UpDownCounter** | Value that can go up or down | `queue.depth`, `db.client.connections.usage` |
| **Histogram** | Distribution of a value (latency, payload size) | `http.server.duration`, `db.client.operation.duration` |
| **Gauge (Observable)** | Sampled value read on collection | `process.memory.usage`, `runtime.gc.heap_size` |

Counters are not gauges. Histograms are not counters. A "request latency counter" is a category error and will produce a useless time series.

**b. Use semantic-convention names.** `http.server.duration`, `http.server.requests`, `http.server.response.size`, `db.client.operation.duration`, `messaging.publish.duration`, `process.runtime.gc.duration`. Custom metrics for business signals go under your service's namespace: `payments.charge.attempts`, `payments.charge.duration`. Lower-case dot-separated, never camelCase.

**c. Cardinality is a hard constraint.** Every distinct combination of label values is a new time series; storage scales linearly with cardinality. Hard rules:

- **Never** use `user.id`, `email`, `session.id`, `request.id`, raw URL with path params, or any unbounded value as a metric attribute.
- **Always** use the route template (`http.route = "/users/{user_id}"`), not the resolved URL.
- Bound enumerable labels (`http.status_code`, `db.system`, `payment.method`, `tenant.tier`) — if you can't list every possible value in advance, it doesn't belong on a metric.
- If you genuinely need the high-cardinality dimension, it belongs on a **span** (where one trace = one record) or a **log** (same), not on a metric.

**d. RED for request-driven services, USE for resources.** Encode both in your default dashboard:

- **RED**: **R**ate, **E**rrors, **D**uration — for every HTTP route, gRPC method, and queue consumer.
  - Rate: derive from `http.server.requests` counter.
  - Errors: filter the same counter by `http.status_code >= 500` (and explicitly track `4xx` separately — those are user errors, not service errors).
  - Duration: the `http.server.duration` histogram, with p50 / p95 / p99 plotted.
- **USE**: **U**tilization, **S**aturation, **E**rrors — for every resource the service depends on.
  - Utilization: CPU %, memory %, DB connection-pool %, queue worker concurrency %.
  - Saturation: queue depth, request-queue depth, GC pause duration.
  - Errors: connection-pool exhaustion, DB lock-wait timeouts, queue retries.

**e. Histograms need bucket boundaries.** The OTel SDK default buckets are tuned for HTTP-server-duration in seconds; for anything else (DB-operation duration in ms, message-payload size in bytes), pass explicit bucket boundaries that match the realistic range of your values, otherwise every observation collapses into one bucket and p95 is meaningless.

### 4. Logs — structured only, correlated to traces

**a. Structured JSON only.** Every log record is a key-value structure, not a `printf`-style string. The OTel logs API and the language-native structured logger (Python `structlog`, Node `pino`, Go `slog`, Java `logback-json`) both produce structured output; bridge the native logger into the OTel SDK so log records carry the active trace context automatically.

```python
import structlog
logger = structlog.get_logger()

# Bad
logger.info(f"User {user_id} charged {amount}")

# Good
logger.info("user.charged", user_id=user_id, amount=amount, currency="USD")
```

```ts
import { logger } from "@/lib/logger"; // pino instance wired to OTel logs bridge

// Bad
logger.info(`User ${userId} charged ${amount}`);

// Good
logger.info({ userId, amount, currency: "USD" }, "user.charged");
```

**b. Every log carries trace context.** When a request is in flight, the active `trace_id` and `span_id` are attached to the log record automatically by the OTel logs bridge. This is what lets you click a span in the trace UI and pull up all logs that fired during it. If your logger emits log lines without `trace_id` / `span_id` when there is an active span, the bridge is misconfigured — fix it before adding more logs.

**c. Levels mean specific things, and the threshold ships at INFO.**

| Level | Use | Production threshold |
|-------|-----|----------------------|
| `DEBUG` | Per-step diagnostics; never on in production except temporarily | Off |
| `INFO` | One line per significant business event: "user.charged", "subscription.cancelled", "job.started", "job.completed" | On |
| `WARNING` / `WARN` | Recoverable failure that the service handled; the operator should know but not be paged | On |
| `ERROR` | The request / job did not succeed and the user / caller saw a failure | On |
| `CRITICAL` / `FATAL` | The service is going down or is broken in a way it cannot recover from | On |

`INFO` is not "everything that happened" — it is "events the operator would want a record of, even with no incident." If you can't name the event, it's `DEBUG`.

**The level is configurable at the application; it is NOT "always DEBUG and let the Collector filter."** The serialization cost of every DEBUG record (formatting, attribute resolution, structured-JSON construction, OTel `LogRecord` allocation) is paid in the app before the Collector ever sees it — and the Collector can't refund that CPU. On any hot path, "DEBUG everywhere, filter downstream" doubles or triples the per-request log cost for records that get thrown away. It also widens the secret-leak blast radius: every DEBUG line that touches a token is a potential exfiltration vector the moment a redaction processor misconfigures.

**Operator escape hatch — make the level dynamically tunable, not just env-var-at-boot.** The reason operators reach for "DEBUG everywhere" is the pain of needing to redeploy during an incident. Fix the underlying problem:

- **Per-logger / per-module levels.** `logging.getLogger("payments").setLevel(DEBUG)` (Python), `pino.child({ level: "debug" })` (Node), `slog.NewLogger().With(...).WithLevel(slog.LevelDebug)` (Go). Crank one subsystem during an incident, not the whole service.
- **Signal- or endpoint-driven level change.** A `SIGUSR1` handler, or an internal `POST /debug/log-level` route (auth-gated, never exposed on the public ingress) that flips the level without a restart. The same route serves a `GET` so the on-call can confirm the current level.
- **Time-boxed boost.** When the level is raised dynamically, auto-revert after N minutes (default: 10–30). A forgotten DEBUG-in-prod is how the log bill triples overnight and how a secret-leak window stays open.
- **Audit the boost.** The act of raising the level is itself a business event — log it at `WARN` with the actor (operator user-id), the logger name, the new level, and the auto-revert deadline.

**d. Redaction is the Collector's job, but you still must not log secrets in the first place.** Never log: passwords, tokens, API keys, full credit-card numbers, full SSNs, `Authorization` headers, password-reset tokens, session cookies, refresh tokens. PII (email, full name, postal address): redact at the boundary or hash before logging; log the user id, not the email. The Collector's redaction processor is a backstop, not the rule.

**e. One log line per business event, not one per code path.** Logging at every function boundary is debug-time work that should be removed before commit. The signal a reviewer can see at glance: "this PR added 12 log lines in one handler" is almost always wrong — pick the one moment that's worth recording.

### 5. SDK bootstrap — one place per service

Bootstrap the OTel SDK in **exactly one place** per service (`observability.py`, `observability.ts`, `observability.go`), called once at process start before any framework wiring. The bootstrap sets the resource, the exporters, the propagator, and bridges the logger.

Copy the matching template into the service and adapt it; do not rewrite the bootstrap from scratch each time:

- Python — `../templates/observability/python-bootstrap.py`
- TypeScript / Node — `../templates/observability/typescript-bootstrap.ts`

Two non-negotiables the bootstrap encodes (and any new-language template MUST encode the same way):

- **Read every endpoint and credential from `OTEL_*` env vars** (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_SERVICE_NAMESPACE`, `DEPLOYMENT_ENVIRONMENT`). Never hard-code an endpoint or service name in source. Mirror the required vars in `.env.example`.
- **Use the `BatchSpanProcessor` / `BatchLogRecordProcessor` / `PeriodicExportingMetricReader` in production**, never the synchronous variants. The synchronous ones block the request path on the exporter; the batch ones don't.

### 6. Auto-instrumentation first, hand-rolled spans for business logic

For every supported framework or driver, install the matching auto-instrumentation package and let it produce HTTP-server / DB-client / HTTP-client / messaging spans for free. Hand-rolled spans are reserved for **business operations the framework doesn't know about**:

```python
# Hand-rolled: business operation the framework can't infer.
with tracer.start_as_current_span("payments.charge_card") as span:
    span.set_attribute("payments.amount", amount)
    span.set_attribute("payments.currency", currency)
    span.set_attribute("payments.provider", "stripe")
    result = await stripe_client.charge(card, amount)
    span.set_attribute("payments.transaction_id", result.id)
```

If you find yourself wrapping every function in a span, stop — the auto-instrumentation already gave you a span per request, per query, per outbound call. Pick the 3–10 business operations per service that are worth a span, and stop there.

### 7. The Collector is the seam — keep it thin in app code, thick in config

The OpenTelemetry Collector sits between your services and your backends. App code talks **only** to the Collector via OTLP. The Collector owns:

- Backend fan-out (Datadog, Jaeger, Tempo, Loki, Prometheus, S3 archive, etc.) — each backend is a separate **exporter** in the Collector pipeline.
- Tail-based sampling (`tail_sampling` processor) — keep all error traces, sample successful traces by rate.
- Redaction / scrubbing (`attributes` / `transform` processors) — strip headers, PII keys, query strings.
- Resource enrichment (`resource` processor) — add `host.name`, `k8s.pod.name`, region, AZ from the platform.
- Batching, retries, and a queue-size budget so a backend outage doesn't backpressure the app.

When a "logging change" turns out to be a Collector-config change (redaction, additional backend, sampling adjustment), that PR touches the Collector deployment, not the service code.

### 8. SLOs and alerts — derive from metrics, not logs

Page on metric thresholds, not log strings. A `grep ERROR` alert is fragile and high-cardinality:

- **Availability SLO**: `successful_requests / total_requests` over a window. `successful` = `http.status_code < 500` (4xx is the user's problem, not yours).
- **Latency SLO**: p95 (or p99) of `http.server.duration` for the route under the SLO target.
- **Error-rate alert**: `rate(http.server.requests{http.status_code="5xx"})` exceeding a percentage of total rate for N minutes.
- **Saturation alert**: `db.client.connections.usage / db.client.connections.max > 0.8` for N minutes; queue depth above the consumer's drain rate × N minutes.

Logs back the alert — they let the operator drill into *why* — but never trigger it.

## Anti-patterns (reject in review)

- **Vendor SDK in app code.** `import datadog`, `import newrelic`, `from sentry_sdk import init` in `src/`. Use OTel; put the vendor adapter in the Collector.
- **`print` / `console.log` / `fmt.Println` / `System.out.println`.** In committed application paths, ever. Remove before commit.
- **High-cardinality metric labels.** `user_id`, `request_id`, `email`, raw URL paths, raw SQL with literals, full stack traces as label values.
- **One log line per function entry/exit.** That's a tracing concern. Use a span.
- **Span name with route parameters baked in.** `GET /users/42` instead of `GET /users/{user_id}` — kills metric/trace aggregation.
- **Logging secrets.** Tokens, passwords, full PAN, `Authorization` headers, password-reset tokens, refresh tokens. Even at DEBUG. Even "just to confirm we got it."
- **Multiple parallel logging stacks.** A `print` here, a structured logger there, a third SDK over there. One logger per language; bridged to OTel.
- **Hand-rolled context propagation.** Manually shoving `trace_id` into a custom HTTP header instead of using the OTel propagator. The W3C `traceparent` already exists.
- **No batch processors.** Synchronous exporters in production paths — they block the request thread on export network IO.
- **Sampling decided in app code with a fixed ratio "to save cost".** Sampling belongs in the Collector where the full trace is visible (errors should be sampled at 100%, success at a fraction).
- **"DEBUG everywhere in prod, let the Collector filter."** The serialization cost is paid in the app before the Collector sees it. Gate logs at the source with a configurable level; gate traces with Collector tail-sampling — they are different problems.
- **Log level pinned at boot via env var with no runtime override.** The on-call shouldn't need a redeploy to debug an incident. Expose a per-logger, signal- or endpoint-driven, time-boxed level boost.
- **Per-signal `service.name`.** Setting it on the tracer and forgetting it on the meter/logger. Set the resource once at SDK init.

## TDD for observability

Observability is a first-class behavior. Test it the same way you test anything else: in the RED step, assert that the span / metric / log is emitted with the right attributes; in the GREEN step, add the OTel call. Observability is not a separate phase after the feature ships — it's part of the same RED→GREEN cycle.

Copy the matching in-memory-exporter fixtures from `../templates/observability/test-fixtures.md` (Python pytest and TypeScript vitest/jest recipes for spans, metrics, and logs). The non-negotiables:

- **Do not mock the OTel API itself.** Use the real SDK with an in-memory exporter; a test that mocks `tracer.startSpan` is testing the mock, not the behavior.
- **Pin attributes, not just span/metric/log existence.** "A span was created" is not an assertion; "a span named X with attribute Y=Z was created" is. A span with no attribute assertions is barely worth emitting — the next change can strip the attributes silently and the test still passes.
- **Clear the exporter between tests.** `exporter.clear()` / `exporter.reset()` in an `afterEach` / pytest fixture teardown so the next test starts from a known state.

## Command

There is no language-specific command set for this skill; instrumentation runs as part of the service's normal startup. The only invariants to verify on every change:

- The service boots without `OTEL_*` errors when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset (development mode → exporter is a no-op or stdout, never a panic).
- `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_SERVICE_NAMESPACE`, and `DEPLOYMENT_ENVIRONMENT` are present in `.env.example` and in the deployed environment manifests.
- The Collector is reachable from the service network and exposes OTLP gRPC on `4317` (and OTLP HTTP on `4318` if any client uses it).
