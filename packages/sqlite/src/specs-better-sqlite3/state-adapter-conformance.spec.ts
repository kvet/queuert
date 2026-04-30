import { type UUID } from "node:crypto";

import Database from "better-sqlite3";
import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createProcessors,
  defineJobTypes,
  withTransactionHooks,
  createInProcessNotifyAdapter,
} from "queuert";
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
        db.pragma("journal_mode = WAL");
        db.pragma("auto_vacuum = INCREMENTAL");
        db.pragma("foreign_keys = ON");
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
  const stateProvider = createBetterSqlite3Provider({ db });
  const stateAdapter = await createSqliteStateAdapter({
    stateProvider,
    tablePrefix: "myapp_",
    idType: "TEXT",
    idGenerator: () => `job.${crypto.randomUUID()}`,
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
  const worker = await createInProcessWorker({
    client,
    processors: createProcessors({
      client,
      jobTypes,
      processors: {
        test: {
          attemptHandler: async ({ job, complete }) => {
            expectTypeOf(job.id).toEqualTypeOf<`job.${UUID}`>();

            return complete(async () => ({ bar: 42 }));
          },
        },
      },
    }),
  });

  const outerDb = db;
  const withTransaction = async <T>(fn: (db: typeof outerDb) => Promise<T>): Promise<T> => {
    db.exec("BEGIN");
    try {
      const result = await fn(outerDb);
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const chain = await withTransactionHooks(async (transactionHooks) =>
    withTransaction(async (db) =>
      client.startChain({
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
