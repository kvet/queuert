/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import { createClient, createWorkerRunner, createProcessors } from "queuert";
import { createInProcessStateAdapter } from "queuert/internal";

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

    const workerRunner = await step("After creating worker", async () => {
      const workerRunner = createWorkerRunner({
        client,
        processors: createProcessors({
          client,
          jobTypes,
          processors: {
            "test-job": {
              attemptHandler: async ({ complete }) => {
                const result = await stateAdapter.withTransaction(async (ctx) =>
                  complete({ ...ctx, output: { processed: true } }),
                );
                completions.record();
                return result;
              },
            },
          },
        }),
      });
      await workerRunner.start();
      return workerRunner;
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await stateAdapter.withTransaction(async (ctx) =>
          client.createChain({
            ...ctx,
            typeName: "test-job",
            input: { message: `Test message ${i}` },
          }),
        );
      }
      await completions.done;
    });

    await step("After first dashboard API request", async () => {
      await dashboard.fetch(new Request("http://localhost/api/chains"));
    });

    await workerRunner.close();
    await stateAdapter.close();
  },
});
