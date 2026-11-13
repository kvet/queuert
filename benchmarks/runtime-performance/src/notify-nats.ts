/**
 * NATS Notify Adapter Memory Measurement
 */

import { type NatsConnection, connect } from "@nats-io/transport-node";
import { createNatsNotifyAdapter } from "@queuert/nats";
import { NatsContainer } from "@testcontainers/nats";
import {
  createClient,
  createWorkerRunner,
  createProcessors,
  createInProcessStateAdapter,
} from "queuert";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

printHeader("NATS NOTIFY ADAPTER");

type Infra = {
  nc: NatsConnection;
};

await runDoubleRunBenchmark<Infra>({
  name: "notify-nats",
  setupInfrastructure: async () => {
    console.log("\nStarting NATS container...");
    const [beforeContainer, afterContainer, natsContainer] = await measureMemory(async () =>
      new NatsContainer("nats:2").withExposedPorts(4222).start(),
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
  runLifecycle: async ({ nc }, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createNatsNotifyAdapter({ nc, subjectPrefix: "queuert_perf" }),
    );

    const setup = await step("After creating client + worker", async () => {
      const client = createClient({ stateAdapter, notifyAdapter, jobTypes });
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
    await notifyAdapter.close();
    await stateAdapter.close();
  },
});
