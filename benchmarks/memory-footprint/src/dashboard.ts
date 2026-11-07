/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";

import { jobTypes, printHeader, runDoubleRunBenchmark } from "./utils.ts";

printHeader("DASHBOARD");

await runDoubleRunBenchmark<Record<string, never>>({
  name: "dashboard",
  setupInfrastructure: async () => ({
    infra: {},
    teardown: async () => {},
  }),
  runLifecycle: async (_infra, { step, processStep }) => {
    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createInProcessNotifyAdapter(),
    );

    const client = await step("After creating client", async () =>
      createClient({ stateAdapter, notifyAdapter, jobTypes }),
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
      return workerRunner.start();
    });

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const chain = await withTxHooks(async (txHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            client.createChain({
              ...ctx,
              txHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(client.awaitChain(chain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await step("After first dashboard API request", async () => {
      await dashboard.fetch(new Request("http://localhost/api/chains"));
    });

    await stopWorkerRunner();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
