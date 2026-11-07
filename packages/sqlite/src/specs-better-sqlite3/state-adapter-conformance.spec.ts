import type { UUID } from "node:crypto";

import { createAsyncRwLock } from "@queuert/helpers";
import Database from "better-sqlite3";
import {
  type StateAdapter,
  createClient,
  createInProcessNotifyAdapter,
  createWorkerRunner,
  createProcessors,
  defineJobTypes,
  withTxHooks,
} from "queuert";
import { stateAdapterConformanceTestSuite, withWorkerRunners } from "queuert/testing";
import { describe, expectTypeOf, it, vi } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.ts";
import { createBetterSqlite3Provider } from "../state-provider/state-provider.better-sqlite3.ts";
import { extendWithStateSqlite } from "../testing.ts";

it("index");

describe("SQLite State Adapter Conformance", () => {
  const tablePrefix = "queuert_";

  const conformanceIt = it.extend<{
    db: Database.Database;
    stateAdapter: StateAdapter<{ $test: true }, string, string>;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
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
    transactionConcurrency: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        await use("serialized");
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createBetterSqlite3Provider({ db });
        const adapter = createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string, string>);
      },
      { scope: "test" },
    ],
    withNonTransactionContext: [
      async ({ db }, use) => {
        await use(async (fn) => fn({ db } as unknown as { $test: true }));
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
  const stateAdapter = createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    jobIdType: "TEXT",
    generateJobId: () => `job.${crypto.randomUUID()}`,
  });

  await stateAdapter.migrateToLatest();

  const notifyAdapter = createInProcessNotifyAdapter();
  const log = vi.fn();
  const jobTypes = defineJobTypes<{
    test: {
      entry: true;
      input: { foo: string };
      output: { bar: number };
    };
  }>();

  const client = createClient({
    stateAdapter,
    notifyAdapter,
    log,
    jobTypes,
  });

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

  const workerRunner = createWorkerRunner({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ job, complete, fence }) => {
            expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();
            expectTypeOf(fence).parameter(0).toEqualTypeOf<{ db: Database.Database }>();

            await withTransaction(async (db) => fence({ db }));

            return withTxHooks(async (txHooks) =>
              withTransaction(async (db) => {
                await fence({ db });
                return complete({ db, txHooks, output: { bar: 42 } });
              }),
            );
          },
        },
      },
    }),
  });

  const chain = await withTxHooks(async (txHooks) =>
    withTransaction(async (db) =>
      client.createChain({
        db,
        txHooks,
        typeName: "test",
        input: { foo: "hello" },
      }),
    ),
  );
  expectTypeOf(chain.id).toEqualTypeOf<`job.${UUID}`>();

  await withWorkerRunners([await workerRunner.start()], async () => {
    await client.awaitChain(chain, { timeoutMs: 1000 });
  });
});
