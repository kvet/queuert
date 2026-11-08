/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import {
  createClient,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";

import { createCompletionCounter, jobTypes, printHeader, runDoubleRunBenchmark } from "./utils.ts";

printHeader("DASHBOARD");

await runDoubleRunBenchmark<Record<string, never>>({
  name: "dashboard",
  setupInfrastructure: async () => ({
    infra: {},
    teardown: async () => {},
  }),
  runLifecycle: async (_infra, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const client = await step("After creating client", async () =>
      createClient({ stateAdapter, jobTypes }),
    );

    const dashboard = await step("After creating dashboard", async () =>
      createDashboard({ client }),
    );

    const stopWorkerRunner = await step("After creating worker", async () => {
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
      return workerRunner.start();
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await withTxHooks(async (txHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            client.createChain({
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

    await step("After first dashboard API request", async () => {
      await dashboard.fetch(new Request("http://localhost/api/chains"));
    });

    await stopWorkerRunner();
    await stateAdapter.close();
  },
});
