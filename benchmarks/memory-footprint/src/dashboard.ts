/**
 * Dashboard Memory Measurement
 */

import { createDashboard } from "@queuert/dashboard";
import {
  createClient,
  createInProcessNotifyAdapter,
  createInProcessStateAdapter,
  createInProcessWorker,
  createProcessors,
  withTransactionHooks,
} from "queuert";

import { jobTypes, printHeader, runDoubleRunBenchmark } from "./utils.js";

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

    const stopWorker = await step("After creating worker", async () => {
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
      return worker.start();
    });

    await processStep("After processing 100 jobs", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const chain = await withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            client.startChain({
              ...ctx,
              transactionHooks,
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

    await stopWorker();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
