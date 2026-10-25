import { type UUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { createAsyncRwLock } from "@queuert/helpers";
import {
  type StateAdapter,
  createClient,
  createInProcessNotifyAdapter,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
} from "queuert";
import { stateAdapterConformanceTestSuite, withWorkers } from "queuert/testing";
import { describe, expectTypeOf, it, vi } from "vitest";

import { createAsyncSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createNodeSqliteProvider } from "../state-provider/state-provider.node-sqlite.js";

it("index");

describe("SQLite State Adapter Conformance (node:sqlite)", () => {
  const tablePrefix = "queuert_";

  const conformanceIt = it.extend<{
    db: DatabaseSync;
    stateAdapter: StateAdapter<{ $test: true }, string>;
    transactionConcurrency: "concurrent" | "serialized";
    withNonTransactionContext: <T>(fn: (txCtx: { $test: true }) => Promise<T>) => Promise<T>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = new DatabaseSync(":memory:");
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
        const stateProvider = createNodeSqliteProvider({ db });
        const adapter = createAsyncSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
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

it("infers custom ID types through the full stack", async () => {
  const db = new DatabaseSync(":memory:");

  try {
    const lock = createAsyncRwLock();
    const stateProvider = createNodeSqliteProvider({ db, lock });
    const stateAdapter = createAsyncSqliteStateAdapter({
      stateProvider,
      tablePrefix: "myapp_",
      idType: "TEXT",
      generateId: () => `job.${crypto.randomUUID()}`,
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

    const withTransaction = async <T>(fn: (db: DatabaseSync) => Promise<T>): Promise<T> => {
      using _h = await lock.acquireWrite();
      db.exec("BEGIN");
      try {
        const result = await fn(db);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    };

    const worker = createInProcessWorker({
      client,
      processors: createProcessors({
        client,
        jobTypes,
        processors: {
          test: {
            attemptHandler: async ({ job, complete }) => {
              expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

              return withTransactionHooks(async (transactionHooks) =>
                withTransaction(async (db) =>
                  complete({ db, transactionHooks, output: { bar: 42 } }),
                ),
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
  } finally {
    db.close();
  }
});
