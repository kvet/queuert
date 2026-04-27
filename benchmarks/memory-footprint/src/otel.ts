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
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.js";

class NoopMetricExporter {
  export(_metrics: unknown, resultCallback: (result: { code: number }) => void): void {
    resultCallback({ code: 0 });
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}
}

printHeader("OPENTELEMETRY OBSERVABILITY ADAPTER");

type Infra = {
  provider: MeterProvider;
};

await runDoubleRunBenchmark<Infra>({
  name: "otel",
  setupInfrastructure: async () => {
    const [beforeOtel, afterOtel, provider] = await measureMemory(async () => {
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
    diffMemory(beforeOtel, afterOtel);

    return {
      infra: { provider },
      teardown: async () => {
        await provider.shutdown();
      },
    };
  },
  runLifecycle: async (_infra, { step, processStep }) => {
    const observabilityAdapter = await step("After creating observability adapter", async () =>
      createOtelObservabilityAdapter({
        meter: metrics.getMeter("queuert-perf"),
      }),
    );

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createInProcessNotifyAdapter(),
    );

    const setup = await step("After creating client + worker (with observability)", async () => {
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

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const jobChain = await withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.startJobChain({
              ...ctx,
              transactionHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitJobChain(jobChain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorker();
    await stateAdapter.close();
    await notifyAdapter.close();
  },
});
