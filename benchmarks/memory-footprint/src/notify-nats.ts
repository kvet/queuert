/**
 * NATS Notify Adapter Memory Measurement
 */

import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import { type NatsConnection, connect } from "nats";
import {
  createClient,
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

printHeader("NATS NOTIFY ADAPTER");

type Infra = {
  nc: NatsConnection;
};

await runDoubleRunBenchmark<Infra>({
  name: "notify-nats",
  setupInfrastructure: async () => {
    console.log("\nStarting NATS container...");
    const [beforeContainer, afterContainer, natsContainer] = await measureMemory(async () =>
      new NatsContainer("nats:2.10").withExposedPorts(4222).start(),
    );
    console.log("\nAfter starting container (testcontainers overhead):");
    diffMemory(beforeContainer, afterContainer);

    const [beforeConnection, afterConnection, nc] = await measureMemory(async () =>
      connect(natsContainer.getConnectionOptions()),
    );
    console.log("\nAfter creating NATS connection:");
    diffMemory(beforeConnection, afterConnection);

    return {
      infra: { nc },
      teardown: async () => {
        await nc.close();
        await natsContainer.stop();
      },
    };
  },
  runLifecycle: async ({ nc }, { step, processStep }) => {
    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_perf" }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = await createClient({ stateAdapter, notifyAdapter, jobTypes });
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
        const chain = await withTransactionHooks(async (transactionHooks) =>
          stateAdapter.withTransaction(async (ctx) =>
            setup.client.startChain({
              ...ctx,
              transactionHooks,
              typeName: "test-job",
              input: { message: `Test message ${i}` },
            }),
          ),
        );
        promises.push(setup.client.awaitChain(chain, { timeoutMs: 5000 }));
      }
      await Promise.all(promises);
    });

    await setup.stopWorker();
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
