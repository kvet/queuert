import { type UUID } from "node:crypto";

import Database from "better-sqlite3";
import {
  type StateAdapter,
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import { createAsyncRwLock } from "queuert/internal";
import { stateAdapterConformanceTestSuite, withWorkers } from "queuert/testing";
import { describe, expectTypeOf, it, vi } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.js";
import { extendWithStateSqlite } from "../testing.js";

it("index");

describe("SQLite State Adapter Conformance", () => {
  const tablePrefix = "queuert_";

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new Database(":memory:");
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

const typeInferenceIt = extendWithStateSqlite(it);

typeInferenceIt("infers custom ID types through the full stack", async ({ db }) => {
  const lock = createAsyncRwLock();
  const stateProvider = createBetterSqlite3Provider({ db, lock });
  const stateAdapter = await createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    idType: "TEXT",
    generateId: () => `job.${crypto.randomUUID()}`,
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = await createInProcessNotifyAdapter();
  const log = vi.fn();
  const jobTypes = defineJobTypes<{
    test: {
      entry: true;
      input: { foo: string };
      output: { bar: number };
    };
  }>();

  const client = await createClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypes,
  });
  // Transactions passed to queuert hold the provider's write lock, as SQLite requires.
  const withTransaction = async <T>(fn: (txDb: typeof db) => Promise<T>): Promise<T> => {
    using _h = await lock.acquireWrite();
    db.exec("BEGIN");
    try {
      const result = await fn(db);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      if (db.inTransaction) db.exec("ROLLBACK");
      throw error;
    }
  };

  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ job, finish }) => {
            expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

            return withTransactionHooks(async (transactionHooks) =>
              withTransaction(async (db) => finish({ db, transactionHooks, output: { bar: 42 } })),
            );
          },
        },
      },
    }),
  });

  const chain = await withTransactionHooks(async (transactionHooks) =>
    withTransaction(async (db) =>
      client.createChain({
        db,
        transactionHooks,
        typeName: "test",
        input: { foo: "hello" },
      }),
    ),
  );
  expectTypeOf(chain.id).toEqualTypeOf<`job.${UUID}`>();

  await withWorkers([await worker.start()], async () => {
    await client.awaitChain(chain, { timeoutMs: 1000 });
  });
});
