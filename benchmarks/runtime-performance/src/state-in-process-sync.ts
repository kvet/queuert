/**
 * In-process (sync) State Adapter Memory Measurement
 */

import {
  createClient,
  createWorkerRunner,
  createProcessors,
  createSyncInProcessStateAdapter,
} from "queuert";

import { createCompletionCounter, jobTypes, printHeader, runDoubleRunBenchmark } from "./utils.ts";

printHeader("IN-PROCESS (SYNC) STATE ADAPTER");

await runDoubleRunBenchmark<Record<string, never>>({
  name: "state-in-process-sync",
  setupInfrastructure: async () => ({ infra: {}, teardown: async () => {} }),
  runLifecycle: async (_infra, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createSyncInProcessStateAdapter(),
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
                const result = stateAdapter.withTransaction((ctx) =>
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
        stateAdapter.withTransaction((ctx) =>
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
    stateAdapter.close();
  },
});
