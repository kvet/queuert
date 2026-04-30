/**
 * SQLite State Adapter Memory Measurement
 */

import { createAsyncRwLock, createSqliteStateAdapter } from "@queuert/sqlite";
import Database from "better-sqlite3";
import { createBetterSqlite3StateProvider } from "example-state-sqlite-better-sqlite3/provider";
import {
  createClient,
  createInProcessNotifyAdapter,
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

printHeader("SQLITE STATE ADAPTER");

type Infra = {
  db: Database.Database;
  stateProvider: ReturnType<typeof createBetterSqlite3StateProvider>;
};

await runDoubleRunBenchmark<Infra>({
  name: "state-sqlite",
  setupInfrastructure: async () => {
    const [beforeDb, afterDb, db] = await measureMemory(async () => {
      const db = new Database(":memory:");
      db.pragma("auto_vacuum = INCREMENTAL");
      db.pragma("foreign_keys = ON");
      return db;
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
  runLifecycle: async ({ stateProvider }, { step, processStep }) => {
    const notifyAdapter = await step("After creating notify adapter", async () =>
      createInProcessNotifyAdapter(),
    );

    const stateAdapter = await step("After creating state adapter (with migrations)", async () => {
      const adapter = await createSqliteStateAdapter({ stateProvider });
      await adapter.migrateToLatest();
      return adapter;
    });

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
          stateProvider.withTransaction(async (ctx) =>
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
    await stateAdapter.close();
    await notifyAdapter.close();
  },
});
