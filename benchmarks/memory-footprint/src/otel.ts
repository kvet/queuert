/**
 * OpenTelemetry Observability Adapter Memory Measurement
 */

import { metrics } from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createOtelObservabilityAdapter } from "@queuert/otel";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";

import {
  diffMemory,
  jobTypes,
  measureBaseline,
  measureMemory,
  printHeader,
  printSummary,
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
  }),
);
console.log("\nAfter creating OtelObservabilityAdapter:");
diffMemory(beforeAdapter, afterAdapter);

const stateAdapter = await createInProcessStateAdapter();
const notifyAdapter = await createInProcessNotifyAdapter();

const [beforeSetup, afterSetup, { client, stopWorker }] = await measureMemory(async () => {
  const client = await createClient({
    stateAdapter,
    notifyAdapter,
    observabilityAdapter,
    jobTypes,
  });

  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        "test-job": {
          attemptHandler: async ({ complete }) => complete(async () => ({ processed: true })),
        },
      },
    }),
  });

  const stopWorker = await worker.start();
  return { client, stopWorker };
});
console.log("\nAfter creating client + worker (with observability):");
diffMemory(beforeSetup, afterSetup);

console.log("\nProcessing 100 jobs...");
const [beforeProcessing, afterProcessing] = await measureMemory(async () => {
  const promises = [];
  for (let i = 0; i < 100; i++) {
    const jobChain = await withTransactionHooks(async (transactionHooks) =>
      stateAdapter.withTransaction(async (ctx) =>
        client.startJobChain({
          ...ctx,
          transactionHooks,
          typeName: "test-job",
          input: { message: `Test message ${i}` },
        }),
      ),
    );
    promises.push(client.awaitJobChain(jobChain, { timeoutMs: 5000 }));
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
