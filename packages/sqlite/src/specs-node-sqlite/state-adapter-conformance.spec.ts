import { type UUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import {
  type StateAdapter,
  createClient,
  createInProcessWorker,
  createJobTypeProcessorRegistry,
  defineJobTypeRegistry,
  withTransactionHooks,
} from "queuert";
import { createAsyncLock, createInProcessNotifyAdapter } from "queuert/internal";
import { stateAdapterConformanceTestSuite, withWorkers } from "queuert/testing";
import { describe, expectTypeOf, it, vi } from "vitest";

import { createSqliteStateAdapter } from "../state-adapter/state-adapter.sqlite.js";
import { createNodeSqliteProvider } from "../state-provider/state-provider.node-sqlite.js";

const createDb = (): DatabaseSync => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
};

it("index");

describe("SQLite State Adapter Conformance (node:sqlite)", () => {
  const tablePrefix = "queuert_";

  const conformanceIt = it.extend<{
    db: DatabaseSync;
    stateAdapter: StateAdapter<{ $test: true }, string>;
  }>({
    db: [
      // oxlint-disable-next-line no-empty-pattern
      async ({}, use) => {
        const db = createDb();
        await use(db);
        db.close();
      },
      { scope: "test" },
    ],
    stateAdapter: [
      async ({ db }, use) => {
        const stateProvider = createNodeSqliteProvider({ db });
        const adapter = await createSqliteStateAdapter({ stateProvider, tablePrefix });
        await adapter.migrateToLatest();
        return use(adapter as unknown as StateAdapter<{ $test: true }, string>);
      },
      { scope: "test" },
    ],
  });

  stateAdapterConformanceTestSuite({ it: conformanceIt });
});

it("infers custom ID types through the full stack", async () => {
  const db = createDb();

  try {
    const stateProvider = createNodeSqliteProvider({ db });
    const stateAdapter = await createSqliteStateAdapter({
      stateProvider,
      tablePrefix: "myapp_",
      idType: "TEXT",
      idGenerator: () => `job.${crypto.randomUUID()}`,
    });

    await stateAdapter.migrateToLatest();

    const notifyAdapter = createInProcessNotifyAdapter();
    const log = vi.fn();
    const jobTypeRegistry = defineJobTypeRegistry<{
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
      jobTypeRegistry,
    });
    const worker = await createInProcessWorker({
      client,
      jobTypeProcessorRegistry: createJobTypeProcessorRegistry({
        client,
        jobTypeRegistry,
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

    const lock = createAsyncLock();

    const jobChain = await withTransactionHooks(async (transactionHooks) => {
      await lock.acquire();
      try {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = await client.startJobChain({
            db,
            transactionHooks,
            typeName: "test",
            input: { foo: "hello" },
          });
          db.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            db.exec("ROLLBACK");
          } catch {
            // ignore
          }
          throw error;
        }
      } finally {
        lock.release();
      }
    });
    expectTypeOf(jobChain.id).toEqualTypeOf<`job.${UUID}`>();

    await withWorkers([await worker.start()], async () => {
      await client.awaitJobChain(jobChain, { timeoutMs: 1000 });
    });
  } finally {
    db.close();
  }
});
