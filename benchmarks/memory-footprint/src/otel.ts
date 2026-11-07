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
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";

import {
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

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
        exporter,
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
      const client = createClient({
        stateAdapter,
        notifyAdapter,
        observabilityAdapter,
        jobTypes,
      });
      const workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) =>
                withTxHooks(async (txHooks) =>
                  stateAdapter.withTransaction(async (ctx) =>
                    complete({ ...ctx, txHooks, output: { processed: true } }),
                  ),
                ),
            },
          },
        }),
      });
      const stopWorkerRunner = await workerRunner.start();
      return { client, stopWorkerRunner };
    });

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const chain = await withTxHooks(async (txHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.createChain({
              ...ctx,
              txHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitChain(chain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorkerRunner();
    await stateAdapter.close();
    await notifyAdapter.close();
  },
});
