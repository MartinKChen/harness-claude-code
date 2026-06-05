---
name: pattern-reviewer-observability
description: "OTel instrumentation audit: vendor SDKs (Datadog/Sentry/etc.) in `src/` → CRITICAL (Collector-only); `print`/`console.log` in committed paths → HIGH; high-cardinality span names or metric labels → HIGH; logs without trace_id/span_id under an active span → MEDIUM; synchronous exporters → HIGH; app-level fixed-ratio head-sampling → HIGH (Collector's job). Holds the architectural background so audits are grounded in the why. Activate when reviewing instrumentation or `OTEL_*` env vars."
---

# pattern-reviewer-observability

OpenTelemetry instrumentation audit catalogue and the architectural reference the rules sit on top of. Drop-in starting files live in `templates/`.

## When to activate

Reviewing a diff that touches: instrumentation (logs, spans, metrics, trace-context propagation), OTel SDK bootstrap, Collector config, `OTEL_*` env vars, dashboards / alerts / SLOs that consume traces / metrics / logs.

## Project memory overlay

After loading this skill, also check `$MAIN_ROOT/.claude/memory/patterns/pattern-reviewer-observability.md` in the consuming project (resolve `MAIN_ROOT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"`). If present, load it as an **additive overlay** to the rules below; if absent, skip silently. See `memory-convention` for the full contract (additivity, severity floor, conflict surfacing).

## Iron rules

- **>80% confidence filter.** Report only when you are >80% confident. Consolidate similar findings.
- **Cite `path/to/file.ext:line`.** Quote the offending snippet in a BAD block; show the fix in a GOOD block.
- **Severity is load-bearing.** CRITICAL / HIGH block the gate; MEDIUM / LOW are informational. Use the per-pattern severity assigned below.
- **Never refer to a finding as `#N`** — GitHub auto-links those to issues. Use a non-numeric handle (quoted title, `F1` / `F2`, `Finding 1`).

## Background — the architecture the rules enforce

These patterns are the *symptoms* the audit catches; the architecture below is the *system* they protect. When a rule feels arbitrary, the rationale lives here.

### The seam — OpenTelemetry SDK → OTLP → Collector → backends

One instrumentation API in source. App code emits **traces, metrics, logs** through OTel and exports via **OTLP** (gRPC on `:4317` preferred, HTTP/protobuf on `:4318` as a fallback) to an **OpenTelemetry Collector**. The Collector — a small Go process between every service and every backend — is the **only** thing in the system that knows which backend(s) data actually lands in.

```
[service A] ─ OTLP gRPC :4317 ─┐
                                ├─► [OTel Collector] ──► Datadog / Tempo / Loki / Prometheus / S3 / ...
[service B] ─ OTLP gRPC :4317 ─┘
```

That indirection is the entire payoff. Swapping backends, adding redaction, changing sampling, fanning out to two backends in parallel for a migration — all of that is a Collector-config change, never a code change in `src/`. If a backend can't ingest OTLP, that's a Collector exporter problem, not an SDK problem.

### Pipeline shape — receivers → processors → exporters

Every Collector config has the same three-stage shape, wired into one pipeline per signal:

- **Receivers** — accept incoming data. For OTLP this is `otlp` on `:4317` (gRPC) and `:4318` (HTTP).
- **Processors** — transform / filter / sample in order. Order matters: `memory_limiter` first to refuse data when overloaded; `resourcedetection` to add platform attributes; `tail_sampling` for traces; `attributes` / `transform` / redact for backstop secret-stripping; `batch` last before export.
- **Exporters** — ship data out. One exporter per backend; each pipeline can fan to multiple exporters.

Starter config: `templates/collector-config.yaml`.

### What the Collector owns (and the app doesn't)

- **Backend fan-out** — each backend is a separate exporter (`otlphttp/tempo`, `prometheusremotewrite`, `datadog`, etc.). Adding a backend is editing the Collector config.
- **Tail-based sampling** (`tail_sampling` processor) — sees the full trace before deciding, so it can keep 100% of error/slow traces and sample successful traces at a fraction. App code MUST NOT head-sample with a fixed ratio "to save cost".
- **Redaction / scrubbing** (`attributes` / `transform` processors) — strip auth headers, cookie headers, PII keys. Backstop only — the app must still not log secrets in the first place.
- **Resource enrichment** (`resourcedetection` processor) — add `host.name`, `k8s.pod.name`, `cloud.region`, `cloud.availability_zone` from the environment.
- **Batching, retries, queue budget** — so a backend outage doesn't backpressure the app. The Collector buffers; when its queue fills, it drops on the floor and increments `otelcol_processor_dropped_*` — alert on it.

### Emit-vs-gate model per signal

The instinct to "log everything at DEBUG and let downstream filter" is wrong *for logs*, right *for traces*, and N/A *for metrics*. The cost the Collector can drop is network + storage. The cost it **cannot** drop is serialization in the app — every record gets formatted, attributes resolved, OTel objects allocated.

| Signal | App-side strategy | Collector-side strategy | Reason |
|--------|-------------------|--------------------------|--------|
| **Traces** | Emit all at 100% (`ParentBased(AlwaysOn)`) — no head-sampling in app code | Tail-sample: keep 100% of error / slow traces, sample successful traces at 1–10% | Collector sees the whole trace before deciding, so it never drops the trace that contained the bug |
| **Metrics** | Emit all — no gating | No drop; metrics are pre-aggregated | A counter / histogram is server-side aggregate; nothing to sample |
| **Logs** | Gate at source with a configurable level (default `INFO` in prod) | Backstop redaction / drop only | Per-record serialization is the cost the Collector cannot offload |

### Deployment topology

| Topology | Where it runs | App points at | When to pick it |
|----------|---------------|---------------|------------------|
| **Sidecar** | One Collector container per app pod | `localhost:4317` | Simplest network model; small fleets; per-app isolation. ~30 MB RAM per pod. |
| **Agent (DaemonSet)** | One Collector per node | `localhost:4317` (node IP) | Cheaper than sidecar; needs node-level access policy. Common on Kubernetes. |
| **Gateway** | Separate `Deployment` with 3–5 replicas behind a `Service` | `otel-collector.<ns>:4317` | Centralised tail-sampling + redaction; what most teams converge on. |
| **Agent + Gateway** | Both layers — agent batches close to the app, gateway tail-samples and fans out | `localhost:4317` (agent forwards to gateway) | OTel-recommended production topology once traffic is non-trivial. |

Tail-sampling only works correctly when all spans of a trace land on the same Collector instance — the gateway layer typically has session-affinity routing (`trace_id`-hashed). A naïve round-robin gateway loses traces.

### Deployment boundary — observability stack vs app stack

- **Production: separate stack.** Different cluster / cloud account / VPC from the app — whichever isolation boundary is the strongest one your platform offers.
- **Local dev and CI: one stack.** `docker-compose.yaml` with the app + Collector + a backend stub (or the Collector's `debug` exporter) is correct.

```
[ App stack — owned by feature engineers ]      [ Observability stack — owned by sre ]
  service A ─┐                                    Collector gateway (3–5 replicas,
  service B ─┼─ OTLP ─► Collector agents ─OTLP─► trace_id-hashed affinity)
  service C ─┘            (DaemonSet/sidecar)               │
                                                            ├──► Tempo   (traces)
                                                            ├──► Mimir/Prom (metrics)
                                                            ├──► Loki    (logs)
                                                            └──► Grafana + Alertmanager
```

The only wire across the boundary is **OTLP outbound from the app side**. The observability side never reaches back into the app side — no Prometheus scraping app endpoints across the boundary, no shared databases, no shared service accounts.

Why separate in production:

| Reason | What breaks when they share a stack |
|--------|--------------------------------------|
| **Blast radius** | When the app cluster falls over, you lose the dashboards and traces explaining *why* — at the exact moment you need them. |
| **Resource isolation** | Prometheus eats RAM, Loki eats disk, Tempo eats object-store IO. Co-located with latency-sensitive workloads → noisy-neighbor problems. |
| **Lifecycle** | Observability infra changes monthly once stable; the app changes daily. Coupling makes every Grafana upgrade a release gate on the app. |
| **Multi-tenant fan-in** | One observability stack should serve every service in every environment. Per-app stacks → N independent backends, no unified dashboards, quadratic operational cost. |
| **Security + compliance** | Logs and metrics carry regulatory retention rules (90 days / 1 year / 7 years), different SSO/IAM groups, different network perimeter. |

Triggers to split (any one of these): first "we lost visibility during an incident because the same outage took down observability" postmortem; first regulated data class (PII / payment / health) the signals could contain; second team or environment that wants to consume the same dashboards; traffic high enough that observability-backend resource contention shows up in app p95 latency.

Managed shortcut (Grafana Cloud / Datadog / Honeycomb / New Relic / Splunk Observability) is "separate stack" by construction — the backend runs in the vendor's account. The app stack is unchanged either way: it speaks OTLP to a gateway and doesn't know what's on the other side.

### Dev-mode story — no Collector required to boot

The SDK bootstrap MUST NOT crash when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Two viable local setups:

- Run a Collector in `docker-compose.yaml` alongside the app with the `debug` exporter (prints OTLP payloads to stdout). Useful for "did this span/metric/log actually emit?" — ~30 MB.
- Leave the endpoint unset. The SDK exporter logs a connection-refused warning every batch interval and the app boots fine.

CI typically uses the first option so E2E smoke tests can assert that spans / metrics / logs reach the in-Compose Collector.

### Ownership

| Surface | Owner | Examples |
|---------|-------|----------|
| App-side SDK bootstrap + emitted spans/metrics/logs | architect (initial scaffold) + feature engineers | `observability.py` / `observability.ts`; business spans like `payments.charge_card`; route-level histograms |
| App-stack Compose Collector (dev / CI only) | architect | The Collector service in the project's `docker-compose.yaml` |
| Production Collector deployment (gateway + agents) | sre | Helm/manifest, scaling, autoscaler, alerts on `otelcol_processor_dropped_*` |
| Production observability backends (Tempo / Mimir / Loki / Grafana, or the wire-up to a managed vendor) | sre | Backend deploys, retention policy, IAM, on-call dashboards |

A new backend, a redaction rule, a sampling-percentage change, or a new processor is a change request against the Collector config in the sre lane — never an edit to `src/`.

## Patterns to review

### OpenTelemetry only — no vendor SDKs in app code (CRITICAL)

- `import datadog` / `import newrelic` / `from sentry_sdk import init` / `dd-trace` / `elastic-apm-node` / `@sentry/node` in `src/` → CRITICAL.
- Vendor adapter belongs in the Collector via a processor / exporter — never in application code.

### No `print` / `console.log` (HIGH)

- `print(...)` / `console.log(...)` / `console.error(...)` / `fmt.Println(...)` / `System.out.println(...)` in committed production paths → HIGH.
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
    span.set_attribute("http.method", "GET")
```

```ts
// GOOD — TypeScript equivalent
const span = tracer.startSpan("GET /users/:userId", {
  attributes: {
    "user.id": userId,
    "http.route": "/users/:userId",
    "http.method": "GET",
  },
});
```

Route parameters baked into the span name → HIGH (kills aggregation; explodes time-series count).

### Semantic-convention attribute names (MEDIUM)

- Custom attribute names that overlap with OTel semantic conventions → flag.
- `httpMethod` / `dbSystem` / `errorMsg` → flag; use `http.method` / `db.system` / `exception.message`.
- The spec exists so dashboards and SLOs are portable.

### Errors on spans (HIGH)

```python
# BAD — error info shoved into a free-text attribute
span.set_attribute("error", str(exc))
span.set_attribute("traceback", traceback.format_exc())

# GOOD — structured slot
from opentelemetry.trace import Status, StatusCode
span.record_exception(exc)
span.set_status(Status(StatusCode.ERROR, str(exc)))
```

```ts
// GOOD — TypeScript equivalent
import { SpanStatusCode } from "@opentelemetry/api";
span.recordException(err as Error);
span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
```

### Metric instrument-type misuse (MEDIUM)

- `Counter` used for a value that can go down → flag (use `UpDownCounter`).
- `Histogram` used for a count → flag.
- A "request latency counter" is a category error — `http.server.duration` is a `Histogram`.
- Histogram without explicit bucket boundaries on a domain that isn't HTTP-server-duration in seconds → flag (default buckets collapse every observation into one bucket).

### Metric label cardinality (HIGH)

- `user.id` / `email` / `session.id` / `request.id` / raw URL with path params / SQL with literals as a metric attribute → HIGH (storage cost explodes; query becomes useless).
- Use the route template (`http.route = "/users/{user_id}"`), not the resolved URL.
- Bound enumerable labels (`http.status_code`, `db.system`, `payment.method`, `tenant.tier`).
- If you genuinely need the high-cardinality dimension, it belongs on a **span** or a **log**, not on a metric.

### Metric naming (MEDIUM)

- Custom metrics not under a service namespace (`charge_attempts` instead of `payments.charge.attempts`) → flag.
- camelCase metric names (`httpServerDuration`) → flag; lower-case dot-separated only.

### Structured logs only (HIGH)

```python
# BAD — printf-style with PII / secrets interpolated
logger.info(f"User {user_id} charged {amount}")

# GOOD — structured fields
logger.info("user.charged", user_id=user_id, amount=amount, currency="USD")
```

```ts
// GOOD — TypeScript equivalent (pino instance wired to OTel logs bridge)
logger.info({ userId, amount, currency: "USD" }, "user.charged");
```

- `printf`-style log lines on hot paths → flag.

### Trace correlation in logs (MEDIUM)

- Active span present but log records emitted without `trace_id` / `span_id` → flag; the logs bridge is misconfigured. Click-through from trace UI to logs is broken until fixed.

### Log level threshold (MEDIUM)

- `DEBUG` as the production threshold → flag (gate at source, default `INFO`).
- "Just log everything and let the Collector filter" pattern → flag — serialization cost is paid in the app before the Collector ever sees it, and the Collector cannot refund that CPU.
- Per-logger / per-module level override missing (no operator escape hatch — `SIGUSR1` handler, `POST /debug/log-level` route auth-gated and never on the public ingress, env-driven reload) → MEDIUM.
- Dynamic level-boost without auto-revert after N minutes (10–30 default) → flag. Forgotten DEBUG-in-prod is how the log bill triples overnight and how a secret-leak window stays open.
- Level boost not audited at `WARN` with actor + new level + auto-revert deadline → flag.

### Log line density (LOW–MEDIUM)

- One log line per function entry/exit → flag (that's a tracing concern; use a span).
- 10+ new log lines added in one handler in a single PR → likely wrong; ask which moments are worth recording.

### Logging secrets (CRITICAL)

- Passwords / tokens / full PANs / `Authorization` header / password-reset tokens / session cookies / refresh tokens emitted to logs → CRITICAL. Even at DEBUG. Even "just to confirm we got it."
- PII (raw email / full name / postal address) logged in the clear → HIGH; log the user id, not the email.
- Same sensitive value logged at two layers → flag (one layer only).
- Redaction allow-list key names that don't match the emitted keys (`tokenHash` vs emitted `token`) → flag (case-sensitive exact match).

### Bootstrap shape (MEDIUM–HIGH)

- OTel SDK bootstrap in multiple places (`observability.py` + scattered `tracer = ...` calls) → flag; bootstrap in **one** place per service.
- Resource attributes (`service.name`, `service.version`, `service.namespace`, `deployment.environment`) set per-signal instead of once on the resource → flag (per-signal `service.name` is a bug).
- Hard-coded OTLP endpoint or service name (not read from `OTEL_*` env vars) → HIGH.
- Sync exporters (`SimpleSpanProcessor`, sync log record processor) in production → HIGH; use `BatchSpanProcessor` / `BatchLogRecordProcessor` / `PeriodicExportingMetricReader` — sync variants block the request thread on export network IO.
- SDK bootstrap crashes when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset → HIGH (dev mode must boot without a Collector).
- `OTEL_*` env var read by code but missing from `.env.example` → MEDIUM.

### Auto-instrumentation first (MEDIUM)

- Hand-rolled span around an HTTP handler that auto-instrumentation already covers → flag.
- Hand-rolled span around a DB query that auto-instrumentation already covers → flag.
- Hand-rolled span around an outbound `requests` / `httpx` / `fetch` / `axios` call → flag.
- Reserve hand-rolled spans for business operations the framework can't infer (`payments.charge_card`, `subscription.renew`, etc.) — 3–10 per service is a healthy budget.

### Sampling (HIGH)

- App-level `TraceIdRatioBased(0.1)` (fixed-ratio head sampling) used as the actual sampling strategy → HIGH (Collector tail-sampling sees the whole trace; app-level head-sampling drops the trace that contained the bug).
- Sampling decided in app code "to save cost" → HIGH.
- Correct shape: app uses `ParentBased(AlwaysOn)`; Collector's `tail_sampling` processor does the real decision (100% errors / 100% slow / fraction of success).

### Context propagation (MEDIUM)

- Custom `x-trace-id` / `x-b3-traceid` header used in new code instead of W3C `traceparent` → flag.
- Hand-rolled propagation throughout the codebase instead of using the OTel propagator → flag. For in-house messaging wrappers, propagate at exactly two points (produce, consume), not throughout.

### Alerts / SLOs (MEDIUM)

- Alert defined as `grep "ERROR"` on logs instead of metric threshold → flag.
- Availability defined including 4xx as failures → flag (4xx is the caller's problem; only 5xx counts against availability).
- Latency SLO defined on mean instead of p95 / p99 → flag.

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
