---
name: pattern-reviewer-observability
description: "OTel instrumentation audit: vendor SDKs (Datadog/New Relic/Sentry/Honeycomb/Splunk) in `src/` → CRITICAL (Collector-only). `print` / `console.log` / `fmt.Println` in committed paths → HIGH. Span names with route params baked in (high cardinality) → HIGH. Metric labels with `user.id` / `request.id` / raw URL → HIGH. Logs without trace_id/span_id when active span exists → MEDIUM. Synchronous exporters → HIGH. SDK bootstrap not single-place → MEDIUM. App-level head-sampling at fixed ratio → HIGH (sampling is Collector's job)."
---

# pattern-reviewer-observability

OpenTelemetry instrumentation audit catalogue. Engineer-side bullets live in `pattern-engineer-observability`. Drop-in starting files live in `templates/`.

## When to activate

- Reviewing a diff that touches: instrumentation (logs, spans, metrics, trace-context propagation), OTel SDK bootstrap, Collector config, `OTEL_*` env vars, dashboards / alerts / SLOs that consume traces / metrics / logs.

## Iron rules

See `pattern-reviewer-coding-standard` for citation, severity, finding-shape, and `#N` rules.

## Patterns to review

### OpenTelemetry only — no vendor SDKs in app code (CRITICAL)

- `import datadog` / `import newrelic` / `from sentry_sdk import init` / `dd-trace` / `elastic-apm-node` / `@sentry/node` in `src/` → CRITICAL.
- Vendor adapter belongs in the Collector via a processor / exporter — never in application code.

### No `print` / `console.log` (HIGH)

- `print(...)` / `console.log(...)` / `fmt.Println(...)` / `System.out.println(...)` in committed production paths → HIGH.
- `console.error` same rule.
- Use the OTel-emitting structured logger.

### Span naming — low cardinality (HIGH)

```python
# BAD — high cardinality, one time series per user id
with tracer.start_as_current_span(f"GET /users/{user_id}"):
    ...

# GOOD — route template is the span name; the id is an attribute
with tracer.start_as_current_span("GET /users/{user_id}") as span:
    span.set_attribute("user.id", user_id)
    span.set_attribute("http.route", "/users/{user_id}")
```

Route parameters baked into the span name → HIGH (kills aggregation; explodes time-series count).

### Semantic-convention attribute names (MEDIUM)

- Custom attribute names that overlap with OTel semantic conventions → flag.
- `httpMethod` / `dbSystem` / `errorMsg` → flag; use `http.method` / `db.system` / `exception.message`.

### Errors on spans (HIGH)

```python
# BAD — error info shoved into a free-text attribute
span.set_attribute("error", str(exc))
span.set_attribute("traceback", traceback.format_exc())

# GOOD — structured slot
span.record_exception(exc)
span.set_status(Status(StatusCode.ERROR, str(exc)))
```

### Metric label cardinality (HIGH)

- `user.id` / `email` / `session.id` / `request.id` / raw URL with path params / SQL with literals as a metric attribute → HIGH (storage cost explodes; query becomes useless).
- Use the route template (`http.route = "/users/{user_id}"`), not the resolved URL.
- Bound enumerable labels (`http.status_code`, `db.system`, `payment.method`, `tenant.tier`).

### Instrument-type misuse (MEDIUM)

- `Counter` used for a value that can go down → flag (use `UpDownCounter`).
- `Histogram` used for a count → flag.
- Histogram without explicit bucket boundaries on a domain that isn't HTTP-server-duration in seconds → flag (default buckets collapse every observation into one bucket).

### Structured logs only (HIGH)

```python
# BAD — printf-style with PII / secrets interpolated
logger.info(f"User {user_id} charged {amount}")

# GOOD — structured fields
logger.info("user.charged", user_id=user_id, amount=amount, currency="USD")
```

- `printf`-style log lines on hot paths → flag.

### Trace correlation in logs (MEDIUM)

- Active span present but log records emitted without `trace_id` / `span_id` → flag; the logs bridge is misconfigured.

### Log level threshold (MEDIUM)

- `DEBUG` as the production threshold → flag (gate at source, default `INFO`).
- "Just log everything and let the Collector filter" pattern → flag.
- Per-logger / per-module level override missing (no operator escape hatch — `SIGUSR1` handler, `POST /debug/log-level` route, env-driven reload) → MEDIUM.
- Dynamic level-boost without auto-revert after N minutes → flag.

### Logging secrets (CRITICAL)

- Passwords / tokens / full PANs / `Authorization` header / password-reset tokens / session cookies / refresh tokens emitted to logs → CRITICAL.
- PII (raw email / full name / postal address) logged in the clear → HIGH; log the user id, not the email.
- Same sensitive value logged at two layers → flag.
- Redaction allow-list key names that don't match the emitted keys (`tokenHash` vs emitted `token`) → flag.

### Bootstrap shape (MEDIUM)

- OTel SDK bootstrap in multiple places (`observability.py` + scattered `tracer = ...` calls) → flag; bootstrap in **one** place per service.
- Resource attributes (`service.name`, `service.version`, `service.namespace`, `deployment.environment`) set per-signal instead of once on the resource → flag.
- Hard-coded OTLP endpoint or service name (not read from `OTEL_*` env vars) → HIGH.
- Sync exporters (`SimpleSpanProcessor`, sync log record processor) in production → HIGH; use `BatchSpanProcessor` / `BatchLogRecordProcessor` / `PeriodicExportingMetricReader`.
- SDK bootstrap crashes when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset → HIGH (dev mode must boot without a Collector).

### Auto-instrumentation first (MEDIUM)

- Hand-rolled span around an HTTP handler that auto-instrumentation already covers → flag.
- Hand-rolled span around a DB query that auto-instrumentation already covers → flag.
- Reserve hand-rolled spans for business operations the framework can't infer (`payments.charge_card`, etc.).

### Sampling (HIGH)

- App-level `TraceIdRatioBased(0.1)` (fixed-ratio head sampling) used as the actual sampling strategy → flag.
- Sampling decided in app code "to save cost" → flag.
- Correct shape: app uses `ParentBased(AlwaysOn)`; Collector's `tail_sampling` processor does the real decision (100% errors / fraction of success).

### Context propagation (MEDIUM)

- Custom `x-trace-id` / `x-b3-traceid` header used in new code instead of W3C `traceparent` → flag.
- Hand-rolled propagation throughout the codebase instead of using the OTel propagator → flag.

### Testing observability (MEDIUM)

- Tests mock `tracer.start_span` / `tracer.startSpan` → flag (testing the mock, not the behavior).
- Test asserts "a span was created" without asserting any attribute → flag (next change can strip attributes silently).
- Test fixtures don't clear the in-memory exporter between tests → flag.

## Templates

| Asset | Purpose |
|-------|---------|
| `templates/collector-config.yaml` | Reference Collector pipeline (receivers → processors → exporters). |
| `templates/python-bootstrap.py` | Reference Python OTel bootstrap. |
| `templates/typescript-bootstrap.ts` | Reference TypeScript / Node OTel bootstrap. |
| `templates/test-fixtures.md` | In-memory exporter recipes for assertions. |

## Constructing the finding

Use the shape in `templates/review-comment.md`.
