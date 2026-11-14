/**
 * In-process State Adapter Memory Measurement, async mode
 */

import {
  createClient,
  createWorkerRunner,
  createProcessors,
  createInProcessStateAdapter,
} from "queuert";

import { createCompletionCounter, jobTypes, printHeader, runDoubleRunBenchmark } from "./utils.ts";

printHeader("IN-PROCESS STATE ADAPTER (ASYNC)");

await runDoubleRunBenchmark<Record<string, never>>({
  name: "state-in-process-async",
  setupInfrastructure: async () => ({ infra: {}, teardown: async () => {} }),
  runLifecycle: async (_infra, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter({ mode: "async" }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = createClient({ stateAdapter, jobTypes });
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
      return { client, workerRunner };
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await stateAdapter.withTransaction(async (ctx) =>
          setup.client.createChain({
            ...ctx,
            typeName: "test-job",
            input: { message: `Test message ${i}` },
          }),
        );
      }
      await completions.done;
    });

    await setup.workerRunner.close();
    await stateAdapter.close();
  },
});
