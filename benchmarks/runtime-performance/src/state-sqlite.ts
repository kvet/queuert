/**
 * SQLite State Adapter Memory Measurement
 */

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createInProcessNotifyAdapter,
  createWorkerRunner,
  createProcessors,
  withTxHooks,
} from "queuert";

import {
  createCompletionCounter,
  diffMemory,
  jobTypes,
  measureMemory,
  printHeader,
  runDoubleRunBenchmark,
} from "./utils.ts";

printHeader("SQLITE STATE ADAPTER");

type Infra = {
  db: Database.Database;
  stateProvider: ReturnType<typeof createBetterSqlite3StateProvider>;
};

await runDoubleRunBenchmark<Infra>({
  name: "state-sqlite",
  setupInfrastructure: async () => {
    const [beforeDb, afterDb, db] = await measureMemory(async () => {
      return new Database(":memory:");
    });
    console.log("\nAfter creating better-sqlite3 database:");
    diffMemory(beforeDb, afterDb);

    const stateProvider = createBetterSqlite3StateProvider({ db, lock: createAsyncRwLock() });

    return {
      infra: { db, stateProvider },
      teardown: async () => {
        db.close();
      },
    };
  },
  runLifecycle: async ({ stateProvider }, { step, processStep, jobCount }) => {
    const completions = createCompletionCounter(jobCount);

    const notifyAdapter = await step("After creating notify adapter", async () =>
      createInProcessNotifyAdapter(),
    );

    const stateAdapter = await step("After creating state adapter (with migrations)", async () => {
      const adapter = createSqliteStateAdapter({ stateProvider });
      await adapter.migrateToLatest();
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
                const result = await withTxHooks(async (txHooks) =>
                  stateProvider.withTransaction(async (ctx) =>
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
      const stopWorkerRunner = await workerRunner.start();
      return { client, stopWorkerRunner };
    });

    await processStep(`After processing ${jobCount} jobs`, async () => {
      for (let i = 0; i < jobCount; i++) {
        await withTxHooks(async (txHooks) =>
          stateProvider.withTransaction(async (ctx) =>
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

    await setup.stopWorkerRunner();
    await stateAdapter.close();
    await notifyAdapter.close();
  },
});
