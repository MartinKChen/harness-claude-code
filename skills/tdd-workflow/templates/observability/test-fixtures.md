# Test fixtures for observability

Recipes for asserting on emitted spans, metric points, and log records in unit
tests. The rule from `references/observability-patterns.md`:

> Do not mock the OTel API. Use the real SDK with an **in-memory exporter**.

The in-memory exporters are shipped by the OTel SDKs themselves — they capture
finished spans / metric reads / log records into a list the test can assert on.

---

## Python — pytest

### Trace assertions

```python
# tests/conftest.py
import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter


@pytest.fixture
def span_exporter() -> InMemorySpanExporter:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    yield exporter
    exporter.clear()
```

```python
# tests/test_payments.py
from opentelemetry.trace.status import StatusCode

def test_charge_emits_business_span(span_exporter, charge_service):
    charge_service.charge(card, amount=Decimal("9.99"), currency="USD")

    [span] = span_exporter.get_finished_spans()
    assert span.name == "payments.charge_card"
    assert span.attributes["payments.amount"] == "9.99"
    assert span.attributes["payments.currency"] == "USD"
    assert span.status.status_code == StatusCode.OK
```

Pin every attribute the production code is expected to set. A span with no
attribute assertions is barely worth emitting; if the test doesn't pin them,
the next change can strip them silently.

### Metric assertions

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader


@pytest.fixture
def metric_reader() -> InMemoryMetricReader:
    reader = InMemoryMetricReader()
    metrics.set_meter_provider(MeterProvider(metric_readers=[reader]))
    return reader


def test_charge_increments_counter(metric_reader, charge_service):
    charge_service.charge(card, amount=Decimal("9.99"), currency="USD")

    data = metric_reader.get_metrics_data()
    [scope_metrics] = data.resource_metrics[0].scope_metrics
    [metric] = [m for m in scope_metrics.metrics if m.name == "payments.charge.attempts"]
    [point] = metric.data.data_points
    assert point.value == 1
    assert point.attributes["payments.currency"] == "USD"
    assert point.attributes["payments.provider"] == "stripe"
```

Assert on the observable surface (counter went up by 1; histogram recorded a
value in the expected range), never on internal SDK call counts.

### Log assertions

```python
import logging
import pytest

def test_charge_logs_business_event(caplog, charge_service):
    with caplog.at_level(logging.INFO):
        charge_service.charge(card, amount=Decimal("9.99"), currency="USD")

    [record] = [r for r in caplog.records if r.message == "user.charged"]
    assert record.user_id == card.holder_id
    assert record.amount == "9.99"
    assert record.currency == "USD"
```

Assert on event name + structured fields. Do **not** assert on the formatted
message string — that's brittle and locked to the formatter.

---

## TypeScript — vitest / jest

### Trace assertions

```ts
// tests/setupObservability.ts
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";

export function setupSpanCapture(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
  return exporter;
}
```

```ts
// tests/payments.test.ts
import { SpanStatusCode } from "@opentelemetry/api";
import { afterEach, expect, test } from "vitest";
import { setupSpanCapture } from "./setupObservability";
import { chargeCard } from "@/payments";

const exporter = setupSpanCapture();

afterEach(() => exporter.reset());

test("charge emits business span", async () => {
  await chargeCard(card, { amount: "9.99", currency: "USD" });

  const [span] = exporter.getFinishedSpans();
  expect(span.name).toBe("payments.charge_card");
  expect(span.attributes["payments.amount"]).toBe("9.99");
  expect(span.attributes["payments.currency"]).toBe("USD");
  expect(span.status.code).toBe(SpanStatusCode.OK);
});
```

### Metric assertions

```ts
import { InMemoryMetricExporter, MeterProvider, PeriodicExportingMetricReader, AggregationTemporality } from "@opentelemetry/sdk-metrics";
import { metrics } from "@opentelemetry/api";

const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 50 });
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [reader] }));

test("charge increments counter", async () => {
  await chargeCard(card, { amount: "9.99", currency: "USD" });
  await reader.forceFlush();

  const data = exporter.getMetrics()[0];
  const metric = data.scopeMetrics[0].metrics.find(m => m.descriptor.name === "payments.charge.attempts");
  expect(metric?.dataPoints[0].value).toBe(1);
  expect(metric?.dataPoints[0].attributes["payments.currency"]).toBe("USD");
});
```

### Log assertions

Bridge `pino` into the OTel logs SDK via `@opentelemetry/instrumentation-pino`,
then capture with the equivalent `InMemoryLogRecordExporter`. The assertion
shape is the same as Python: event name + structured fields, never the
formatted string.

---

## Rules

- **Do not mock the OTel API itself.** A test that mocks `tracer.startSpan` is
  testing the mock, not the behavior. Use the real SDK with an in-memory
  exporter.
- **Clear the exporter between tests.** `exporter.clear()` (Python) / `exporter.reset()`
  (TS) in an `afterEach` / teardown so the next test starts from a known state.
- **Pin attributes, not just span/metric existence.** "A span was created" is
  not an assertion; "a span named X with attribute Y=Z was created" is.
- **One assertion fixture per test file, configured at module top.** Setting
  up the global provider inside the test body races other tests and leaks
  state across modules.
