/**
 * OpenTelemetry Observability Adapter Memory Measurement
 */

import { metrics } from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createOtelObservabilityAdapter } from "@queuert/otel";
import { createQueuertClient, createQueuertInProcessWorker } from "queuert";
import { createInProcessNotifyAdapter, createInProcessStateAdapter } from "queuert/internal";
import {
  diffMemory,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
  registry,
} from "./utils.js";

class NoopMetricExporter {
  export(_metrics: unknown, resultCallback: (result: { code: number }) => void): void {
    resultCallback({ code: 0 });
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

printHeader("OPENTELEMETRY OBSERVABILITY ADAPTER");

const baseline = await measureBaseline();

const [beforeOtel, afterOtelSetup, provider] = await measureMemory(async () => {
  const exporter = new NoopMetricExporter();
  const reader = new PeriodicExportingMetricReader({
    exporter: exporter as never,
    exportIntervalMillis: 60000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  metrics.setGlobalMeterProvider(provider);
  return provider;
});
console.log("\nAfter creating OTEL MeterProvider:");
diffMemory(beforeOtel, afterOtelSetup);

const [beforeAdapter, afterAdapter, observabilityAdapter] = await measureMemory(async () =>
  createOtelObservabilityAdapter({
    meter: metrics.getMeter("queuert-perf"),
    metricPrefix: "queuert",
  }),
);
console.log("\nAfter creating OtelObservabilityAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const stateAdapter = createInProcessStateAdapter();
const notifyAdapter = createInProcessNotifyAdapter();

const [beforeSetup, afterSetup, { qrtClient, stopWorker }] = await measureMemory(async () => {
  const qrtClient = await createQueuertClient({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log: () => {},
    registry,
  });

  const qrtWorker = await createQueuertInProcessWorker({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    log: () => {},
    registry,
    processors: {
      "test-job": {
        attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
      },
    },
  });

  const stopWorker = await qrtWorker.start();
  return { qrtClient, stopWorker };
});
console.log("\nAfter creating client + worker (with observability):");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const chain = await qrtClient.withNotify(async () =>
      stateAdapter.runInTransaction(async (ctx) =>
        qrtClient.startJobChain({
          ...ctx,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(qrtClient.waitForJobChainCompletion(chain, { timeoutMs: 5000 }));
  }
  await Promise.all(promises);
});
console.log("\nAfter processing 100 jobs:");
diffMemory(beforeProcessing, afterProcessing);

await stopWorker();
await provider.shutdown();

const [, afterCleanup] = await measureMemory(async () => {});
console.log("\nAfter cleanup (delta from baseline):");
diffMemory(baseline, afterCleanup);

printSummary([
  ["OTEL MeterProvider:", afterOtelSetup.heapUsed - beforeOtel.heapUsed],
  ["Otel adapter:", afterAdapter.heapUsed - beforeAdapter.heapUsed],
  ["Client + worker:", afterSetup.heapUsed - beforeSetup.heapUsed],
]);
