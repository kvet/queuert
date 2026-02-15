import { metrics, trace } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { createOtelObservabilityAdapter } from "@queuert/otel";

const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";

// Shared resource for all telemetry
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: "queuert-example",
});

// --- Tracing Setup ---
const traceExporter = new OTLPTraceExporter({
  url: `${OTLP_ENDPOINT}/v1/traces`,
});

const tracerProvider = new NodeTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(traceExporter)],
});
tracerProvider.register();

// --- Metrics Setup ---
const metricExporter = new OTLPMetricExporter({
  url: `${OTLP_ENDPOINT}/v1/metrics`,
});

const metricReader = new PeriodicExportingMetricReader({
  exporter: metricExporter,
  exportIntervalMillis: 5000,
});

const meterProvider = new MeterProvider({
  resource,
  readers: [metricReader],
});
metrics.setGlobalMeterProvider(meterProvider);

// --- Queuert Observability Adapter ---
export const observabilityAdapter = await createOtelObservabilityAdapter({
  meter: metrics.getMeter("queuert"),
  tracer: trace.getTracer("queuert"),
});

// --- Flush & Shutdown ---
// Errors are swallowed - example should work even without a collector running
export const flush = async (): Promise<void> => {
  await Promise.allSettled([tracerProvider.forceFlush(), metricReader.forceFlush()]);
};

export const shutdown = async (): Promise<void> => {
  await Promise.allSettled([tracerProvider.shutdown(), meterProvider.shutdown()]);
};
