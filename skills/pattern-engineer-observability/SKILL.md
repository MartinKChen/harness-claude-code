---
name: pattern-engineer-observability
description: "OpenTelemetry is the only instrumentation API in source; vendor SDKs only behind the Collector. Services emit traces + metrics + logs through OTel with shared resource attributes, W3C `tracecontext` propagation, auto-instrumentation for boilerplate, RED/USE metrics with bounded label cardinality, structured JSON logs gated at source. Activate when touching instrumentation or `OTEL_*` env vars."
---

# pattern-engineer-observability

Terse rule list for writing observability code. **OpenTelemetry is the only instrumentation API**; vendor SDKs (Datadog, New Relic, Sentry, Honeycomb, Splunk, Elastic) appear only as OTLP backends behind the Collector — never as imports in `src/`.

## When to activate

Activate whenever you add/edit/remove a log statement, span, metric, or trace-context propagation; scaffold observability for a service; touch `OTEL_*` env vars or the SDK bootstrap; wire (or remove) auto-instrumentation; or reach for `print` / `console.log` to "see what's happening" in a service path.

Skip for local one-off `print` debugging in throwaway scripts or pure log-aggregation tooling that doesn't touch the app code path.

## Rules

### Instrumentation surface

- **OpenTelemetry only.** No `dd-trace`, `newrelic`, `@sentry/node`, `elastic-apm-node`, `splunk-otel` as direct imports.
- **No `print` / `console.log` / `console.error` / `fmt.Println` / `System.out.println`** in committed code. Use the OTel-emitting structured logger.
- **One structured logger per language**, bridged to OTel logs (`structlog` for Python, `pino` for Node, `slog` for Go, `Logback` for Java). No parallel logging stacks.
- **Auto-instrumentation for boilerplate** (HTTP servers, DB drivers, queue clients, outbound HTTP). Hand-roll spans only for business operations the framework can't infer (3–10 per service is enough).
- **Resource attributes set once** at SDK init (`service.name`, `service.version`, `service.namespace`, `deployment.environment`). Per-signal `service.name` is a bug.
- **W3C `traceparent` / `tracestate` propagation.** No `x-datadog-trace-id` / `x-b3-traceid` headers in new code.

### Traces

- **Span name is the route template**, never the resolved URL: `"GET /users/{user_id}"`, not `f"GET /users/{user_id}"`.
- **Use OTel semantic-convention attribute names**: `http.method`, `http.route`, `http.status_code`, `db.system`, `db.statement`, `messaging.system`, `exception.type`, `exception.message`, `exception.stacktrace`. Don't invent `httpMethod` / `dbSystem` / `errorMsg`.
- **Errors → `record_exception(exc)` + `set_status(Status(StatusCode.ERROR, ...))`** (Python) / `recordException` + `setStatus({code: SpanStatusCode.ERROR, ...})` (TS). Never shove the stack trace into a free-text attribute.
- **App-side sampling: `ParentBased(AlwaysOn)`** — emit 100%. The real sampling decision lives in the Collector's `tail_sampling` processor. Fixed-ratio app-level head sampling "to save cost" is wrong.

### Metrics

- **Pick the right instrument.** `Counter` (monotonic), `UpDownCounter` (up/down), `Histogram` (distribution), `Observable Gauge` (sampled). A "request latency counter" is a category error.
- **Semantic-convention names**: `http.server.duration`, `http.server.requests`, `db.client.operation.duration`. Business signals under your namespace: `payments.charge.attempts`. Lower-case dot-separated, never camelCase.
- **Cardinality is a hard constraint.** Never use `user.id`, `email`, `session.id`, `request.id`, raw URL with path params, or any unbounded value as a metric attribute. If you need the dimension, it belongs on a span or log, not a metric.
- **Bound enumerable labels** only (`http.status_code`, `db.system`, `payment.method`, `tenant.tier`).
- **Histograms ship with explicit bucket boundaries** when the domain isn't HTTP-server-duration in seconds — otherwise every observation collapses into one bucket and p95 is meaningless.
- **Default dashboard = RED + USE.** RED (Rate / Errors / Duration) per HTTP route, gRPC method, queue consumer. USE (Utilization / Saturation / Errors) per resource dependency (CPU, memory, DB pool, queue depth, GC pause).

### Logs

- **Structured key-value records, never `printf`-style.** `logger.info("user.charged", user_id=user_id, amount=amount, currency="USD")`, not `f"User {user_id} charged {amount}"`.
- **Production threshold = `INFO`.** `DEBUG` is for transient operator-driven boosts, never the default. Gate at source, not in the Collector — serialization cost is paid in the app before the Collector ever sees it.
- **`INFO` = "events the operator would want a record of, even with no incident."** If you can't name the event, it's `DEBUG`.
- **Dynamic per-logger level override**, auth-gated, time-boxed (auto-revert after 10–30 min), audit-logged at `WARN`. So the on-call doesn't need a redeploy during an incident, and a forgotten boost doesn't triple the log bill overnight.
- **Never log secrets** (passwords, tokens, API keys, `Authorization` headers, full PAN/SSN, password-reset tokens, session/refresh cookies). Redact PII (email, full name, address) at the boundary; log the user id instead. The Collector's redaction is a backstop, not the rule.
- **One log line per business event**, not one per code path. "12 log lines in one handler" is almost always wrong.
- **Active span context attaches automatically** via the logs bridge. Records without `trace_id` / `span_id` when there's an active span mean the bridge is misconfigured — fix that before adding more logs.

### SDK bootstrap

- **Bootstrap in exactly one place** per service (`observability.py` / `observability.ts` / equivalent), called once at process start before any framework wiring.
- **Read every endpoint and credential from `OTEL_*` env vars** (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_SERVICE_NAMESPACE`, `DEPLOYMENT_ENVIRONMENT`). Never hard-code an endpoint or service name. Mirror the required vars in `.env.example`.
- **Use batch processors in production**: `BatchSpanProcessor`, `BatchLogRecordProcessor`, `PeriodicExportingMetricReader`. Never synchronous variants — they block on export network IO.
- **Bootstrap MUST NOT crash when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.** Dev/CI booting without a Collector is a supported mode.

### Alerts and SLOs

- **Page on metric thresholds, not log strings.** `grep ERROR` alerts are fragile.
- **Availability SLO** = `successful / total` over a window; successful = `http.status_code < 500` (4xx is the caller's problem).
- **Latency SLO** = p95 (or p99) of `http.server.duration`.
- **Saturation alerts** = connection-pool / queue-depth ratios over time. Logs back the alert; they don't trigger it.

### Testing observability

- **Don't mock the OTel API.** Use the real SDK with an in-memory exporter — mocking `tracer.startSpan` tests the mock, not the behavior.
- **Pin attributes, not just existence.** "A span was created" is not an assertion; "a span named X with attribute Y=Z was created" is.
- **Clear the exporter between tests** (`exporter.clear()` / `exporter.reset()` in `afterEach` / pytest fixture teardown).

### TDD cadence

Observability is first-class behavior: in RED assert the span / metric / log emits with the right attributes; in GREEN add the OTel call. Not a separate phase after the feature ships.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/observability/python-bootstrap.py` | Python OTel SDK bootstrap (resource, exporters, propagator, logger bridge). |
| `templates/observability/typescript-bootstrap.ts` | TypeScript / Node OTel SDK bootstrap. |
| `templates/observability/collector-config.yaml` | Collector starter pipeline (receivers → processors → exporters). |
| `templates/observability/test-fixtures.md` | In-memory exporter recipes for pytest / vitest assertions. |

## Invariants (verify on every change)

- The service boots without errors when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset.
- `OTEL_SERVICE_NAME`, `OTEL_SERVICE_VERSION`, `OTEL_SERVICE_NAMESPACE`, `DEPLOYMENT_ENVIRONMENT` are present in `.env.example` and the deployed env manifest.
- The Collector is reachable from the service network on `:4317` (gRPC) — and `:4318` if any client uses OTLP HTTP.
