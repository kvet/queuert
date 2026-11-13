/**
 * IPC Notify Adapter Memory Measurement
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIpcNotifyAdapter } from "@queuert/ipc";
import {
  type SyncNotifyAdapter,
  createProcessors,
  createClient,
  createWorkerRunner,
  createSyncInProcessStateAdapter,
} from "queuert";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

printHeader("IPC NOTIFY ADAPTER");

type Infra = {
  directory: string;
};

await runDoubleRunBenchmark<Infra>({
  name: "notify-ipc",
  setupInfrastructure: async () => {
    const [before, after, directory] = await measureMemory(async () =>
      mkdtempSync(join(tmpdir(), "queuert-perf-ipc-")),
    );
    console.log("\nAfter creating the IPC directory:");
    diffMemory(before, after);

    return {
      infra: { directory },
      teardown: async () => {
        rmSync(directory, { recursive: true, force: true });
      },
    };
  },
  runLifecycle: async ({ directory }, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const stateAdapter = await step("After creating state adapter", async () =>
      createSyncInProcessStateAdapter(),
    );

    const notifyAdapter = await step("After creating notify adapter", async () => {
      const sender = createIpcNotifyAdapter({ directory });
      const receiver = createIpcNotifyAdapter({ directory });
      const warmUp = Promise.withResolvers<void>();
      const disposeWarmUp = receiver.listenJobScheduled(["warm-up"], () => {
        warmUp.resolve();
      });
      const sendWarmUp = (): void => {
        sender.notifyJobsScheduled(["warm-up"]);
      };
      sendWarmUp();
      const warmUpInterval = setInterval(sendWarmUp, 50);
      await warmUp.promise;
      clearInterval(warmUpInterval);
      disposeWarmUp();
      const adapter: SyncNotifyAdapter = {
        ...receiver,
        notifyJobsScheduled: sender.notifyJobsScheduled,
        notifyChainsCompleted: sender.notifyChainsCompleted,
        notifyJobAttemptsLost: sender.notifyJobAttemptsLost,
        close: () => {
          sender.close();
          receiver.close();
        },
      };
      return adapter;
    });

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
    notifyAdapter.close();
    stateAdapter.close();
  },
});
