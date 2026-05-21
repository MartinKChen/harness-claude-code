/**
 * OpenTelemetry SDK bootstrap — copy into the service as `observability.ts`
 * and import it ONCE at the very top of the process entrypoint, before any
 * framework wiring (`express()` / `fastify()` / NestJS bootstrap / Next.js
 * server start). Auto-instrumentation hooks must register before the modules
 * they wrap are required.
 *
 * Reads every endpoint and credential from `OTEL_*` env vars (per the iron
 * rule in `references/observability-patterns.md` — no hard-coded endpoints
 * in source).
 *
 * Required env vars in every environment, including `.env.example`:
 *   OTEL_SERVICE_NAME=<the-service-name>
 *   OTEL_SERVICE_VERSION=<semver-or-git-sha>
 *   OTEL_SERVICE_NAMESPACE=<team-or-product>
 *   DEPLOYMENT_ENVIRONMENT=<local|dev|staging|prod>
 *
 * Optional / wired by the Collector deployment:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
 *   OTEL_EXPORTER_OTLP_HEADERS=<auth headers if the Collector requires them>
 *
 * The exporter uses OTLP gRPC (port 4317). Use the HTTP variant
 * (`@opentelemetry/exporter-*-otlp-http`, port 4318) only when gRPC is blocked
 * by the network path; the rest of this file is unchanged.
 */

import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-grpc";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-grpc";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import {
  SemanticResourceAttributes,
} from "@opentelemetry/semantic-conventions";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: requireEnv("OTEL_SERVICE_NAME"),
  [SemanticResourceAttributes.SERVICE_VERSION]: requireEnv("OTEL_SERVICE_VERSION"),
  [SemanticResourceAttributes.SERVICE_NAMESPACE]: requireEnv("OTEL_SERVICE_NAMESPACE"),
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: requireEnv("DEPLOYMENT_ENVIRONMENT"),
});

// BatchSpanProcessor / BatchLogRecordProcessor are REQUIRED in production —
// the synchronous variants block the event loop on the exporter's network IO.
const sdk = new NodeSDK({
  resource,
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter()),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  logRecordProcessor: new BatchLogRecordProcessor(new OTLPLogExporter()),
  // Auto-instrumentation covers HTTP server/client, fetch, Express, Fastify,
  // pg / mysql / mongodb, ioredis, AWS SDK, gRPC, etc. — do NOT hand-roll
  // spans for any of these. Hand-rolled spans are for business operations.
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Shut the SDK down cleanly on process exit so the batch processors flush
// pending spans/metrics/logs to the Collector before the process dies.
const shutdown = async (): Promise<void> => {
  try {
    await sdk.shutdown();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("OpenTelemetry shutdown failed", err);
  } finally {
    process.exit(0);
  }
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
