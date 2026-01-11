import { metrics } from "@opentelemetry/api";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
} from "@opentelemetry/sdk-metrics";
import { createOtelObservabilityAdapter } from "@queuert/otel";

// Create OTEL metric exporter that outputs to console
const exporter = new ConsoleMetricExporter();

// Create metric reader with short export interval for demo
const reader = new PeriodicExportingMetricReader({
  exporter,
  exportIntervalMillis: 5000, // Export every 5 seconds
});

// Create and register meter provider
const provider = new MeterProvider({
  readers: [reader],
});
metrics.setGlobalMeterProvider(provider);

// Create queuert observability adapter using the global meter
export const observabilityAdapter = createOtelObservabilityAdapter({
  meter: metrics.getMeter("queuert-example"),
  metricPrefix: "queuert",
});

// Export flush function to force metric export before exit
export const flushMetrics = async (): Promise<void> => {
  await reader.forceFlush();
};

// Export shutdown function for cleanup
export const shutdownMetrics = async (): Promise<void> => {
  await provider.shutdown();
};
