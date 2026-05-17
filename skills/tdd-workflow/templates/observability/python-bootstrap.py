"""
OpenTelemetry SDK bootstrap — copy into the service as `observability.py` and
call `setup_observability()` exactly once at process start, before any framework
wiring (FastAPI app construction, Flask app init, Celery worker setup).

Reads every endpoint and credential from `OTEL_*` env vars (per the iron rule
in `references/observability-patterns.md` — no hard-coded endpoints in source).

Required env vars in every environment, including `.env.example`:
    OTEL_SERVICE_NAME=<the-service-name>
    OTEL_SERVICE_VERSION=<semver-or-git-sha>
    OTEL_SERVICE_NAMESPACE=<team-or-product>
    DEPLOYMENT_ENVIRONMENT=<local|dev|staging|prod>

Optional / wired by the Collector deployment:
    OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
    OTEL_EXPORTER_OTLP_HEADERS=<auth headers if the Collector requires them>

The exporter uses OTLP gRPC (port 4317). Use the HTTP variant
(`opentelemetry.exporter.otlp.proto.http.*`, port 4318) only when gRPC is
blocked by the network path; the rest of this file is unchanged.
"""

from __future__ import annotations

import logging
import os

from opentelemetry import _logs, metrics, trace
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup_observability() -> None:
    """Bootstrap traces, metrics, and logs for this service.

    Call exactly once at process start. Re-entry is a bug — the OTel SDK does
    not support multiple providers per signal in the same process, and a second
    call silently shadows the first while leaking exporter goroutines.
    """
    resource = _build_resource()

    _setup_traces(resource)
    _setup_metrics(resource)
    _setup_logs(resource)


def _build_resource() -> Resource:
    return Resource.create(
        {
            "service.name": os.environ["OTEL_SERVICE_NAME"],
            "service.version": os.environ["OTEL_SERVICE_VERSION"],
            "service.namespace": os.environ["OTEL_SERVICE_NAMESPACE"],
            "deployment.environment": os.environ["DEPLOYMENT_ENVIRONMENT"],
        }
    )


def _setup_traces(resource: Resource) -> None:
    provider = TracerProvider(resource=resource)
    # BatchSpanProcessor is REQUIRED in production. The synchronous variant
    # blocks the request thread on the exporter's network IO.
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)


def _setup_metrics(resource: Resource) -> None:
    reader = PeriodicExportingMetricReader(OTLPMetricExporter())
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))


def _setup_logs(resource: Resource) -> None:
    provider = LoggerProvider(resource=resource)
    # BatchLogRecordProcessor is REQUIRED in production for the same reason as
    # the BatchSpanProcessor above.
    provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))
    _logs.set_logger_provider(provider)

    # Bridge the stdlib logger into OTel so every `logger.info(...)` call
    # produces an OTel LogRecord that carries the active trace_id / span_id.
    # If the service uses `structlog`, wrap structlog's `LoggerFactory` to call
    # into stdlib logging — do NOT install a parallel sink that bypasses OTel.
    handler = LoggingHandler(level=logging.INFO, logger_provider=provider)
    logging.getLogger().addHandler(handler)
    logging.getLogger().setLevel(logging.INFO)
