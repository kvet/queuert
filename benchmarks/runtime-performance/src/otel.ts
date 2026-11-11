/**
 * OpenTelemetry Observability Adapter Memory Measurement
 */

import { metrics } from "@opentelemetry/api";
import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { createOtelObservabilityAdapter } from "@queuert/otel";
import { createClient, createWorkerRunner, createProcessors, withTxHooks } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

import {
  createCompletionCounter,
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
  runLifecycle: async (_infra, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const observabilityAdapter = await step("After creating observability adapter", async () =>
      createOtelObservabilityAdapter({
        meter: metrics.getMeter("queuert-perf"),
      }),
    );

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const setup = await step("After creating client + worker (with observability)", async () => {
      const client = createClient({
        stateAdapter,
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
              attemptHandler: async ({ complete }) => {
                const result = await withTxHooks(async (txHooks) =>
                  stateAdapter.withTransaction(async (ctx) =>
                    complete({ ...ctx, txHooks, output: { processed: true } }),
                  ),
                );
                completions.record();
                return result;
              },
            },
          },
        }),
      });
      await workerRunner.start();
      return { client, workerRunner };
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await withTxHooks(async (txHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.createChain({
              ...ctx,
              txHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
      }
      await completions.done;
    });

    await setup.workerRunner.close();
    await stateAdapter.close();
  },
});
